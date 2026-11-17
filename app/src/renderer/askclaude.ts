/**
 * Ask Claude, renderer side: the compact project brief Claude reads, and the strict check + apply of its answer.
 * All or nothing: if any operation is wrong (unknown op, missing id, time outside the video, a cut that would remove
 * everything, a file not in media/…), nothing is applied and the reason is shown. Pure functions, tested headless.
 */
import { ASK_CONFIG, ASK_OPS, type AskOp } from '../shared/askclaude'
import type { Cut, InsertClip, ManualZoom, Overlay, RecordingEvents, RenderConfig, SpeedRange, Sticker, TextPop, Transcript, Voiceover } from '../shared/types'
import { keptDuration, keptRanges, playLen, srcToOut, type Range } from '../video/ranges'

/** The parts of the editor's state Claude can read and change. */
export type AskEdits = { config: RenderConfig; cuts: Cut[]; texts: TextPop[]; stickers: Sticker[]; overlays: Overlay[]; zooms: ManualZoom[]; voiceovers: Voiceover[]; speeds: SpeedRange[]; inserts: InsertClip[] }
export interface AskCtx {
  events: RecordingEvents
  transcript: Transcript | null
  /** Source seconds. */
  playhead: number
  /** Files in <project>/media that can go over the video (pictures and clips), with their length when known. */
  media: { file: string; kind: 'image' | 'video'; duration?: number }[]
  newId: (prefix: string) => string
}
/** What to select afterwards (same shapes as the timeline's Item). */
export type AskPick = { kind: 'cut'; i: number } | { kind: 'text'; id: string } | { kind: 'sticker'; id: string } | { kind: 'broll'; id: string } | { kind: 'zoom'; id: string }
export type AskApplied<E extends AskEdits = AskEdits> = { ok: true; next: E; lines: string[]; pick: AskPick | null; empty: boolean } | { ok: false; error: string }

const r2 = (x: number) => Math.round(x * 100) / 100
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const isPic = (f: string) => /\.(png|jpe?g|webp|gif)$/i.test(f), isVid = (f: string) => /\.(mp4|webm|mov|m4v)$/i.test(f)

/** The brief: everything Claude needs to place an edit, nothing it does not (no paths outside the project, no secrets). */
export function buildBrief(e: AskEdits, ctx: AskCtx): string {
  const ev = ctx.events, kept = keptRanges(ev, e.cuts, e.speeds, e.inserts)
  let acc = 0
  const table: (number | string)[][] = []
  for (const r of kept) { table.push(r.ins ? [r2(r.start), r2(r.end), r2(acc), 'inserted clip'] : [r2(r.start), r2(r.end), r2(acc)]); acc += playLen(r) }
  const removed = (t: number) => !kept.some((r: Range) => !r.ins && t >= r.start - 0.01 && t < r.end)
  const settings: Record<string, { now: unknown; allowed: unknown }> = {}
  for (const [k, spec] of Object.entries(ASK_CONFIG)) {
    settings[k] = { now: (e.config as unknown as Record<string, unknown>)[k] ?? null,
      allowed: spec.type === 'enum' ? spec.values : spec.type === 'num' ? `number ${spec.min} to ${spec.max}` : spec.type === 'bool' ? 'true or false' : spec.type === 'color' ? '#RRGGBB' : `text up to ${spec.max} characters` }
  }
  const brief = {
    video: { durationSource: r2(ev.videoDuration), durationOutput: r2(acc), kind: ev.source === 'import' ? 'talking video (upload)' : 'screen recording',
      width: ev.display.width, height: ev.display.height, aspect: e.config.aspect, face: ev.focus ?? null },
    playhead: { source: r2(ctx.playhead), output: r2(srcToOut(kept, ctx.playhead)) },
    kept: { columns: ['sourceStart', 'sourceEnd', 'outputStart'], rows: table },
    transcript: ctx.transcript ? ctx.transcript.segments.map((s) => ({ start: r2(s.start), end: r2(s.end),
      words: s.words.map((w) => [r2(w.start), r2(w.end), w.word.trim()]),
      ...(s.words.some((w) => removed((w.start + w.end) / 2)) ? { removed: s.words.filter((w) => removed((w.start + w.end) / 2)).map((w) => r2(w.start)) } : {}) })) : null,
    items: {
      cuts: e.cuts.map((c, i) => ({ id: `cut-${i}`, start: r2(Math.min(c[0], c[1])), end: r2(Math.max(c[0], c[1])) })),
      texts: e.texts.map((x) => ({ id: x.id, t: r2(x.t), duration: r2(x.duration), text: x.text, style: x.style, ...(x.color ? { color: x.color } : {}) })),
      stickers: e.stickers.map((x) => ({ id: x.id, t: r2(x.t), duration: r2(x.duration), ...(x.emoji ? { emoji: x.emoji } : { shape: x.shape }) })),
      overlays: e.overlays.map((x) => ({ id: x.id, t: r2(x.t), duration: r2(x.duration), file: x.file, fit: x.fit })),
      zooms: e.zooms.map((x) => ({ id: x.id, t: r2(x.t), duration: r2(x.duration), level: x.level })),
      voiceovers: e.voiceovers.map((x) => ({ id: x.id, t: r2(x.t), duration: r2(x.duration), text: x.text })),
    },
    media: ctx.media.map((m) => ({ file: m.file, kind: m.kind, ...(m.duration ? { duration: r2(m.duration) } : {}) })),
    settings,
  }
  return JSON.stringify(brief)
}

