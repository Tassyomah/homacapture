import { useEffect, useMemo, useRef, useState } from 'react'
import { IconEyeOff, IconLetterT, IconMoodSmile, IconPhoto, IconPlayerTrackNext, IconScissors, IconX, IconZoomIn } from '@tabler/icons-react'
import type { Chapter, Cut, InsertClip, ManualZoom, Mask, MusicTrack, Overlay, Sticker, RecordingEvents, SpeedRange, TextPop, Transcript, Voiceover } from '../../shared/types'
import { outToSrc, playLen, srcToOut, type Range } from '../../video/ranges'

/** Something on the timeline the user can select and edit in the inspector. */
export type Item = { kind: 'cut'; i: number } | { kind: 'zoom'; id: string } | { kind: 'speed'; i: number } | { kind: 'mask'; id: string } | { kind: 'text'; id: string } | { kind: 'broll'; id: string } | { kind: 'sticker'; id: string } | { kind: 'voice'; id: string }
  | { kind: 'piece'; a: number; b: number } | { kind: 'insert'; id: string }
export type RangeAction = 'cut' | 'zoom' | 'speed' | 'mask' | 'text' | 'broll' | 'sticker'
export type DragMode = 'move' | 'l' | 'r'
export const sameItem = (a: Item | null, b: Item | null) => {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'piece') return Math.abs(a.a - (b as typeof a).a) < 0.01 && Math.abs(a.b - (b as typeof a).b) < 0.01
  return 'id' in a ? a.id === (b as { id: string }).id : a.i === (b as { i: number }).i
}
/** The blocks on the video track: what plays, in order, also divided where the user split it. */
export function piecesOf(ranges: Range[], splits: number[]): Range[] {
  const out: Range[] = []
  for (const r of ranges) {
    if (r.ins) { out.push(r); continue }
    let cur = r.start
    for (const s of [...splits].sort((x, y) => x - y)) if (s > cur + 0.02 && s < r.end - 0.02) { out.push({ ...r, start: cur, end: s }); cur = s }
    out.push({ ...r, start: cur })
  }
  return out
}

/**
 * The finished video, left to right (spec §36–40): a removed stretch closes up, so what you see is what plays, with a
 * small joint you can click to bring it back. Click to move the playhead, drag across empty track to select a stretch,
 * drag a block to move it, drag its ends to change its length. Items keep their source seconds underneath, so everything
 * stays in place when the cut changes.
 */
