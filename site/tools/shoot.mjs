// Screenshot a local HTML page with the installed Google Chrome over the DevTools protocol (no npm deps; Node 22+).
//   node site/tools/shoot.mjs <page.html> <outDir> [--w 1440 --h 900] [--scroll 0,0.25,0.5,1] [--wait 1500] [--dark] [--js "<expr>"]
// Writes <outDir>/<w>x<h>-<scroll>.png for each scroll fraction (fraction of the scrollable height, or px if > 1),
// and prints console errors and the page's horizontal overflow (scrollWidth > innerWidth) so layout bugs surface.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const a = process.argv.slice(2), page = resolve(a[0]), out = resolve(a[1]); mkdirSync(out, { recursive: true })
const opt = (k, d) => { const i = a.indexOf('--' + k); return i < 0 ? d : (a[i + 1] ?? true) }
const W = +opt('w', 1440), H = +opt('h', 900), WAIT = +opt('wait', 1500), DARK = a.includes('--dark'), JS = opt('js', null)
const scrolls = String(opt('scroll', '0')).split(',').map(Number)
const port = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--mute-audio', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shoot-'))}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = t.find((x) => x.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break } } catch {} await sleep(200) }
if (!ws) { console.error('chrome did not start'); chrome.kill(); process.exit(1) }
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pending = new Map(), errors = []
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((x) => x.value ?? x.description).join(' '))
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || '')) })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 })
if (W < 600) await send('Emulation.setTouchEmulationEnabled', { enabled: true })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: DARK ? 'dark' : 'light' }] })
await send('Page.navigate', { url: 'file://' + page }); await sleep(WAIT)
if (JS) console.log('js:', JSON.stringify(await ev(JS)))
const total = await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - innerHeight')
const overflow = await ev('document.documentElement.scrollWidth - innerWidth')
for (const s of scrolls) {
  const y = s > 1 ? s : Math.round(s * total)
  // scroll in steps so scroll-driven animations see intermediate positions
  const from = await ev('scrollY'); const steps = 12
  for (let k = 1; k <= steps; k++) { await ev(`scrollTo(0, ${Math.round(from + (y - from) * k / steps)})`); await sleep(60) }
  await sleep(700)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const f = join(out, `${W}x${H}${DARK ? '-dark' : ''}-${String(s).replace('.', '_')}.png`); writeFileSync(f, Buffer.from(shot.result.data, 'base64')); console.log('wrote', f)
}
console.log(JSON.stringify({ scrollHeight: total + H, horizontalOverflowPx: overflow, errors: errors.slice(0, 20) }))
ws.close(); chrome.kill(); process.exit(0)
