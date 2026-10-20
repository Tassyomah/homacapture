import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Devices, Permissions, RecState, StartOptions } from '../shared/types'

type RawEvent = { event: string; [k: string]: unknown }

/**
 * Interpreter for the Python recorders. On Windows, look in the usual per-user install folders before trusting PATH
 * (a fresh install may not have refreshed PATH yet, and the Store stub in WindowsApps is not a real Python).
 */
/** Python + ffmpeg bundled by scripts/bundle-runtime.mjs (packaged Windows build). Exported through env so the
 * recorder (common.find_tool) and the GIF exporter pick the same binaries. */
const RUNTIME = process.resourcesPath ? join(process.resourcesPath, 'runtime') : ''
if (RUNTIME && existsSync(join(RUNTIME, 'ffmpeg', 'ffmpeg.exe'))) {
  process.env.NARRATE_FFMPEG ??= join(RUNTIME, 'ffmpeg', 'ffmpeg.exe')
  process.env.NARRATE_FFPROBE ??= join(RUNTIME, 'ffmpeg', 'ffprobe.exe')
}
function findPython(): string {
  if (process.env.NARRATE_PYTHON) return process.env.NARRATE_PYTHON
  if (RUNTIME && existsSync(join(RUNTIME, 'python', 'python.exe'))) return join(RUNTIME, 'python', 'python.exe')
  if (process.platform !== 'win32') return 'python3'
  const roots = [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Python'), 'C:\\Program Files', 'C:\\'].filter(Boolean) as string[]
  const found: string[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const d of readdirSync(root)) if (/^Python3\d+$/i.test(d) && existsSync(join(root, d, 'python.exe'))) found.push(join(root, d, 'python.exe'))
  }
  if (found.length) return found.sort().reverse()[0]   // newest version first
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (!dir || /WindowsApps/i.test(dir)) continue
    const p = join(dir, 'python.exe'); if (existsSync(p)) return p
  }
  return 'python'
}
const PYTHON = findPython()
const SPAWN = { windowsHide: true } as const

/**
 * Drives the recorder sidecar (recorder/narrate.py on macOS, recorder/narrate_win.py on Windows; the
 * Swift/ScreenCaptureKit recorder later — same line protocol). Emits 'event' with each JSON line the recorder prints.
 */
export class Recorder extends EventEmitter {
  private proc: ChildProcess | null = null
  state: RecState = 'idle'
  since = 0            // ms timestamp of the current state
  pausedTotal = 0      // ms spent paused in this recording
  startedAt = 0        // ms timestamp when recording began
  currentOut = ''      // folder of the recording in progress
  constructor(private script: string) { super() }

