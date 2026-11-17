import { useEffect, useRef, useState } from 'react'
import { IconArrowBackUp, IconArrowUp, IconLoader2, IconPlayerStop } from '@tabler/icons-react'
import type { ClaudeStatus } from '../../shared/askclaude'

/** One request in this editing session and what came of it. */
export interface AskEntry { id: number; request: string; state: 'working' | 'done' | 'nothing' | 'error'; summary?: string; lines?: string[]; error?: string; undone?: boolean }

const EXAMPLES = ['Cut the part where I talk about…', 'Add a 🔥 sticker when I say…', 'Put “Watch this” on screen at 0:05', 'Turn on bold captions']

/**
 * Ask Claude drawer: type what you want changed, Claude (her own Claude Code sign-in on this computer) answers with
 * edits, HomaCapture checks them and applies them as one undo step. Nothing changes unless every edit checks out.
 */
export function AskClaudePanel({ status, entries, onAsk, onCancel, onSignIn, onUndo, canUndoLast, hasTranscript, signingIn }: {
  status: ClaudeStatus | null; entries: AskEntry[]; onAsk: (text: string) => void; onCancel: () => void; onSignIn: () => void
  onUndo: () => void; canUndoLast: boolean; hasTranscript: boolean; signingIn: boolean
}) {
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const working = entries.some((e) => e.state === 'working')
  const ready = !!status?.installed && status.signedIn
  useEffect(() => { if (ready) box.current?.focus() }, [ready])
  const send = () => { const t = text.trim(); if (!t || working || !ready) return; onAsk(t); setText('') }
  const last = entries[entries.length - 1]
  return <>
    <h3 className="drawer-title">Ask Claude</h3>
    {!status ? <span className="note">Checking for Claude on this Mac…</span>
      : !status.installed ? <span className="note">Claude Code isn’t on this computer, so this is switched off.</span>
      : !status.signedIn ? <div className="ask-signin">
          <p className="note">Sign in once with your Claude account. It uses your Claude plan, no extra cost. Your browser opens to confirm.</p>
          <button className="primary wide" disabled={signingIn} onClick={onSignIn}>{signingIn ? 'Waiting for your browser…' : 'Sign in to Claude'}</button>
        </div>
      : <>
        <div className={'ask-box' + (working ? ' busy' : '')}>
          <textarea ref={box} rows={3} value={text} disabled={working} placeholder="Say what to change, like “cut the part where I talk about Figma”"
            aria-label="What should Claude change?" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          {working
            ? <button className="ask-send stop" aria-label="Stop" data-tip="Stop. Nothing changes." onClick={onCancel}><IconPlayerStop size={15} /></button>
            : <button className="ask-send" aria-label="Ask" data-tip="Ask · Enter" disabled={!text.trim()} onClick={send}><IconArrowUp size={16} /></button>}
        </div>
        {!hasTranscript && <span className="note">Tip: transcribe the video first (Script tab) so Claude knows what you say and when.</span>}
        {!entries.length && <div className="ask-examples">{EXAMPLES.map((x) => (
          <button key={x} onClick={() => { setText(x.replace(/…$/, '')); box.current?.focus() }}>{x}</button>))}</div>}
      </>}
    {entries.length > 0 && <ol className="ask-log">{[...entries].reverse().map((e) => (
      <li key={e.id} className={e.state + (e.undone ? ' undone' : '')}>
        <p className="ask-req">{e.request}</p>
        {e.state === 'working' && <p className="ask-res"><IconLoader2 size={14} className="spin" /> Working… <span className="note">up to a minute</span></p>}
        {e.state === 'done' && <><p className="ask-res">{e.summary}</p>
          {!!e.lines?.length && <ul className="ask-lines">{e.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          {e.undone ? <span className="note">Undone.</span>
            : e === last && canUndoLast && <button className="ask-undo" onClick={onUndo}><IconArrowBackUp size={14} />Undo this</button>}</>}
        {e.state === 'nothing' && <p className="ask-res">{e.summary || 'Claude had nothing to change.'} <span className="note">Nothing was changed.</span></p>}
        {e.state === 'error' && <p className="ask-res err">{e.error}</p>}
      </li>))}</ol>}
  </>
}
