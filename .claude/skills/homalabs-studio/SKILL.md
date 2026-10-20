---
name: homalabs-studio
description: Resume building the Homalabs screen studio (working name "narrate"), Tassy Omah's open-source Loom + Screen Studio alternative. Load for any request about this app, screen recording, the recorder, the editor, export, or "continue Phase N". Carries the full project context so a fresh machine or session can pick up without the original conversation.
---

# Homalabs screen studio ("narrate")

**Owner:** Tassy Omah (Esther Omah Atasie), designer, runs the agency Homalabs. Product is hers, open source, must feel like a serious Homalabs product.
**Promise:** Record once. Let the software make it look good. Loom's ease + Screen Studio's automatic polish, own identity.
**Repo:** this repository. Read, in order, before any work: `docs/SPEC.md` (her 108-section spec, governing), `docs/SPEC-ADDON.md` (Smart Director / derivative assets / Asset Studio add-on, also governing; its text is cut off in §19 — ask her for the rest), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `README.md`.

## Rules Tassy has set (do not re-ask)
- Build vertically, Phase 1 → 8 as in SPEC §97. Phase 1 stable before moving on.
- No placeholder buttons. A visible feature works end-to-end or is marked unavailable in plain text (SPEC §98).
- Very high quality; it will be open-sourced and scaled.
- She uses the app through its window, never the terminal. Never run test recordings of her screen without telling her first.
- Desktop app, not web (SPEC §3). macOS and Windows, one Electron app, one recorder sidecar per OS with the same protocol. Development currently happens on a Windows laptop; the Mac recorders are untouched.
- She is not a terminal user: give her plain steps (open Settings, click X), never a command to run unless asked.
- Brand tokens: ink #14140F, paper #EFEEE8, coral #FB8B73, indigo #6E71E8, violet #8B78D6, mustard #F5C36A. Flat shapes, no outline borders or offset shadows on UI chips. Calm, premium, no SaaS-dashboard look (SPEC §91–92).
- Never delete her files; move to the Bin after an explicit yes.

