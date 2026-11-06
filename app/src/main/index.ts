import { app, BrowserWindow, dialog, ipcMain, shell, screen, globalShortcut, clipboard } from 'electron'
import { join, resolve, basename, extname } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Analysis, BrandKit, ClipOp, Cut, Devices, ExportFormat, ExportProgress, MasterExtras, MediaFile, Project, ProjectFile, RecorderEvent, RecordingEvents, RenderConfig, StartOptions, Transcript, UnfinishedRecording, VoiceFx } from '../shared/types'
import { Recorder } from './recorder'
import { AssetServer } from './assetServer'
import { exportProject, findFfmpeg, renderThumbnails } from './exporter'
import { getShareSettings, saveShareSettings, shareFile } from './share'

const IS_WIN = process.platform === 'win32'
const APP_ROOT = resolve(app.getAppPath())
/** Packaged installs keep the recorder scripts and the pre-bundled composition in resources/ (see package.json "build"). */
const RESOURCES = app.isPackaged ? process.resourcesPath : resolve(APP_ROOT, '..')
/** One recorder per platform, same stdin/stdout protocol (docs/ARCHITECTURE.md). */
const RECORDER = process.env.NARRATE_RECORDER ?? join(RESOURCES, 'recorder', IS_WIN ? 'narrate_win.py' : 'narrate.py')
// The app was called "Narrate" until 2026-10-20; Electron keys userData by product name, so carry the
// sharing settings over from the old folder once instead of making her set them up again.
try {
  const fresh = app.getPath('userData'), old = join(fresh, '..', 'Narrate')
  if (!existsSync(join(fresh, 'sharing.json')) && existsSync(join(old, 'sharing.json'))) {
    mkdirSync(fresh, { recursive: true }); copyFileSync(join(old, 'sharing.json'), join(fresh, 'sharing.json'))
  }
} catch { /* nothing to migrate */ }
// Remotion downloads its headless browser into <cwd>/.remotion; in a packaged app cwd must be somewhere writable.
if (app.isPackaged) { try { process.chdir(app.getPath('userData')) } catch { /* keep the default */ } }
const RECORDINGS = join(homedir(), IS_WIN ? 'Videos' : 'Movies', 'Narrate')
const SETTINGS_URL = IS_WIN
  ? { screen: 'ms-settings:privacy', mic: 'ms-settings:privacy-microphone' }
  : { screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone' }

let win: BrowserWindow | null = null
let bar: BrowserWindow | null = null
let server: AssetServer
const recorder = new Recorder(RECORDER)

function load(w: BrowserWindow, hash = '') {
  if (process.env.ELECTRON_RENDERER_URL) w.loadURL(process.env.ELECTRON_RENDERER_URL + hash)
  else w.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash.replace('#', '') })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 640,
    show: !process.env.NARRATE_SCREENSHOT,   // dev screenshots run hidden, no window or focus steal
    title: 'HomaCapture', backgroundColor: '#EFEEE8',
    ...(IS_WIN
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#EFEEE8', symbolColor: '#14140F', height: 52 } }
      : { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }),
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false },
  })
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log('[renderer]', e.message) })
  load(win)
  win.on('closed', () => (win = null))
  devScreenshot(win)
}

/**
 * Developer aid: NARRATE_SCREENSHOT=<file.png> saves a picture of the main window ~2 s after it loads
 * (NARRATE_OPEN=<recording dir> opens that recording in the editor first), then quits. Never active for users.
 */
