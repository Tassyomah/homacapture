#!/usr/bin/env python3
"""narrate recorder sidecar for macOS — screen + mic + camera + cursor capture (interim: ffmpeg avfoundation + PyObjC).

Same command line and line protocol as recorder/narrate_win.py:

    narrate.py --list                 devices (JSON)
    narrate.py --check [--request]    permission state (JSON); --request triggers the macOS prompts
    narrate.py record --out DIR [--fps 60] [--screen N] [--mic N | --no-mic] [--camera N]
    narrate.py finalize --out DIR     finish a recording whose process died (crash recovery)
    narrate.py meter [--mic N]        microphone level lines until stdin closes
    narrate.py analyze | transcribe | enhance --out DIR   (shared with Windows: common.py)

Output folder: screen.mp4 (cursor hidden), mic.wav, camera.mp4, system.wav (with --system-audio, via the
ScreenCaptureKit helper in mac/homacapture-sysaudio), events.json, cursors/*.png.
Time base: the macOS host clock (CLOCK_UPTIME_RAW == CACurrentMediaTime == avfoundation pts), so cursor events and
media need no offset measurement. Raw captures go to Matroska (crash-tolerant) and are remuxed on finalisation.
Pauses are metadata, not cuts. Computer sound comes from mac/sysaudio.m (ScreenCaptureKit, macOS 13+), same host clock.

Needs ffmpeg/ffprobe (brew install ffmpeg) and `pip3 install --user pyobjc-core pyobjc-framework-Cocoa pyobjc-framework-Quartz`.
STATUS: ported from the Windows recorder; first run on a Mac 2026-10-20 (devices, meter, computer sound self-test).
"""
import argparse, hashlib, json, os, re, signal, subprocess, sys, threading, time
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from common import *   # noqa: F401,F403
import Quartz
from AppKit import NSScreen, NSCursor, NSEvent, NSBitmapImageRep, NSPNGFileType
try:
    import AVFoundation
except ImportError:   # optional: only used for the microphone permission state
    AVFoundation = None

now = lambda: time.clock_gettime(time.CLOCK_UPTIME_RAW)   # the clock avfoundation stamps with

