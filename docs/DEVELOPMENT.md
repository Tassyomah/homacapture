# Development

How to run narrate from source on macOS and Windows. Product spec: `SPEC.md`. Shape of the code: `ARCHITECTURE.md`.

## Layout
- `app/` — Electron + React + Remotion. UI, control bar, preview, export. One codebase for both platforms.
- `recorder/` — capture sidecars, one per platform, same stdin/stdout JSON-line protocol:
  - `narrate.py` macOS (interim: ffmpeg avfoundation + PyObjC), `swift/` macOS ScreenCaptureKit (target recorder)
  - `narrate_win.py` Windows (ffmpeg ddagrab/gdigrab + dshow + Win32 cursor log; standard library only)
  - `tests/smoke_win.py` 5-second end-to-end check of the Windows recorder
- `docs/` — spec, architecture, decisions, this file.

The app picks the recorder by `process.platform` (`app/src/main/index.ts`). Override with `NARRATE_RECORDER=<path>`
and the interpreter with `NARRATE_PYTHON=<path>`.

## Windows
Everything installs per-user; no administrator rights needed.
```powershell
winget install Gyan.FFmpeg            # ffmpeg + ffprobe (the recorder finds the WinGet install automatically)
winget install Python.Python.3.12     # the recorder is plain Python, no packages
winget install OpenJS.NodeJS.LTS      # or unzip https://nodejs.org/dist/latest-v24.x/ into %LOCALAPPDATA%\Programs\nodejs
cd app; npm install; npm run dev
```
Open a new terminal after installing so PATH is refreshed. Recordings go to `%USERPROFILE%\Videos\Narrate\<stamp>\`.
Windows has no screen-recording permission; the microphone can be blocked under Settings → Privacy & security →
Microphone → "Let desktop apps access your microphone". The app shows a notice with a link when that is the case.

Check the recorder without the app:
```powershell
python recorder\narrate_win.py --list        # displays and microphones
python recorder\narrate_win.py --check       # {"screen": true, "mic": "authorized"|"denied"|"unknown"}
python recorder\tests\smoke_win.py           # records the primary display for ~5 s into %TEMP%\narrate-smoke and validates it
python recorder\tests\smoke_win.py --camera  # same, plus the first camera (picks its best format ≤1080p at ≥24 fps)
python recorder\tests\smoke_win.py --system-audio   # same, plus computer sound (WASAPI loopback; the test beeps so there is something to capture)
python recorder\win_loopback.py out.wav 3    # loopback self-test: records 3 s with two beeps and prints the sync error
python recorder\narrate_win.py analyze --out <dir>    # Smart Director: writes analysis.json (silences, scene changes, idle, click groups → proposals)
python recorder\narrate_win.py transcribe --out <dir> [--model small.en]   # local Whisper → transcript.json; first run creates %LOCALAPPDATA%\Narrate\speech
python recorder\tests\crash_win.py           # kills the recorder mid-recording, checks ffmpeg died with it, recovers
python recorder\narrate_win.py meter         # microphone level lines until you press Ctrl-C
python recorder\narrate_win.py finalize --out <dir>   # finish a recording whose recorder died (what the app's "Restore" does)
```
While recording, the folder holds `recording.json`, `events.partial.jsonl` (cursor log, flushed every 0.5 s), `screen.mkv`
and `mic.mka`. A folder with `recording.json` but no `events.json` is an unfinished recording; the home screen offers
Restore / Discard for each. ffmpeg children are bound to a job object, so they die with the recorder instead of recording on.
Hardware encoders are probed in order NVENC → Quick Sync → AMF → libx264; the chosen one is written to `events.json`
(`encoder`) along with the capture path (`capture`: `ddagrab` or `gdigrab`).

## macOS
```sh
# Xcode command line tools provide python3; ffmpeg/ffprobe go in ~/bin (brew install ffmpeg && ln -s ...)
pip3 install --user pyobjc-core==10.3.2 pyobjc-framework-Cocoa==10.3.2 pyobjc-framework-Quartz==10.3.2
cd app && npm install && npm run dev
```
Grant Screen Recording and Microphone to the app on first run, then reopen it; Input Monitoring lets the recorder log keyboard shortcuts for keycaps. Recordings go to `~/Movies/Narrate/`. The Python recorder was ported from the Windows one and has not been run on a Mac yet — run `python3 recorder/narrate.py --list` and a short recording first and fix what breaks.
With Xcode installed, build the ScreenCaptureKit recorder with `make` in `recorder/swift` and point `RECORDER` at it.

## Installer (Windows)
```powershell
cd app; npm run dist          # electron-vite build → remotion bundle (out/remotion) → electron-builder NSIS → app/release/HomaCapture-Setup-<version>.exe
```
The installer is per-user (no admin) and unsigned for now (`signAndEditExecutable: false`, so no code-signing tooling is needed to build). The installed app ships the recorder scripts and the pre-bundled composition under `resources/`, and Remotion downloads its headless browser into `%APPDATA%\Narrate\.remotion` on the first export. Users still need Python 3 and ffmpeg (both `winget install`, per-user); the app says so in plain words when they are missing.
A GitHub Actions workflow that builds the installer on every push and attaches it to releases on `v*` tags lives at `.github/workflows/release.yml`. Pushing workflow files needs a GitHub login with the `workflow` scope (`gh auth refresh -h github.com -s workflow`); until that is done on this laptop the file is kept locally and not yet committed.
Verify an installed build without clicking: `NARRATE_OPEN=<recording dir>` + `NARRATE_EXPORT_ON_OPEN=1` exports that recording at 480p as `<stamp>-packaged-test.mp4` and quits.

## Export
Export renders the same Remotion composition the editor previews (`app/src/video`). The first export downloads
Remotion's headless Chrome (needs internet once). Output lands next to the recording as `<stamp>-narrate.mp4`.

## GIF export
`Export → Format → GIF` (or `npx tsx scripts/export.ts <dir> 480 --gif`): the composition is rendered muted, capped at 480 px on the short side, then ffmpeg makes a looping 15 fps GIF with a two-pass palette. Needs ffmpeg (found like the recorder finds it; `NARRATE_FFMPEG` overrides).

## Derivative assets from the command line
```powershell
npx tsx scripts/assets.ts "$env:USERPROFILE\Videos\Narrate\<stamp>"          # print what "Generate assets" would make
npx tsx scripts/assets.ts "$env:USERPROFILE\Videos\Narrate\<stamp>" --write  # store them in project.json
```

## Screenshots of the app (for reviews and docs)
```powershell
$env:NARRATE_SCREENSHOT = "$env:TEMP\home.png"; npm run dev          # saves the main window ~2.5 s after load, then quits
$env:NARRATE_OPEN = "$env:USERPROFILE\Videos\Narrate\<stamp>"; $env:NARRATE_SCREENSHOT_DELAY = "7000"; npm run dev   # opens that recording in the editor first
```
Unset the variables afterwards (`Remove-Item Env:NARRATE_SCREENSHOT`). The hook only captures the app's own window, never the screen.

## Conventions
- Raw media are never modified after finalisation. Edits are instructions in the project (pauses today; cuts, zooms, masks next).
- A visible control must work end-to-end or say in plain text that it is unavailable (spec §98).
- Record decisions in `DECISIONS.md`; keep `.claude/skills/homalabs-studio/SKILL.md` "State" current so any machine can resume.
