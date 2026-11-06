import { useEffect, useRef, useState } from 'react'

type Rect = { x: number; y: number; w: number; h: number }
const RATIOS: [string, number | null][] = [['Free', null], ['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:5', 4 / 5]]
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Full-screen layer for choosing what to record: drag out an area, drag it to move it, Return to confirm, Esc to cancel. */
export function AreaPicker() {
  const [rect, setRect] = useState<Rect | null>(null)
  const [ratio, setRatio] = useState<number | null>(null)
  const drag = useRef<{ mode: 'new' | 'move'; x: number; y: number; r: Rect | null } | null>(null)
  useEffect(() => { document.documentElement.classList.add('overlay-page') }, [])
  const done = (r: Rect | null) => window.narrate.areaDone(r)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') done(null); if (e.key === 'Enter' && rect) done(rect) }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [rect])
  const shaped = (x0: number, y0: number, x1: number, y1: number): Rect => {
    let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
    if (ratio) { if (w / Math.max(1, h) > ratio) w = h * ratio; else h = w / ratio }
    return { x: x1 < x0 ? x0 - w : x0, y: y1 < y0 ? y0 - h : y0, w, h }
  }
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.area-bar')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const inside = rect && e.clientX >= rect.x && e.clientX <= rect.x + rect.w && e.clientY >= rect.y && e.clientY <= rect.y + rect.h
    drag.current = { mode: inside ? 'move' : 'new', x: e.clientX, y: e.clientY, r: rect }
    if (!inside) setRect(null)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    if (d.mode === 'new') setRect(shaped(d.x, d.y, e.clientX, e.clientY))
    else if (d.r) setRect({ ...d.r, x: clamp(d.r.x + e.clientX - d.x, 0, innerWidth - d.r.w), y: clamp(d.r.y + e.clientY - d.y, 0, innerHeight - d.r.h) })
  }
  const up = () => { drag.current = null; setRect((r) => (r && (r.w < 40 || r.h < 40) ? null : r)) }
  const pickRatio = (v: number | null) => { setRatio(v); if (v && rect) { const h = Math.min(rect.h, rect.w / v); setRect({ ...rect, w: h * v, h }) } }
  const k = window.devicePixelRatio || 1
  return (
    <div className="area-page" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      {rect ? <div className="area-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}><span>{Math.round(rect.w * k)} × {Math.round(rect.h * k)}</span></div>
        : <p className="area-hint">Drag over the part of the screen you want to record</p>}
      <div className="area-bar">
        <div className="seg">{RATIOS.map(([l, v]) => <button key={l} className={ratio === v ? 'on' : ''} onClick={() => pickRatio(v)}>{l}</button>)}</div>
        <button onClick={() => done(null)}>Cancel</button>
        <button className="primary" disabled={!rect} onClick={() => rect && done(rect)}>Use this area</button>
      </div>
    </div>
  )
}

/** A dashed line just outside the area while recording, so you can see what is in the shot. */
export function AreaFrame({ spec }: { spec: string }) {
  const [x, y, w, h] = spec.split(',').map(Number)
  useEffect(() => { document.documentElement.classList.add('overlay-page') }, [])
  return <div className="area-live" style={{ left: x - 3, top: y - 3, width: w + 6, height: h + 6 }} />
}
