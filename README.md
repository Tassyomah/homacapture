# HomaCapture — the Homalabs screen studio

Record once. Let the software make it look good. See `docs/SPEC.md` and `docs/SPEC-ADDON.md`.

**What works today (Windows):** screen + microphone + camera + computer-sound recording on one clock · crash recovery · editor with live preview (auto-zoom, smoothed cursor, click ripple, padding, backgrounds, camera overlay, volumes) · timeline with trim / cut / restore / undo · aspect presets (16:9, 9:16, 1:1, 4:5) with content-aware reframing · Smart Director proposals (pauses, chapters, highlights, filler words) · local transcript and burned-in captions · content map · derivative assets (Quick Demo, LinkedIn, Vertical Teaser, 15s Teaser, Clips) · manual zooms, speed ranges, privacy masks, voice clean-up, keycaps · export presets, MP4 and GIF export · Export all · a per-user installer. macOS has recording and the editor; the rest is on the way.

Pipeline (same shape as Screen Studio's own project files, so those import too):

1. **capture** — recorder sidecar per OS (`recorder/narrate.py` macOS, `recorder/narrate_win.py` Windows) → `<recordings>/<stamp>/`
   `screen.mp4` (native pixels, cursor hidden) + `mic.wav` + optional `camera.mp4` and `system.wav` + `events.json`
   (cursor path, clicks, cursor PNGs; all on the host clock so nothing drifts). Crash-tolerant: unfinished recordings are offered for recovery.
2. **narrate** — (next) cut the take into segments at clicks/pauses, record a voice line
   per segment with retakes; zoom timing follows the narration.
3. **render** — (next) Remotion composition: smooth cursor, auto-zoom to click groups,
   padding + Homalabs background, export via ffmpeg.

## Run (development)
```
cd app && npm install && npm run dev
```
Opens the HomaCapture window. Record → control bar appears bottom-right (Pause / Stop, ⌘⇧P / ⌘⇧S on macOS, Ctrl+Shift+P / Ctrl+Shift+S on Windows) → editor opens with the polished preview → Export MP4.

- **macOS:** recordings live in `~/Movies/Narrate/`. First run: allow Screen Recording (and Microphone) for the app, then reopen it.
- **Windows:** `winget install Gyan.FFmpeg Python.Python.3.12`; recordings live in `%USERPROFILE%\Videos\Narrate\`. No screen-recording permission exists on Windows.

Full setup for both platforms: `docs/DEVELOPMENT.md`. Docs: `docs/SPEC.md` (product spec), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.
