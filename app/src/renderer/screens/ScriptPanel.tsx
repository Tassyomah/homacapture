import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconEye, IconEyeOff, IconMicrophone, IconPhoto, IconPlayerPlay, IconScissors, IconRestore, IconWand, IconX } from '@tabler/icons-react'
import type { Cut, Transcript, TranscriptWord } from '../../shared/types'
import { fmt } from './Timeline'
import { fillerRanges, type TranscribeStatus } from './TranscriptPanel'

/**
 * Edit the video by its script (like Tassy's script editor): every spoken word, in lines as they were said. Select words
 * and Remove them — they stay on the page with a red line through them, so nothing important is lost by accident — or
 * Keep them to bring them back. Click a word to jump there; the word being said lights up as it plays.
 * From a selection you can also put B-roll over those words or record a voiceover starting there.
 */
type W = TranscriptWord & { i: number; line: number }
const clean = (w: string) => w.replace(/^\s+|\s+$/g, '')
const isFiller = (w: string) => /^(um+|uh+|erm*|hmm+)[,.]?$/i.test(clean(w))

export function ScriptPanel({ transcript, status, hasMic, cuts, playhead, playing, onCreate, onSeek, onCut, onKeep, onCutMany, onBroll, onVoice }: {
  transcript: Transcript | null; status: TranscribeStatus; hasMic: boolean; cuts: Cut[]; playhead: number; playing: boolean
  onCreate: () => void; onSeek: (t: number) => void
  onCut: (a: number, b: number) => void; onKeep: (a: number, b: number) => void; onCutMany: (r: Cut[]) => void
  onBroll: (a: number, b: number, words: string) => void; onVoice: (t: number) => void
}) {
  const words = useMemo<W[]>(() => {
    if (!transcript) return []
    const out: W[] = []
    transcript.segments.forEach((s, line) => s.words.forEach((w) => { if (w.end > w.start && clean(w.word)) out.push({ ...w, i: out.length, line }) }))
    return out
  }, [transcript])
  const lines = useMemo(() => { const m: W[][] = []; for (const w of words) (m[w.line] ??= []).push(w); return m.filter(Boolean) }, [words])
  const [hide, setHide] = useState(false)
  // Selection lives here, not in the browser's text selection (that one vanished on every re-render and scroll).
  const [sel, setSel] = useState<{ i: number; j: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const anchor = useRef<number | null>(null), dragging = useRef(false), moved = useRef(false)

  const gone = (w: W) => { const m = (w.start + w.end) / 2; return cuts.some(([a, b]) => m > Math.min(a, b) && m < Math.max(a, b)) }
  // The stretch of video a run of words takes: from just after the word before to just before the word after, so a cut
  // never clips a neighbouring word and leaves no stray breath.
  const span = (i: number, j: number): [number, number] => {
    const a = i > 0 ? Math.max(words[i - 1].end + 0.02, words[i].start - 0.12) : Math.max(0, words[i].start - 0.12)
    const b = j < words.length - 1 ? Math.min(words[j + 1].start - 0.02, words[j].end + 0.25) : words[j].end + 0.25
    return [a, Math.max(a + 0.05, b)]
  }
  const live = words.find((w) => playhead >= w.start - 0.02 && playhead < (words[w.i + 1]?.start ?? w.end + 0.3))

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
  const lineOf = (i: number) => { const ln = words[i].line, all = words.filter((w) => w.line === ln); return [all[0].i, all[all.length - 1].i] as const }
  // press on a word: select it (Shift extends); drag across words to select a run; a plain click also jumps there
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
      if (!moved.current && anchor.current != null) onSeek(words[anchor.current].start + 0.01)
    }
    window.addEventListener('pointerup', up); return () => window.removeEventListener('pointerup', up)
  }, [words, onSeek])
  // the action bar sits under the last selected word and scrolls with the text; it stays until you close it
  useLayoutEffect(() => {
    if (!sel || !box.current) { setBarPos(null); return }
    const el = box.current.querySelector(`[data-i="${sel.j}"]`) as HTMLElement | null
    if (!el) { setBarPos(null); return }
    setBarPos({ x: Math.max(4, Math.min(box.current.clientWidth - 236, el.offsetLeft - 20)), y: el.offsetTop + el.offsetHeight + 4 })
  }, [sel, hide, words])
  const selGone = sel ? words.slice(sel.i, sel.j + 1).every(gone) : false
  const act = {
    remove: () => { if (!sel) return; const [a, b] = span(sel.i, sel.j); onCut(a, b); clear() },
    keep: () => { if (!sel) return; const [a, b] = span(sel.i, sel.j); onKeep(a, b); clear() },
    broll: () => { if (!sel) return; const [a, b] = span(sel.i, sel.j); onBroll(a, b, words.slice(sel.i, sel.j + 1).map((w) => clean(w.word)).join(' ')); clear() },
    voice: () => { if (!sel) return; onVoice(words[sel.i].start); clear() },
    play: () => { if (!sel) return; onSeek(words[sel.i].start + 0.01); setMenu(null) },
  }
  // keys while words are selected: Delete removes (or brings back), Esc closes; they win over the editor's own shortcuts
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
    {selGone ? <button onClick={act.keep}><IconRestore size={14} />{inMenu ? 'Bring back' : 'Bring back'}</button> : <button className="danger" onClick={act.remove}><IconScissors size={14} />Remove</button>}
    <button onClick={act.play} data-tip="Play from here"><IconPlayerPlay size={14} />{inMenu && 'Play from here'}</button>
    {!selGone && <button onClick={act.broll} data-tip="B-roll over these words"><IconPhoto size={14} />{inMenu && 'B-roll over this'}</button>}
    <button onClick={act.voice} data-tip="Record a voiceover from here"><IconMicrophone size={14} />{inMenu && 'Voiceover here'}</button>
    {inMenu && sel && <button onClick={() => { const [a, b] = lineOf(sel.i); select(a, b) }}>Select the whole line</button>}
    {!inMenu && <button className="x" aria-label="Close" onClick={clear}><IconX size={14} /></button>}
  </>

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
  const cutCount = words.filter(gone).length
  return (
    <div className="script">
      <div className="script-tools">
        <button disabled={!fillersLeft.length} onClick={() => onCutMany(fillersLeft.map((f) => [Math.max(0, f.start - 0.04), f.end + 0.04] as Cut))}>
          <IconWand size={15} />{fillersLeft.length ? `Remove ${fillersLeft.length} um${fillersLeft.length === 1 ? '' : 's'}` : 'No ums left'}</button>
        <button className={hide ? 'on' : ''} aria-pressed={hide} onClick={() => setHide((h) => !h)} data-tip="Removed words stay visible, struck through, unless you hide them">
          {hide ? <IconEyeOff size={15} /> : <IconEye size={15} />}{hide ? 'Show cuts' : 'Hide cuts'}</button>
        <button className="rec" onClick={() => onVoice(playhead)} data-tip="Record your voice over the video from the playhead"><IconMicrophone size={15} />Voiceover</button>
      </div>
      <p className="hint">Click or drag across words to select · double-click for the whole line · right-click for more · Delete removes.{cutCount ? ` ${cutCount} word${cutCount === 1 ? '' : 's'} removed.` : ''}</p>
      <div className="script-body" ref={box} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('.w, .script-bar, .script-menu')) clear() }}>
        {lines.map((ln, k) => {
          const shown = hide ? ln.filter((w) => !gone(w)) : ln
          if (!shown.length) return null
          return <p key={k} className="script-line">
            <button className="script-t" onClick={() => onSeek(ln[0].start)}>{fmt(ln[0].start)}</button>
            {shown.map((w) => <span key={w.i} data-i={w.i} className={'w' + (gone(w) ? ' cut' : '') + (live?.i === w.i ? ' now' : '') + (isFiller(w.word) ? ' um' : '') + (sel && w.i >= sel.i && w.i <= sel.j ? ' sel' : '')}
              onPointerDown={(e) => down(e, w.i)} onPointerOver={() => enter(w.i)}
              onDoubleClick={() => { const [a, b] = lineOf(w.i); select(a, b) }}
              onContextMenu={(e) => { e.preventDefault(); if (!sel || w.i < sel.i || w.i > sel.j) select(w.i, w.i); const c = box.current!.getBoundingClientRect(); setMenu({ x: Math.min(e.clientX - c.left, c.width - 220), y: e.clientY - c.top + box.current!.scrollTop }) }}>{clean(w.word)} </span>)}
          </p>
        })}
        {sel && barPos && !menu && <div className="script-bar" style={{ left: barPos.x, top: barPos.y }}>{actions(false)}</div>}
        {sel && menu && <div className="script-menu" style={{ left: menu.x, top: menu.y }}>{actions(true)}</div>}
      </div>
    </div>)
}
