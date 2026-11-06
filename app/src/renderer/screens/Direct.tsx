import { useEffect, useRef, useState } from 'react'
import { IconCopy, IconRotateClockwise2, IconTrash } from '@tabler/icons-react'

type Box = { x: number; y: number; w: number; h: number }
const near = (a: Box | null, b: Box) => !!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5
const SNAP = 0.012

/**
 * Direct editing on the preview: the sits-on-top layer that makes what is on screen touchable. Items in the composition
 * carry data-hc-item="kind:id", so this layer finds them where they actually are (animations and all), lets you click to
 * select, drag to move with centre guides, pull a corner to resize and the handle to rotate.
 */
export function Direct({ selKey, canMove, onTogglePlay, onPick, onStart, onMove, onScale, onRotate, onEdit, onDuplicate, onDelete, scaleOf, rotateOf }: {
  selKey: string | null; canMove: boolean
  /** A click on the video with nothing under it and nothing selected plays or pauses, as anyone expects. */
  onTogglePlay: () => void
  onPick: (key: string | null) => void; onStart: () => void
  onMove: (x: number, y: number) => void; onScale: (s: number) => void; onRotate: (deg: number) => void
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void
  scaleOf: () => number; rotateOf: () => number
}) {
  const layer = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  const gesture = useRef<{ kind: 'move' | 'scale' | 'rotate'; sx: number; sy: number; cx: number; cy: number; x0: number; y0: number; s0: number; r0: number; a0: number; d0: number; started: boolean } | null>(null)

  const frame = () => document.querySelector('[data-hc-frame]')?.getBoundingClientRect() ?? null
  const elOf = (key: string) => document.querySelector(`[data-hc-item="${key}"]`)
  // Follow the selected item every frame: it may be animating, playing or moved by a slider.
  useEffect(() => {
    if (!selKey) { setBox(null); return }
    let raf = 0
    const tick = () => {
      const el = elOf(selKey), L = layer.current?.getBoundingClientRect()
      if (el && L) { const r = el.getBoundingClientRect(); const b = { x: r.left - L.left, y: r.top - L.top, w: r.width, h: r.height }; setBox((o) => near(o, b) ? o : b) }
      else setBox(null)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [selKey])

  const begin = (e: React.PointerEvent, kind: 'move' | 'scale' | 'rotate', key: string) => {
    const el = elOf(key), F = frame(); if (!el || !F) return
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
    try { layer.current?.setPointerCapture(e.pointerId) } catch { /* synthetic events have no pointer */ }
    gesture.current = { kind, sx: e.clientX, sy: e.clientY, cx, cy, x0: (cx - F.left) / F.width, y0: (cy - F.top) / F.height, s0: scaleOf(), r0: rotateOf(),
      a0: Math.atan2(e.clientY - cy, e.clientX - cx), d0: Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy)), started: false }
  }
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.direct-tools')) return
    const handle = (e.target as HTMLElement).closest?.('[data-handle]')?.getAttribute('data-handle') as 'scale' | 'rotate' | undefined
    if (handle && selKey) { e.stopPropagation(); begin(e, handle, selKey); return }
    const hits = [...document.querySelectorAll('[data-hc-item]')].reverse()
    const hit = hits.find((n) => { const r = n.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom })
    const key = hit?.getAttribute('data-hc-item') ?? null
    if (!key && !selKey) { onTogglePlay(); return }
    onPick(key)
    if (key) begin(e, 'move', key)
  }
  const move = (e: React.PointerEvent) => {
    const g = gesture.current, F = frame(); if (!g || !F) return
    if (!g.started) { if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return; if (g.kind === 'move' && !canMove) { gesture.current = null; return } g.started = true; onStart() }
    if (g.kind === 'move') {
      let x = g.x0 + (e.clientX - g.sx) / F.width, y = g.y0 + (e.clientY - g.sy) / F.height
      const v = Math.abs(x - 0.5) < SNAP, h = Math.abs(y - 0.5) < SNAP
      if (v) x = 0.5; if (h) y = 0.5
      setGuides({ v, h })
      onMove(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)))
    } else if (g.kind === 'scale') onScale(Math.max(0.05, g.s0 * (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) / g.d0)))
    else {
      let deg = g.r0 + ((Math.atan2(e.clientY - g.cy, e.clientX - g.cx) - g.a0) * 180) / Math.PI
      deg = ((deg + 180) % 360 + 360) % 360 - 180
      if (Math.abs(deg) < 3) deg = 0
      onRotate(Math.round(deg))
    }
  }
  const up = () => { gesture.current = null; setGuides({ v: false, h: false }) }
  const F = frame(), L = layer.current?.getBoundingClientRect()

  return (
    <div className="direct" ref={layer} onPointerDown={down} onPointerMove={move} onPointerUp={up} onDoubleClick={() => { if (selKey) onEdit() }}>
      {F && L && guides.v && <i className="guide v" style={{ left: F.left - L.left + F.width / 2, top: F.top - L.top, height: F.height }} />}
      {F && L && guides.h && <i className="guide h" style={{ top: F.top - L.top + F.height / 2, left: F.left - L.left, width: F.width }} />}
      {box && <div className="direct-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
        {canMove && <>{['tl', 'tr', 'bl', 'br'].map((c) => <i key={c} className={'hd ' + c} data-handle="scale" />)}
          <i className="hd rot" data-handle="rotate" aria-label="Rotate"><IconRotateClockwise2 size={12} /></i></>}
        <div className="direct-tools" style={{ top: box.y < 44 ? 'calc(100% + 26px)' : -40 }}>
          <button aria-label="Duplicate" data-tip="Duplicate · Cmd+D" onClick={onDuplicate}><IconCopy size={15} /></button>
          <button aria-label="Delete" data-tip="Delete" onClick={onDelete}><IconTrash size={15} /></button>
        </div>
      </div>}
    </div>
  )
}
