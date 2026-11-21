import type { PodcastConfig, PodPerson, PodShot, PodShotKind, PodTalk } from './types'

/**
 * Podcast scenes: which shot is on screen when (source seconds on the main picture's clock).
 * Turns come from talk.json (who is talking every 0.1 s). A turn shorter than MIN_ONE (one person) or MIN_BOTH
 * (crosstalk, laughing) is too short to cut for and stays with the shot before it, so the edit never flickers.
 */
const MIN_ONE = 2.0, MIN_BOTH = 1.2

type Turn = { t: number; end: number; who: string | 'both' | null }

export function turns(talk: PodTalk): Turn[] {
  const ids = Object.keys(talk.active)
  const n = Math.max(0, ...ids.map((i) => talk.active[i].length))
  const raw: Turn[] = []
  for (let k = 0; k < n; k++) {
    const on = ids.filter((i) => talk.active[i][k] === '1')
    const who = on.length === 0 ? null : on.length === 1 ? on[0] : 'both'
    const last = raw[raw.length - 1]
    if (last && last.who === who) last.end = (k + 1) * talk.hop
    else raw.push({ t: k * talk.hop, end: (k + 1) * talk.hop, who })
  }
  // silence belongs to whoever spoke last; too-short turns fold into the previous one
  const out: Turn[] = []
  for (const r of raw) {
    const prev = out[out.length - 1]
    const short = r.who === null || (r.who === 'both' ? r.end - r.t < MIN_BOTH : r.end - r.t < MIN_ONE)
    if (prev && (short || prev.who === r.who)) { prev.end = r.end; continue }
    out.push({ ...r, who: r.who ?? (prev?.who ?? null) })
  }
  return out
}

/** The person shown first / by default: the host (Tassy). */
export const hostOf = (people: PodPerson[]) => people.find((p) => p.kind === 'host')?.id ?? people[0]?.id ?? null

export function podShots(talk: PodTalk, pc: PodcastConfig, portrait: boolean, duration?: number): PodShot[] {
  const end = duration ?? talk.duration
  const host = hostOf(talk.people)
  const pair: PodShotKind = portrait ? 'stack' : 'side'
  const base: PodShot[] = []
  if (pc.layout === 'side' || pc.layout === 'stack') base.push({ t: 0, end, shot: pc.layout === 'side' ? pair : 'stack', focus: null })
  else if (pc.layout === 'solo') base.push({ t: 0, end, shot: 'solo', focus: host })
  else {
    let focus = host
    for (const u of turns(talk)) {
      if (u.who && u.who !== 'both') focus = u.who
      const shot: PodShot = pc.layout === 'speaker' ? { t: u.t, end: u.end, shot: 'speaker', focus }
        : u.who === 'both' ? { t: u.t, end: u.end, shot: pair, focus: null } : { t: u.t, end: u.end, shot: 'solo', focus }
      const last = base[base.length - 1]
      if (last && last.shot === shot.shot && last.focus === shot.focus) last.end = shot.end
      else base.push(shot)
    }
    if (!base.length) base.push({ t: 0, end, shot: pair, focus: null })
    base[0].t = 0; base[base.length - 1].end = Math.max(base[base.length - 1].end, end)
  }
  // hand-picked shots win for their stretch
  let list = base
  for (const o of [...pc.overrides].sort((a, b) => a.t - b.t)) {
    const shot = portrait && o.shot === 'side' ? 'stack' : !portrait && o.shot === 'stack' ? 'side' : o.shot
    const next: PodShot[] = []
    for (const s of list) {
      if (s.end <= o.t || s.t >= o.end) { next.push(s); continue }
      if (s.t < o.t) next.push({ ...s, end: o.t })
      if (s.end > o.end) next.push({ ...s, t: o.end })
    }
    next.push({ ...o, shot })
    list = next.sort((a, b) => a.t - b.t)
  }
  return list
}

export function shotAt(shots: PodShot[], t: number): PodShot | null {
  let lo = 0, hi = shots.length - 1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (shots[m].end <= t) lo = m + 1; else if (shots[m].t > t) hi = m - 1; else return shots[m] }
  return shots[shots.length - 1] ?? null
}

export type Tile = { id: string; x: number; y: number; w: number; h: number; radius: number; z: number; label: boolean }

/** Where each person sits for a shot inside a W×H frame. People not in the list are hidden. */
export function tilesFor(shot: PodShot, people: PodPerson[], W: number, H: number, pc: PodcastConfig, present: (id: string) => boolean): Tile[] {
  const s = Math.min(W, H), g = Math.round(pc.gap * s), r = Math.round(pc.corner * s)
  const here = people.filter((p) => present(p.id))
  const focus = shot.focus && here.some((p) => p.id === shot.focus) ? shot.focus : here[0]?.id ?? null
  if (!here.length) return []
  if (shot.shot === 'solo' || here.length === 1) return [{ id: focus!, x: 0, y: 0, w: W, h: H, radius: 0, z: 1, label: pc.names }]
  if (shot.shot === 'speaker') {
    const others = here.filter((p) => p.id !== focus)
    const pw = Math.round(W * (W >= H ? 0.22 : 0.34)), ph = Math.round(pw * 9 / 16), m = Math.max(g, Math.round(s * 0.03))
    return [{ id: focus!, x: 0, y: 0, w: W, h: H, radius: 0, z: 1, label: pc.names },
      ...others.map((p, i) => ({ id: p.id, x: W - m - pw, y: H - m - ph - i * (ph + m), w: pw, h: ph, radius: Math.max(r, Math.round(s * 0.012)), z: 2, label: pc.names }))]
  }
  const n = here.length
  if (shot.shot === 'stack') {
    const th = Math.round((H - (n + 1) * g) / n)
    return here.map((p, i) => ({ id: p.id, x: g, y: g + i * (th + g), w: W - 2 * g, h: th, radius: g ? r : 0, z: 1, label: pc.names }))
  }
  const tw = Math.round((W - (n + 1) * g) / n), th = H - 2 * g
  return here.map((p, i) => ({ id: p.id, x: g + i * (tw + g), y: g, w: tw, h: th, radius: g ? r : 0, z: 1, label: pc.names }))
}

/** The person's video that covers source time t, if any (guests can drop and rejoin: several files). */
export function videoAt(p: PodPerson, t: number) {
  return p.videos.find((v) => t >= v.start - 0.05 && (v.end === null || t < v.end)) ?? null
}