export function Timeline({ ev, cuts, ranges, splits = [], chapters = [], highlights = [], zooms = [], speeds = [], masks = [], texts = [], overlays = [], stickers = [], music = null, voiceovers = [], inserts = [], transcript, playhead, range, selected, editable, scale = 1,
  onSeek, onRange, onSelect, onAction, onDragStart, onDragItem, onDragEnd, onMenu, onHover, strip }: {
  ev: RecordingEvents; cuts: Cut[]; ranges: Range[]; splits?: number[]; chapters?: Chapter[]; highlights?: [number, number][]; zooms?: ManualZoom[]; speeds?: SpeedRange[]; masks?: Mask[]; texts?: TextPop[]; overlays?: Overlay[]; stickers?: Sticker[]; music?: MusicTrack | null; voiceovers?: Voiceover[]; inserts?: InsertClip[]
  transcript?: Transcript | null; playhead: number; range: [number, number] | null; selected: Item | null
  /** False while editing a derived version: only cuts belong to it, so the other tracks are read-only. */
  editable: boolean
  /** How far the timeline is zoomed in: 1 fits the whole video. */
  scale?: number
  onSeek: (tSrc: number) => void; onRange: (r: [number, number] | null) => void; onSelect: (it: Item | null) => void; onAction: (a: RangeAction) => void
  onDragStart: (it: Item) => void; onDragItem: (it: Item, mode: DragMode, tOut: number) => void; onDragEnd: (it: Item, mode: DragMode, tOut: number) => void
  onMenu: (it: Item, x: number, y: number) => void
  /** What the pointer is over, for the status line. */
  onHover: (text: string | null) => void
  strip?: { strip: string; frames: number; aspect: number; wave: string | null } | null
}) {
  const total = useMemo(() => Math.max(0.001, ranges.reduce((s, r) => s + playLen(r), 0)), [ranges])
  const pieces = useMemo(() => piecesOf(ranges, splits), [ranges, splits])
  const upload = ev.source === 'import'
  const out = (t: number) => Math.max(0, Math.min(total, srcToOut(ranges, t)))
  const pct = (t: number) => `${(out(t) / total) * 100}%`
  const w = (a: number, b: number) => `${(Math.max(0, out(b) - out(a)) / total) * 100}%`
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; t: number; moved: boolean; item: Item | null; scrub: boolean; mode: DragMode; grab: number } | null>(null)
  const [hover, setHover] = useState<{ x: number; t: number; info: string | null } | null>(null)
  const [snap, setSnap] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [areaW, setAreaW] = useState(0)
  useEffect(() => {
    const a = area.current; if (!a) return
    const ro = new ResizeObserver(() => setAreaW(a.clientWidth)); ro.observe(a); setAreaW(a.clientWidth)
    return () => ro.disconnect()
  }, [])
  // Zoomed in: the view follows the playhead.
  useEffect(() => {
    const v = scroller.current, a = area.current; if (!v || !a || scale <= 1) return
    const x = (out(playhead) / total) * a.clientWidth
    if (x < v.scrollLeft + 20 || x > v.scrollLeft + v.clientWidth - 20) v.scrollLeft = Math.max(0, x - v.clientWidth / 3)
  }, [playhead, scale, total])

  const outAt = (clientX: number) => {
    const box = area.current!.getBoundingClientRect()
    return Math.max(0, Math.min(total, ((clientX - box.left) / box.width) * total))
  }
  const timeAt = (clientX: number) => outToSrc(ranges, outAt(clientX))
  const itemOf = (el: EventTarget | null): Item | null => {
    const n = (el as HTMLElement | null)?.closest?.('[data-item]') as HTMLElement | null
    return n ? JSON.parse(n.dataset.item!) : null
  }
  // Blocks land on the playhead and on the joins between pieces when they come close.
  const snapped = (tOut: number) => {
    const near = (8 / (area.current?.getBoundingClientRect().width ?? 800)) * total
    const points = [out(playhead), 0, total, ...pieces.reduce<number[]>((acc, p) => [...acc, (acc[acc.length - 1] ?? 0) + playLen(p)], [])]
    const hit = points.find((p) => Math.abs(p - tOut) < near)
    setSnap(hit ?? null)
    return hit ?? tOut
  }
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.rangebar')) return
    if (e.button === 2) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic events have no pointer */ }
    const scrub = !!(e.target as HTMLElement).closest('.ruler, .playhead')
    const edge = (e.target as HTMLElement).closest?.('.edge') as HTMLElement | null
    const mode: DragMode = edge ? (edge.classList.contains('l') ? 'l' : 'r') : 'move'
    const item = scrub ? null : itemOf(e.target)
    const block = (e.target as HTMLElement).closest?.('[data-item]') as HTMLElement | null
    const grab = block ? outAt(e.clientX) - outAt(block.getBoundingClientRect().left) : 0
    drag.current = { x: e.clientX, t: timeAt(e.clientX), moved: false, item, scrub, mode, grab }
    if (scrub) onSeek(timeAt(e.clientX))
  }
  const draggable = (it: Item | null, mode: DragMode) => !!it && editable && it.kind !== 'cut' && it.kind !== 'speed' && (mode !== 'move' || it.kind !== 'piece') && (mode === 'move' || it.kind !== 'voice')
  const move = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX)
    const info = (e.target as HTMLElement).closest?.('[data-info]')?.getAttribute('data-info') ?? null
    setHover({ x: e.clientX - area.current!.getBoundingClientRect().left, t: outAt(e.clientX), info })
    onHover(info)
    const d = drag.current; if (!d) return
    if (d.scrub) { onSeek(t); return }
    if (!d.moved && Math.abs(e.clientX - d.x) > 4) {
      d.moved = true
      if (draggable(d.item, d.mode)) onDragStart(d.item!); else { d.item = null; onSelect(null) }
    }
    if (!d.moved) return
    if (d.item) onDragItem(d.item, d.mode, snapped(outAt(e.clientX) - (d.mode === 'move' ? d.grab : 0)))
    else onRange([Math.min(d.t, t), Math.max(d.t, t)])
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; setSnap(null)
    if (!d || d.scrub) return
    if (d.moved && d.item) { onDragEnd(d.item, d.mode, snapped(outAt(e.clientX) - (d.mode === 'move' ? d.grab : 0))); setSnap(null); return }
    if (d.moved) { const a = timeAt(e.clientX); if (Math.abs(a - d.t) < 0.15) onRange(null); return }
    onRange(null)
    if (d.item) {
      // Clicking the video also puts the playhead where you clicked.
      if (d.item.kind === 'piece' || d.item.kind === 'insert') onSeek(timeAt(e.clientX))
      onSelect(d.item); return
    }
    onSelect(null); onSeek(timeAt(e.clientX))
  }
  const menu = (e: React.MouseEvent) => {
    const it = itemOf(e.target); if (!it || !editable) return
    e.preventDefault(); onSelect(it); onMenu(it, e.clientX, e.clientY)
  }

  // Ruler ticks: a "nice" step so there are roughly 6–10 labels across the visible width.
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => total / s <= 10 * scale) ?? 1200
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step)
  // Lane names live in their own column, so they stay put while a zoomed-in timeline scrolls sideways.
  const labels: { name: string; rows: number }[] = []
  const lane = (label: string, hint: string, children: React.ReactNode, rows = 1) => {
    labels.push({ name: label, rows })
    return <div className="lane" style={rows > 1 ? { height: 22 * rows } : undefined} data-info={hint}><div className="lane-body">{children}</div></div>
  }
  // Things that overlap in time stack in rows, so none hides another.
  const stack = <X,>(xs: X[], span: (x: X) => [number, number]) => {
    const ends: number[] = [], rowOf = new Map<X, number>()
    for (const x of [...xs].sort((p, q) => out(span(p)[0]) - out(span(q)[0]))) {
      const [a, b] = span(x), oa = out(a), ob = Math.max(out(b), oa + total * 0.012)
      let r = ends.findIndex((e) => e <= oa + 0.001)
      if (r < 0) { r = ends.length; ends.push(0) }
      ends[r] = ob; rowOf.set(x, r)
    }
    return { rows: Math.max(1, ends.length), rowOf }
  }
  // Floats above the timeline, in window coordinates, so nothing clips it and it stays on screen.
  const floating = (fraction: number, above: number): React.CSSProperties => {
    const box = area.current?.getBoundingClientRect(), view = scroller.current?.getBoundingClientRect()
    if (!box || !view) return { display: 'none' }
    return { position: 'fixed', top: view.top - above, left: Math.max(view.left + 130, Math.min(view.right - 130, box.left + box.width * fraction)) }
  }
  // The video track shows the video: frames across, the shape of the sound along the bottom.
  const film = (p: Range) => {
    if (!strip || !areaW) return null
    const pieceW = (playLen(p) / total) * areaW, tileW = Math.max(24, 52 * strip.aspect), n = Math.min(240, Math.ceil(pieceW / tileW)), rec = ev.videoDuration
    const sound = strip.wave && <i className="wave" style={{ width: pieceW * (rec / Math.max(0.01, p.end - p.start)), left: -(p.start / Math.max(0.01, p.end - p.start)) * pieceW, backgroundImage: `url("${strip.wave}")` }} />
    return <>{Array.from({ length: n }, (_, i) => {
      const t = p.start + ((i + 0.5) * tileW / Math.max(1, pieceW)) * (p.end - p.start)
      const f = Math.max(0, Math.min(strip.frames - 1, Math.floor((t / rec) * strip.frames)))
      return <i key={i} className="frame" style={{ left: i * tileW, width: tileW, backgroundImage: `url("${strip.strip}")`, backgroundSize: `${strip.frames * tileW}px 100%`, backgroundPosition: `${-f * tileW}px 0` }} />
    })}{sound}</>
  }
  const it = (x: Item) => JSON.stringify(x)
  const on = (x: Item) => (selected && sameItem(selected, x) ? ' on' : '')
  const ends = (show: boolean) => show ? <><i className="edge l" /><i className="edge r" /></> : null
  const block = (kind: string, x: Item, a: number, b: number, info: string, label: React.ReactNode, row = 0) => (
    <div key={'id' in x ? x.id : kind + a} className={`blk pill ${kind}` + on(x) + (editable ? '' : ' ro')} style={{ left: pct(a), width: w(a, b), minWidth: 6, top: 3 + row * 22, bottom: 'auto', height: 16 }}
      data-item={editable ? it(x) : undefined} data-info={info}><span>{label}</span>{ends(editable)}</div>)

  const textRows = stack(texts, (x) => [x.t, x.t + x.duration]), stickerRows = stack(stickers, (x) => [x.t, x.t + x.duration])
  const overlayRows = stack(overlays, (x) => [x.t, x.t + x.duration]), voiceRows = stack(voiceovers, (x) => [x.t, x.t + x.duration])

  return (
    <div className="tl" onContextMenu={menu}>
      <div className="tl-scroll" ref={scroller}><div className="tl-area" ref={area} style={{ width: `${scale * 100}%` }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => { setHover(null); onHover(null) }}>
        <div className="ruler" data-info="Drag here to scrub">
          {ticks.map((t) => <span key={t} style={{ left: `${(t / total) * 100}%` }}>{fmtShort(t)}</span>)}
        </div>
        {lane('Video', 'Your video. Click a piece to edit it, drag its ends to trim.', <>
          {pieces.map((p, i) => {
            const x: Item = p.ins ? { kind: 'insert', id: p.ins.id } : { kind: 'piece', a: p.start, b: p.end }
            const from = pieces.slice(0, i).reduce((s, q) => s + playLen(q), 0)
            return <div key={'k' + i} className={'blk kept' + (p.ins ? ' ins' : '') + on(x)} style={{ left: `${(from / total) * 100}%`, width: `${(playLen(p) / total) * 100}%` }} data-item={it(x)}
              data-info={`${p.ins ? p.ins.name : 'Clip'} · ${fmt(playLen(p))}${p.rate !== 1 ? ` · ${p.rate}× speed` : ''} · click to edit`}>
              {!p.ins && film(p)}
              {p.ins && <span className="blk-name">{p.ins.name}</span>}{p.rate !== 1 && <span className="blk-name">{p.rate}×</span>}{ends(true)}</div>
          })}
          {cuts.map((c, i) => <div key={'c' + i} className={'blk joint' + on({ kind: 'cut', i })} style={{ left: pct(Math.min(...c)) }}
            data-item={it({ kind: 'cut', i })} data-info={`${fmt(Math.abs(c[1] - c[0]))} removed here · click to bring it back`} />)}
          {highlights.map(([a, b], i) => <div key={'h' + i} className="blk hl" style={{ left: pct(a), width: w(a, b) }} data-info={`Highlight ${fmt(a)}–${fmt(b)}`} />)}
          {chapters.map((c, i) => <div key={'ch' + i} className="chap" style={{ left: pct(c.t) }} data-info={`Chapter: ${c.title} · ${fmt(c.t)}`} />)}
        </>)}
        {texts.length > 0 && lane('Text', 'Words on screen. Click to edit, drag to move, drag the ends to change how long it shows.', texts.map((x) =>
          block('text', { kind: 'text', id: x.id }, x.t, x.t + x.duration, `“${x.text}” · ${fmt(x.t)} · click to edit`, x.text, textRows.rowOf.get(x))), textRows.rows)}
        {stickers.length > 0 && lane('Stickers', 'Emoji and shapes on the video.', stickers.map((k) =>
          block('sticker', { kind: 'sticker', id: k.id }, k.t, k.t + k.duration, `Sticker ${k.emoji ?? k.shape} · ${fmt(k.t)} · click to edit`, k.emoji ?? k.shape, stickerRows.rowOf.get(k))), stickerRows.rows)}
        {overlays.length > 0 && lane('Overlay', 'Pictures and clips shown over the video.', overlays.map((o) =>
          block('broll', { kind: 'broll', id: o.id }, o.t, o.t + o.duration, `${o.name} · ${fmt(o.t)}–${fmt(o.t + o.duration)} · click to edit`, o.name, overlayRows.rowOf.get(o))), overlayRows.rows)}
        {voiceovers.length > 0 && lane('Voice', 'Voiceovers made from text. Click one to change it.', voiceovers.map((v) =>
          block('voice', { kind: 'voice', id: v.id }, v.t, v.t + v.duration, `“${v.text}” · ${v.voice} · click to edit`, v.text, voiceRows.rowOf.get(v))), voiceRows.rows)}
        {music && lane('Music', 'Music under the whole video. Change it in Audio.', <div className="blk pill music" style={{ left: 0, width: '100%' }} data-info={`${music.name} · ${Math.round(music.volume * 100)}%${music.duck ? ' · quieter when you talk' : ''}`}><span>{music.name}</span></div>)}
        {zooms.length > 0 && lane('Zoom', upload ? 'Punch-ins: closer framings on the speaker.' : 'Zoom-ins you added. Automatic zoom follows your clicks on its own.', zooms.map((z) =>
          block('zoom', { kind: 'zoom', id: z.id }, z.t, z.t + z.duration, `${z.snap ? 'Punch-in' : 'Zoom'} ${z.level.toFixed(1)}× · ${fmt(z.t)}–${fmt(z.t + z.duration)} · click to edit`, `${z.level.toFixed(1)}×`)))}
        {speeds.length > 0 && lane('Speed', 'Stretches played faster or slower.', speeds.map((s, i) => (
          <div key={'s' + i} className={'blk pill speed' + on({ kind: 'speed', i }) + (editable ? '' : ' ro')} style={{ left: pct(s.start), width: w(s.start, s.end) }}
            data-item={editable ? it({ kind: 'speed', i }) : undefined} data-info={`${s.rate}× speed · ${fmt(s.start)}–${fmt(s.end)} · click to edit`}><span>{s.rate}×</span></div>)))}
        {masks.length > 0 && lane('Blur', 'Hidden areas: passwords, emails, anything private.', masks.map((m) =>
          block('mask', { kind: 'mask', id: m.id }, m.start, m.end, `${m.kind === 'blur' ? 'Blur' : 'Solid box'} · ${fmt(m.start)}–${fmt(m.end)} · click to edit`, '')))}

        {range && <div className="sel" style={{ left: pct(range[0]), width: w(range[0], range[1]) }} />}
        {range && (
          <div className="rangebar" style={floating(((out(range[0]) + out(range[1])) / 2 / total), 48)} onPointerDown={(e) => e.stopPropagation()}>
            <span className="len">{fmt(out(range[1]) - out(range[0]))}</span>
            <button data-tip="Remove this stretch · C" onClick={() => onAction('cut')}><IconScissors size={15} />Cut</button>
            {editable && <>
              <button data-tip={upload ? 'Punch in on the speaker · Z' : 'Zoom in on the cursor · Z'} onClick={() => onAction('zoom')}><IconZoomIn size={15} />Zoom</button>
              <button data-tip="Pop up words from here · T" onClick={() => onAction('text')}><IconLetterT size={15} />Text</button>
              <button data-tip="Show a picture or clip here · R" onClick={() => onAction('broll')}><IconPhoto size={15} />Overlay</button>
              <button data-tip="Add an emoji or shape · K" onClick={() => onAction('sticker')}><IconMoodSmile size={15} />Sticker</button>
              <button data-tip="Play faster · S" onClick={() => onAction('speed')}><IconPlayerTrackNext size={15} />Speed</button>
              <button data-tip="Hide something private · B" onClick={() => onAction('mask')}><IconEyeOff size={15} />Blur</button>
            </>}
            <button className="x" aria-label="Clear selection" data-tip="Clear · Esc" onClick={() => onRange(null)}><IconX size={14} /></button>
          </div>
        )}
        {snap != null && <div className="snap" style={{ left: `${(snap / total) * 100}%` }} />}
        <div className="playhead" style={{ left: pct(playhead) }} />
        {hover && <div className="ghost" style={{ left: hover.x }} />}
      </div></div>
      <div className="tl-labels">{labels.map((l) => <span key={l.name} style={l.rows > 1 ? { height: 22 * l.rows } : undefined}>{l.name}</span>)}</div>
    </div>
  )
}

export const fmt = (s: number) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), tenths = Math.floor((s % 1) * 10)
  return `${m}:${String(sec).padStart(2, '0')}.${tenths}`
}
export const fmtShort = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