function devScreenshot(w: BrowserWindow) {
  const file = process.env.NARRATE_SCREENSHOT
  if (!file) return
  w.webContents.once('did-finish-load', () => {
    const open = process.env.NARRATE_OPEN
    if (open) w.webContents.send('dev:open', open)
    setTimeout(async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          if (w.isVisible()) w.focus()
          // NARRATE_SCREENSHOT_JS: a snippet run in the page first (drive the UI into a state worth checking).
          if (process.env.NARRATE_SCREENSHOT_JS && attempt === 1) { const r = await w.webContents.executeJavaScript(process.env.NARRATE_SCREENSHOT_JS); if (r) console.log('[dev] js:', r); await new Promise((r) => setTimeout(r, 900)) }
          const img = await w.webContents.capturePage()
          await writeFile(file, img.toPNG())
          console.log('[dev] screenshot written', file)
          break
        } catch (e) {   // the compositor occasionally refuses a capture (UnknownVizError); try again shortly
          console.log(`[dev] screenshot attempt ${attempt} failed:`, (e as Error).message)
          await new Promise((r) => setTimeout(r, 1200))
        }
      }
      app.quit()
    }, Number(process.env.NARRATE_SCREENSHOT_DELAY ?? 2500))
  })
}

/** Small always-on-top control bar shown while recording (timer, pause, stop). */
function showBar() {
  const area = screen.getPrimaryDisplay().workArea
  bar = new BrowserWindow({
    width: 280, height: 52, x: area.x + area.width - 300, y: area.y + area.height - 72,
    frame: false, transparent: true, alwaysOnTop: true, resizable: false, movable: true, hasShadow: true,
    skipTaskbar: true, focusable: true, fullscreenable: false,
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false },
  })
  bar.setAlwaysOnTop(true, 'screen-saver'); bar.setVisibleOnAllWorkspaces(true)
  load(bar, '#bar')
}
function hideBar() { bar?.close(); bar = null }

function broadcast(ev: RecorderEvent) { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('recorder:event', ev) }

