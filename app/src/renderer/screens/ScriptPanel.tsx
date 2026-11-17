import { useEffect, useMemo, useRef, useState } from 'react'
import { IconEye, IconEyeOff, IconMicrophone, IconPhoto, IconScissors, IconRestore, IconWand } from '@tabler/icons-react'
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
  const [sel, setSel] = useState<{ i: number; j: number; x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)

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

  const idxOf = (n: Node | null) => { const el = (n instanceof Element ? n : n?.parentElement)?.closest('[data-i]'); return el ? Number(el.getAttribute('data-i')) : null }
  const onUp = () => {
    const s = window.getSelection()
    if (!s || !box.current) return
    if (s.isCollapsed) { setSel(null); return }
    let i = idxOf(s.anchorNode), j = idxOf(s.focusNode)
    if (i == null || j == null) { setSel(null); return }
    if (i > j) [i, j] = [j, i]
    const r = s.getRangeAt(0).getBoundingClientRect(), c = box.current.getBoundingClientRect()
    setSel({ i, j, x: Math.max(8, Math.min(c.width - 250, r.left - c.left)), y: r.bottom - c.top + box.current.scrollTop + 6 })
  }
  const done = () => { window.getSelection()?.removeAllRanges(); setSel(null) }

  if (!hasMic) return <p className="note">This video has no voice, so there is no script to edit.</p>
  if (status.kind === 'running') return <div className="director"><div className="spinner small" /><span><b>Script</b> — {status.message}</span></div>
  if (!transcript) return (
    <div className="director muted">
      <b>Script</b> — HomaCapture writes down what you say (on this Mac), then you edit the video by editing the words.
      <button className="primary" onClick={onCreate}>Write the script</button>
      {status.kind === 'error' && <span className="err">{status.message}</span>}
    </div>)

  const selGone = sel ? words.slice(sel.i, sel.j + 1).every(gone) : false
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
      <p className="hint">Select words to remove them. Click a word to jump there.{cutCount ? ` ${cutCount} word${cutCount === 1 ? '' : 's'} removed.` : ''}</p>
      <div className="script-body" ref={box} onMouseUp={onUp} onScroll={() => sel && done()}>
        {lines.map((ln, k) => {
          const shown = hide ? ln.filter((w) => !gone(w)) : ln
          if (!shown.length) return null
          return <p key={k} className="script-line">
            <button className="script-t" onClick={() => onSeek(ln[0].start)}>{fmt(ln[0].start)}</button>
            {shown.map((w) => <span key={w.i} data-i={w.i} className={'w' + (gone(w) ? ' cut' : '') + (live?.i === w.i ? ' now' : '') + (isFiller(w.word) ? ' um' : '')}
              onClick={() => { const s = window.getSelection(); if (!s || s.isCollapsed) onSeek(w.start + 0.01) }}>{clean(w.word)} </span>)}
          </p>
        })}
        {sel && <div className="script-bar" style={{ left: sel.x, top: sel.y }} onMouseUp={(e) => e.stopPropagation()}>
          {selGone
            ? <button onClick={() => { const [a, b] = span(sel.i, sel.j); onKeep(a, b); done() }}><IconRestore size={14} />Keep</button>
            : <button className="danger" onClick={() => { const [a, b] = span(sel.i, sel.j); onCut(a, b); done() }}><IconScissors size={14} />Remove</button>}
          {!selGone && <button onClick={() => { const [a, b] = span(sel.i, sel.j); onBroll(a, b, words.slice(sel.i, sel.j + 1).map((w) => clean(w.word)).join(' ')); done() }}><IconPhoto size={14} />B-roll</button>}
          <button onClick={() => { onVoice(words[sel.i].start); done() }}><IconMicrophone size={14} />Voice</button>
        </div>}
      </div>
    </div>)
}