class Bad extends Error {}
const need = (ok: unknown, msg: string): void => { if (!ok) throw new Bad(msg) }
const num = (v: unknown, what: string, min: number, max: number): number => {
  need(typeof v === 'number' && Number.isFinite(v), `${what} is missing or not a number`)
  need((v as number) >= min - 0.05 && (v as number) <= max + 0.05, `${what} (${v}) is outside ${r2(min)}–${r2(max)}`)
  return Math.max(min, Math.min(max, v as number))
}
const optNum = (v: unknown, what: string, min: number, max: number) => (v == null ? undefined : num(v, what, min, max))
const color = (v: unknown, what: string) => { if (v == null || v === '') return undefined; need(typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v), `${what} must look like #RRGGBB`); return (v as string).toUpperCase() }
const words = (v: unknown, what: string, max: number) => { need(typeof v === 'string' && v.trim().length > 0, `${what} is empty`); need((v as string).trim().length <= max, `${what} is too long`); return (v as string).trim() }

/** Checks every operation, then applies them all to a copy. `e` itself is never changed. */
export function applyOps<E extends AskEdits>(e: E, ops: unknown, ctx: AskCtx): AskApplied<E> {
  try {
    need(Array.isArray(ops), 'the answer has no list of changes')
    const list = ops as AskOp[]
    if (!list.length) return { ok: true, next: e, lines: [], pick: null, empty: true }
    need(list.length <= 40, 'too many changes at once')
    const ev = ctx.events, dur = ev.videoDuration, W = ev.display.width, H = ev.display.height
    const keptBefore = keptRanges(ev, e.cuts, e.speeds, e.inserts), out = (t: number) => mmss(srcToOut(keptBefore, t))
    const upload = ev.source === 'import'
    const dropCut = new Set<number>(), newCuts: Cut[] = []
    let config = { ...e.config }, texts = [...e.texts], stickers = [...e.stickers], overlays = [...e.overlays], zooms = [...e.zooms], voiceovers = [...e.voiceovers]
    const lines: string[] = []
    let pick: AskPick | null = null, newCutPick = -1
    const time = (v: unknown, what = 'time') => num(v, what, 0, dur)
    const span = (o: AskOp, max: number, dflt: number) => { const t = time(o.t); const d = o.duration == null ? dflt : num(o.duration, 'duration', 0.2, max); return { t, duration: r2(Math.max(0.2, Math.min(d, dur - t))) } }
    list.forEach((o, n) => {
      const at = `change ${n + 1} (${(o as { op?: string })?.op ?? '?'})`
      try {
        need(o && typeof o === 'object' && ASK_OPS.includes(o.op), 'unknown kind of change')
        switch (o.op) {
          case 'addCut': {
            const a = time(o.start, 'start'), b = time(o.end, 'end')
            need(b - a >= 0.1, 'the stretch to cut is empty')
            newCuts.push([r2(a), r2(b)]); if (newCutPick < 0) newCutPick = newCuts.length - 1
            lines.push(`Cut ${out(a)}–${out(b)} (${r2(b - a)} s)`); break
          }
          case 'keepRange': {
            const a = time(o.start, 'start'), b = time(o.end, 'end')
            need(b - a >= 0.5, 'the stretch to keep is shorter than half a second')
            if (a > 0.05) newCuts.push([0, r2(a)])
            if (dur - b > 0.05) newCuts.push([r2(b), r2(dur)])
            lines.push(`Kept only ${out(a)}–${out(b)}`); break
          }
          case 'addText': {
            const { t, duration } = span(o, 30, 3), id = ctx.newId('t'), style = o.style ?? 'pop'
            need(['pop', 'title', 'name', 'band'].includes(style), 'unknown text style')
            const x = optNum(o.x, 'x', 0, 1), y = optNum(o.y, 'y', 0, 1)
            const tp: TextPop = { id, t: r2(t), duration, text: words(o.text, 'text', 120), style,
              ...(style === 'pop' ? { x: x ?? 0.5, y: y ?? 0.3 } : x != null || y != null ? { x: x ?? 0.5, y: y ?? 0.3 } : {}),
              ...(o.sub ? { sub: words(o.sub, 'sub', 80) } : {}), ...(o.anim ? { anim: o.anim } : {}),
              ...(color(o.color, 'color') ? { color: color(o.color, 'color') } : {}), ...(color(o.bg, 'bg') ? { bg: color(o.bg, 'bg') } : {}) }
            need(!o.anim || ['pop', 'slide', 'type', 'slam'].includes(o.anim), 'unknown animation')
            texts.push(tp); pick ??= { kind: 'text', id }
            lines.push(`Text “${tp.text}” at ${out(t)}`); break
          }
          case 'editText': {
            need(typeof o.id === 'string' && texts.some((x) => x.id === o.id), `there is no text with id ${o.id}`)
            const patch: Partial<TextPop> = {}
            if (o.text != null) patch.text = words(o.text, 'text', 120)
            if (o.t != null) patch.t = r2(time(o.t))
            if (o.duration != null) patch.duration = r2(num(o.duration, 'duration', 0.2, 30))
            if (o.style != null) { need(['pop', 'title', 'name', 'band'].includes(o.style), 'unknown text style'); patch.style = o.style }
            if (o.anim != null) { need(['pop', 'slide', 'type', 'slam'].includes(o.anim), 'unknown animation'); patch.anim = o.anim }
            if (o.color != null) patch.color = color(o.color, 'color')
            if (o.bg != null) patch.bg = color(o.bg, 'bg')
            if (o.x != null) patch.x = num(o.x, 'x', 0, 1)
            if (o.y != null) patch.y = num(o.y, 'y', 0, 1)
            need(Object.keys(patch).length > 0, 'nothing to change on the text')
            texts = texts.map((x) => x.id === o.id ? { ...x, ...patch } : x)
            pick ??= { kind: 'text', id: o.id! }
            lines.push(`Changed the text “${texts.find((x) => x.id === o.id)!.text}”`); break
          }
          case 'addSticker': {
            const { t, duration } = span(o, 30, 2.5), id = ctx.newId('k')
            const emoji = o.emoji?.trim()
            need(!!emoji !== !!o.shape, 'a sticker needs either an emoji or a shape')
            if (emoji) need(emoji.length <= 16 && /\p{Extended_Pictographic}/u.test(emoji) && !/[A-Za-z0-9]/.test(emoji), `“${emoji}” is not an emoji`)
            if (o.shape) need(['arrow', 'star', 'sparkle', 'heart', 'burst'].includes(o.shape), 'unknown sticker shape')
            const s: Sticker = { id, t: r2(t), duration, ...(emoji ? { emoji } : { shape: o.shape }), x: optNum(o.x, 'x', 0, 1) ?? 0.5, y: optNum(o.y, 'y', 0, 1) ?? 0.35, size: optNum(o.size, 'size', 0.05, 0.8) ?? 0.22, rotate: -6 }
            stickers.push(s); pick ??= { kind: 'sticker', id }
            lines.push(`Sticker ${emoji ?? o.shape} at ${out(t)}`); break
          }
          case 'addOverlay': {
            const m = ctx.media.find((x) => x.file === o.file)
            need(m && (isPic(m.file) || isVid(m.file)), `${o.file ?? 'that file'} is not in this project's media`)
            const { t, duration } = span(o, 120, Math.min(4, m!.duration ?? 4)), id = ctx.newId('o'), fit = o.fit ?? 'card'
            need(fit === 'full' || fit === 'card', 'fit must be full or card')
            const name = m!.file.replace(/^media\//, '').replace(/\.[^.]+$/, '')
            overlays.push({ id, t: r2(t), duration, file: m!.file, kind: m!.kind, name, fit, length: m!.duration, ...(fit === 'card' ? { x: 0.5, y: 0.4, scale: 1, rotate: 0 } : {}) } as Overlay)
            pick ??= { kind: 'broll', id }
            lines.push(`${m!.kind === 'image' ? 'Picture' : 'Clip'} ${name} at ${out(t)}`); break
          }
          case 'setConfig': {
            const k = o.key ?? '', spec = ASK_CONFIG[k], v = o.value
            need(spec, `the setting ${k || '?'} cannot be changed here`)
            let val: unknown
            if (spec.type === 'enum') { need(typeof v === 'string' && spec.values.includes(v), `${k} cannot be ${JSON.stringify(v)}`); val = v }
            else if (spec.type === 'bool') { need(typeof v === 'boolean', `${k} must be true or false`); val = v }
            else if (spec.type === 'num') val = r2(num(v, k, spec.min, spec.max))
            else if (spec.type === 'color') { val = color(v, k); need(val, `${k} needs a colour`) }
            else val = words(v, k, spec.max)
            config = { ...config, [k]: val }
            lines.push(`${k} → ${String(val)}`); break
          }
          case 'addZoom': {
            const { t, duration } = span(o, 60, 2), id = ctx.newId('z')
            const at0 = ev.focus ?? [W / 2, H / 2]
            const z: ManualZoom = { id, t: r2(t), duration, x: Math.round(optNum(o.x, 'x', 0, W) ?? at0[0]), y: Math.round(optNum(o.y, 'y', 0, H) ?? at0[1]),
              level: r2(optNum(o.level, 'level', 1.05, 3) ?? (upload ? 1.3 : Math.max(1.5, config.zoom))), ...(upload ? { snap: true } : {}) }
            zooms.push(z); pick ??= { kind: 'zoom', id }
            lines.push(`Zoom ×${z.level} at ${out(t)}`); break
          }
          case 'removeItem': {
            const id = o.id ?? ''
            if (o.kind === 'cut') {
              const m = /^cut-(\d+)$/.exec(id), i = m ? Number(m[1]) : -1
              need(i >= 0 && i < e.cuts.length && !dropCut.has(i), `there is no cut ${id}`)
              dropCut.add(i); lines.push(`Brought back ${mmss(srcToOut(keptBefore, e.cuts[i][0]))} (${r2(Math.abs(e.cuts[i][1] - e.cuts[i][0]))} s)`)
            } else {
              const lists = { text: texts, sticker: stickers, overlay: overlays, zoom: zooms, voiceover: voiceovers } as const
              need(o.kind && o.kind in lists, 'removeItem needs a kind')
              const arr = lists[o.kind as keyof typeof lists] as { id: string }[]
              need(arr.some((x) => x.id === id), `there is no ${o.kind} with id ${id}`)
              if (o.kind === 'text') texts = texts.filter((x) => x.id !== id)
              if (o.kind === 'sticker') stickers = stickers.filter((x) => x.id !== id)
              if (o.kind === 'overlay') overlays = overlays.filter((x) => x.id !== id)
              if (o.kind === 'zoom') zooms = zooms.filter((x) => x.id !== id)
              if (o.kind === 'voiceover') voiceovers = voiceovers.filter((x) => x.id !== id)
              lines.push(`Removed a ${o.kind}`)
            }
            break
          }
        }
      } catch (err) { if (err instanceof Bad) throw new Bad(`${at}: ${err.message}`); throw err }
    })
    const kept = e.cuts.filter((_, i) => !dropCut.has(i))
    const cuts: Cut[] = [...kept, ...newCuts]
    need(keptDuration(ev, cuts, e.speeds, e.inserts) >= 0.5, 'those cuts would remove the whole video')
    if (!pick && newCutPick >= 0) pick = { kind: 'cut', i: kept.length + newCutPick }
    const byT = <X extends { t: number }>(xs: X[]) => [...xs].sort((a, b) => a.t - b.t)
    return { ok: true, empty: false, lines, pick,
      next: { ...e, config, cuts, texts: byT(texts), stickers: byT(stickers), overlays: byT(overlays), zooms, voiceovers } }
  } catch (err) {
    if (err instanceof Bad) return { ok: false, error: err.message }
    return { ok: false, error: `unexpected problem: ${(err as Error).message}` }
  }
}