function loadProject(dir: string): Project | null {
  const ev = join(dir, 'events.json')
  if (!existsSync(ev)) return null
  const events = JSON.parse(readFileSync(ev, 'utf8'))
  const url = (f: string) => server.url(join(dir, f))
  const cursors: Record<string, string> = {}
  for (const [id, c] of Object.entries(events.cursors ?? {})) cursors[id] = url((c as { file: string }).file)
  const readJson = <T,>(f: string): T | null => { const p = join(dir, f); if (!existsSync(p)) return null; try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
  const file = readJson<ProjectFile>('project.json')         // torn file: start from defaults
  const transcript = readJson<Transcript>('transcript.json')
  return {
    dir, name: basename(dir), createdAt: statSync(ev).mtime.toISOString(), events, file, transcript,
    assets: { screen: url(events.files.screen), mic: events.files.mic ? url(events.files.mic) : null,
              micClean: existsSync(join(dir, 'mic.clean.wav')) ? url('mic.clean.wav') + `?v=${statSync(join(dir, 'mic.clean.wav')).mtimeMs}` : null,
              camera: events.files.camera ? url(events.files.camera) : null,
              system: events.files.system ? url(events.files.system) : null, cursors,
              cutout: existsSync(join(dir, 'screen.cutout.webm')) ? url('screen.cutout.webm') + `?v=${statSync(join(dir, 'screen.cutout.webm')).mtimeMs}` : null,
              media: Object.fromEntries((existsSync(join(dir, 'media')) ? readdirSync(join(dir, 'media')) : []).filter((f) => !f.startsWith('.')).map((f) => [`media/${f}`, url(join('media', f))])) },
  }
}

/** Folders the recorder started but never finished (crash, force quit, power loss). */
function listUnfinished(): UnfinishedRecording[] {
  const out: UnfinishedRecording[] = []
  for (const d of readdirSync(RECORDINGS)) {
    const dir = join(RECORDINGS, d)
    const setup = join(dir, 'recording.json')
    if (!existsSync(setup) || existsSync(join(dir, 'events.json'))) continue
    if (recorder.state !== 'idle' && recorder.currentOut === dir) continue   // the one being recorded right now
    try {
      const s = JSON.parse(readFileSync(setup, 'utf8'))
      out.push({ dir, name: d, startedAt: s.startedAt ?? statSync(setup).mtime.toISOString(), display: s.display, mic: s.mic ?? null })
    } catch { /* torn file: ignore */ }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

// Recovery progress is shown inline on the home screen, never as a new recording.
recorder.on('recover', (ev: RecorderEvent) => {
  if (ev.event === 'finalizing') broadcast({ event: 'recovering', step: ev.step })
  else if (ev.event === 'ready') broadcast({ event: 'recovering', step: 'done' })
})
recorder.on('level', (level: number) => win?.webContents.send('mic:level', level))
recorder.on('analyze', (ev: RecorderEvent) => {
  if (ev.event === 'analyzing') broadcast(ev)
  else if (ev.event === 'ready') broadcast({ event: 'analyzing', step: 'done' })
})
recorder.on('transcribe', (ev: RecorderEvent) => {
  if (ev.event === 'transcribing') broadcast(ev)
  else if (ev.event === 'ready') broadcast({ event: 'transcribing', stage: 'done' })
})
recorder.on('import', (ev: RecorderEvent) => { if (ev.event === 'importing') broadcast(ev) })
recorder.on('matte', (ev: RecorderEvent) => { if (ev.event === 'matting') broadcast(ev) })
recorder.on('enhance', (ev: RecorderEvent) => {
  if (ev.event === 'enhancing') broadcast(ev)
  else if (ev.event === 'ready') broadcast({ event: 'enhancing', step: 'done' })
})

recorder.on('event', (raw: RecorderEvent) => {
  let ev = raw
  if (raw.event === 'ready') {
    const project = loadProject(raw.out)
    ev = project ? { ...raw, project } : { event: 'error', code: 'no_project', message: 'Recording finished but no project was written.' }
  }
  if (ev.event === 'ready' || ev.event === 'error') {
    hideBar(); globalShortcut.unregisterAll()
    if (win) { win.show(); win.focus() } else createWindow()
  }
  broadcast(ev)
})

app.whenReady().then(async () => {
  if (process.env.NARRATE_SCREENSHOT) app.dock?.hide()
  await mkdir(RECORDINGS, { recursive: true })
  server = await AssetServer.start(RECORDINGS)

  ipcMain.handle('devices:list', (): Promise<Devices> => recorder.listDevices())
  ipcMain.handle('permissions:check', (_e, request: boolean) => recorder.checkPermissions(request))
  ipcMain.handle('settings:open', (_e, which: 'screen' | 'mic') => shell.openExternal(SETTINGS_URL[which]))
  ipcMain.handle('recording:start', async (_e, opts: StartOptions) => {
    recorder.stopMeter()
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    await recorder.start({ ...opts, out: join(RECORDINGS, stamp) })
    win?.hide(); showBar()
    globalShortcut.register('CommandOrControl+Shift+S', () => recorder.stop())
    globalShortcut.register('CommandOrControl+Shift+P', () => (recorder.state === 'paused' ? recorder.resume() : recorder.pause()))
  })
  ipcMain.handle('recording:pause', () => recorder.pause())
  ipcMain.handle('recording:resume', () => recorder.resume())
  ipcMain.handle('recording:stop', () => recorder.stop())
  ipcMain.handle('recording:state', () => ({ state: recorder.state, since: recorder.since, pausedTotal: recorder.pausedTotal, startedAt: recorder.startedAt }))
  ipcMain.handle('projects:list', (): Project[] =>
    readdirSync(RECORDINGS).map((d) => loadProject(join(RECORDINGS, d))).filter((p): p is Project => !!p)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  ipcMain.handle('projects:unfinished', (): UnfinishedRecording[] => listUnfinished())
  ipcMain.handle('projects:recover', async (_e, dir: string): Promise<Project> => {
    if (!dir.startsWith(RECORDINGS)) throw new Error('not a recording folder')
    await recorder.recover(dir)
    const p = loadProject(dir); if (!p) throw new Error('The recording was finalised but could not be opened.')
    return p
  })
  ipcMain.handle('mic:meter:start', (_e, mic: number) => { if (recorder.state === 'idle') recorder.startMeter(mic) })
  ipcMain.handle('mic:meter:stop', () => recorder.stopMeter())
  ipcMain.handle('project:save', async (_e, dir: string, file: ProjectFile) => {
    if (!dir.startsWith(RECORDINGS) || !existsSync(join(dir, 'events.json'))) throw new Error('not a recording folder')
    const tmp = join(dir, 'project.json.tmp')
    await writeFile(tmp, JSON.stringify(file, null, 1), 'utf8')
    await rename(tmp, join(dir, 'project.json'))   // atomic: project.json is always complete (spec §82)
  })
  let analyzing: Promise<void> | null = null
  ipcMain.handle('project:analyze', async (_e, dir: string, force: boolean): Promise<Analysis> => {
    if (!dir.startsWith(RECORDINGS) || !existsSync(join(dir, 'events.json'))) throw new Error('not a recording folder')
    const file = join(dir, 'analysis.json')
    if (force || !existsSync(file)) {
      analyzing ??= recorder.analyze(dir).finally(() => { analyzing = null })
      await analyzing
    }
    return JSON.parse(readFileSync(file, 'utf8'))
  })
  let transcribing: Promise<void> | null = null
  ipcMain.handle('project:transcribe', async (_e, dir: string): Promise<Transcript> => {
    if (!dir.startsWith(RECORDINGS) || !existsSync(join(dir, 'events.json'))) throw new Error('not a recording folder')
    transcribing ??= recorder.transcribe(dir).finally(() => { transcribing = null })
    await transcribing
    return JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8'))
  })
  ipcMain.handle('project:export', async (_e, dir: string, config: RenderConfig, cuts: Cut[] = [], suffix?: string, format?: ExportFormat, extra?: MasterExtras) => {
    const p = loadProject(dir); if (!p) throw new Error('project not found')
    const send = (prog: ExportProgress) => win?.webContents.send('export:progress', prog)
    return exportProject(APP_ROOT, p, config, cuts, send, suffix, format, join(RESOURCES, 'remotion'), extra)
  })
  ipcMain.handle('project:enhance', async (_e, dir: string): Promise<Project> => {
    if (!dir.startsWith(RECORDINGS) || !existsSync(join(dir, 'events.json'))) throw new Error('not a recording folder')
    await recorder.enhance(dir)
    const p = loadProject(dir); if (!p) throw new Error('project not found')
    return p
  })
  ipcMain.handle('project:thumbnails', async (_e, dir: string, config: RenderConfig, cuts: Cut[] = [], timesOut: number[], extra?: MasterExtras) => {
    const p = loadProject(dir); if (!p) throw new Error('project not found')
    const files = await renderThumbnails(APP_ROOT, p, config, cuts, timesOut.slice(0, 6), join(RESOURCES, 'remotion'), extra)
    return files.map((f) => ({ path: f, url: server.url(f) + `?v=${Date.now()}` }))
  })
  // Developer aid: NARRATE_EXPORT_ON_OPEN=1 with NARRATE_OPEN=<dir> exports that recording's master (as "packaged-test") and quits —
  // used to verify an installed build end to end without clicking.
  if (process.env.NARRATE_EXPORT_ON_OPEN && process.env.NARRATE_OPEN) {
    const p = loadProject(process.env.NARRATE_OPEN)
    if (p) exportProject(APP_ROOT, p, { ...(await import('../shared/types')).defaultConfig, ...(p.file?.config ?? {}), outputHeight: 480 }, p.file?.cuts ?? [],
      (prog) => console.log('[dev] export', prog.stage, Math.round(prog.progress * 100) + '%', prog.message ?? ''), 'packaged-test', 'mp4', join(RESOURCES, 'remotion'),
      { zooms: p.file?.zooms ?? [], speeds: p.file?.speeds ?? [], masks: p.file?.masks ?? [], texts: p.file?.texts ?? [], overlays: p.file?.overlays ?? [], stickers: p.file?.stickers ?? [], music: p.file?.music ?? null, voiceovers: p.file?.voiceovers ?? [], inserts: p.file?.inserts ?? [] })
      .then(() => app.quit(), (e) => { console.log('[dev] export failed', e.message); app.quit() })
  }
  ipcMain.handle('share:settings', () => getShareSettings())
  ipcMain.handle('share:save', (_e, i) => saveShareSettings(i))
  ipcMain.handle('share:file', (_e, file: string, title: string) => shareFile(file, title, (p) => win?.webContents.send('share:progress', p)))
  ipcMain.handle('clipboard:write', (_e, t: string) => clipboard.writeText(t))
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('project:trash', (_e, dir: string) => shell.trashItem(dir))
  // Upload: any video becomes a project in the recordings folder (the original file is only read, never moved).
  ipcMain.handle('project:import', async (_e, path?: string): Promise<Project | null> => {
    let src = path
    if (!src) {
      const r = await dialog.showOpenDialog(win!, { title: 'Upload a video', properties: ['openFile'],
        filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }] })
      if (r.canceled || !r.filePaths[0]) return null
      src = r.filePaths[0]
    }
    if (!existsSync(src)) throw new Error('That file could not be found.')
    const slug = basename(src).replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'video'
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
    const out = join(RECORDINGS, `${slug}-${stamp}`)
    await recorder.importVideo(src, out)
    const p = loadProject(out); if (!p) throw new Error('The video was read but no project was written.')
    return p
  })

  // Music and B-roll: the chosen file is copied into <project>/media (the original stays where it is). Videos that are not
  // MP4 are converted so every player and the renderer can read them.
  ipcMain.handle('project:media', async (_e, dir: string, kind: 'music' | 'broll' | 'image'): Promise<MediaFile | null> => {
    const filters = kind === 'music' ? [{ name: 'Music', extensions: ['mp3', 'm4a', 'wav', 'aac'] }]
      : kind === 'image' ? [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      : [{ name: 'Pictures and clips', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'm4v', 'webm'] }]
    const r = await dialog.showOpenDialog(win!, { title: kind === 'music' ? 'Add music' : kind === 'image' ? 'Choose a background picture' : 'Add B-roll', properties: ['openFile'], filters })
    if (r.canceled || !r.filePaths[0]) return null
    const src = r.filePaths[0], ext = extname(src).toLowerCase()
    const isVideo = ['.mp4', '.mov', '.m4v', '.webm'].includes(ext), isAudio = ['.mp3', '.m4a', '.wav', '.aac'].includes(ext)
    const slug = basename(src, extname(src)).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'media'
    mkdirSync(join(dir, 'media'), { recursive: true })
    let name = `${slug}${isVideo ? '.mp4' : ext}`
    for (let i = 2; existsSync(join(dir, 'media', name)); i++) name = `${slug}-${i}${isVideo ? '.mp4' : ext}`
    const dest = join(dir, 'media', name)
    if (isVideo && ext !== '.mp4') {
      const ff = findFfmpeg(); if (!ff) throw new Error('ffmpeg is needed to add this clip.')
      await new Promise<void>((res, rej) => { const p = spawn(ff, ['-v', 'error', '-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', dest]); p.on('error', rej); p.on('close', (c) => c === 0 ? res() : rej(new Error('That clip could not be converted.'))) })
    } else copyFileSync(src, dest)
    let duration: number | undefined
    const probe = findFfmpeg()?.replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe'))
    if ((isVideo || isAudio) && probe && existsSync(probe)) {
      try { duration = Number(execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dest], { encoding: 'utf8' }).trim()) || undefined } catch { /* unknown length */ }
    }
    return { file: `media/${name}`, url: server.url(dest), kind: isVideo ? 'video' : isAudio ? 'audio' : 'image', name: basename(src), duration }
  })
  // Editing tools that make a new file in the project's media/ with ffmpeg. All local and free; the source is never changed.
  const inProject = (dir: string) => { if (!dir.startsWith(RECORDINGS) || !existsSync(join(dir, 'events.json'))) throw new Error('not a recording folder') }
  const freeName = (dir: string, stem: string, ext: string) => {
    mkdirSync(join(dir, 'media'), { recursive: true })
    let name = `${stem}${ext}`
    for (let i = 2; existsSync(join(dir, 'media', name)); i++) name = `${stem}-${i}${ext}`
    return name
  }
  const ffmpegRun = (args: string[], failure: string) => new Promise<void>((res, rej) => {
    const ff = findFfmpeg(); if (!ff) return rej(new Error('ffmpeg is needed for this.'))
    const p = spawn(ff, ['-v', 'error', '-y', ...args]); let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('error', rej); p.on('close', (c) => { if (c === 0) res(); else { console.warn(err.slice(-400)); rej(new Error(failure)) } })
  })
  const lengthOf = (file: string): number | undefined => {
    const probe = findFfmpeg()?.replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe'))
    if (!probe || !existsSync(probe)) return undefined
    try { return Number(execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim()) || undefined } catch { return undefined }
  }
  const made = (dir: string, name: string, kind: MediaFile['kind'], label: string): MediaFile => {
    const dest = join(dir, 'media', name)
    return { file: `media/${name}`, url: server.url(dest), kind, name: label, duration: kind === 'image' ? undefined : lengthOf(dest) }
  }
  const eventsOf = (dir: string): RecordingEvents => JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8'))
  ipcMain.handle('project:frame', async (_e, dir: string, t: number, poster?: boolean): Promise<MediaFile> => {
    inProject(dir)
    if (poster && existsSync(join(dir, 'media', '.poster.jpg'))) return made(dir, '.poster.jpg', 'image', 'Poster')
    const name = poster ? '.poster.jpg' : freeName(dir, 'freeze', '.jpg')
    mkdirSync(join(dir, 'media'), { recursive: true })
    await ffmpegRun(['-ss', t.toFixed(3), '-i', join(dir, eventsOf(dir).files.screen), '-frames:v', '1', '-q:v', '2', join(dir, 'media', name)], 'That frame could not be saved.')
    return made(dir, name, 'image', 'Freeze frame')
  })
  // What the timeline shows: a strip of frames and the shape of the sound, made once per project and kept in media/.
  ipcMain.handle('project:strip', async (_e, dir: string): Promise<{ strip: string; frames: number; aspect: number; wave: string | null }> => {
    inProject(dir)
    const ev = eventsOf(dir), frames = Math.max(8, Math.min(90, Math.ceil(ev.videoDuration / 2)))
    mkdirSync(join(dir, 'media'), { recursive: true })
    const stripFile = join(dir, 'media', '.strip.jpg'), waveFile = join(dir, 'media', '.wave.png')
    // Short videos read every frame; long ones only keyframes, so the strip stays quick.
    if (!existsSync(stripFile)) await ffmpegRun([...(ev.videoDuration > 600 ? ['-skip_frame', 'nokey'] : []), '-i', join(dir, ev.files.screen), '-vf', `fps=${(frames / Math.max(0.1, ev.videoDuration)).toFixed(4)},scale=-2:80,tile=${frames}x1`, '-frames:v', '1', '-q:v', '5', stripFile], 'The timeline pictures could not be made.')
    if (ev.files.mic && !existsSync(waveFile)) await ffmpegRun(['-i', join(dir, ev.files.mic), '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=2400x48:colors=0xFFFFFF:scale=sqrt', '-frames:v', '1', waveFile], 'wave').catch(() => {})
    return { strip: server.url(stripFile), frames, aspect: ev.display.width / Math.max(1, ev.display.height), wave: existsSync(waveFile) ? server.url(waveFile) : null }
  })
  ipcMain.handle('project:process', async (_e, dir: string, op: ClipOp, start: number, end: number, source?: string): Promise<MediaFile> => {
    inProject(dir)
    const len = end - start
    if (len < 0.1) throw new Error('Select a longer stretch.')
    const limit = op === 'reverse' || op === 'slowmo' ? 15 : 120
    if (len > limit) throw new Error(`Keep it under ${limit} seconds for this. Split the clip first.`)
    const ev = eventsOf(dir)
    const name = freeName(dir, op, '.mp4'), out = join(dir, 'media', name)
    // Reverse holds every frame in memory and slow motion is heavy, so both work at up to 1080p. Sizes stay even for H.264.
    const fit = "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    const video = op === 'copy' ? even : op === 'reverse' ? `${fit},reverse` : op === 'slowmo' ? `${fit},setpts=2*PTS,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir` : `deshake=rx=32:ry=32,${even}`
    const audio = op === 'reverse' ? 'areverse' : op === 'slowmo' ? 'atempo=0.5' : 'anull'
    const hasOwnAudio = (f: string) => { try { return execFileSync(findFfmpeg()!.replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe')), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().length > 0 } catch { return false } }
    const clip = source ? join(dir, source) : join(dir, ev.files.screen)
    const inputs = ['-ss', start.toFixed(3), '-t', len.toFixed(3), '-i', clip]
    // The voice lives in its own track on recordings, so it is cut from there with the same offset the player uses.
    let audioIn: string | null = null
    if (!source && ev.files.mic) {
      const voice = existsSync(join(dir, 'mic.clean.wav')) ? 'mic.clean.wav' : ev.files.mic
      inputs.push('-ss', Math.max(0, start - (ev.micOffset ?? 0)).toFixed(3), '-t', len.toFixed(3), '-i', join(dir, voice))
      audioIn = '1:a:0'
    } else if (hasOwnAudio(clip)) audioIn = '0:a:0'
    const graph = `[0:v:0]${video},format=yuv420p[v]` + (audioIn ? `;[${audioIn}]${audio}[a]` : '')
    await ffmpegRun([...inputs, '-filter_complex', graph, '-map', '[v]', ...(audioIn ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-movflags', '+faststart', out], 'That piece could not be processed.')
    return made(dir, name, 'video', op === 'copy' ? 'Copy' : op === 'reverse' ? 'Reversed' : op === 'slowmo' ? 'Slow motion' : 'Steadied')
  })
  ipcMain.handle('project:chroma', async (_e, dir: string, file: string, color: string, similarity: number): Promise<MediaFile> => {
    inProject(dir)
    const src = join(dir, file), still = /\.(png|jpe?g|webp)$/i.test(file)
    const name = freeName(dir, basename(file, extname(file)) + '-keyed', still ? '.png' : '.webm')
    const key = `chromakey=${color.replace('#', '0x')}:${similarity.toFixed(2)}:0.08,format=${still ? 'rgba' : 'yuva420p'}`
    await ffmpegRun(['-i', src, '-vf', key, ...(still ? ['-frames:v', '1'] : ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-row-mt', '1', '-deadline', 'realtime', '-cpu-used', '5', '-an']), join(dir, 'media', name)], 'The background colour could not be removed.')
    return made(dir, name, still ? 'image' : 'video', 'Keyed')
  })
  ipcMain.handle('project:voice', async (_e, dir: string, fx: Exclude<VoiceFx, 'none'>, clean: boolean): Promise<MediaFile> => {
    inProject(dir)
    const ev = eventsOf(dir); if (!ev.files.mic) throw new Error('This recording has no voice track.')
    const src = join(dir, clean && existsSync(join(dir, 'mic.clean.wav')) ? 'mic.clean.wav' : ev.files.mic)
    const probe = findFfmpeg()?.replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe'))
    let rate = 48000
    try { if (probe) rate = Number(execFileSync(probe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', src], { encoding: 'utf8' }).trim()) || rate } catch { /* assume 48 kHz */ }
    const pitch = (k: number) => `asetrate=${Math.round(rate * k)},aresample=${rate},atempo=${(1 / k).toFixed(4)}`
    const filter = { deep: pitch(0.84), high: pitch(1.25), radio: 'highpass=f=400,lowpass=f=3000,acompressor=threshold=0.1:ratio=6', echo: 'aecho=0.8:0.6:140:0.3',
      robot: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75" }[fx]
    const name = `voice-${fx}.wav`
    mkdirSync(join(dir, 'media'), { recursive: true })
    await ffmpegRun(['-i', src, '-af', filter, '-ar', String(rate), join(dir, 'media', name)], 'The voice could not be changed.')
    return made(dir, name, 'audio', fx)
  })
  // Brand kit: one per app, kept beside the other settings.
  const brandFile = () => join(app.getPath('userData'), 'brand.json')
  const noBrand: BrandKit = { colors: ['#FB8B73', '#6E71E8', '#14140F', '#EFEEE8'], font: 'Aeonik', handle: '', logo: null }
  ipcMain.handle('brand:get', (): BrandKit => { try { return { ...noBrand, ...JSON.parse(readFileSync(brandFile(), 'utf8')) } } catch { return noBrand } })
  ipcMain.handle('brand:set', (_e, b: BrandKit): BrandKit => { writeFileSync(brandFile(), JSON.stringify(b, null, 1)); return b })
  ipcMain.handle('brand:logo', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose your logo', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const dest = join(app.getPath('userData'), `brand-logo${extname(r.filePaths[0]).toLowerCase()}`)
    copyFileSync(r.filePaths[0], dest)
    return dest
  })
  ipcMain.handle('project:mediaPath', async (_e, dir: string, path: string): Promise<MediaFile> => {
    inProject(dir)
    if (!path.startsWith(app.getPath('userData'))) throw new Error('That file cannot be added.')
    const name = freeName(dir, 'logo', extname(path).toLowerCase())
    copyFileSync(path, join(dir, 'media', name))
    return made(dir, name, 'image', 'Logo')
  })
  // Voiceover from text: the Mac's own voices via `say` (offline, free), saved as m4a in the project's media/.
  // Joke and sound-effect voices that ship with macOS; never offered for a voiceover.
  const NOVELTY = new Set(['Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News', 'Jester', 'Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Fred', 'Junior', 'Kathy', 'Ralph'])
  ipcMain.handle('voices:list', async (): Promise<{ name: string; lang: string }[]> => {
    if (process.platform !== 'darwin') return []
    try {
      const out = execFileSync('/usr/bin/say', ['-v', '?'], { encoding: 'utf8' })
      return out.split('\n').map((l) => /^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#/.exec(l)).filter(Boolean)
        .map((m) => ({ name: m![1].trim(), lang: m![2] })).filter((v) => v.lang.startsWith('en_') && !NOVELTY.has(v.name.replace(/ \(.*$/, '')))
    } catch { return [] }
  })
  ipcMain.handle('project:speak', async (_e, dir: string, text: string, voice: string): Promise<{ file: string; url: string; duration: number }> => {
    if (process.platform !== 'darwin') throw new Error('Voiceover works on macOS for now.')
    const ff = findFfmpeg(); if (!ff) throw new Error('ffmpeg is needed for voiceovers.')
    mkdirSync(join(dir, 'media'), { recursive: true })
    let name = 'voiceover.m4a'
    for (let i = 2; existsSync(join(dir, 'media', name)); i++) name = `voiceover-${i}.m4a`
    const aiff = join(dir, 'media', name.replace('.m4a', '.aiff')), dest = join(dir, 'media', name)
    execFileSync('/usr/bin/say', ['-v', voice, '-o', aiff, '--', text])
    await new Promise<void>((res, rej) => { const p = spawn(ff, ['-v', 'error', '-y', '-i', aiff, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', dest]); p.on('error', rej); p.on('close', (c) => c === 0 ? res() : rej(new Error('The voiceover could not be saved.'))) })
    rmSync(aiff, { force: true })
    let duration = 0
    const probe = ff.replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe'))
    try { duration = Number(execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dest], { encoding: 'utf8' }).trim()) || 0 } catch { /* unknown */ }
    if (!duration) duration = text.trim().split(/\s+/).length / 2.6 + 0.5   // ~156 words a minute, so it is never cut short
    return { file: `media/${name}`, url: server.url(dest), duration }
  })
  ipcMain.handle('project:matte', async (_e, dir: string): Promise<Project> => {
    if (process.platform !== 'darwin') throw new Error('Removing the background works on macOS for now.')
    await recorder.matte(dir)
    const p = loadProject(dir); if (!p) throw new Error('project not found')
    return p
  })

  createWindow()
  app.on('activate', () => { if (!win) createWindow(); else win.show() })
})
app.on('window-all-closed', () => { /* keep running while the control bar is up */ if (recorder.state === 'idle') app.quit() })
app.on('before-quit', () => recorder.kill())
