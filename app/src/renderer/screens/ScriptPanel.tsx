import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconEye, IconEyeOff, IconLetterT, IconMicrophone, IconPhoto, IconPlayerPlay, IconRefresh, IconScissors, IconRestore, IconWand, IconX } from '@tabler/icons-react'
import type { Cut, TextPop, Transcript } from '../../shared/types'
import { fmt } from './Timeline'
import { fillerRanges, type TranscribeStatus } from './TranscriptPanel'

/**
 * Edit the video by its script, down to the smallest bit (Tassy, 2026-11-18: "it has to be granular"). The script is a
 * row of pieces in the order they happen: every word, every "(sound)" the recogniser left out (an um, a laugh, a cut-off
 * word), and every pause longer than a third of a second. Any of them can be selected and removed; removed pieces stay
 * on the page with a red line through them. Text that appears on screen hangs under its line as a reply, so you can see
 * and edit what shows where (it is added from a selection: "Text on screen").
 */
type Tok = { i: number; line: number; start: number; end: number; kind: 'word' | 'sound' | 'pause'; text: string }
const clean = (w: string) => w.replace(/^\s+|\s+$/g, '')
const isFiller = (w: string) => /^(um+|uh+|erm*|hmm+|mm+|ah+)[,.]?$/i.test(clean(w))
const PAUSE = 0.35