## Where things are
- `app/` Electron + React + Remotion. `npm install`, `npm run dev`. Main: `src/main` (window, control bar, Recorder driver, AssetServer, exporter). UI: `src/renderer`. Composition shared by preview and export: `src/video`. Contracts: `src/shared/types.ts`.
- `recorder/narrate.py` interim macOS recorder (ffmpeg avfoundation + PyObjC). Needs `~/bin/ffmpeg`, `~/bin/ffprobe`, `pip install --user pyobjc-core==10.3.2 pyobjc-framework-Cocoa==10.3.2 pyobjc-framework-Quartz==10.3.2`.
- `recorder/swift/` ScreenCaptureKit recorder, same stdout/stdin JSON protocol. Build with Xcode installed (`make` in that folder). This is the real macOS recorder; the Python one is a stopgap.
- `recorder/narrate_win.py` Windows recorder (Python stdlib + ffmpeg: ddagrab→gdigrab, dshow mic, Win32 cursor log). `recorder/tests/smoke_win.py` records 5 s and validates `events.json`. Needs `winget install Gyan.FFmpeg Python.Python.3.12`.
- `app/scripts/export.ts` exports a recording from the CLI through the app's own pipeline (`npx tsx scripts/export.ts <dir> [height]`).
- Recordings: macOS `~/Movies/Narrate/<stamp>/`, Windows `%USERPROFILE%\Videos\Narrate\<stamp>\` → `screen.mp4` (cursor hidden), `mic.wav`, `events.json`, `cursors/`.
- `docs/DEVELOPMENT.md` has the full setup for both platforms.

## State as of 2026-10-06 (evening, Windows laptop)
Working on both platforms: home (display, mic, countdown, permission notices) → record → floating control bar (pause/resume/stop, ⌘⇧P/⌘⇧S or Ctrl+Shift+P/S) → finalising states → editor with live preview (auto-zoom to click clusters, smoothed cursor, click ripple, padding, radius, 4 backgrounds, cursor size) → MP4 export (1080p/1440p/source) → Show in Finder/Explorer. Pauses removed non-destructively.
Windows recorder verified by `smoke_win.py` on this laptop: ddagrab ≈ 52 fps at 1080p with Quick Sync, mic on the same clock (offset ≈ 0.4 s, recorded in events.json), cursor PNG correct. Encoder choice cached in `%LOCALAPPDATA%\Narrate\encoder.json`.
Windows also has: crash recovery (journal + `finalize`; home screen shows Restore / Discard for unfinished recordings; tested by killing recorder + ffmpeg mid-recording), live mic level meter on the home screen (`meter` subcommand), ffmpeg children in a kill-on-close job object, camera recording (`--camera N` → `camera.mp4` on the shared clock) with an editable overlay in the editor (Hidden / Circle / Rounded, size, corner, mirror), system audio (`--system-audio` → `system.wav` via `win_loopback.py`, WASAPI loopback) with voice / computer-sound volume sliders in the editor.
Editor also has: project.json autosave (config + cuts, merged over defaults), timeline in source time (kept / pause / cut / clicks / playhead, click to seek), Trim start/end here, Cut from here…to here, Restore per cut, Undo/Redo (Ctrl+Z / Ctrl+Y), output vs recorded duration readout.
Phase 1 on Windows is feature-complete except window/region capture and a camera preview before recording.
**macOS (2026-10-07):** `recorder/narrate.py` rewritten on the shared `recorder/common.py` — camera, crash journal + recovery, shortcut log, meter, analyze, transcribe, enhance all present; system audio still needs the Swift/ScreenCaptureKit recorder. NOT YET RUN ON A MAC: first thing on her Mac is `python3 recorder/narrate.py --list`, then a short recording, then `npm run dev`. Expect small PyObjC/avfoundation fixes.
GitHub note (2026-10-07): pushes failed for ~1 h with a GitHub-side Internal Server Error on every ref; it cleared by itself. If it happens again, keep committing locally and retry later — the API still works.

Also done (evening): aspect presets Screen / 16:9 / 9:16 / 1:1 / 4:5 with content-aware reframing (portrait/square crop and follow the cursor; exports get exact platform sizes), and Smart Director v1 (`analyze` subcommand → analysis.json; card under the timeline; Accept/Reject → cuts, chapters, highlights in project.json). Verified: 9:16 export 720×1280 with camera top-right; analysis on the test clip; editor screenshots (`NARRATE_SCREENSHOT`).
Test recording used for screenshots: `%USERPROFILE%\Videos\Narrate\zz-smoke-test` (my 12 s capture of her screen; safe to delete).

## State as of 2026-10-19 (Windows laptop)
- **Self-contained Windows installer:** `npm run dist` now runs `scripts/bundle-runtime.mjs`, which copies a full Python 3.12 and ffmpeg/ffprobe into `app/runtime/` (git-ignored) → `resources/runtime/` in the app. `src/main/recorder.ts` prefers it and exports `NARRATE_FFMPEG`/`NARRATE_FFPROBE` so the recorder and GIF export use the bundled binaries. Speech engine still installs on first transcription (needs internet once).
- **Voice quality:** `enhance` chain is high-pass 80 Hz → 50/60 Hz hum notches → afftdn → de-ess → gentle compressor → two-pass loudnorm −16 LUFS → limiter (−1.5 dBTP). The editor runs it automatically the first time a recording with a mic opens (voice = clean; raw stays selectable). Export audio is AAC 320k.
- Tassy's agreed order after this (2026-10-19): installer ✅ → sharing links (needs her to pick + create a hosting account; she cannot have Claude create it) → tune on her real recording → Mac test run. Then she tests.

- **Share links (Phase 7 v1):** `app/src/main/share.ts` uploads the last MP4 export + a branded player page to her Cloudflare R2 bucket (`<id>/index.html`) with hand-rolled SigV4 (no SDK), returns the public r2.dev link and copies it. Setup form lives in the editor's export column (`SharePanel.tsx`); secret encrypted via safeStorage in userData/sharing.json; Save test-uploads `.narrate-check`. She created the Cloudflare account 2026-10-19; NOT yet tested end-to-end with real keys. Later: custom domain, delete/expire shares, view counts, Mac.

## Continuing on her Mac / another Claude account
She works from two Claude accounts; this repo (pushed to GitHub `Tassyomah/homalabs-studio`) is the only shared context. On the Mac: clone the repo, open it in Claude Code, say "continue" — this skill loads via CLAUDE.md. First Mac session: follow `docs/DEVELOPMENT.md` → macOS, run `python3 recorder/narrate.py --list`, tell her before a short test recording, then `npm run dev`, fix what breaks, commit, ask before pushing.

## Roadmap (SPEC-ADDON, agreed 2026-10-06)
1. ✅ Aspect presets with content-aware reframing.
2. ✅ Smart Director v1 (local signals → proposals). Later: SPEED proposals for repetitive navigation, sensitive-info warnings, transcript-based signals.
3. ✅ Asset Studio v1: `assets[]` derivatives (master + own cuts + config overrides) generated by `app/src/renderer/generate.ts` (Quick Demo, LinkedIn, Vertical Teaser, 15s Teaser, Clips); asset strip in the editor, per-asset editing, Export all. `scripts/assets.ts` prints/writes the set. Heuristics are untested on long real recordings — first thing to tune once she records something real.
4. ✅ Transcript + captions v1: `transcribe` subcommand (local faster-whisper in `%LOCALAPPDATA%\Narrate\speech`, on-demand install), transcript panel (seek / Remove sentence / Restore), filler-word proposals in the Smart Director, Captions setting Off / Minimal / Bold with word highlight.
5. ✅ Content map card, GIF export, Windows installer (`npm run dist` → `app/release/Narrate-Setup-*.exe`, per-user, unsigned; GitHub Actions builds it on push/tag).
6. ✅ Manual zooms (Zoom here + level/hold), speed ranges (Speed from here…to here, 0.5–3×), SPEED proposals from the Smart Director. Installed on this laptop via the NSIS installer (Start menu "Narrate").
7. ✅ Privacy masks (Mask here; blur / solid; sliders for box and end time).
8. ✅ Content card: thumbnail candidates (renderStill) + title / description / LinkedIn copy from the transcript and chapters, with Copy buttons (`scripts/thumbs.ts` for the CLI).
9. ✅ Shared `common.py`; macOS recorder ported to parity (untested on a Mac). Trim can no longer delete the whole video. Matroska clusters flushed every second.
10. ✅ Smart-zoom dwell filter + pan-to-nearby; camera preview on Home; export presets (YouTube / Shorts / Instagram / LinkedIn / Web); trim guard.
11. Next: remaining add-on sections (§19+ once she pastes them), bundling Python + ffmpeg into the installer, keyboard-shortcut keycaps (§46), drag-to-place for masks/zooms on the preview, audio normalisation (§16), macOS parity. The CI workflow file sits untracked until she runs `gh auth refresh -s workflow`. Rebuild + reinstall (`npm run dist`, then the setup exe with /S) so her installed app has the newest features — last installed build predates zooms/speeds/masks/content.
Known limits of both interim recorders: control bar appears in the capture; no window/region; no system audio. Windows multi-monitor ddagrab index order is assumed, untested (one display here).

## On a new machine
- **Windows:** `winget install Gyan.FFmpeg Python.Python.3.12 OpenJS.NodeJS.LTS` (Node needs admin; otherwise unzip node into `%LOCALAPPDATA%\Programs\nodejs`). `cd app && npm install && npm approve-scripts esbuild electron`; if Electron's binary is missing run `node node_modules/electron/install.js`. `npm run dev`.
- **macOS:** Install Xcode (App Store) and Node 20+. `cd app && npm install`. Build the Swift recorder (`cd recorder/swift && make`) and point `src/main/index.ts` RECORDER at it; keep the protocol identical. `npm run dev`, grant Screen Recording + Microphone, reopen.
- Continue from "Not built yet" above, updating `docs/DECISIONS.md` and this file as state changes.
