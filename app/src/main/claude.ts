/**
 * Ask Claude: runs the Claude Code CLI already on this computer, headless, with every tool switched off. It answers one
 * request with JSON edit operations; nothing here reads or writes the project. Uses her own Claude sign-in (subscription),
 * never an API key. See docs/DECISIONS.md (2026-11-17).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { ASK_SCHEMA, ASK_SYSTEM, type AskAnswer, type AskResult, type ClaudeStatus } from '../shared/askclaude'

const IS_WIN = process.platform === 'win32'
const TIMEOUT_MS = 60_000
/** Every built-in tool, refused by name as well (belt and braces on top of --tools ""). */
const NO_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite', 'KillShell', 'BashOutput', 'Skill', 'SlashCommand']

/** Where the CLI can live: NARRATE_CLAUDE_BIN, PATH (a Finder-launched app has a short PATH, so the usual install folders too),
 *  then the copy the Claude desktop app keeps for itself (newest version first). */
export function findClaude(): string | null {
  const env = process.env.NARRATE_CLAUDE_BIN
  if (env) return existsSync(env) ? env : null
  const home = homedir(), names = IS_WIN ? ['claude.exe', 'claude.cmd'] : ['claude']
  const dirs = [...(process.env.PATH ?? '').split(delimiter), join(home, '.claude', 'local'), join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'),
    ...(IS_WIN ? [join(process.env.APPDATA ?? '', 'npm')] : ['/opt/homebrew/bin', '/usr/local/bin'])].filter(Boolean)
  for (const d of dirs) for (const n of names) { const p = join(d, n); if (existsSync(p)) return p }
  if (!IS_WIN) {
    const root = join(home, 'Library', 'Application Support', 'Claude', 'claude-code')
    try {
      const versions = readdirSync(root).filter((v) => /^\d+\.\d+\.\d+$/.test(v))
        .sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] })
      for (const v of versions) for (const h of readdirSync(join(root, v))) {
        const p = join(root, v, h, 'claude.app', 'Contents', 'MacOS', 'claude')
        if (existsSync(p) && statSync(p).isFile()) return p
      }
    } catch { /* no desktop app copy */ }
  }
  return null
}

/** The CLI runs in an empty folder of its own, with none of a parent Claude session's variables. */
function runEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK)/.test(k)) env[k] = v
  return env
}
function workDir(): string { const d = join(tmpdir(), 'homacapture-ask'); mkdirSync(d, { recursive: true }); return d }

function run(bin: string, args: string[], input: string | null, ms: number, onChild?: (c: ChildProcess) => void): Promise<{ code: number | null; out: string; err: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const c = spawn(bin, args, { cwd: workDir(), env: runEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: IS_WIN && bin.endsWith('.cmd') })
    onChild?.(c)
    let out = '', err = '', timedOut = false, done = false
    const timer = setTimeout(() => { timedOut = true; c.kill('SIGTERM'); setTimeout(() => c.kill('SIGKILL'), 2000) }, ms)
    c.stdout.on('data', (d) => { out += d }); c.stderr.on('data', (d) => { err += d })
    const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err, timedOut }) }
    c.on('error', (e) => { err += String(e); finish(-1) })
    c.on('close', finish)
    if (input != null) c.stdin.end(input); else c.stdin.end()
  })
}

let cached: { at: number; status: ClaudeStatus } | null = null
export async function claudeStatus(fresh = false): Promise<ClaudeStatus> {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.status
  const bin = findClaude()
  let status: ClaudeStatus = { installed: false }
  if (bin) {
    const [v, a] = await Promise.all([run(bin, ['--version'], null, 15_000), run(bin, ['auth', 'status'], null, 15_000)])
    let signedIn = false
    try { signedIn = !!JSON.parse(a.out).loggedIn } catch { signedIn = /logged in|signed in/i.test(a.out) && !/not/i.test(a.out) }
    status = v.code === 0 ? { installed: true, signedIn, version: v.out.trim().split(/\s/)[0] } : { installed: false }
  }
  cached = { at: Date.now(), status }
  return status
}

