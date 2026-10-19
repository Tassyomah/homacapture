// Copies a Python runtime and ffmpeg/ffprobe into app/runtime/ so the installer works on a PC with nothing else
// installed. Sources: NARRATE_PYTHON_DIR / NARRATE_FFMPEG_DIR if set (CI), otherwise this machine's own installs
// (per-user Python 3.12, WinGet Gyan.FFmpeg). The bundled Python is a full install, so `venv` works for the
// on-demand speech engine. ffmpeg builds from gyan.dev are GPL; the licence ships beside them (runtime/ffmpeg/LICENSE).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

if (process.platform !== 'win32') { console.log('bundle-runtime: Windows only for now; skipping'); process.exit(0) }
const out = join(dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'runtime')
const local = process.env.LOCALAPPDATA ?? ''

function pythonDir() {
  if (process.env.NARRATE_PYTHON_DIR) return process.env.NARRATE_PYTHON_DIR
  const root = join(local, 'Programs', 'Python')
  const d = existsSync(root) && readdirSync(root).filter((n) => /^Python3\d+$/.test(n)).sort().reverse()[0]
  if (!d) throw new Error('No Python 3 found. Install it with `winget install Python.Python.3.12` or set NARRATE_PYTHON_DIR.')
  return join(root, d)
}
function ffmpegDir() {
  if (process.env.NARRATE_FFMPEG_DIR) return process.env.NARRATE_FFMPEG_DIR
  const pk = join(local, 'Microsoft', 'WinGet', 'Packages')
  for (const d of existsSync(pk) ? readdirSync(pk) : []) if (d.startsWith('Gyan.FFmpeg')) {
    for (const sub of readdirSync(join(pk, d))) { const b = join(pk, d, sub, 'bin'); if (existsSync(join(b, 'ffmpeg.exe'))) return b }
  }
  throw new Error('No ffmpeg found. Install it with `winget install Gyan.FFmpeg` or set NARRATE_FFMPEG_DIR.')
}

rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, 'ffmpeg'), { recursive: true })
const py = pythonDir()
// Skip what the recorder never uses: docs, tests, IDLE/Tk, the launcher's pip cache, any user site-packages.
const skip = /[\\/](Doc|tcl|Tools|Lib[\\/]test|Lib[\\/]idlelib|Lib[\\/]tkinter|Lib[\\/]site-packages[\\/](?!pip)[^\\/]+|__pycache__)([\\/]|$)/
cpSync(py, join(out, 'python'), { recursive: true, filter: (src) => !skip.test(src.slice(py.length)) })
const ff = ffmpegDir()
for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) cpSync(join(ff, exe), join(out, 'ffmpeg', exe))
const lic = join(ff, '..', 'LICENSE'); if (existsSync(lic)) cpSync(lic, join(out, 'ffmpeg', 'LICENSE'))
writeFileSync(join(out, 'ffmpeg', 'SOURCE.txt'), 'ffmpeg build by gyan.dev (https://www.gyan.dev/ffmpeg/builds/), GPL v3. Source: https://ffmpeg.org\n')
const v = execFileSync(join(out, 'python', 'python.exe'), ['-c', 'import sys, venv; print(sys.version.split()[0])']).toString().trim()
console.log(`bundle-runtime: Python ${v} from ${py}; ffmpeg from ${ff} → ${out}`)
