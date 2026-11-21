/**
 * HomaPod remote recording (Tassy, 2026-11-20: "build both").
 *
 * The guest only ever gets one VDO.Ninja link and installs nothing. HomaCapture joins the same room in a hidden window
 * (the VDO.Ninja scene view, which shows every guest) and records each guest's stream as its own file, plus Tassy's own
 * camera and mic straight from her devices, all on one clock.
 *   A  "Open the call here": the call itself also runs in a HomaCapture window.
 *   B  "I'll talk in Chrome": she runs the call in Chrome as today; HomaCapture records quietly alongside as the backup.
 * Stop turns it into a normal project (the main camera as the video, everyone's voices mixed as the sound, every other
 * camera in media/) plus homapod.json, the map the HomaPod edit pipeline reads. Phone 4K files are lined up later by
 * sound (`narrate.py align`); they are linked, never copied.
 */
import { app, BrowserWindow, dialog, ipcMain, screen, session, shell, type IpcMainEvent } from 'electron'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, type WriteStream } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { HomapodFile, HomapodGuest, HomapodStatus, HomapodTrack, PodTalk, Project } from '../shared/types'
import type { Recorder } from './recorder'

const VDO = 'https://vdo.ninja/'
const HOST_SID = 'homapodhost'
const PARTITION = 'persist:homapod'

type Track = { key: string; kind: HomapodTrack['kind']; sid: string | null; mime: string; t0: number; t1: number | null
  width: number | null; height: number | null; hasVideo: boolean; hasAudio: boolean; raw: string; out: WriteStream; bytes: number }

export function guestLink(room: string, guest: string) {
  const q = new URLSearchParams({ room }); q.set('webcam', ''); q.set('quality', '0')
  if (guest.trim()) q.set('label', guest.trim())
  return `${VDO}?${q.toString().replace(/=(&|$)/g, '$1').replace(/\+/g, '%20')}`
}
export function hostLink(room: string, host: string) {
  const q = new URLSearchParams({ room, push: HOST_SID }); q.set('webcam', ''); q.set('quality', '0'); q.set('label', host || 'Host')
  return `${VDO}?${q.toString().replace(/=(&|$)/g, '$1').replace(/\+/g, '%20')}`
}
const sceneLink = (room: string) => `${VDO}?scene=0&room=${encodeURIComponent(room)}&videobitrate=12000&audiobitrate=256&cleanoutput`