export function ScriptPanel({ transcript, status, hasMic, cuts, playhead, playing, texts, onCreate, onRedo, onSeek, onCut, onKeep, onCutMany, onBroll, onVoice, onAddText, onEditText, onRemoveText }: {
  transcript: Transcript | null; status: TranscribeStatus; hasMic: boolean; cuts: Cut[]; playhead: number; playing: boolean
  texts: TextPop[]
  onCreate: () => void; onRedo: () => void; onSeek: (t: number) => void
  onCut: (a: number, b: number) => void; onKeep: (a: number, b: number) => void; onCutMany: (r: Cut[]) => void
  onBroll: (a: number, b: number, words: string) => void; onVoice: (t: number) => void
  onAddText: (a: number, b: number, text: string) => void; onEditText: (id: string, text: string) => void; onRemoveText: (id: string) => void
}) {
  // words + sounds in time order, with a pause piece wherever the silence between two of them is long enough to matter
  const toks = useMemo<Tok[]>(() => {
    if (!transcript) return []
    const raw: Omit<Tok, 'i'>[] = []
    transcript.segments.forEach((s, line) => s.words.forEach((w) => {
      if (w.end > w.start && clean(w.word)) raw.push({ line, start: w.start, end: w.end, kind: w.hidden ? 'sound' : 'word', text: w.hidden ? '(sound)' : clean(w.word) })
    }))
    raw.sort((a, b) => a.start - b.start)
    const out: Tok[] = []
    raw.forEach((t, k) => {
      const prev = raw[k - 1]
      if (prev && t.start - prev.end >= PAUSE) out.push({ i: out.length, line: prev.line, start: prev.end, end: t.start, kind: 'pause', text: `⏸ ${(t.start - prev.end).toFixed(1)} s` })
      out.push({ ...t, i: out.length })
    })
    return out
  }, [transcript])
  const lines = useMemo(() => { const m: Tok[][] = []; for (const t of toks) (m[t.line] ??= []).push(t); return m.filter(Boolean) }, [toks])
  const [hide, setHide] = useState(false)
  // Selection lives here, not in the browser's text selection (that one vanished on every re-render and scroll).
  const [sel, setSel] = useState<{ i: number; j: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null)
  const [compose, setCompose] = useState<{ i: number; j: number; value: string } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const anchor = useRef<number | null>(null), dragging = useRef(false), moved = useRef(false)

  const gone = (t: Tok) => { const m = (t.start + t.end) / 2; return cuts.some(([a, b]) => m > Math.min(a, b) && m < Math.max(a, b)) }
  // The stretch of video a run of pieces takes. A pause piece is exactly its silence. A word or sound reaches halfway
  // into a short gap (so nothing is left behind) but stops at a pause piece, which you remove on its own if you want.
  const edgeBefore = (k: number) => {
    const t = toks[k], p = toks[k - 1]
    if (t.kind === 'pause') return t.start + 0.02
    if (!p) return Math.max(0, t.start - 0.1)
    if (p.kind === 'pause') return Math.max(p.end - 0.06, t.start - 0.06)
    return (p.end + t.start) / 2
  }
  const edgeAfter = (k: number) => {
    const t = toks[k], n = toks[k + 1]
    if (t.kind === 'pause') return t.end - 0.02
    if (!n) return t.end + 0.2
    if (n.kind === 'pause') return Math.min(n.start + 0.08, t.end + 0.08)
    return (t.end + n.start) / 2
  }
  const span = (i: number, j: number): [number, number] => { const a = edgeBefore(i), b = edgeAfter(j); return [a, Math.max(a + 0.04, b)] }
  const live = toks.find((t) => t.kind !== 'pause' && playhead >= t.start - 0.02 && playhead < (toks[t.i + 1]?.start ?? t.end + 0.3))

  // keep the word being said in view while playing
  useEffect(() => {
    if (!playing || !live || !box.current) return
    const el = box.current.querySelector(`[data-i="${live.i}"]`) as HTMLElement | null
    if (!el) return
    const b = el.getBoundingClientRect(), c = box.current.getBoundingClientRect()
    if (b.top < c.top + 20 || b.bottom > c.bottom - 20) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [live?.i, playing])

  const select = (i: number, j: number) => { setSel({ i: Math.min(i, j), j: Math.max(i, j) }); setMenu(null) }
  const clear = () => { setSel(null); setMenu(null); anchor.current = null }
  const lineOf = (i: number) => { const ln = toks[i].line, all = toks.filter((t) => t.line === ln); return [all[0].i, all[all.length - 1].i] as const }
  // press on a piece: select it (Shift extends); drag across pieces to select a run; a plain click also jumps there
  const down = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    if (e.shiftKey && sel) { select(Math.min(sel.i, i), Math.max(sel.j, i)); return }
    anchor.current = i; dragging.current = true; moved.current = false; select(i, i)
  }
  const enter = (i: number) => { if (dragging.current && anchor.current != null) { moved.current = moved.current || i !== anchor.current; select(anchor.current, i) } }
  useEffect(() => {
    const up = () => {
      if (!dragging.current) return
      dragging.current = false
      if (!moved.current && anchor.current != null) onSeek(toks[anchor.current].start + 0.01)
    }
    window.addEventListener('pointerup', up); return () => window.removeEventListener('pointerup', up)
  }, [toks, onSeek])
  // the action bar sits under the last selected piece and scrolls with the text; it stays until you close it
  useLayoutEffect(() => {
    if (!sel || !box.current) { setBarPos(null); return }
    const el = box.current.querySelector(`[data-i="${sel.j}"]`) as HTMLElement | null
    if (!el) { setBarPos(null); return }
    setBarPos({ x: Math.max(4, Math.min(box.current.clientWidth - 270, el.offsetLeft - 20)), y: el.offsetTop + el.offsetHeight + 4 })
  }, [sel, hide, toks])
  const selGone = sel ? toks.slice(sel.i, sel.j + 1).every(gone) : false
  const saying = (i: number, j: number) => toks.slice(i, j + 1).filter((t) => t.kind === 'word').map((t) => t.text).join(' ')
  const act = {
    remove: () => { if (!sel) return; const [a, b] = span(sel.i, sel.j); onCut(a, b); clear() },
    keep: () => { if (!sel) return; const [a, b] = span(sel.i, sel.j); onKeep(a, b); clear() },
    broll: () => { if (!sel) return; const [a, b] = span(sel.i, sel.j); onBroll(a, b, saying(sel.i, sel.j)); clear() },
    voice: () => { if (!sel) return; onVoice(toks[sel.i].start); clear() },
    play: () => { if (!sel) return; onSeek(toks[sel.i].start + 0.01); setMenu(null) },
    text: () => { if (!sel) return; setCompose({ i: sel.i, j: sel.j, value: '' }); clear() },
  }
  // keys while pieces are selected: Delete removes (or brings back), Esc closes; they win over the editor's own shortcuts
  useEffect(() => {
    if (!sel) return
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select')) return
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); e.stopImmediatePropagation(); if (selGone) act.keep(); else act.remove() }
      else if (e.key === 'Escape') { e.stopImmediatePropagation(); clear() }
    }
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true)
  })
  const actions = (inMenu: boolean) => <>
    {selGone ? <button onClick={act.keep}><IconRestore size={14} />Bring back</button> : <button className="danger" onClick={act.remove}><IconScissors size={14} />Remove</button>}
    <button onClick={act.text} data-tip="Text on screen at this moment"><IconLetterT size={14} />{inMenu ? 'Text on screen here' : 'Text'}</button>
    <button onClick={act.play} data-tip="Play from here"><IconPlayerPlay size={14} />{inMenu && 'Play from here'}</button>
    {!selGone && <button onClick={act.broll} data-tip="B-roll over these words"><IconPhoto size={14} />{inMenu && 'B-roll over this'}</button>}
    <button onClick={act.voice} data-tip="Record a voiceover from here"><IconMicrophone size={14} />{inMenu && 'Voiceover here'}</button>
    {inMenu && sel && <button onClick={() => { const [a, b] = lineOf(sel.i); select(a, b) }}>Select the whole line</button>}
    {!inMenu && <button className="x" aria-label="Close" onClick={clear}><IconX size={14} /></button>}
  </>
  const submitText = () => {
    if (!compose || !compose.value.trim()) { setCompose(null); return }
    const [a, b] = span(compose.i, compose.j); onAddText(a, b, compose.value.trim()); setCompose(null)
  }

  if (!hasMic) return <p className="note">This video has no voice, so there is no script to edit.</p>
  if (status.kind === 'running') return <div className="director"><div className="spinner small" /><span><b>Script</b> — {status.message}</span></div>
  if (!transcript) return (
    <div className="director muted">
      <b>Script</b> — HomaCapture writes down what you say (on this Mac), then you edit the video by editing the words.
      <button className="primary" onClick={onCreate}>Write the script</button>
      {status.kind === 'error' && <span className="err">{status.message}</span>}
    </div>)

  const fillers = fillerRanges(transcript)
  const fillersLeft = fillers.filter((f) => !cuts.some(([a, b]) => (f.start + f.end) / 2 > a && (f.start + f.end) / 2 < b))
  const sounds = toks.filter((t) => t.kind === 'sound' && !gone(t))
  const cutCount = toks.filter((t) => t.kind !== 'pause' && gone(t)).length
  // on-screen text belongs to the line it appears during (or the nearest line before it)
  const lineStart = lines.map((ln) => ln[0].start)
  const lineAt = (t: number) => { let n = 0; for (let k = 0; k < lineStart.length; k++) if (lineStart[k] <= t + 0.01) n = k; return n }
  const textsOf = (k: number) => texts.filter((x) => lineAt(x.t) === k)
  return (
    <div className="script">
      <div className="script-tools">
        <button disabled={!fillersLeft.length && !sounds.length} onClick={() => onCutMany([...fillersLeft.map((f) => [Math.max(0, f.start - 0.04), f.end + 0.04] as Cut), ...sounds.map((t) => span(t.i, t.i))])}
          data-tip="Removes every um, uh and (sound)">
          <IconWand size={15} />{fillersLeft.length + sounds.length ? `Remove ${fillersLeft.length + sounds.length} ums & sounds` : 'No ums left'}</button>
        <button className={hide ? 'on' : ''} aria-pressed={hide} onClick={() => setHide((h) => !h)} data-tip="Removed pieces stay visible, struck through, unless you hide them">
          {hide ? <IconEyeOff size={15} /> : <IconEye size={15} />}{hide ? 'Show cuts' : 'Hide cuts'}</button>
        <button className="rec" onClick={() => onVoice(playhead)} data-tip="Record your voice over the video from the playhead"><IconMicrophone size={15} />Voiceover</button>
        <button onClick={onRedo} data-tip="Write the script again, word for word (keeps ums, repeats and every sound). Your cuts stay."><IconRefresh size={15} />More detail</button>
      </div>
      <p className="hint">Click or drag to select words, <b>(sounds)</b> and <b>⏸ pauses</b> · double-click a line · right-click for more · Delete removes.{cutCount ? ` ${cutCount} removed.` : ''}</p>
      <div className="script-body" ref={box} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('.w, .script-bar, .script-menu, .script-reply, .script-compose')) clear() }}>
        {lines.map((ln, k) => {
          const shown = hide ? ln.filter((t) => !gone(t)) : ln
          const replies = textsOf(k)
          const composing = compose && toks[compose.i].line === ln[0].line ? compose : null
          if (!shown.length && !replies.length && !composing) return null
          return <div key={k} className="script-line">
            <p>
              <button className="script-t" onClick={() => onSeek(ln[0].start)}>{fmt(ln[0].start)}</button>
              {shown.map((t) => <span key={t.i} data-i={t.i}
                className={'w ' + t.kind + (gone(t) ? ' cut' : '') + (live?.i === t.i ? ' now' : '') + (t.kind === 'word' && isFiller(t.text) ? ' um' : '') + (sel && t.i >= sel.i && t.i <= sel.j ? ' sel' : '')}
                onPointerDown={(e) => down(e, t.i)} onPointerOver={() => enter(t.i)}
                onDoubleClick={() => { const [a, b] = lineOf(t.i); select(a, b) }}
                onContextMenu={(e) => { e.preventDefault(); if (!sel || t.i < sel.i || t.i > sel.j) select(t.i, t.i); const c = box.current!.getBoundingClientRect(); setMenu({ x: Math.min(e.clientX - c.left, c.width - 230), y: e.clientY - c.top + box.current!.scrollTop }) }}>{t.text}</span>).flatMap((el) => [el, ' '])}
            </p>
            {replies.map((x) => <div key={x.id} className="script-reply" data-tip={`On screen at ${fmt(x.t)} for ${x.duration.toFixed(1)} s`}>
              <IconLetterT size={13} /><input value={x.text} aria-label="Text on screen" onChange={(e) => onEditText(x.id, e.target.value)} />
              <button className="x" aria-label="Remove this text" onClick={() => onRemoveText(x.id)}><IconX size={12} /></button></div>)}
            {composing && <div className="script-compose">
              <span className="q">On screen during “{saying(composing.i, composing.j).slice(0, 40) || toks[composing.i].text}”</span>
              <input autoFocus value={composing.value} placeholder="Type what should appear on screen" onChange={(e) => setCompose({ ...composing, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') submitText(); if (e.key === 'Escape') setCompose(null) }} />
              <div className="row"><button onClick={() => setCompose(null)}>Cancel</button><button className="primary" onClick={submitText}>Add to video</button></div>
            </div>}
          </div>
        })}
        {sel && barPos && !menu && <div className="script-bar" style={{ left: barPos.x, top: barPos.y }}>{actions(false)}</div>}
        {sel && menu && <div className="script-menu" style={{ left: menu.x, top: menu.y }}>{actions(true)}</div>}
      </div>
    </div>)
}
