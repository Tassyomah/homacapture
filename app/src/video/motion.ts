import type { ManualZoom, RecordingEvents, RenderConfig } from '../shared/types'

/**
 * The "camera" here is the virtual viewport over the screen recording (not the webcam).
 * Scale is absolute: screen pixels × scale = frame pixels. At rest the scale is `base` (the whole screen fits the
 * frame, or — for cropping aspects like 9:16 — the frame is filled and the viewport follows the cursor).
 */
export interface CamKey { t: number; scale: number; cx: number; cy: number }
export interface Camera { scale: number; cx: number; cy: number }
/** Where the screen is shown: frame size in design pixels plus the rest scale. */
export interface Viewport { FW: number; FH: number; base: number; crop: boolean }

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Keep the viewport (FW/scale × FH/scale screen pixels around cx,cy) inside the screen. */
export function clampCenter(cx: number, cy: number, scale: number, W: number, H: number, vp: Viewport): [number, number] {
  const hw = vp.FW / (2 * scale), hh = vp.FH / (2 * scale)
  return [hw >= W / 2 ? W / 2 : clamp(cx, hw, W - hw), hh >= H / 2 ? H / 2 : clamp(cy, hh, H - hh)]
}

/** Where the viewport rests when nothing is zoomed: the screen centre, or the (slowly) followed cursor when cropping. */
export function restCenter(ev: RecordingEvents, t: number, W: number, H: number, vp: Viewport): [number, number] {
  if (!vp.crop) return [W / 2, H / 2]
  const p = smoothCursor(ev, t, 0.6) ?? ev.focus ?? [W / 2, H / 2]     // uploads have no cursor: rest on the speaker
  return clampCenter(p[0], p[1], vp.base, W, H, vp)
}

/**
 * Auto-zoom: group clicks close in time and space, zoom in before the first click,
 * pan between clicks of the group, zoom out after the last. Returns keyframes.
 */
export function buildCamera(ev: RecordingEvents, cfg: RenderConfig, vp: Viewport, zooms: ManualZoom[] = []): CamKey[] {
  const W = ev.display.width, H = ev.display.height, z = cfg.zoom
  const LEAD = 0.55, TAIL = 1.6, EASE = 0.65, GAP = 2.6, DIST = 0.33 * W
  type Pt = { t: number; x: number; y: number }
  type Group = { clicks: Pt[]; level: number; tail: number }
  const groups: Group[] = []
  if (z > 1.001) {
    const downs: Pt[] = ev.clicks.filter((c) => c.type === 'down').map((c) => ({ t: c.t - ev.t0Video, x: c.x, y: c.y }))
      .filter((c) => c.t >= 0 && c.t <= ev.videoDuration)
      // Add-on §10: a click is worth a zoom when the cursor settled on its target first. Clicks made while the cursor
      // was still travelling fast (drag-through, flicking between windows) are skipped.
      .filter((c) => { const p = rawCursor(ev, c.t - 0.35); return !p || Math.hypot(p[0] - c.x, p[1] - c.y) < 0.18 * W })
    for (const c of downs) {
      const g = groups[groups.length - 1]
      const last = g?.clicks[g.clicks.length - 1]
      if (g && last && c.t - last.t < GAP && Math.hypot(c.x - last.x, c.y - last.y) < DIST) g.clicks.push(c)
      else groups.push({ clicks: [c], level: z, tail: TAIL })
    }
  }
  // Punch-ins (snap) are hard cuts in and out, laid over everything else at the end; manual zooms (spec §26) are groups
  // of their own: hold on the target for `duration`, at their own level.
  const snaps = zooms.filter((m) => m.snap)
  for (const m of zooms.filter((x) => !x.snap)) groups.push({ clicks: [{ t: m.t, x: m.x, y: m.y }, { t: m.t + m.duration, x: m.x, y: m.y }], level: m.level, tail: 0.1 })
  groups.sort((a, b) => a.clicks[0].t - b.clicks[0].t)
  // a manual zoom wins over automatic groups that overlap it
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]; if (g.tail !== 0.1) continue
    const a = g.clicks[0].t - LEAD, b = g.clicks[g.clicks.length - 1].t + 1
    for (let k = groups.length - 1; k >= 0; k--) { const o = groups[k]; if (o !== g && o.tail !== 0.1 && o.clicks[0].t < b && o.clicks[o.clicks.length - 1].t + TAIL > a) groups.splice(k, 1) }
  }
  if (!groups.length) return withSnaps([], snaps, ev, vp)
  const rest = (t: number) => restCenter(ev, t, W, H, vp)
  const keys: CamKey[] = []
  let prevEnd = -Infinity
  for (const g of groups) {
    const zoomed = vp.base * g.level
    const first = g.clicks[0], last = g.clicks[g.clicks.length - 1]
    const start = Math.max(0, first.t - LEAD), end = Math.min(ev.videoDuration, last.t + g.tail)
    const [cx0, cy0] = clampCenter(first.x, first.y, zoomed, W, H, vp)
    // Nearby follow-up within a few seconds: pan instead of zooming out and back in (add-on §10: no rapid in/out).
    const prevKey = keys[keys.length - 1]
    const nearPrev = prevKey ? Math.hypot(prevKey.cx - cx0, prevKey.cy - cy0) < 0.3 * W : false
    if (keys.length && start > keys[keys.length - 2].t && (start - prevEnd < 0.8 || (start - prevEnd < 3.0 && nearPrev))) {
      // adjacent group: stay zoomed and pan instead of zooming out and back in
      keys.splice(-1, 1)   // drop previous zoom-out
      keys.push({ t: Math.max(keys[keys.length - 1].t + 0.05, Math.min(start + EASE, first.t)), scale: zoomed, cx: cx0, cy: cy0 })
    } else if (keys.length && start <= keys[keys.length - 1].t) {
      continue   // overlaps the previous group entirely: skip
    } else {
      const [rx, ry] = rest(start)
      keys.push({ t: start, scale: vp.base, cx: rx, cy: ry }, { t: Math.min(start + EASE, first.t), scale: zoomed, cx: cx0, cy: cy0 })
    }
    for (const c of g.clicks.slice(1)) {
      const [cx, cy] = clampCenter(c.x, c.y, zoomed, W, H, vp)
      keys.push({ t: c.t, scale: zoomed, cx, cy })
    }
    const [cxl, cyl] = clampCenter(last.x, last.y, zoomed, W, H, vp)
    const [rx, ry] = rest(end + EASE)
    keys.push({ t: Math.max(end, last.t + 0.05), scale: zoomed, cx: cxl, cy: cyl }, { t: Math.min(ev.videoDuration, end + EASE), scale: vp.base, cx: rx, cy: ry })
    prevEnd = end + EASE
  }
  return withSnaps(keys, snaps, ev, vp)
}