export function registerHomapod(deps: {
  main: () => BrowserWindow | null
  recordings: string
  preload: string
  recorder: Recorder
  ffmpeg: () => string | null
  loadProject: (dir: string) => Project | null
  /** load a renderer route (#hpbar) into a window */
  load: (w: BrowserWindow, hash: string) => void
  /** show the main window, opening it again if it was closed */
  openMain: (projectDir?: string | null) => void
  mainPreload: string
}) {
  let recWin: BrowserWindow | null = null, callWin: BrowserWindow | null = null
  let room = '', mode: 'here' | 'chrome' = 'chrome', guestName = '', hostName = 'Tassy'
  let dir: string | null = null, startedAt = 0, phase: HomapodStatus['phase'] = 'off', message: string | null = null
  let guests: HomapodGuest[] = []
  const labels: Record<string, string> = {}
  let tracks = new Map<string, Track>()
  let poll: NodeJS.Timeout | null = null
  let stopped: (() => void) | null = null
  let saved: string | null = null
  // Auto record (Tassy, 2026-11-21: "when i hit start/record for the vdo, the homapod recording should start as well"):
  // her own camera joining the room (VDO.Ninja's START, in Chrome or the call window) starts recording; leaving the call
  // for more than 10 s stops and saves. The record options come from the HomaPod screen.
  type RecOpts = { micLabel: string | null; camLabel: string | null; headphones: boolean }
  let recOpts: RecOpts = { micLabel: 'default', camLabel: 'default', headphones: true }   // the Mac's default mic and camera until the screen says otherwise
  let autoRecord = !process.env.NARRATE_TEST_NOAUTO, autoStarted = false, hostInCall = false, hostGoneAt = 0
  let bar: BrowserWindow | null = null
  const test = !!process.env.NARRATE_TEST_HOMAPOD

  const status = (): HomapodStatus => ({ phase, room, mode, guests, since: startedAt || null, dir, message, saved, auto: autoRecord, hostInCall,
    guestLink: room ? guestLink(room, guestName) : '', hostLink: room ? hostLink(room, hostName) : '',
    tracks: [...tracks.values()].map((t) => ({ key: t.key, kind: t.kind, label: t.sid ? labels[t.sid] ?? t.sid : t.kind === 'host-mic' ? 'Your mic' : 'Your camera', bytes: t.bytes })) })
  const send = () => { const st = status(); deps.main()?.webContents.send('homapod:status', st); if (bar && !bar.isDestroyed()) bar.webContents.send('homapod:status', st) }

  /** The floating Record / Stop bar: stays on top of Chrome or the call window, never takes focus when it appears. */
  function showBar() {
    if (test && process.env.NARRATE_TEST_HOMAPOD !== 'shot' && process.env.NARRATE_TEST_HOMAPOD !== 'auto') return
    if (bar && !bar.isDestroyed()) { if (!test) bar.showInactive(); return }
    // On the right edge, halfway down: clear of the call's own buttons (bottom) and the browser's toolbar (top).
    // Dragged somewhere else, it remembers (Tassy, 2026-11-21: "blocks the vdo record button on chrome").
    const BW = 176, BH = 150, posFile = join(app.getPath('userData'), 'homapod-bar.json')
    const area = screen.getPrimaryDisplay().workArea
    let x = area.x + area.width - BW - 12, y = area.y + Math.round((area.height - BH) / 2)
    try {
      const p = JSON.parse(readFileSync(posFile, 'utf8')) as { x: number; y: number }
      if (screen.getAllDisplays().some((d) => p.x >= d.workArea.x && p.y >= d.workArea.y && p.x + BW <= d.workArea.x + d.workArea.width && p.y + BH <= d.workArea.y + d.workArea.height)) { x = p.x; y = p.y }
    } catch { /* first time: the default spot */ }
    bar = new BrowserWindow({ width: BW, height: BH, x, y,
      frame: false, transparent: true, alwaysOnTop: true, resizable: false, movable: true, hasShadow: true, skipTaskbar: true,
      focusable: true, fullscreenable: false, show: false, acceptFirstMouse: true, webPreferences: { preload: deps.mainPreload, sandbox: false } })
    bar.setAlwaysOnTop(true, 'screen-saver'); bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    bar.on('closed', () => { bar = null })
    bar.on('moved', () => { if (bar) { const b = bar.getBounds(); try { writeFileSync(posFile, JSON.stringify({ x: b.x, y: b.y })) } catch { /* not saved */ } } })
    bar.once('ready-to-show', () => { if (!test) bar?.showInactive() })
    deps.load(bar, '#hpbar')
  }
  const hideBar = () => { bar?.destroy(); bar = null }
  // closing the card (its ×, or leaving the HomaPod screen) never stops a recording
  ipcMain.handle('homapod:closeCard', () => { if (phase !== 'recording' && phase !== 'saving') hideBar() })
  ipcMain.handle('homapod:focusMain', () => deps.openMain(saved))   // Show = the saved HomaPod, open in the editor

  const ses = () => {
    const s = session.fromPartition(PARTITION)
    // camera + mic for VDO.Ninja only (the call and the recorder); nothing else on this partition asks
    s.setPermissionRequestHandler((wc, perm, cb) => cb((perm === 'media' || perm === 'speaker-selection') && wc.getURL().startsWith(VDO)))
    s.setPermissionCheckHandler((_wc, perm, origin) => (perm === 'media') && origin.startsWith('https://vdo.ninja'))
    return s
  }

  /** Join the room in the hidden recorder window; it watches who is there from now on. */
  async function connect() {
    if (recWin && !recWin.isDestroyed()) return
    ses()
    recWin = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { partition: PARTITION, preload: deps.preload, sandbox: false, backgroundThrottling: false } })
    recWin.webContents.setAudioMuted(true)
    recWin.webContents.on('will-prevent-unload', (e) => e.preventDefault())   // VDO.Ninja's "leave this page?" guard must never block quitting   // records the guests' sound, never plays it out of the speakers
    recWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    recWin.on('closed', () => { recWin = null })
    await recWin.loadURL(sceneLink(room))
    poll = setInterval(async () => {
      if (!recWin || recWin.isDestroyed()) return
      try {
        const r = await recWin.webContents.executeJavaScript(`JSON.stringify({ v: [...document.querySelectorAll('video[data-sid]')].map(v => ({ sid: v.dataset.sid, w: v.videoWidth, h: v.videoHeight, a: !!(v.srcObject && v.srcObject.getAudioTracks().length) })),
          l: Object.values((window.session && session.rpcs) || {}).map(r => [r.streamID, r.label || '']) })`)
        const { v, l } = JSON.parse(r) as { v: { sid: string; w: number; h: number; a: boolean }[]; l: [string, string][] }
        for (const [sid, label] of l) if (sid && label) labels[sid] = label
        guests = v.filter((g) => g.sid !== HOST_SID).map((g) => ({ sid: g.sid, label: labels[g.sid] || 'Guest', width: g.w, height: g.h, audio: g.a }))
        const wasIn = hostInCall
        hostInCall = v.some((g) => g.sid === HOST_SID)
        if (autoRecord && hostInCall && !wasIn && phase === 'ready') { autoStarted = true; void startRecording(recOpts) }
        if (phase === 'recording' && autoStarted) {
          if (hostInCall) hostGoneAt = 0
          else if (!hostGoneAt) hostGoneAt = Date.now()
          else if (Date.now() - hostGoneAt > 10000) { hostGoneAt = 0; void stopRecording().catch(() => {}) }
        }
        send()
      } catch { /* page reloading */ }
    }, 1500)
  }

  function disconnect() {
    hideBar()
    if (poll) clearInterval(poll); poll = null
    recWin?.destroy(); recWin = null
    callWin?.destroy(); callWin = null
    guests = []
  }

  ipcMain.handle('homapod:prepare', async (_e, o: { room: string; guest: string; host: string; mode: 'here' | 'chrome' }) => {
    if (phase === 'recording' || phase === 'saving') return status()
    const nextRoom = o.room.replace(/[^\w]/g, '').slice(0, 40)
    if (!nextRoom) throw new Error('Give the room a name (letters and numbers).')
    if (nextRoom !== room) disconnect()
    room = nextRoom; guestName = o.guest; hostName = o.host || 'Tassy'; mode = o.mode
    phase = 'ready'; message = null; saved = null
    await connect()
    showBar()
    if (mode === 'here') openCall()
    else { callWin?.destroy(); callWin = null }
    send(); return status()
  })

  function openCall() {
    if (callWin && !callWin.isDestroyed()) { if (!test) callWin.show(); return }
    ses()
    callWin = new BrowserWindow({ width: 1280, height: 800, show: !test, title: 'HomaPod call', backgroundColor: '#14140F',
      webPreferences: { partition: PARTITION, sandbox: true, backgroundThrottling: false } })
    callWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' } })
    callWin.webContents.on('will-prevent-unload', (e) => e.preventDefault())
    callWin.on('closed', () => { callWin = null })
    void callWin.loadURL(hostLink(room, hostName) + (test ? '&autostart' : ''))
  }
  ipcMain.handle('homapod:openCall', () => { openCall(); return status() })
  ipcMain.handle('homapod:openChrome', () => shell.openExternal(hostLink(room, hostName)))
  ipcMain.handle('homapod:status', () => status())


  // Quitting HomaCapture closes the call windows first (a hidden VDO.Ninja page used to block Quit, 2026-11-21).
  app.on('before-quit', () => { if (poll) clearInterval(poll); recWin?.destroy(); callWin?.destroy(); bar?.destroy() })
  ipcMain.handle('homapod:options', (_e, o: RecOpts & { auto: boolean }) => { recOpts = { micLabel: o.micLabel, camLabel: o.camLabel, headphones: o.headphones }; autoRecord = o.auto; send(); return status() })
  ipcMain.handle('homapod:record', async (_e, o: RecOpts) => { autoStarted = false; return startRecording(o) })
  async function startRecording(o: RecOpts) {
    if (phase === 'recording' || phase === 'saving') return status()
    if (!recWin) await connect()
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
    dir = join(deps.recordings, `homapod-${room}-${stamp}`)
    mkdirSync(join(dir, 'homapod', 'raw'), { recursive: true })
    tracks = new Map(); startedAt = Date.now(); phase = 'recording'; message = null; saved = null
    writeFileSync(join(dir, 'homapod', 'session.json'), JSON.stringify({ room, mode, guestName, startedAt }, null, 1))
    recWin!.webContents.send('homapod:start', { hostSid: HOST_SID, ...o })
    showBar()   // back up if she had closed it
    send(); return status()
  }

  const fromRec = (e: IpcMainEvent) => !!recWin && e.sender === recWin.webContents
  ipcMain.on('homapod:track', (e, m: Omit<Track, 'raw' | 'out' | 'bytes' | 't1'>) => {
    if (!fromRec(e) || !dir) return
    const ext = m.mime.startsWith('video/mp4') ? '.mp4' : '.webm'
    const raw = join(dir, 'homapod', 'raw', m.key + ext)
    tracks.set(m.key, { ...m, t1: null, raw, out: createWriteStream(raw), bytes: 0 })
    send()
  })
  ipcMain.on('homapod:chunk', (e, key: string, buf: Uint8Array) => {
    if (!fromRec(e)) return
    const t = tracks.get(key); if (!t) return
    t.out.write(Buffer.from(buf)); t.bytes += buf.byteLength
  })
  ipcMain.on('homapod:trackEnd', (e, key: string, at: number) => { if (fromRec(e)) { const t = tracks.get(key); if (t) t.t1 = at } })
  ipcMain.on('homapod:error', (e, msg: string) => { if (fromRec(e)) { message = msg; send() } })
  ipcMain.on('homapod:stopped', (e) => { if (fromRec(e)) stopped?.() })

  ipcMain.handle('homapod:stop', () => stopRecording())
  async function stopRecording(): Promise<Project | null> {
    autoStarted = false
    if (phase !== 'recording' || !dir || !recWin) return null
    phase = 'saving'; message = 'Saving the tracks…'; send()
    await new Promise<void>((res) => { stopped = res; recWin!.webContents.send('homapod:stop'); setTimeout(res, 20000) })
    stopped = null
    await Promise.all([...tracks.values()].map((t) => new Promise<void>((res) => t.out.end(res))))
    try {
      const p = await finalize(dir)
      phase = 'ready'; message = null; startedAt = 0; saved = p.dir; send()
      return p
    } catch (err) {
      phase = 'ready'; message = `The recording is saved as raw files in ${dir}, but making the project failed: ${(err as Error).message}`; startedAt = 0; send()
      throw err
    }
  }

  ipcMain.handle('homapod:leave', () => { if (phase !== 'recording' && phase !== 'saving') { disconnect(); phase = 'off'; room = ''; send() } return status() })

  // ---- after Stop: raw files → project ------------------------------------------------------------------------------
  const ff = (args: string[]) => new Promise<void>((res, rej) => {
    const bin = deps.ffmpeg(); if (!bin) return rej(new Error('ffmpeg was not found.'))
    const p = spawn(bin, ['-v', 'error', '-y', ...args]); let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (c) => c === 0 ? res() : rej(new Error(err.trim().slice(-400) || `ffmpeg exited ${c}`)))
  })
  const say = (m: string) => { message = m; send() }

  async function finalize(out: string): Promise<Project> {
    const list = [...tracks.values()].filter((t) => t.bytes > 0)
    if (!list.length) throw new Error('Nothing was recorded: no camera, mic or guest was connected.')
    const hp = join(out, 'homapod'), media = join(out, 'media')
    mkdirSync(media, { recursive: true })
    const safe = (s: string) => s.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'guest'
    const made: (HomapodTrack & { _t0: number })[] = []
    for (const t of list) {
      const label = t.sid ? labels[t.sid] || 'Guest' : t.kind === 'host-mic' || t.hasAudio ? hostName : `${hostName} camera`
      say(`Saving ${label}…`)
      const base = t.kind === 'guest' ? `guest-${safe(label)}${t.key.match(/-\d+$/)?.[0] ?? ''}` : t.kind
      let video: string | null = null, wav: string | null = null
      if (t.hasVideo) {
        video = join(hp, base + '.mp4')
        const px = (t.width ?? 1920) * (t.height ?? 1080)
        const mbps = Math.max(8, Math.round(px * 8 / 1_000_000))
        // constant 30 fps (the call's frames arrive unevenly), sound kept in the file, nothing scaled
        await ff(['-fflags', '+genpts', '-i', t.raw, '-map', '0:v:0', ...(t.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '256k', '-af', 'aresample=async=1:first_pts=0'] : []),
          '-fps_mode', 'cfr', '-r', '30', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
          ...(process.platform === 'darwin' ? ['-c:v', 'h264_videotoolbox', '-b:v', `${mbps}M`] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16']),
          '-movflags', '+faststart', video])
      }
      if (t.hasAudio) {
        wav = join(hp, base + '.wav')
        await ff(['-i', t.raw, '-map', '0:a:0', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav])
      }
      made.push({ key: t.key, kind: t.kind, sid: t.sid, label, video: video ? `homapod/${basename(video)}` : null, wav: wav ? `homapod/${basename(wav)}` : null,
                  start: 0, end: t.t1 ? (t.t1 - t.t0) / 1000 : null, width: t.width, height: t.height, _t0: t.t0 })
    }
    // the main picture: Tassy's camera when it was recorded, otherwise the guest seen longest
    const vids = made.filter((m) => m.video)
    const mainT = vids.find((m) => m.kind === 'host-camera') ?? vids.sort((a, b) => (b.end ?? 0) - (a.end ?? 0))[0] ?? null
    const t0 = mainT ? mainT._t0 : Math.min(...made.map((m) => m._t0))
    for (const m of made) m.start = (m._t0 - t0) / 1000

    say('Making the project…')
    let mainVideo = mainT?.video ? join(out, mainT.video) : null
    if (!mainVideo) {   // sound only: a plain dark picture the length of the talk so the editor still opens it
      const longest = Math.max(...made.map((m) => (m.end ?? 0) + m.start), 1)
      mainVideo = join(hp, 'audio-only.mp4')
      await ff(['-f', 'lavfi', '-i', `color=c=0x14140F:s=1920x1080:r=30:d=${longest.toFixed(2)}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mainVideo])
    }
    await deps.recorder.importVideo(mainVideo, out)          // screen.mp4 + events.json, same shape as any recording
    // screen.mp4 is now the main picture: drop the duplicate the import copied from
    if (mainT?.video) { rmSync(join(out, mainT.video), { force: true }); mainT.video = 'screen.mp4' }
    else rmSync(mainVideo, { force: true })

    // the sound of the whole conversation, every voice in place on the main picture's clock
    const voices = made.filter((m) => m.wav)
    if (voices.length) {
      say('Mixing everyone’s voices…')
      const ins = voices.flatMap((v) => ['-i', join(out, v.wav!)])
      const chains = voices.map((v, i) => v.start >= 0 ? `[${i}:a]adelay=${Math.round(v.start * 1000)}:all=1[a${i}]` : `[${i}:a]atrim=start=${(-v.start).toFixed(3)},asetpts=N/SR/TB[a${i}]`)
      const mix = voices.length > 1 ? `${voices.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0[m]` : `[a0]anull[m]`
      await ff([...ins, '-filter_complex', `${chains.join(';')};${mix}`, '-map', '[m]', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', join(out, 'mic.wav.tmp.wav')])
      renameSync(join(out, 'mic.wav.tmp.wav'), join(out, 'mic.wav'))
      const evp = join(out, 'events.json'), ev = JSON.parse(readFileSync(evp, 'utf8'))
      ev.t0Mic = 0; ev.micOffset = 0; ev.files.mic = 'mic.wav'; ev.capture = 'homapod'
      writeFileSync(evp, JSON.stringify(ev))
    }
    // every other camera into the project's media (moved, not copied), so it is there as a cutaway in the editor
    for (const m of made) {
      if (!m.video || m.video === 'screen.mp4') continue
      const to = join(media, basename(m.video)); renameSync(join(out, m.video), to); m.video = `media/${basename(to)}`
    }
    rmSync(join(hp, 'raw'), { recursive: true, force: true })   // our own capture fragments, now converted
    const file: HomapodFile = { version: 1, room, mode, startedAt: new Date(t0).toISOString(), main: mainT?.key ?? null,
      tracks: made.map(({ _t0, ...m }) => m), phones: [] }
    writeFileSync(join(out, 'homapod.json'), JSON.stringify(file, null, 1))
    say('Finding who talks when…')
    try { await deps.recorder.talk(out) } catch (e) { console.log('[homapod] talk:', (e as Error).message) }
    const p = deps.loadProject(out); if (!p) throw new Error('The project could not be opened.')
    return p
  }

  // ---- phone 4K files, lined up by sound ------------------------------------------------------------------------------
  /** Who is talking when (talk.json), measured once per project and again after the tracks change. */
  ipcMain.handle('homapod:talk', async (_e, d: string): Promise<PodTalk | null> => {
    const hp = join(d, 'homapod.json'), tk = join(d, 'talk.json')
    if (!existsSync(hp)) return null
    if (!existsSync(tk) || statSync(tk).mtimeMs < statSync(hp).mtimeMs) await deps.recorder.talk(d)
    try { return JSON.parse(readFileSync(tk, 'utf8')) } catch { return null }
  })
  ipcMain.handle('homapod:read', (_e, d: string): HomapodFile | null => {
    const f = join(d, 'homapod.json'); if (!existsSync(f)) return null
    try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null }
  })
  ipcMain.handle('homapod:addPhone', async (_e, d: string, paths?: string[]): Promise<HomapodFile> => {
    const f = join(d, 'homapod.json'); const file = JSON.parse(readFileSync(f, 'utf8')) as HomapodFile
    let srcs = paths
    if (!srcs?.length) {
      const r = await dialog.showOpenDialog(deps.main()!, { title: 'Add the phone videos from this HomaPod', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Videos', extensions: ['mov', 'mp4', 'm4v'] }] })
      if (r.canceled) return file
      srcs = r.filePaths
    }
    const refs = file.tracks.filter((t) => t.wav)
    if (!refs.length) throw new Error('This HomaPod has no recorded sound to line the phone videos up with.')
    for (const src of srcs) {
      if (!existsSync(src)) continue
      deps.main()?.webContents.send('homapod:status', { ...status(), message: `Lining up ${basename(src)} by sound…` })
      const a = await deps.recorder.align(src, refs.map((t) => join(d, t.wav!)))
      const ref = refs[a.ref]
      const link = join(d, 'media', `phone-${basename(src, extname(src)).replace(/[^\w-]+/g, '-')}${extname(src).toLowerCase()}`)
      if (!existsSync(link)) symlinkSync(src, link)     // the 4K original stays where it is; nothing copied
      const entry = { file: src, media: `media/${basename(link)}`, start: +(a.offset + ref.start).toFixed(3), matchedTo: ref.label, score: +a.score.toFixed(1), confident: a.confident,
        size: statSync(src).size }
      file.phones = [...file.phones.filter((p) => p.file !== src), entry]
      writeFileSync(f, JSON.stringify(file, null, 1))
    }
    send()
    return file
  })
  return {
    /** tests only: hang up the call window (as if she closed the call) */
    hangUp: () => { callWin?.destroy(); callWin = null },
    status: () => status(),
    /** tests only: swap a guest's tracks the way VDO.Ninja does on a quality change, to prove the recorder follows it */
    testSwap: (): Promise<boolean> => recWin ? recWin.webContents.executeJavaScript(
      `(() => { const v = document.querySelector('video[data-sid]'); if (!v || !v.srcObject) return false; v.srcObject = new MediaStream(v.srcObject.getTracks().map(t => t.clone())); return true })()`) : Promise.resolve(false),
  }
}
