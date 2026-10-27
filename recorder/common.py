"""Shared, platform-independent part of the recorder sidecars (Windows narrate_win.py, macOS narrate.py):
tool discovery, process helpers, the crash journal, and the intelligence layer — Smart Director analysis (add-on §7–9),
voice clean-up (§16) and local transcription (§43). Standard library + ffmpeg only; the speech engine installs itself
into a private virtual environment on first use.
"""
import glob, json, math, os, re, shutil, subprocess, sys, threading, time
from datetime import datetime

IS_WIN = sys.platform == "win32"
now = time.time
CREATE_NO_WINDOW = 0x08000000 if IS_WIN else 0   # never flash a console when launched from the app (Windows)
def emit(**kw): print(json.dumps(kw), flush=True)
def log(msg): print(msg, file=sys.stderr, flush=True)
def assign_job(proc): pass                        # Windows replaces this with its kill-on-close job object

# ---------------------------------------------------------------- tools
def find_tool(name):
    env = os.environ.get(f"NARRATE_{name.upper()}")
    if env and os.path.exists(env): return env
    p = shutil.which(name)
    if p: return p
    if IS_WIN:
        local = os.environ.get("LOCALAPPDATA", "")
        candidates = [os.path.join(local, "Microsoft", "WinGet", "Links", f"{name}.exe"),
                      os.path.expanduser(rf"~\bin\{name}.exe"), rf"C:\ffmpeg\bin\{name}.exe"]
        candidates += glob.glob(os.path.join(local, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg*", "*", "bin", f"{name}.exe"))
    else:
        candidates = [os.path.expanduser(f"~/bin/{name}"), f"/opt/homebrew/bin/{name}", f"/usr/local/bin/{name}", f"/usr/bin/{name}"]
    return next((c for c in candidates if os.path.exists(c)), None)

FFMPEG = find_tool("ffmpeg"); FFPROBE = find_tool("ffprobe")

def run(cmd, timeout=30):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          timeout=timeout, creationflags=CREATE_NO_WINDOW)

def need_ffmpeg():
    if FFMPEG and FFPROBE: return
    emit(event="error", code="no_ffmpeg", message=("ffmpeg is not installed. Install it with `winget install Gyan.FFmpeg`, then reopen HomaCapture." if IS_WIN else "ffmpeg is not installed. Install it with `brew install ffmpeg`, then reopen HomaCapture."))
    sys.exit(2)


# ---------------------------------------------------------------- helpers
def probe(path):
    try:
        out = run([FFPROBE, "-v", "error", "-show_entries", "stream=start_time,duration,nb_frames,codec_type,width,height", "-of", "json", path]).stdout
        return json.loads(out)["streams"][0]
    except Exception: return {}

def drain(pipe, sink):
    def go():
        for line in pipe: sink(line.rstrip("\n"))
    th = threading.Thread(target=go, daemon=True); th.start(); return th

def kill(proc):
    if proc.poll() is None:
        proc.terminate()
        try: proc.wait(2)
        except subprocess.TimeoutExpired: proc.kill(); proc.wait()


class Journal:
    """Append-only line journal (events.partial.jsonl) so a crash loses at most the last flush interval."""
    def __init__(self, path):
        self.path = path; self.lock = threading.Lock(); self.buf = []
        self.fh = open(path, "a", encoding="utf-8")
    def add(self, kind, data):
        with self.lock: self.buf.append(json.dumps({"k": kind, "d": data}))
    def flush(self):
        with self.lock:
            if not self.buf: return
            self.fh.write("\n".join(self.buf) + "\n"); self.buf.clear(); self.fh.flush()
    def close(self): self.flush(); self.fh.close()

def read_journal(path):
    moves, clicks, changes, cursors, pauses, keys = [], [], [], {}, [], []
    if not os.path.exists(path): return moves, clicks, changes, cursors, pauses, keys
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try: e = json.loads(line)
            except ValueError: continue          # a torn last line after a crash
            k, d = e.get("k"), e.get("d")
            if k == "m": moves.extend(d)
            elif k == "c": clicks.append(d)
            elif k == "s": changes.append(d)
            elif k == "k": keys.append(d)
            elif k == "cur": cursors[d["id"]] = d["shape"]
            elif k == "pause": pauses.append([d, None])
            elif k == "resume" and pauses and pauses[-1][1] is None: pauses[-1][1] = d
    return moves, clicks, changes, cursors, pauses, keys


# ---------------------------------------------------------------- analysis (Smart Director, add-on spec §7–9)
def ff_lines(args, timeout=1800):
    """Run ffmpeg and return its stderr lines (filters print their reports there)."""
    return run([FFMPEG, "-hide_banner", "-nostats", *args], timeout=timeout).stderr.splitlines()

def detect_silences(path, offset, noise_db=-35, min_len=0.8):
    """[(start, end)] in source seconds where the microphone is quiet."""
    out, start = [], None
    for line in ff_lines(["-i", path, "-af", f"silencedetect=noise={noise_db}dB:d={min_len}", "-f", "null", "-"]):
        m = re.search(r"silence_start:\s*([\d.]+)", line)
        if m: start = float(m.group(1)); continue
        m = re.search(r"silence_end:\s*([\d.]+)", line)
        if m and start is not None: out.append((round(start + offset, 3), round(float(m.group(1)) + offset, 3))); start = None
    return out

def detect_scenes(path, threshold=0.25):
    """[(t, score)] visual cuts: moments the screen content changed a lot (window switch, page change…)."""
    out, t = [], None
    for line in ff_lines(["-i", path, "-vf", f"scale=320:-2,select='gte(scene,{threshold})',metadata=print", "-f", "null", "-"]):
        m = re.search(r"pts_time:([\d.]+)", line)
        if m: t = float(m.group(1)); continue
        m = re.search(r"lavfi\.scene_score=([\d.]+)", line)
        if m and t is not None: out.append((round(t, 3), round(float(m.group(1)), 3))); t = None
    return out

def idle_stretches(ev, min_len=2.5):
    """[(start, end)] in source seconds with no cursor movement and no clicks."""
    t0, dur = ev["t0Video"], ev["videoDuration"]
    times = sorted([m[0] - t0 for m in ev["moves"]] + [c["t"] - t0 for c in ev["clicks"]])
    times = [t for t in times if 0 <= t <= dur]
    out, prev = [], 0.0
    for t in times + [dur]:
        if t - prev >= min_len: out.append((round(prev, 3), round(t, 3)))
        prev = t
    return out

def click_groups(ev, gap=2.6, dist_frac=0.33):
    """Same grouping as the renderer's auto-zoom (motion.ts): clicks close in time and space."""
    W, t0 = ev["display"]["width"], ev["t0Video"]
    downs = sorted([(c["t"] - t0, c["x"], c["y"]) for c in ev["clicks"] if c["type"] == "down"])
    groups = []
    for t, x, y in downs:
        if groups and t - groups[-1][-1][0] < gap and math.hypot(x - groups[-1][-1][1], y - groups[-1][-1][2]) < W * dist_frac: groups[-1].append((t, x, y))
        else: groups.append([(t, x, y)])
    return groups

def overlap(a, b): return (max(a[0], b[0]), min(a[1], b[1]))

def analyze(args):
    need_ffmpeg()
    outdir = args.out
    ev_path = os.path.join(outdir, "events.json")
    if not outdir or not os.path.exists(ev_path):
        emit(event="error", code="no_recording", message="No finished recording in that folder."); sys.exit(3)
    with open(ev_path) as fh: ev = json.load(fh)
    dur = ev["videoDuration"]
    emit(event="analyzing", step="audio")
    silences = detect_silences(os.path.join(outdir, ev["files"]["mic"]), ev.get("micOffset") or 0) if ev["files"].get("mic") else []
    emit(event="analyzing", step="screen")
    scenes = detect_scenes(os.path.join(outdir, ev["files"]["screen"]))
    emit(event="analyzing", step="interaction")
    idle = idle_stretches(ev)
    groups = click_groups(ev)
    t0 = ev["t0Video"]
    clicks = sorted(c["t"] - t0 for c in ev["clicks"] if c["type"] == "down")

    proposals, n = [], 0
    def add(kind, start, end, reason, confidence, **extra):
        nonlocal n; n += 1
        proposals.append({"id": f"{kind.lower()}-{n}", "type": kind, "start": round(max(0, start), 3), "end": round(min(dur, end), 3),
                          "reason": reason, "confidence": confidence, **extra})

    # REMOVE — dead air: nothing said and nothing happening. Keep a little breathing room at both ends.
    MARGIN = 0.35
    for s in silences:
        for i in idle:
            a, b = overlap(s, i)
            if b - a - 2 * MARGIN >= 1.0 and not any(a <= c <= b for c in clicks):
                add("REMOVE", a + MARGIN, b - MARGIN, f"{b - a:.1f}s with no speech and no activity", "high")
    for s in silences:   # long silence while still moving the mouse: probably thinking; medium confidence
        if s[1] - s[0] >= 4 and not any(abs(p["start"] - s[0]) < 1 for p in proposals if p["type"] == "REMOVE") and not any(s[0] <= c <= s[1] for c in clicks):
            add("REMOVE", s[0] + 0.5, s[1] - 0.5, f"{s[1] - s[0]:.1f}s without speech", "medium")

    # SPEED — repetitive navigation: long stretches of busy cursor movement without clicks or speech (add-on §9).
    moves_t = sorted(m[0] - t0 for m in ev["moves"])
    for s in silences:
        a, b = s
        if b - a < 6: continue
        if any(a <= c <= b for c in clicks): continue
        n_moves = sum(1 for t in moves_t if a <= t <= b)
        if n_moves / (b - a) >= 25:                                   # ≥25 position samples/s = the mouse is really moving
            add("SPEED", a + 0.3, b - 0.3, f"{b - a:.0f}s of moving around without talking or clicking", "medium", rate=1.5)

    # CHAPTER — big visual changes, spaced out, not in the first seconds.
    last = -1e9
    for t, score in scenes:
        if t < 3 or t > dur - 3 or t - last < 15: continue
        add("CHAPTER", t, t, f"the screen changed a lot (score {score:.2f})", "high" if score >= 0.45 else "medium", score=score)
        last = t

    # ZOOM — informational: these click clusters already drive the automatic zoom.
    for g in groups:
        add("ZOOM", g[0][0] - 0.55, g[-1][0] + 1.6, f"{len(g)} click{'s' if len(g) > 1 else ''} in one place", "high", clicks=len(g), x=g[0][1], y=g[0][2])

    # HIGHLIGHT — the busiest 12-second windows: dense interaction, clicks, and a visual change nearby.
    WIN = 12.0
    scores = []
    moves = sorted(m[0] - t0 for m in ev["moves"])
    for start in [x * 2.0 for x in range(int(max(0, dur - WIN) / 2.0) + 1)]:
        end = start + WIN
        sc = sum(1 for t in moves if start <= t < end) / 60.0 + 3 * sum(1 for c in clicks if start <= c < end) + 4 * sum(1 for t, _ in scenes if start <= t < end)
        scores.append((sc, start, end))
    scores.sort(reverse=True)
    chosen = []
    for sc, start, end in scores:
        if sc < 3 or any(start < e and end > s for s, e in chosen): continue
        chosen.append((start, end))
        add("HIGHLIGHT", start, end, "busy stretch with clicks and visible change", "medium" if sc < 8 else "high", score=round(sc, 2))
        if len(chosen) == 3: break

    summary = {k: sum(1 for p in proposals if p["type"] == k) for k in ("REMOVE", "SPEED", "ZOOM", "CHAPTER", "HIGHLIGHT")}
    removable = sum(p["end"] - p["start"] for p in proposals if p["type"] == "REMOVE")
    analysis = {"version": 1, "analyzedAt": datetime.now().isoformat(timespec="seconds"), "duration": dur,
                "signals": {"silences": silences, "scenes": scenes, "idle": idle, "clickGroups": [[g[0][0], g[-1][0], len(g)] for g in groups]},
                "proposals": proposals, "summary": {**summary, "removableSeconds": round(removable, 2)}}
    tmp = os.path.join(outdir, "analysis.json.tmp")
    with open(tmp, "w") as fh: json.dump(analysis, fh)
    os.replace(tmp, os.path.join(outdir, "analysis.json"))
    emit(event="ready", out=outdir, summary=analysis["summary"])

# ---------------------------------------------------------------- audio enhancement (spec §16)
def enhance(args):
    """mic.wav → mic.clean.wav, same length and start. Chain (spec §16): rumble high-pass, hum notches (50/60 Hz mains),
    adaptive FFT noise reduction, gentle de-ess, light speech compression, two-pass EBU loudness to -16 LUFS, true-peak
    limiter at -1.5 dBTP so nothing clips after AAC encoding."""
    need_ffmpeg()
    outdir = args.out
    ev_path = os.path.join(outdir, "events.json")
    if not outdir or not os.path.exists(ev_path):
        emit(event="error", code="no_recording", message="No finished recording in that folder."); sys.exit(3)
    with open(ev_path) as fh: ev = json.load(fh)
    if not ev["files"].get("mic"):
        emit(event="error", code="no_mic", message="This recording has no microphone track."); sys.exit(3)
    src = os.path.join(outdir, ev["files"]["mic"]); dst = os.path.join(outdir, "mic.clean.wav"); tmp = dst + ".tmp.wav"
    emit(event="enhancing", step="measure")
    chain = ("highpass=f=80:poles=2,"
             "bandreject=f=50:width_type=q:w=30,bandreject=f=60:width_type=q:w=30,"
             "afftdn=nr=12:nf=-40:tn=1,"
             "deesser=i=0.4:m=0.5:f=0.5,"
             "acompressor=threshold=-22dB:ratio=2.5:attack=8:release=120:makeup=2:knee=4")
    lines = ff_lines(["-i", src, "-af", f"{chain},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], timeout=1800)
    stats = None
    try:
        js = "\n".join(lines); i = js.rfind("{"); stats = json.loads(js[i:js.rfind("}") + 1]) if i >= 0 else None
    except ValueError: stats = None
    emit(event="enhancing", step="render")
    if stats and all(k in stats for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")):
        ln = (f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}"
              f":measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true")
    else: ln = "loudnorm=I=-16:TP=-1.5:LRA=11"
    r = run([FFMPEG, "-v", "error", "-y", "-i", src, "-af", f"{chain},{ln},alimiter=limit=0.84:level=false", "-ar", "48000", "-c:a", "pcm_s16le", tmp], timeout=1800)
    if r.returncode != 0 or not os.path.exists(tmp):
        emit(event="error", code="enhance_failed", message="Could not clean the voice track.\n" + r.stderr[-300:]); sys.exit(4)
    os.replace(tmp, dst)
    emit(event="ready", out=outdir, file="mic.clean.wav", measured=stats and {"lufs": stats.get("input_i"), "peak": stats.get("input_tp")})

# ---------------------------------------------------------------- transcription (spec §43; local Whisper)
def speech_env():
    """Private virtual environment for the speech engine, created on first use. Returns its python.exe."""
    root = (os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Narrate", "speech") if IS_WIN
            else os.path.expanduser("~/Library/Application Support/Narrate/speech"))
    py = os.path.join(root, "Scripts", "python.exe") if IS_WIN else os.path.join(root, "bin", "python3")
    marker = os.path.join(root, "installed.txt")
    if os.path.exists(py) and os.path.exists(marker): return py
    emit(event="transcribing", stage="installing", message="Setting up the speech engine (one time, ~300 MB)…")
    r = subprocess.run([sys.executable, "-m", "venv", root], capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
    if r.returncode != 0: raise RuntimeError("could not create the speech environment: " + r.stderr[-400:])
    # msvc-runtime provides the VC++ runtime DLLs ctranslate2 needs on machines without the system-wide redistributable
    r = subprocess.run([py, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "faster-whisper", *(["msvc-runtime"] if IS_WIN else [])],
                       capture_output=True, text=True, creationflags=CREATE_NO_WINDOW, timeout=1800)
    if r.returncode != 0: raise RuntimeError("could not install the speech engine: " + r.stderr[-400:])
    with open(marker, "w") as fh: fh.write("faster-whisper\n")
    return py

def transcribe(args):
    outdir = args.out
    ev_path = os.path.join(outdir, "events.json")
    if not outdir or not os.path.exists(ev_path):
        emit(event="error", code="no_recording", message="No finished recording in that folder."); sys.exit(3)
    with open(ev_path) as fh: ev = json.load(fh)
    if not ev["files"].get("mic"):
        emit(event="error", code="no_mic", message="This recording has no microphone track to transcribe."); sys.exit(3)
    try: py = speech_env()
    except Exception as e:
        emit(event="error", code="speech_install", message=str(e)); sys.exit(4)
    emit(event="transcribing", stage="loading", message="Loading the speech model…")
    worker = os.path.join(os.path.dirname(os.path.abspath(__file__)), "transcribe_worker.py")
    raw = os.path.join(outdir, "transcript.raw.json")
    # decode with ffmpeg to 16 kHz mono float32 so the worker never needs a media library of its own
    pcm = os.path.join(outdir, "transcript.pcm.tmp")
    need_ffmpeg()
    r = run([FFMPEG, "-v", "error", "-y", "-i", os.path.join(outdir, ev["files"]["mic"]), "-ac", "1", "-ar", "16000", "-f", "f32le", pcm], timeout=600)
    if r.returncode != 0 or not os.path.exists(pcm):
        emit(event="error", code="decode_failed", message="Could not read the microphone track.\n" + r.stderr[-300:]); sys.exit(4)
    p = subprocess.Popen([py, worker, pcm, raw, args.model], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, encoding="utf-8", errors="replace", creationflags=CREATE_NO_WINDOW)
    assign_job(p)
    err = []; drain(p.stderr, lambda l: (err.append(l), log("[whisper] " + l)))
    for line in p.stdout:
        if not line.startswith("{"): continue
        try: m = json.loads(line)
        except ValueError: continue
        if m.get("event") == "progress": emit(event="transcribing", stage=m.get("stage", "transcribing"), done=m.get("done"), total=m.get("total"))
    p.wait()
    try: os.remove(pcm)
    except OSError: pass
    if p.returncode != 0 or not os.path.exists(raw):
        emit(event="error", code="transcribe_failed", message="Transcription failed.\n" + "\n".join(err[-4:])); sys.exit(4)
    # shift from mic time to source (screen) time so the editor and renderer can use it directly
    with open(raw, encoding="utf-8") as fh: t = json.load(fh)
    off = ev.get("micOffset") or 0
    for s in t["segments"]:
        s["start"] = round(s["start"] + off, 3); s["end"] = round(s["end"] + off, 3)
        for w in s["words"]: w["start"] = round(w["start"] + off, 3); w["end"] = round(w["end"] + off, 3)
    t["version"] = 1; t["createdAt"] = datetime.now().isoformat(timespec="seconds"); t["timebase"] = "source"
    tmp = os.path.join(outdir, "transcript.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh: json.dump(t, fh, ensure_ascii=False)
    os.replace(tmp, os.path.join(outdir, "transcript.json")); os.remove(raw)
    emit(event="ready", out=outdir, segments=len(t["segments"]), language=t.get("language"))


# ---------------------------------------------------------------- finalisation and crash recovery (both platforms)
def finalize(outdir, setup, t_end, capture=None, log_data=None, platform="win32", mic_latency=0.0):
    """Turn the raw capture (screen.mkv, mic.mka, journal) into screen.mp4 / mic.wav / events.json.
    Used at the end of a normal recording and by `finalize` after a crash (then log_data comes from the journal).
    Raw inputs: screen.mkv (or screen.mov), mic.mka (or mic.mov) or mic.raw.wav (macOS helper), camera.mkv (or camera.mov), system.raw.wav."""
    first = lambda *names: next((os.path.join(outdir, n) for n in names if os.path.exists(os.path.join(outdir, n))), os.path.join(outdir, names[0]))
    raw_video = first("screen.mkv", "screen.mov"); screen_path = os.path.join(outdir, "screen.mp4"); mic_path = first("mic.mka", "mic.mov")
    journal_path = os.path.join(outdir, "events.partial.jsonl")
    moves, clicks, changes, cursors, pauses, keys = log_data if log_data else read_journal(journal_path)
    if pauses and pauses[-1][1] is None: pauses[-1][1] = round(t_end, 4)

    emit(event="finalizing", step="video")
    if os.path.exists(raw_video):
        t0v = float(probe(raw_video).get("start_time", 0) or 0)     # wall-clock origin, before the remux resets it
        setup["t0Video"] = t0v
        with open(os.path.join(outdir, "recording.json"), "w") as fh: json.dump(setup, fh)   # survives a crash during the remux
        run([FFMPEG, "-v", "error", "-y", "-i", raw_video, "-c", "copy", "-movflags", "+faststart", screen_path], timeout=600)
        if not (os.path.exists(screen_path) and os.path.getsize(screen_path) > 0):
            emit(event="error", code="remux_failed", message="The recording could not be finalised. The raw capture is kept as screen.mkv."); sys.exit(5)
        os.remove(raw_video)
    elif os.path.exists(screen_path): t0v = float(setup.get("t0Video", 0) or 0)   # finalize re-run after a crash during finalize
    else:
        emit(event="error", code="no_video", message="This recording has no video file; nothing could be recovered."); sys.exit(5)
    vid = probe(screen_path)
    t0m = None
    wav = os.path.join(outdir, "mic.wav"); mic_raw = os.path.join(outdir, "mic.raw.wav")
    if os.path.exists(mic_path):
        emit(event="finalizing", step="audio")
        st = probe(mic_path).get("start_time")
        run([FFMPEG, "-v", "error", "-y", "-i", mic_path, "-c:a", "pcm_s16le", "-ar", "48000", wav], timeout=600)
        if st is not None and os.path.exists(wav):
            t0m = float(st) - mic_latency                             # Windows: packets are stamped on arrival; the first sample is one buffer older
            setup["t0Mic"] = t0m; os.remove(mic_path)
    elif os.path.exists(mic_raw) and setup.get("t0Mic") is not None:    # macOS native helper: float WAV whose origin is its first buffer
        emit(event="finalizing", step="audio")
        run([FFMPEG, "-v", "error", "-y", "-i", mic_raw, "-c:a", "pcm_s16le", "-ar", "48000", wav], timeout=600)
        if os.path.exists(wav) and os.path.getsize(wav) > 1000: t0m = float(setup["t0Mic"]); os.remove(mic_raw)
    elif os.path.exists(wav) and setup.get("t0Mic") is not None: t0m = float(setup["t0Mic"])
    # camera: same treatment as the screen (Matroska → faststart MP4), origin kept in setup for re-runs
    cam_raw = first("camera.mkv", "camera.mov"); cam_mp4 = os.path.join(outdir, "camera.mp4"); t0c = None; cam_info = None
    if os.path.exists(cam_raw):
        emit(event="finalizing", step="video")
        st = probe(cam_raw).get("start_time")
        run([FFMPEG, "-v", "error", "-y", "-i", cam_raw, "-c", "copy", "-movflags", "+faststart", cam_mp4], timeout=600)
        if st is not None and os.path.exists(cam_mp4) and os.path.getsize(cam_mp4) > 0:
            t0c = float(st); setup["t0Camera"] = t0c; os.remove(cam_raw)
    elif os.path.exists(cam_mp4) and setup.get("t0Camera") is not None: t0c = float(setup["t0Camera"])
    if t0c is not None:
        cp = probe(cam_mp4); cam_info = {"width": int(cp.get("width", 0) or 0), "height": int(cp.get("height", 0) or 0), "duration": float(cp.get("duration", 0) or 0)}
    # system audio: raw float WAV from WASAPI loopback → 48 kHz s16; its origin is the first packet's wall-clock time
    sys_raw = os.path.join(outdir, "system.raw.wav"); sys_wav = os.path.join(outdir, "system.wav"); t0s = None
    if os.path.exists(sys_raw) and setup.get("t0System") is not None:
        emit(event="finalizing", step="audio")
        run([FFMPEG, "-v", "error", "-y", "-i", sys_raw, "-c:a", "pcm_s16le", "-ar", "48000", sys_wav], timeout=600)
        if os.path.exists(sys_wav) and os.path.getsize(sys_wav) > 1000: t0s = float(setup["t0System"]); os.remove(sys_raw)
    elif os.path.exists(sys_wav) and setup.get("t0System") is not None: t0s = float(setup["t0System"])
    if os.path.exists(sys_raw) and t0s is None: os.remove(sys_raw)       # nothing ever played, or no origin: drop it
    events = {"version": 2, "display": setup["display"], "fps": setup["fps"], "tLaunch": setup["tLaunch"], "tEnd": t_end,
              "t0Video": t0v, "t0Mic": t0m, "t0Camera": t0c, "t0System": t0s,
              "videoDuration": float(vid.get("duration", 0) or 0), "videoFrames": int(vid.get("nb_frames", 0) or 0),
              "micOffset": (t0m - t0v) if t0m is not None else None,
              "cameraOffset": (t0c - t0v) if t0c is not None else None, "camera": cam_info,
              "systemOffset": (t0s - t0v) if t0s is not None else None,
              "pauses": pauses, "platform": platform, "encoder": setup.get("encoder"), "capture": capture,
              "recovered": log_data is None,
              "cursors": cursors, "cursorChanges": changes, "moves": moves, "clicks": clicks, "scrolls": [], "keys": keys,
              "files": {"screen": "screen.mp4", "mic": "mic.wav" if t0m is not None else None, "camera": "camera.mp4" if t0c is not None else None,
                        "system": "system.wav" if t0s is not None else None}}
    tmp = os.path.join(outdir, "events.json.tmp")
    with open(tmp, "w") as fh: json.dump(events, fh)
    os.replace(tmp, os.path.join(outdir, "events.json"))              # atomic: events.json is complete or absent
    for f in (journal_path, os.path.join(outdir, "recording.json")):
        if os.path.exists(f): os.remove(f)
    emit(event="ready", out=outdir, frames=events["videoFrames"], duration=events["videoDuration"], clicks=len(clicks) // 2, recovered=log_data is None)


def recover(args, platform="win32", mic_latency=0.0):
    """Finalize a recording whose recorder died. The end time is the raw video's last modification."""
    need_ffmpeg()
    outdir = args.out
    setup_path = os.path.join(outdir, "recording.json")
    if not outdir or not os.path.exists(setup_path):
        emit(event="error", code="not_recoverable", message="No unfinished recording found in that folder."); sys.exit(3)
    with open(setup_path) as fh: setup = json.load(fh)
    for name in ("screen.mkv", "screen.mov", "screen.mp4"):
        p = os.path.join(outdir, name)
        if os.path.exists(p): t_end = os.path.getmtime(p); break
    else: t_end = now()
    finalize(outdir, setup, t_end, capture=setup.get("capture"), platform=platform, mic_latency=mic_latency)


# ---------------------------------------------------------------- mic level meter loop (both platforms)
def meter_loop(cmd):
    """Run an ffmpeg command that writes 16 kHz mono s16le to stdout; print {"event":"level"} at 10 Hz until stdin closes."""
    import array
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
    assign_job(p)
    threading.Thread(target=lambda: (sys.stdin.read(), kill(p)), daemon=True).start()   # app closes stdin -> stop
    chunk = 1600 * 2                                                  # 100 ms of mono s16
    while True:
        data = p.stdout.read(chunk)
        if len(data) < chunk: break
        a = array.array("h", data)
        rms = math.sqrt(sum(v * v for v in a) / len(a)) / 32768.0
        db = 20 * math.log10(max(rms, 1e-6))
        emit(event="level", level=round(max(0.0, min(1.0, (db + 60) / 60)), 3))   # -60 dBFS -> 0, 0 dBFS -> 1
    kill(p)
