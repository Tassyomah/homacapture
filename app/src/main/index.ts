import { app, BrowserWindow, ipcMain, shell, screen, globalShortcut, clipboard } from 'electron'
import { join, resolve, basename } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Analysis, Cut, Devices, ExportFormat, ExportProgress, MasterExtras, Project, ProjectFile, RecorderEvent, RenderConfig, StartOptions, Transcript, UnfinishedRecording } from '../shared/types'
import { Recorder } from './recorder'
import { AssetServer } from './assetServer'
import { exportProject, renderThumbnails } from './exporter'
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
          w.focus()
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
              system: events.files.system ? url(events.files.system) : null, cursors },
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
      { zooms: p.file?.zooms ?? [], speeds: p.file?.speeds ?? [], masks: p.file?.masks ?? [] })
      .then(() => app.quit(), (e) => { console.log('[dev] export failed', e.message); app.quit() })
  }
  ipcMain.handle('share:settings', () => getShareSettings())
  ipcMain.handle('share:save', (_e, i) => saveShareSettings(i))
  ipcMain.handle('share:file', (_e, file: string, title: string) => shareFile(file, title, (p) => win?.webContents.send('share:progress', p)))
  ipcMain.handle('clipboard:write', (_e, t: string) => clipboard.writeText(t))
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('project:trash', (_e, dir: string) => shell.trashItem(dir))

  createWindow()
  app.on('activate', () => { if (!win) createWindow(); else win.show() })
})
app.on('window-all-closed', () => { /* keep running while the control bar is up */ if (recorder.state === 'idle') app.quit() })
app.on('before-quit', () => recorder.kill())