/** Opens Claude's own sign-in in her browser (claude auth login, subscription). Resolves once it finishes or gives up. */
export async function claudeSignIn(): Promise<ClaudeStatus> {
  const bin = findClaude(); if (!bin) return { installed: false }
  await run(bin, ['auth', 'login', '--claudeai'], null, 5 * 60_000)
  return claudeStatus(true)
}

let current: ChildProcess | null = null
let cancelled = false
export function cancelAsk(): void { if (current) { cancelled = true; current.kill('SIGTERM') } }

/** Pulls {summary, ops} out of the CLI's --output-format json result (structured_output, or JSON in the text answer). */
export function parseAnswer(stdout: string): AskResult {
  let r: Record<string, unknown>
  try { r = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '') } catch { return { ok: false, code: 'bad', message: 'Claude answered in a way HomaCapture could not read.' } }
  const text = typeof r.result === 'string' ? r.result : ''
  if (r.is_error) {
    if (/authenticat|log ?in|sign ?in|oauth|credential|401/i.test(text)) return { ok: false, code: 'signin', message: 'Claude needs you to sign in again.' }
    return { ok: false, code: 'failed', message: text ? `Claude could not answer: ${text.slice(0, 200)}` : 'Claude could not answer.' }
  }
  let a: unknown = r.structured_output
  if (!a && text) {
    const body = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    try { a = JSON.parse(body) } catch { const m = body.match(/\{[\s\S]*\}/); if (m) try { a = JSON.parse(m[0]) } catch { /* below */ } }
  }
  const ans = a as AskAnswer | undefined
  if (!ans || typeof ans !== 'object' || typeof ans.summary !== 'string' || !Array.isArray(ans.ops)) return { ok: false, code: 'bad', message: 'Claude answered in a way HomaCapture could not read. Nothing was changed.' }
  return { ok: true, answer: { summary: ans.summary.slice(0, 400), ops: ans.ops } }
}

/** One request: the project brief (JSON) + what she typed → operations. Never more than one at a time; 60 s at most. */
export async function askClaude(brief: string, request: string): Promise<AskResult> {
  if (current) return { ok: false, code: 'busy', message: 'Claude is still working on the last request.' }
  const bin = findClaude()
  if (!bin) return { ok: false, code: 'missing', message: 'Claude Code is not installed on this computer.' }
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(ASK_SCHEMA), '--system-prompt', ASK_SYSTEM,
    '--tools', '', '--disallowedTools', ...NO_TOOLS, '--strict-mcp-config', '--no-session-persistence', '--setting-sources', '',
    ...(process.env.NARRATE_CLAUDE_MODEL ? ['--model', process.env.NARRATE_CLAUDE_MODEL] : [])]
  const input = `The request:\n${request.trim()}\n\nThe project brief (JSON):\n${brief}\n`
  cancelled = false
  try {
    const r = await run(bin, args, input, TIMEOUT_MS, (c) => { current = c })
    if (cancelled) return { ok: false, code: 'cancelled', message: 'Stopped. Nothing was changed.' }
    if (r.timedOut) return { ok: false, code: 'timeout', message: 'Claude took longer than a minute. Nothing was changed. Try a shorter request.' }
    if (!r.out.trim()) {
      if (/authenticat|log ?in|sign ?in/i.test(r.err)) return { ok: false, code: 'signin', message: 'Claude needs you to sign in again.' }
      return { ok: false, code: 'failed', message: `Claude could not answer${r.err.trim() ? `: ${r.err.trim().slice(0, 200)}` : '.'}` }
    }
    const res = parseAnswer(r.out)
    if (!res.ok && res.code === 'signin') cached = null
    return res
  } finally { current = null }
}