/** Lay punch-ins over the eased keys: inside each one the camera jumps to its framing on the first frame and back on the last. */
function withSnaps(keys: CamKey[], snaps: ManualZoom[], ev: RecordingEvents, vp: Viewport): CamKey[] {
  if (!snaps.length) return keys
  const W = ev.display.width, H = ev.display.height, J = 0.004   // less than a frame: a cut, not a move
  const inside = (t: number) => snaps.some((z) => t >= z.t && t <= z.t + z.duration)
  const out = keys.filter((k) => !inside(k.t))
  for (const z of snaps) {
    const scale = vp.base * z.level
    const [cx, cy] = clampCenter(z.x, z.y, scale, W, H, vp)
    const [r0x, r0y] = restCenter(ev, z.t, W, H, vp), [r1x, r1y] = restCenter(ev, z.t + z.duration, W, H, vp)
    out.push({ t: z.t, scale: vp.base, cx: r0x, cy: r0y }, { t: z.t + J, scale, cx, cy },
             { t: z.t + z.duration - J, scale, cx, cy }, { t: z.t + z.duration, scale: vp.base, cx: r1x, cy: r1y })
  }
  return out.sort((a, b) => a.t - b.t)
}

export function cameraAt(ev: RecordingEvents, keys: CamKey[], t: number, W: number, H: number, vp: Viewport): Camera {
  const restCam = (): Camera => { const [cx, cy] = restCenter(ev, t, W, H, vp); return { scale: vp.base, cx, cy } }
  if (!keys.length || t <= keys[0].t || t >= keys[keys.length - 1].t) return restCam()
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const p = b.t === a.t ? 1 : easeInOut((t - a.t) / (b.t - a.t))
      return { scale: a.scale + (b.scale - a.scale) * p, cx: a.cx + (b.cx - a.cx) * p, cy: a.cy + (b.cy - a.cy) * p }
    }
  }
  return restCam()
}

/** Raw cursor position at time t (relative to video start), linear between samples. */
export function rawCursor(ev: RecordingEvents, t: number): [number, number] | null {
  const m = ev.moves; if (!m.length) return null
  const T = t + ev.t0Video
  let lo = 0, hi = m.length - 1
  if (T <= m[0][0]) return [m[0][1], m[0][2]]
  if (T >= m[hi][0]) return [m[hi][1], m[hi][2]]
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (m[mid][0] <= T) lo = mid; else hi = mid }
  const a = m[lo], b = m[hi], p = (T - a[0]) / (b[0] - a[0] || 1)
  return [a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p]
}

/** Gaussian-smoothed cursor: removes hand jitter, keeps the path. Larger sigma = lazier follow. */
export function smoothCursor(ev: RecordingEvents, t: number, sigma = 0.045): [number, number] | null {
  let sx = 0, sy = 0, sw = 0
  for (let k = -3; k <= 3; k++) {
    const p = rawCursor(ev, t + k * sigma * 0.7); if (!p) continue
    const w = Math.exp(-0.5 * (k * 0.7) ** 2); sx += p[0] * w; sy += p[1] * w; sw += w
  }
  return sw ? [sx / sw, sy / sw] : null
}

export function cursorIdAt(ev: RecordingEvents, t: number): string | null {
  const T = t + ev.t0Video; let id: string | null = null
  for (const [ct, cid] of ev.cursorChanges) { if (ct <= T) id = cid; else break }
  return id ?? ev.cursorChanges[0]?.[1] ?? null
}