  private run(args: string[]): Promise<string> {
    return new Promise((res, rej) => {
      const p = spawn(PYTHON, [this.script, ...args], SPAWN)
      let out = '', err = ''
      p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d))
      p.on('error', (e) => rej(new Error(friendlySpawnError(e))))
      p.on('close', (code) => (code === 0 ? res(out) : rej(new Error(friendlyExit(err, code)))))
    })
  }
  listDevices(): Promise<Devices> { return this.run(['--list']).then(JSON.parse) }
  checkPermissions(request: boolean): Promise<Permissions> { return this.run(['--check', ...(request ? ['--request'] : [])]).then(JSON.parse) }

  start(opts: StartOptions & { out: string }): Promise<void> {
    if (this.proc) return Promise.reject(new Error('already recording'))
    this.currentOut = opts.out
    const args = [this.script, 'record', '--out', opts.out, '--fps', String(opts.fps), '--screen', String(opts.screen)]
    if (opts.mic === null) args.push('--no-mic'); else args.push('--mic', String(opts.mic))
    if (opts.camera !== null && opts.camera !== undefined) args.push('--camera', String(opts.camera))
    if (opts.systemAudio) args.push('--system-audio')
    return new Promise((res, rej) => {
      const p = spawn(PYTHON, args, { stdio: ['pipe', 'pipe', 'pipe'], ...SPAWN })
      this.proc = p
      let settled = false, buf = ''
      p.on('error', (e) => { this.proc = null; if (!settled) { settled = true; rej(new Error(friendlySpawnError(e))) } })
      p.stderr.on('data', (d) => console.log('[recorder]', String(d).trim()))
      p.stdout.on('data', (d) => {
        buf += d
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('{')) continue
          const ev = JSON.parse(line) as RawEvent
          this.track(ev)
          if (ev.event === 'started' && !settled) { settled = true; res() }
          if (ev.event === 'error' && !settled) { settled = true; rej(new Error(String(ev.message))) }
          this.emit('event', ev)
        }
      })
      p.on('close', (code) => {
        this.proc = null
        if (this.state !== 'idle') { this.setState('idle'); this.emit('event', { event: 'error', code: 'exit', message: `recorder exited (${code})` }) }
        if (!settled) { settled = true; rej(new Error(`recorder exited early (${code})`)) }
      })
    })
  }

  /**
   * Finalise a recording whose recorder died (folder has recording.json but no events.json).
   * Streams the same finalizing/ready/error events; resolves with the folder once events.json exists.
   */
  recover(dir: string): Promise<string> {
    return new Promise((res, rej) => {
      const p = spawn(PYTHON, [this.script, 'finalize', '--out', dir], SPAWN)
      let buf = '', settled = false, err = ''
      p.stderr.on('data', (d) => { err += d; console.log('[recover]', String(d).trim()) })
      p.stdout.on('data', (d) => {
        buf += d
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('{')) continue
          const ev = JSON.parse(line) as RawEvent
          this.emit('recover', ev)
          if (ev.event === 'ready' && !settled) { settled = true; res(String(ev.out)) }
          if (ev.event === 'error' && !settled) { settled = true; rej(new Error(String(ev.message))) }
        }
      })
      p.on('error', (e) => { if (!settled) { settled = true; rej(new Error(friendlySpawnError(e))) } })
      p.on('close', (code) => { if (!settled) { settled = true; rej(new Error(friendlyExit(err, code))) } })
    })
  }

  /** Smart Director analysis: runs `analyze --out dir`, emits 'analyze' progress events, resolves when analysis.json is written. */
  analyze(dir: string): Promise<void> { return this.job('analyze', dir) }
  /** Local speech recognition: runs `transcribe --out dir`, emits 'transcribe' progress events, resolves when transcript.json is written. */
  transcribe(dir: string): Promise<void> { return this.job('transcribe', dir) }
  /** Cleaned voice track: runs `enhance --out dir` → mic.clean.wav. */
  enhance(dir: string): Promise<void> { return this.job('enhance', dir) }

  private job(cmd: 'analyze' | 'transcribe' | 'enhance', dir: string): Promise<void> {
    return new Promise((res, rej) => {
      const p = spawn(PYTHON, [this.script, cmd, '--out', dir], SPAWN)
      let buf = '', settled = false, err = ''
      p.stderr.on('data', (d) => { err += d; console.log(`[${cmd}]`, String(d).trim()) })
      p.stdout.on('data', (d) => {
        buf += d
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('{')) continue
          const ev = JSON.parse(line) as RawEvent
          this.emit(cmd, ev)
          if (ev.event === 'ready' && !settled) { settled = true; res() }
          if (ev.event === 'error' && !settled) { settled = true; rej(new Error(String(ev.message))) }
        }
      })
      p.on('error', (e) => { if (!settled) { settled = true; rej(new Error(friendlySpawnError(e))) } })
      p.on('close', (code) => { if (!settled) { settled = true; rej(new Error(friendlyExit(err, code))) } })
    })
  }

  /** Microphone level meter: emits 'level' (0..1) ~10×/s until stopMeter(). Only one runs at a time. */
  private meterProc: ChildProcess | null = null
  startMeter(mic: number) {
    this.stopMeter()
    const p = spawn(PYTHON, [this.script, 'meter', '--mic', String(mic)], { stdio: ['pipe', 'pipe', 'pipe'], ...SPAWN })
    this.meterProc = p
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('{')) continue
        const ev = JSON.parse(line) as RawEvent
        if (ev.event === 'level') this.emit('level', Number(ev.level))
      }
    })
    p.on('error', () => { if (this.meterProc === p) this.meterProc = null })
    p.on('close', () => { if (this.meterProc === p) this.meterProc = null })
  }
  stopMeter() {
    const p = this.meterProc; this.meterProc = null
    if (!p) return
    try { p.stdin?.end() } catch { /* already gone */ }
    setTimeout(() => { if (p.exitCode === null) p.kill() }, 1500)
  }

  private setState(s: RecState) { this.state = s; this.since = Date.now() }
  private track(ev: RawEvent) {
    switch (ev.event) {
      case 'started': this.pausedTotal = 0; this.startedAt = Date.now(); this.setState('recording'); break
      case 'paused': this.setState('paused'); break
      case 'resumed': this.pausedTotal += Date.now() - this.since; this.setState('recording'); break
      case 'stopped': this.setState('finalizing'); break
      case 'ready': case 'error': this.setState('idle'); break
    }
  }
  private send(cmd: string) { this.proc?.stdin?.write(JSON.stringify({ cmd }) + '\n') }
  pause() { if (this.state === 'recording') this.send('pause') }
  resume() { if (this.state === 'paused') this.send('resume') }
  stop() { if (this.state === 'recording' || this.state === 'paused') this.send('stop') }
  kill() { this.proc?.kill('SIGTERM'); this.stopMeter() }
}

const PYTHON_HELP = process.platform === 'win32'
  ? 'HomaCapture needs Python 3 to drive the recorder. Install it with `winget install Python.Python.3.12`, then reopen HomaCapture.'
  : 'HomaCapture needs python3 to drive the recorder. Install the Xcode command line tools, then reopen HomaCapture.'
function friendlySpawnError(e: NodeJS.ErrnoException) {
  return e.code === 'ENOENT' ? PYTHON_HELP : e.message
}
function friendlyExit(stderr: string, code: number | null) {
  if (/Python was not found/i.test(stderr) || code === 9009) return PYTHON_HELP
  return stderr.trim() || `recorder exited ${code}`
}