# ---------------------------------------------------------------- devices / permissions
def list_devices():
    out = run([FFMPEG, "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]).stderr
    vids, auds, section = {}, {}, None
    for line in out.splitlines():
        if "video devices" in line: section = vids; continue
        if "audio devices" in line: section = auds; continue
        m = re.search(r"\[(\d+)\] (.+)$", line)
        if m and section is not None: section[int(m.group(1))] = m.group(2).strip()
    return vids, auds

def devices_json():
    v, a = list_devices()
    screens = [{"index": i, "name": n} for i, n in sorted(v.items()) if n.startswith("Capture screen")]
    cameras = [{"index": i, "name": n} for i, n in sorted(v.items()) if not n.startswith("Capture screen")]
    mics = [{"index": i, "name": n} for i, n in sorted(a.items())]
    displays = [{"ordinal": k, "id": int(sc.deviceDescription()["NSScreenNumber"]),
                 "width": int(sc.frame().size.width * sc.backingScaleFactor()),
                 "height": int(sc.frame().size.height * sc.backingScaleFactor()), "name": str(sc.localizedName())}
                for k, sc in enumerate(NSScreen.screens())]
    return {"screens": screens, "mics": mics, "cameras": cameras, "displays": displays}

MIC_STATUS = {0: "notDetermined", 1: "restricted", 2: "denied", 3: "authorized"}
def check_permissions(request=False):
    screen = bool(Quartz.CGPreflightScreenCaptureAccess())
    if not screen and request:
        screen = bool(Quartz.CGRequestScreenCaptureAccess())
    if AVFoundation is None: return {"screen": screen, "mic": "unknown"}
    mic = MIC_STATUS.get(int(AVFoundation.AVCaptureDevice.authorizationStatusForMediaType_("soun")), "unknown")
    if mic == "notDetermined" and request:
        done = threading.Event(); result = {}
        AVFoundation.AVCaptureDevice.requestAccessForMediaType_completionHandler_("soun", lambda ok: (result.__setitem__("ok", ok), done.set()))
        done.wait(30)
        mic = "authorized" if result.get("ok") else MIC_STATUS.get(int(AVFoundation.AVCaptureDevice.authorizationStatusForMediaType_("soun")), "denied")
    return {"screen": screen, "mic": mic}

# ---------------------------------------------------------------- cursor + keyboard logs
class CursorLog:
    """Cursor position/buttons/shape by polling. No Accessibility permission needed. Journaled for crash recovery."""
    def __init__(self, screen, scale, outdir, journal, hz=120):
        self.f = screen.frame(); self.scale = scale; self.hz = hz; self.journal = journal
        self.moves, self.clicks, self.cursorChanges = [], [], []
        self.cursors = {}
        self.outdir = outdir; os.makedirs(os.path.join(outdir, "cursors"), exist_ok=True)
        self.last = None; self.buttons = [False, False]; self.cur_id = None
        self.stop = threading.Event()

    def to_px(self, p):
        return (round((p.x - self.f.origin.x) * self.scale, 2),
                round((self.f.origin.y + self.f.size.height - p.y) * self.scale, 2))

    def cursor_id(self):
        c = NSCursor.currentSystemCursor()
        if c is None: return self.cur_id
        img = c.image(); tiff = img.TIFFRepresentation()
        if tiff is None: return self.cur_id
        h = hashlib.sha1(bytes(tiff)).hexdigest()[:12]
        if h not in self.cursors:
            rep = NSBitmapImageRep.imageRepWithData_(tiff)
            png = rep.representationUsingType_properties_(NSPNGFileType, None)
            fn = f"cursors/{h}.png"; png.writeToFile_atomically_(os.path.join(self.outdir, fn), True)
            hs = c.hotSpot(); sz = img.size()
            self.cursors[h] = {"file": fn, "hotspot": [hs.x, hs.y], "size": [sz.width, sz.height]}
            self.journal.add("cur", {"id": h, "shape": self.cursors[h]})
        return h

    def run(self):
        period = 1.0 / self.hz; n = 0; pending = []
        while not self.stop.is_set():
            t = now(); x, y = self.to_px(NSEvent.mouseLocation())
            if self.last != (x, y):
                self.last = (x, y); m = [round(t, 4), x, y]; self.moves.append(m); pending.append(m)
            for i, btn in enumerate((Quartz.kCGMouseButtonLeft, Quartz.kCGMouseButtonRight)):
                down = bool(Quartz.CGEventSourceButtonState(Quartz.kCGEventSourceStateCombinedSessionState, btn))
                if down != self.buttons[i]:
                    self.buttons[i] = down
                    c = {"t": round(t, 4), "type": "down" if down else "up", "button": "left" if i == 0 else "right", "x": x, "y": y}
                    self.clicks.append(c); self.journal.add("c", c)
            if n % 6 == 0:
                cid = self.cursor_id()
                if cid != self.cur_id:
                    self.cur_id = cid; ch = [round(t, 4), cid]; self.cursorChanges.append(ch); self.journal.add("s", ch)
            if n % 60 == 0:
                if pending: self.journal.add("m", pending); pending = []
                self.journal.flush()
            n += 1
            time.sleep(max(0, period - (now() - t)))
        if pending: self.journal.add("m", pending)
        self.journal.flush()

class KeyLog:
    """Keyboard shortcuts only (command / control / option combos, function keys, Esc) via a Quartz event tap; plain
    typing is never logged. Needs Input Monitoring permission; without it the tap does not start and the log stays empty."""
    NAMES = {36: "Enter", 48: "Tab", 49: "Space", 51: "Backspace", 53: "Esc", 117: "Del", 115: "Home", 119: "End", 116: "PgUp", 121: "PgDn",
             123: "←", 124: "→", 125: "↑", 126: "↓", 122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12"}
    def __init__(self, journal): self.keys = []; self.journal = journal; self.loop = None; self.available = False
    def run(self):
        def cb(proxy, kind, event, refcon):
            try:
                flags = Quartz.CGEventGetFlags(event)
                mods = [m for bit, m in ((Quartz.kCGEventFlagMaskCommand, "⌘"), (Quartz.kCGEventFlagMaskControl, "⌃"),
                                         (Quartz.kCGEventFlagMaskAlternate, "⌥"), (Quartz.kCGEventFlagMaskShift, "⇧")) if flags & bit]
                code = Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode)
                name = self.NAMES.get(code)
                if name is None:
                    s = Quartz.CGEventKeyboardGetUnicodeString(event, 1, None, None)[1]
                    name = s.upper() if s and s.isalnum() else None
                if name and (any(m in mods for m in ("⌘", "⌃", "⌥")) or name.startswith("F") or name in ("Esc", "PgUp", "PgDn", "Home", "End")):
                    k = {"t": round(now(), 4), "keys": "+".join(mods + [name])}
                    self.keys.append(k); self.journal.add("k", k)
            except Exception: pass
            return event
        tap = Quartz.CGEventTapCreate(Quartz.kCGSessionEventTap, Quartz.kCGHeadInsertEventTap, Quartz.kCGEventTapOptionListenOnly,
                                      Quartz.CGEventMaskBit(Quartz.kCGEventKeyDown), cb, None)
        if not tap: log("[keys] no Input Monitoring permission; shortcuts will not be logged"); return
        self.available = True
        src = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
        self.loop = Quartz.CFRunLoopGetCurrent()
        Quartz.CFRunLoopAddSource(self.loop, src, Quartz.kCFRunLoopCommonModes)
        Quartz.CGEventTapEnable(tap, True)
        Quartz.CFRunLoopRun()
    def stop(self):
        if self.loop: Quartz.CFRunLoopStop(self.loop)

# ---------------------------------------------------------------- record
class SysAudio:
    """Computer sound through mac/homacapture-sysaudio (ScreenCaptureKit). Same shape as win_loopback.Loopback:
    start(), stop(), .t0 on the host clock once the first buffer arrives, .error if it failed."""
    BIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mac", "homacapture-sysaudio")
    TAG, SRC = "system", "sysaudio.m"
    def __init__(self, path, *extra): self.path = path; self.extra = list(extra); self.t0 = None; self.error = None; self.ready = threading.Event(); self.p = None
    @classmethod
    def available(cls): return os.path.exists(cls.BIN)
    def start(self):
        if not self.available(): raise RuntimeError(f"the {self.TAG} helper is missing (build it: see recorder/mac/{self.SRC})")
        self.p = subprocess.Popen([self.BIN, self.path, *self.extra], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        def read():
            for line in self.p.stdout:
                try: e = json.loads(line)
                except ValueError: continue
                if e.get("event") == "t0": self.t0 = float(e["t0"])
                elif e.get("event") == "error": self.error = e.get("message"); log(f"[{self.TAG}] " + str(self.error))
                if e.get("event") in ("ready", "error"): self.ready.set()
        threading.Thread(target=read, daemon=True).start()
        drain(self.p.stderr, lambda l: log(f"[{self.TAG}] " + l))
        if not self.ready.wait(6) or self.error or self.p.poll() is not None:
            msg = self.error or "it did not start"; self.stop(); raise RuntimeError(msg)
    def alive(self): return self.p is not None and self.p.poll() is None
    def stop(self):
        if not self.p: return
        try: self.p.stdin.write("stop\n"); self.p.stdin.flush()
        except Exception: pass
        try: self.p.wait(timeout=8)
        except subprocess.TimeoutExpired: kill(self.p)

class MicAudio(SysAudio):
    """Microphone through mac/homacapture-mic (AVCaptureAudioDataOutput, 48 kHz mono float32). ffmpeg's avfoundation
    audio input drops buffers on Apple silicon (≈60 % next to a Retina screen capture), so the mic never goes through it."""
    BIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mac", "homacapture-mic")
    TAG, SRC = "mic", "micaudio.m"

def record(args):
    need_ffmpeg()
    outdir = os.path.expanduser(args.out or f"~/Movies/Narrate/{datetime.now():%Y-%m-%d-%H-%M-%S}")
    os.makedirs(outdir, exist_ok=True)
    perms = check_permissions()
    if not perms["screen"]:
        emit(event="error", code="screen_permission", message="Screen Recording permission is not granted to this app."); sys.exit(3)
    if not args.no_mic and perms["mic"] not in ("authorized", "notDetermined", "unknown"):
        emit(event="error", code="mic_permission", message="Microphone permission is denied for this app."); sys.exit(3)

    dev = devices_json()
    screens = [s["index"] for s in dev["screens"]]
    if not screens: emit(event="error", code="no_screen", message="No capturable display found."); sys.exit(3)
    screen_idx = screens[args.screen] if args.screen < len(screens) else screens[0]
    mic_idx = None
    if not args.no_mic:
        mic_idx = args.mic if args.mic is not None else next((m["index"] for m in dev["mics"] if "Microphone" in m["name"] and "iPhone" not in m["name"]), dev["mics"][0]["index"] if dev["mics"] else None)
    mic_name = next((m["name"] for m in dev["mics"] if m["index"] == mic_idx), None)
    cam = None
    if args.camera is not None:
        cams = dev["cameras"]
        if 0 <= args.camera < len(cams): cam = cams[args.camera]
        else: emit(event="error", code="no_camera", message="The selected camera is no longer available. Choose another camera."); sys.exit(3)
    scr = NSScreen.screens(); nsscreen = scr[args.screen] if args.screen < len(scr) else scr[0]
    f = nsscreen.frame(); scale = float(nsscreen.backingScaleFactor())
    disp = {"id": int(nsscreen.deviceDescription()["NSScreenNumber"]), "scale": scale, "pointWidth": f.size.width, "pointHeight": f.size.height,
            "width": int(round(f.size.width * scale)), "height": int(round(f.size.height * scale))}

    t_launch = now()
    setup = {"version": 1, "display": disp, "fps": args.fps, "tLaunch": t_launch, "encoder": "h264_videotoolbox", "mic": mic_name,
             "camera": cam["name"] if cam else None, "systemAudio": bool(args.system_audio), "startedAt": datetime.now().isoformat(timespec="seconds")}
    with open(os.path.join(outdir, "recording.json"), "w") as fh: json.dump(setup, fh)

    raw_video = os.path.join(outdir, "screen.mkv"); mic_path = os.path.join(outdir, "mic.mka"); cam_path = os.path.join(outdir, "camera.mkv")
    mbps = max(30, disp["width"] * disp["height"] * 8 // 1_000_000)
    flush = ["-cluster_time_limit", "1000", "-flush_packets", "1"]     # Matroska: a crash loses at most ~1 s
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
           "-f", "avfoundation", "-framerate", str(args.fps), "-pixel_format", "nv12", "-capture_cursor", "0", "-i", f"{screen_idx}:none"]
    ff_mic = mic_idx is not None and not MicAudio.available()          # fallback only: ffmpeg drops mic audio on this hardware
    if ff_mic: cmd += ["-f", "avfoundation", "-i", f"none:{mic_idx}"]
    cmd += ["-copyts", "-map", "0:v", "-c:v", "h264_videotoolbox", "-b:v", f"{mbps}M", "-realtime", "1", "-g", str(args.fps), *flush, raw_video]
    if ff_mic: cmd += ["-map", "1:a", "-c:a", "pcm_s16le", "-ar", "48000", *flush, mic_path]
    mic = None
    if mic_idx is not None and not ff_mic:
        try:
            mic = MicAudio(os.path.join(outdir, "mic.raw.wav"), mic_name or ""); mic.start(); log("[mic] native capture started")
        except Exception as e:
            emit(event="error", code="mic_failed", message=f"The microphone could not be started: {e}"); sys.exit(4)
    log("[screen] " + " ".join(cmd))
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    ff_err = []; drain(ff.stderr, lambda l: (ff_err.append(l), log("[ffmpeg] " + l)))
    camera = None; cam_err = []
    if cam:
        ccmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "avfoundation", "-framerate", "30", "-i", f"{cam['index']}:none",
                "-copyts", "-c:v", "h264_videotoolbox", "-b:v", "6M", "-realtime", "1", "-g", "30", *flush, cam_path]
        log("[camera] " + " ".join(ccmd))
        camera = subprocess.Popen(ccmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        drain(camera.stderr, lambda l: (cam_err.append(l), log("[camera] " + l)))

    # Prove frames are flowing before telling the app we're recording (a blocked device = permission problem).
    deadline = time.time() + 6
    while time.time() < deadline:
        if ff.poll() is not None: break
        if os.path.exists(raw_video) and os.path.getsize(raw_video) > 4096: break
        time.sleep(0.1)
    else:
        kill(ff)
        if camera: kill(camera)
        if mic: mic.stop()
        emit(event="error", code="no_frames", message="The screen capture produced no frames. Check Screen Recording permission for this app.\n" + "\n".join(ff_err[-5:])); sys.exit(4)
    if ff.poll() is not None:
        if camera: kill(camera)
        if mic: mic.stop()
        emit(event="error", code="ffmpeg_exit", message="Capture failed to start.\n" + "\n".join(ff_err[-8:])); sys.exit(4)
    warning = None
    if camera:
        deadline = time.time() + 8
        while time.time() < deadline and camera.poll() is None and not (os.path.exists(cam_path) and os.path.getsize(cam_path) > 4096): time.sleep(0.1)
        if camera.poll() is not None or not os.path.exists(cam_path) or os.path.getsize(cam_path) <= 4096:
            kill(camera); camera = None; warning = "The camera could not be started; recording without it. " + "\n".join(cam_err[-2:])
            log("[recorder] " + warning)
    sysaudio = None
    if args.system_audio:
        try:
            sysaudio = SysAudio(os.path.join(outdir, "system.raw.wav")); sysaudio.start(); log("[system] ScreenCaptureKit computer sound started")
        except Exception as e:
            sysaudio = None; log(f"[system] unavailable: {e}")
            warning = ((warning + "\n") if warning else "") + f"Computer sound could not be recorded ({e}); recording without it."

    journal = Journal(os.path.join(outdir, "events.partial.jsonl"))
    cl = CursorLog(nsscreen, scale, outdir, journal); th = threading.Thread(target=cl.run, daemon=True); th.start()
    kl = KeyLog(journal); kth = threading.Thread(target=kl.run, daemon=True); kth.start()
    pauses = []
    emit(event="started", out=outdir, display=disp, tLaunch=t_launch, encoder="h264_videotoolbox", capture="avfoundation",
         mic=mic_name, camera=cam["name"] if camera else None, systemAudio=bool(sysaudio), warning=warning)

    stopped = threading.Event()
    def do_stop(*_): stopped.set()
    def handle(cmd):
        if cmd == "pause" and not (pauses and pauses[-1][1] is None):
            pauses.append([round(now(), 4), None]); journal.add("pause", pauses[-1][0]); journal.flush(); emit(event="paused", t=pauses[-1][0])
        elif cmd == "resume" and pauses and pauses[-1][1] is None:
            pauses[-1][1] = round(now(), 4); journal.add("resume", pauses[-1][1]); journal.flush(); emit(event="resumed", t=pauses[-1][1])
        elif cmd == "stop": do_stop()
    def stdin_loop():
        for line in sys.stdin:
            line = line.strip()
            if not line: handle("stop"); continue
            try: handle(json.loads(line).get("cmd"))
            except Exception: handle("stop")
        do_stop()   # stdin closed → the app died → stop cleanly
    threading.Thread(target=stdin_loop, daemon=True).start()
    signal.signal(signal.SIGINT, do_stop); signal.signal(signal.SIGTERM, do_stop)

    while not stopped.is_set():
        if ff.poll() is not None:
            emit(event="error", code="ffmpeg_died", message="Capture stopped unexpectedly.\n" + "\n".join(ff_err[-8:])); stopped.set()
        elif camera and camera.poll() is not None:
            log("[recorder] camera capture ended early"); camera = None
        if mic and mic.t0 is not None and setup.get("t0Mic") is None:
            setup["t0Mic"] = mic.t0                                         # recording.json carries it for crash recovery
            with open(os.path.join(outdir, "recording.json"), "w") as fh: json.dump(setup, fh)
        if sysaudio and sysaudio.t0 is not None and setup.get("t0System") is None:
            setup["t0System"] = sysaudio.t0                                   # recording.json carries it for crash recovery
            with open(os.path.join(outdir, "recording.json"), "w") as fh: json.dump(setup, fh)
        stopped.wait(0.05)
    t_end = now()
    if pauses and pauses[-1][1] is None: pauses[-1][1] = round(t_end, 4)
    cl.stop.set(); th.join(timeout=1); kl.stop(); kth.join(timeout=1); journal.close()
    for p in (ff, camera):
        if not p: continue
        try: p.stdin.write("q"); p.stdin.flush()
        except Exception: pass
        try: p.wait(timeout=15)
        except subprocess.TimeoutExpired: kill(p)
    if mic:
        mic.stop()
        if mic.t0 is not None: setup["t0Mic"] = mic.t0
    if sysaudio:
        sysaudio.stop()
        if sysaudio.t0 is not None: setup["t0System"] = sysaudio.t0
    emit(event="stopped", out=outdir, duration=round(t_end - t_launch, 2))
    finalize(outdir, setup, t_end, capture="avfoundation", log_data=(cl.moves, cl.clicks, cl.cursorChanges, cl.cursors, pauses, kl.keys), platform="darwin")

def meter(args):
    need_ffmpeg()
    _v, a = list_devices()
    if not a: emit(event="error", code="no_mic", message="No microphone detected."); return
    idx = args.mic if args.mic is not None and args.mic in a else sorted(a)[0]
    meter_loop([FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", f"none:{idx}", "-ac", "1", "-ar", "16000", "-f", "s16le", "-flush_packets", "1", "-"])

def main():
    ap = argparse.ArgumentParser(prog="narrate")
    ap.add_argument("cmd", nargs="?", default="record")
    ap.add_argument("--out"); ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--screen", type=int, default=0); ap.add_argument("--mic", type=int); ap.add_argument("--no-mic", action="store_true")
    ap.add_argument("--camera", type=int); ap.add_argument("--system-audio", action="store_true"); ap.add_argument("--model", default="base.en")
    ap.add_argument("--list", action="store_true"); ap.add_argument("--check", action="store_true"); ap.add_argument("--request", action="store_true")
    args = ap.parse_args()
    if args.list: print(json.dumps(devices_json())); return
    if args.check: print(json.dumps(check_permissions(args.request))); return
    if args.cmd == "finalize": recover(args, platform="darwin"); return
    if args.cmd == "meter": meter(args); return
    if args.cmd == "analyze": analyze(args); return
    if args.cmd == "transcribe": transcribe(args); return
    if args.cmd == "enhance": enhance(args); return
    record(args)

if __name__ == "__main__": main()
