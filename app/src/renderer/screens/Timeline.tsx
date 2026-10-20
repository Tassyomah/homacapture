import { useMemo, useRef, useState } from 'react'
import { IconEyeOff, IconPlayerTrackNext, IconScissors, IconX, IconZoomIn } from '@tabler/icons-react'
import type { Chapter, Cut, ManualZoom, Mask, RecordingEvents, SpeedRange, Transcript } from '../../shared/types'
import { keptRanges, removedRanges, type Range } from '../../video/ranges'

/** Something on the timeline the user can select and edit in the inspector. */
export type Item = { kind: 'cut'; i: number } | { kind: 'zoom'; id: string } | { kind: 'speed'; i: number } | { kind: 'mask'; id: string }
export type RangeAction = 'cut' | 'zoom' | 'speed' | 'mask'
export const sameItem = (a: Item | null, b: Item | null) => !!a && !!b && a.kind === b.kind && ('id' in a ? a.id === (b as { id: string }).id : a.i === (b as { i: number }).i)

/**
 * The recording's timeline in source time, one track per kind of edit (spec §36–40). Click to move the playhead,
 * drag across any track to select a stretch (a toolbar offers Cut / Zoom / Speed / Blur), click a block to edit it.
 * Hovering anything says what it is.
 */
export function Timeline({ ev, cuts, chapters = [], highlights = [], zooms = [], speeds = [], masks = [], transcript, playhead, range, selected, editable,
  onSeek, onRange, onSelect, onAction }: {
  ev: RecordingEvents; cuts: Cut[]; chapters?: Chapter[]; highlights?: [number, number][]; zooms?: ManualZoom[]; speeds?: SpeedRange[]; masks?: Mask[]
  transcript?: Transcript | null; playhead: number; range: [number, number] | null; selected: Item | null
  /** False while editing a derived version: only cuts belong to it, so zoom / speed / blur tracks are read-only. */
  editable: boolean
  onSeek: (tSrc: number) => void; onRange: (r: [number, number] | null) => void; onSelect: (it: Item | null) => void; onAction: (a: RangeAction) => void
}) {
  const dur = Math.max(0.001, ev.videoDuration)
  const kept = useMemo(() => keptRanges(ev, cuts), [ev, cuts])
  const pauses = useMemo(() => removedRanges(ev, []), [ev])
  const pct = (t: number) => `${(Math.max(0, Math.min(dur, t)) / dur) * 100}%`
  const w = (a: number, b: number) => `${(Math.max(0, Math.min(dur, b) - Math.max(0, a)) / dur) * 100}%`
  const width = (r: Range) => w(r.start, r.end)
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; t: number; moved: boolean; item: Item | null; scrub: boolean } | null>(null)
  const [hover, setHover] = useState<{ x: number; t: number; info: string | null } | null>(null)

  const timeAt = (clientX: number) => {
    const box = area.current!.getBoundingClientRect()
    return Math.max(0, Math.min(dur, ((clientX - box.left) / box.width) * dur))
  }
  const itemOf = (el: EventTarget | null): Item | null => {
    const n = (el as HTMLElement | null)?.closest?.('[data-item]') as HTMLElement | null
    return n ? JSON.parse(n.dataset.item!) : null
  }
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.rangebar')) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic events have no pointer */ }
    const scrub = !!(e.target as HTMLElement).closest('.ruler, .playhead')
    drag.current = { x: e.clientX, t: timeAt(e.clientX), moved: false, item: scrub ? null : itemOf(e.target), scrub }
    if (scrub) onSeek(timeAt(e.clientX))
  }
  const move = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX)
    const info = (e.target as HTMLElement).closest?.('[data-info]')?.getAttribute('data-info') ?? null
    setHover({ x: e.clientX - area.current!.getBoundingClientRect().left, t, info })
    const d = drag.current; if (!d) return
    if (d.scrub) { onSeek(t); return }
    if (!d.moved && Math.abs(e.clientX - d.x) > 4) { d.moved = true; onSelect(null) }
    if (d.moved) onRange([Math.min(d.t, t), Math.max(d.t, t)])
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null
    if (!d || d.scrub) return
    if (d.moved) { const r = [Math.min(d.t, timeAt(e.clientX)), Math.max(d.t, timeAt(e.clientX))]; if (r[1] - r[0] < 0.15) onRange(null); return }
    onRange(null)
    if (d.item) { onSelect(d.item); return }
    onSelect(null); onSeek(timeAt(e.clientX))
  }

  // Ruler ticks: a "nice" step so there are roughly 6–10 labels whatever the length.
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => dur / s <= 10) ?? 1200
  const ticks = Array.from({ length: Math.floor(dur / step) + 1 }, (_, i) => i * step)
  const lane = (label: string, hint: string, children: React.ReactNode) => (
    <div className="lane"><span className="lane-label" data-info={hint}>{label}</span><div className="lane-body">{children}</div></div>
  )
  const it = (x: Item) => JSON.stringify(x)
  const on = (x: Item) => (selected && sameItem(selected, x) ? ' on' : '')

  return (
    <div className="tl">
      <div className="tl-area" ref={area} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}>
        <div className="ruler" data-info="Drag here to scrub">
          {ticks.map((t) => <span key={t} style={{ left: pct(t) }}>{fmtShort(t)}</span>)}
        </div>
        {lane('Video', 'Your recording. Drag across it to select a stretch.', <>
          {kept.map((r, i) => <div key={'k' + i} className="blk kept" style={{ left: pct(r.start), width: width(r) }} />)}
          {pauses.map((r, i) => <div key={'p' + i} className="blk pause" style={{ left: pct(r.start), width: width(r) }} data-info={`Pause, removed automatically · ${fmt(r.start)}–${fmt(r.end)}`} />)}
          {cuts.map((c, i) => <div key={'c' + i} className={'blk cut' + on({ kind: 'cut', i })} style={{ left: pct(Math.min(...c)), width: w(Math.min(...c), Math.max(...c)) }}
            data-item={it({ kind: 'cut', i })} data-info={`Cut ${fmt(Math.min(...c))}–${fmt(Math.max(...c))} · click to restore or adjust`} />)}
          {highlights.map(([a, b], i) => <div key={'h' + i} className="blk hl" style={{ left: pct(a), width: w(a, b) }} data-info={`Highlight ${fmt(a)}–${fmt(b)}`} />)}
          {chapters.map((c, i) => <div key={'ch' + i} className="chap" style={{ left: pct(c.t) }} data-info={`Chapter: ${c.title} · ${fmt(c.t)}`} />)}
          {ev.clicks.filter((c) => c.type === 'down').map((c, i) => <i key={'d' + i} className="click" style={{ left: pct(c.t - ev.t0Video) }} />)}
        </>)}
        {lane('Zoom', 'Zoom-ins you added. Automatic zoom follows your clicks on its own.', zooms.map((z) => (
          <div key={z.id} className={'blk pill zoom' + on({ kind: 'zoom', id: z.id }) + (editable ? '' : ' ro')} style={{ left: pct(z.t), width: w(z.t, z.t + z.duration) }}
            data-item={editable ? it({ kind: 'zoom', id: z.id }) : undefined} data-info={`Zoom ${z.level.toFixed(1)}× · ${fmt(z.t)}–${fmt(z.t + z.duration)} · click to edit`}><span>{z.level.toFixed(1)}×</span></div>)))}
        {lane('Speed', 'Stretches played faster or slower.', speeds.map((s, i) => (
          <div key={'s' + i} className={'blk pill speed' + on({ kind: 'speed', i }) + (editable ? '' : ' ro')} style={{ left: pct(s.start), width: w(s.start, s.end) }}
            data-item={editable ? it({ kind: 'speed', i }) : undefined} data-info={`${s.rate}× speed · ${fmt(s.start)}–${fmt(s.end)} · click to edit`}><span>{s.rate}×</span></div>)))}
        {lane('Blur', 'Hidden areas: passwords, emails, anything private.', masks.map((m) => (
          <div key={m.id} className={'blk pill mask' + on({ kind: 'mask', id: m.id }) + (editable ? '' : ' ro')} style={{ left: pct(m.start), width: w(m.start, m.end) }}
            data-item={editable ? it({ kind: 'mask', id: m.id }) : undefined} data-info={`${m.kind === 'blur' ? 'Blur' : 'Solid box'} · ${fmt(m.start)}–${fmt(m.end)} · click to edit`} />)))}
        {transcript && lane('Words', 'What you said. Edit the text in the Transcript tab.', transcript.segments.map((s, i) => (
          <div key={'w' + i} className="blk pill words" style={{ left: pct(s.start), width: w(s.start, s.end) }} data-info={s.text.trim()} />)))}

        {range && <div className="sel" style={{ left: pct(range[0]), width: w(range[0], range[1]) }} />}
        {range && (
          <div className="rangebar" style={{ left: pct((range[0] + range[1]) / 2) }} onPointerDown={(e) => e.stopPropagation()}>
            <span className="len">{fmt(range[1] - range[0])}</span>
            <button data-tip="Remove this stretch · C" onClick={() => onAction('cut')}><IconScissors size={15} />Cut</button>
            {editable && <>
              <button data-tip="Zoom in on the cursor · Z" onClick={() => onAction('zoom')}><IconZoomIn size={15} />Zoom</button>
              <button data-tip="Play faster · S" onClick={() => onAction('speed')}><IconPlayerTrackNext size={15} />Speed</button>
              <button data-tip="Hide something private · B" onClick={() => onAction('mask')}><IconEyeOff size={15} />Blur</button>
            </>}
            <button className="x" aria-label="Clear selection" data-tip="Clear · Esc" onClick={() => onRange(null)}><IconX size={14} /></button>
          </div>
        )}
        <div className="playhead" style={{ left: pct(playhead) }} />
        {hover && <div className="ghost" style={{ left: hover.x }} />}
        {hover && <div className="bubble" style={{ left: Math.max(90, Math.min((area.current?.clientWidth ?? 0) - 90, hover.x)) }}>{hover.info ? <><b>{fmt(hover.t)}</b> {hover.info}</> : fmt(hover.t)}</div>}
      </div>
    </div>
  )
}

export const fmt = (s: number) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), tenths = Math.floor((s % 1) * 10)
  return `${m}:${String(sec).padStart(2, '0')}.${tenths}`
}
export const fmtShort = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
