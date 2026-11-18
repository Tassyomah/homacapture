"""Runs inside the private speech environment (%LOCALAPPDATA%\\Narrate\\speech) — see narrate_win.py `transcribe`.

    python transcribe_worker.py <audio.f32le> <out.json> [model]

<audio.f32le> is raw little-endian float32 PCM, 16 kHz mono, produced by ffmpeg in narrate_win.py (so this never
depends on PyAV's API). Local Whisper (faster-whisper / CTranslate2, CPU). Writes
{"language", "segments":[{start,end,text,words:[{start,end,word,p}]}]} with times in the audio's own seconds.
Progress lines: {"event":"progress","done":seconds}. Nothing leaves the machine except the one-time model download.
"""
import json, sys

def emit(**kw): print(json.dumps(kw), flush=True)

def main():
    audio, out = sys.argv[1], sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "base.en"
    # The VC++ runtime DLLs come from the `msvc-runtime` package in this environment (no admin install needed);
    # make them visible to ctranslate2.dll before it loads.
    import os
    for d in (sys.prefix, os.path.join(sys.prefix, "Scripts")):
        if os.path.isdir(d) and hasattr(os, "add_dll_directory"): os.add_dll_directory(d)
    os.environ["PATH"] = os.path.join(sys.prefix, "Scripts") + os.pathsep + sys.prefix + os.pathsep + os.environ.get("PATH", "")
    from faster_whisper import WhisperModel
    import numpy as np
    pcm = np.fromfile(audio, dtype=np.float32)
    emit(event="progress", stage="loading", done=0)
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    # Word for word: a prompt written the way people really talk (fillers, repeats, false starts) steers Whisper to keep
    # them instead of tidying them away, and the speech filter keeps a wide margin so short sounds are not dropped.
    segments, info = model.transcribe(pcm, word_timestamps=True, vad_filter=True,
                                      vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 400},
                                      initial_prompt="Umm, so, uh, I- I was, like, you know, thinking... Hmm. Okay, so, um, yeah.",
                                      condition_on_previous_text=True)
    result = {"language": info.language, "duration": float(info.duration or len(pcm) / 16000), "model": model_name, "segments": []}
    for s in segments:
        result["segments"].append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip(),
                                   "words": [{"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word.strip(), "p": round(w.probability, 3)} for w in (s.words or [])]})
        emit(event="progress", stage="transcribing", done=round(s.end, 1), total=result["duration"])
    with open(out, "w", encoding="utf-8") as fh: json.dump(result, fh, ensure_ascii=False)
    emit(event="done", segments=len(result["segments"]))

if __name__ == "__main__": main()
