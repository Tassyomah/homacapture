import type { BrandKit, Cut, ManualZoom, RecordingEvents, RenderConfig, TextPop, Transcript, TranscriptWord } from '../shared/types'
import { autoEdit } from './autoedit'
import { brandIn, iconFor } from '../video/icons'

/**
 * Short templates: upload a video, pick a look and a length, and it is edited in that style. No AI generation: the
 * local transcript gives the words and their timing; everything else is rules. The strongest stretch is scored by
 * key words and how it opens; cards and hooks are the key phrases of what was said. Everything the template makes is
 * an ordinary, editable item with an id starting "tpl-", so another template (or Undo) replaces only its own work.
 */
export type TemplateId = 'steps' | 'kinetic' | 'yellow' | 'brand' | 'points' | 'calm' | 'studio' | 'screen'
export interface TemplateDef { id: TemplateId; name: string; line: string; forScreen?: boolean }
export const TEMPLATES: TemplateDef[] = [
  { id: 'steps', name: 'Step cards', line: 'A paper card on top for each step, an icon sticker and an arrow down to you' },
  { id: 'kinetic', name: 'Kinetic hook', line: 'A giant word behind you, app cards, a search bar, a checklist that ticks' },
  { id: 'yellow', name: 'Yellow word', line: 'You as a taped card on stripes, stickers and polaroids around it' },
  { id: 'brand', name: 'Brand pop', line: 'Edge-to-edge words, marquee bands, stickers and notes, outlined captions' },
  { id: 'points', name: 'Numbered points', line: 'Taped cards with hand-circled numbers, number rings and photos' },
  { id: 'calm', name: 'Calm aesthetic', line: 'Polaroids of your moments, handwritten notes, soft colour, serif words' },
  { id: 'studio', name: 'Red studio', line: 'Colour grade: a dark red room, neon behind you, a red rim light, natural skin' },
  { id: 'screen', name: 'Screen + caption', line: 'Your screen taped on paper, a headline, notes in the margins', forScreen: true },
]
export const LENGTHS: [number, string][] = [[15, '15 s'], [30, '30 s'], [60, '60 s'], [0, 'Whole']]

export interface TemplateResult { cuts: Cut[]; zooms: ManualZoom[]; texts: TextPop[]; config: Partial<RenderConfig>; window: [number, number]; hook: string }

const STOPW = new Set(('a an the and or but so if then that this these those there it its i me my we our you your he she they them their is are was were be been being am ' +
  'do does did done have has had will would can could should might must may to of in on at by for with from as about into just really very also like um uh yeah ' +
  'okay ok well than then though because while since until unless whether ever every now here what which who how when where why all any some most more much many lot lots bit thing things stuff way kind sort ' +
  'get got gotten getting go going gone went say said says tell told telling know knew think thought see seen look make made want need able try ' +
  'i\'m i\'ve i\'ll i\'d it\'s you\'re we\'re they\'re that\'s there\'s don\'t can\'t won\'t isn\'t ' +
  'notice let put take give keep come came mean means even still ever always never not no yes one ones something anything everything nothing someone people').split(' '))
const STRONG = new Set(('secret mistake mistakes free money best worst first only biggest important truth problem fix hack rule rules fail win million ' +
  'salary income budget growth strategy portfolio impact design designer ai career job interview client clients').split(' '))
const LINK = new Set('the a an of and for in to on with your my our'.split(' '))
const LEAD_BAD = /^(and|so|but|because|um|uh|like|also|then|or|which|yeah|okay|ok)\b/i
const LEAD_GOOD = /^(how|why|what|stop|if|here|this is|the (biggest|best|worst|one|secret|truth)|never|always|you (need|should|don't|can)|i (wish|learned|quit|got|made|spent))\b/i
const clean = (w: string) => w.replace(/^[^\w$£€₦%]+|[^\w%]+$/g, '')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Seconds of [a, b) that survive the cuts. */
function keptLen(cuts: Cut[], a: number, b: number): number {
  let len = b - a
  for (const [x, y] of cuts) len -= Math.max(0, Math.min(b, y) - Math.max(a, x))
  return Math.max(0, len)
}
function mergeCuts(cs: Cut[]): Cut[] {
  const s = cs.map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as Cut).filter(([a, b]) => b - a > 0.05).sort((x, y) => x[0] - y[0])
  const out: Cut[] = []
  for (const c of s) { const l = out[out.length - 1]; if (l && c[0] <= l[1] + 0.05) l[1] = Math.max(l[1], c[1]); else out.push([c[0], c[1]]) }
  return out
}

/** A run of words: a sentence or a clause. */
interface Unit { start: number; end: number; words: TranscriptWord[]; text: string }
const unit = (ws: TranscriptWord[]): Unit => ({ start: ws[0].start, end: ws[ws.length - 1].end, words: ws, text: ws.map((w) => w.word.trim()).join(' ') })
/** Real sentences from the words (the recogniser's own segments often break mid-sentence): split at . ! ?, a long pause, or 20 s. */
export function sentences(tr: Transcript): Unit[] {
  const ws = tr.segments.flatMap((s) => s.words).filter((w) => w.end > w.start).sort((a, b) => a.start - b.start)
  const out: Unit[] = []
  let cur: TranscriptWord[] = []
  ws.forEach((w, i) => {
    cur.push(w)
    const next = ws[i + 1]
    if (/[.!?]["')]*$/.test(w.word.trim()) || !next || next.start - w.end > 1.2 || w.end - cur[0].start > 20) { out.push(unit(cur)); cur = [] }
  })
  return out
}
/** Clauses of a sentence: split at , ; : (and every 12 words at most). */
function clauses(s: Unit): Unit[] {
  const out: Unit[] = []
  let cur: TranscriptWord[] = []
  s.words.forEach((w, i) => { cur.push(w); if (/[,;:.!?]["')]*$/.test(w.word.trim()) || cur.length >= 12 || i === s.words.length - 1) { out.push(unit(cur)); cur = [] } })
  return out
}

/**
 * The best short card heading in some words: 1–3 words inside one clause, no small words at either edge, scored by
 * numbers, names, strong words and word length. Null when nothing is worth a card.
 */
export function cardPhrase(ws: TranscriptWord[], used: Set<string> = new Set()): { text: string; start: number; score: number } | null {
  let best: { text: string; start: number; score: number } | null = null
  const usedWords = new Set([...used].flatMap((u) => u.split(' ')))
  const toks = ws.map((w, i) => ({ w, c: clean(w.word.trim()), stop: /[,;:.!?]["')]*$/.test(w.word.trim()), first: i === 0 }))
  const value = (c: string, first: boolean) => {
    const l = c.toLowerCase()
    if (/^[$£€₦]?\d/.test(c)) return 5
    if (!first && /^[A-Z][a-z]{2,}/.test(c) && !STOPW.has(l)) return 3.5
    if (STRONG.has(l)) return 3
    return c.length >= 8 ? 2.2 : c.length >= 6 ? 1.5 : c.length >= 4 ? 0.8 : 0.2
  }
  for (let i = 0; i < toks.length; i++) {
    for (let n = 1; n <= 3 && i + n <= toks.length; n++) {
      const g = toks.slice(i, i + n)
      if (g.slice(0, -1).some((x) => x.stop)) break                       // never across punctuation
      const edge = [g[0], g[g.length - 1]]
      if (edge.some((x) => !x.c || STOPW.has(x.c.toLowerCase()) || /ly$/i.test(x.c) || x.c.length < 3)) continue
      if (g.some((x) => !x.c)) continue
      // Inside a phrase only small linking words ("case for design", "the job market"), never verbs like "are" or "have".
      if (g.slice(1, -1).some((x) => STOPW.has(x.c.toLowerCase()) && !LINK.has(x.c.toLowerCase()))) continue
      const text = g.map((x) => x.c).join(' ')
      if (text.length > 22 || used.has(text.toLowerCase())) continue
      if (g.some((x) => x.c.length >= 5 && usedWords.has(x.c.toLowerCase()))) continue    // no near-repeats ("Explore full" after "Explore full time")
      if (/ing$/i.test(g[g.length - 1].c) && n > 1 && !/^(hunting|building|marketing|pricing|hiring|funding|branding|banking|learning|training|meeting|planning|thinking|writing|testing)$/i.test(g[g.length - 1].c)) continue
      const inner = g.reduce((s2, x) => s2 + (STOPW.has(x.c.toLowerCase()) ? -0.6 : value(x.c, x.first)), 0)
      const score = inner + (n === 2 ? 1.2 : n === 3 ? 0.6 : 0)
      if (!best || score > best.score) best = { text, start: g[0].w.start, score }
    }
  }
  return best && best.score >= 2.6 ? { ...best, text: cap(best.text) } : null
}

/** How strong a sentence is: its best card phrase, plus numbers and questions. */
function strength(s: Unit): number {
  const k = cardPhrase(s.words)
  let sc = k ? Math.min(6, k.score) : 0
  if (/\d/.test(s.text)) sc += 1.5
  if (/\?\s*$/.test(s.text.trim())) sc += 1
  return sc
}

/**
 * The strongest run of whole sentences lasting about `target` seconds after cuts. It favours an opening that sounds
 * like a hook, never starts on "and/so/but", ends on a full stop, and leans slightly early (videos tend to open strong).
 */
export function pickWindow(tr: Transcript, cuts: Cut[], target: number): [number, number] {
  const segs = sentences(tr)
  if (!segs.length) return [0, tr.duration]
  const whole = keptLen(cuts, segs[0].start, segs[segs.length - 1].end)
  if (!target || whole <= target * 1.1) return [segs[0].start, segs[segs.length - 1].end]
  let best: { sc: number; a: number; b: number } | null = null
  for (let i = 0; i < segs.length; i++) {
    let total = 0, power = 0
    for (let j = i; j < segs.length; j++) {
      total += keptLen(cuts, segs[j].start, segs[j].end)
      power += strength(segs[j])
      if (total < target * 0.85) continue                                   // too short: never a 3-second "short"
      if (total > target * 1.3 && j > i) break
      const open = segs[i].text.trim()
      let sc = power / Math.max(1, total) * 10
      if (LEAD_GOOD.test(open)) sc += 2.5
      if (LEAD_BAD.test(open)) sc -= 3
      sc -= Math.abs(total - target) / target * 4
      sc -= (i / segs.length) * 0.8
      if (!best || sc > best.sc) best = { sc, a: segs[i].start, b: segs[j].end }
      if (total >= target) break
    }
  }
  if (best) return [best.a, best.b]
  // Nothing reaches the length (a few very long sentences): the run of the right length that starts earliest.
  let total = 0
  for (let j = 0; j < segs.length; j++) { total += keptLen(cuts, segs[j].start, segs[j].end); if (total >= target * 0.85) return [segs[0].start, segs[j].end] }
  return [segs[0].start, segs[segs.length - 1].end]
}

/** The opening line as a hook: the first clause of the first sentence, at most 7 words, no dangling small words. */
export function hookLine(ws: TranscriptWord[]): string {
  const out: string[] = []
  if (ws.length <= 9) {                                                    // a short sentence is used whole, never chopped
    const line = ws.map((w) => clean(w.word.trim())).filter(Boolean)
    while (line.length > 2 && LEAD_BAD.test(line[0])) line.shift()
    return line.length ? cap(line.join(' ')) : ''
  }
  for (const w of ws) {
    const raw = w.word.trim()
    out.push(clean(raw) || raw)
    if (out.length >= 7 || /[.,!?;:]$/.test(raw)) break
  }
  while (out.length > 2 && STOPW.has(out[out.length - 1].toLowerCase())) out.pop()
  while (out.length > 2 && LEAD_BAD.test(out[0])) out.shift()
  const line = out.filter(Boolean).join(' ')
  return line ? cap(line) : ''
}

/** A file name that reads as a title ("AI vs Designer – why case studies matter"), not a camera name (IMG_5262, Screen Recording…). */
export function titleFromName(name: string | undefined): string {
  if (!name) return ''
  const t = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/\s*\(\d+\)$/, '').trim()
  if (/^(img|dsc|mov|vid|pxl|gopr|dji|screen ?recording|recording|untitled|video|clip|export|final|output)\b/i.test(t)) return ''
  const words = t.split(' ').filter((w) => /[a-z]{2,}/i.test(w))
  if (words.length < 3 || /\d{4,}/.test(t) || t.length > 60) return ''
  return t
}
/** The hook for the opening: the video's own title when it has one, else its first or strongest short sentence. */
function hookFor(ev: RecordingEvents, units: Unit[], t0: number, name?: string): string {
  const named = titleFromName(ev.originalName) || titleFromName(name)
  if (named) return named
  // The strongest short line in the first ~15 s: a whole sentence or clause of 4–9 words that reads as a claim.
  const short = (u: Unit) => u.words.length >= 4 && u.words.length <= 9 && u.text.length <= 56
  const early = [...units.filter((u) => u.start < t0 + 15), ...units.filter((u) => u.start < t0 + 15).flatMap(clauses)].filter(short)
  const rate = (u: Unit) => strength(u) + (LEAD_GOOD.test(u.text.trim()) ? 3 : 0) - (LEAD_BAD.test(u.text.trim()) ? 1 : 0) + (/[.!?]["')]*$/.test(u.text.trim()) ? 1 : 0) - (u.start - t0) * 0.05
  const pick = early.sort((x, y) => rate(y) - rate(x))[0]
  if (pick) return hookLine(pick.words)
  const first = units[0]
  return first ? hookLine(first.words) : ''
}

/** Beats of at least `min` seconds (whole clauses), each with its best phrase as a card heading; phrases never repeat. */
type Beat = { t: number; end: number; text: string; words: TranscriptWord[] }
/**
 * Beats of about `min` seconds of the FINISHED short (cut pauses don't count), split at word level and preferably at
 * punctuation, each with its best phrase as a heading (or none: it then gets a picture, not words). Phrases never repeat.
 */
function beats(units: Unit[], min: number, kept: (t: number) => boolean, len: (a: number, b: number) => number): Beat[] {
  const out: Beat[] = []
  const used = new Set<string>()
  let cur: TranscriptWord[] = []
  const flush = () => {
    const ws = cur; cur = []
    if (!ws.length) return
    const k = cardPhrase(ws, used)
    if (!k) { out.push({ t: ws[0].start, end: ws[ws.length - 1].end, text: '', words: ws }); return }
    used.add(k.text.toLowerCase())
    out.push({ t: Math.max(ws[0].start, k.start - 0.4), end: ws[ws.length - 1].end, text: k.text, words: ws })
  }
  for (const w of units.flatMap((u) => u.words)) {
    if (!kept((w.start + w.end) / 2)) continue
    cur.push(w)
    const span = len(cur[0].start, w.end)
    if (span >= min && (/[,;:.!?]["')]*$/.test(w.word.trim()) || span >= min * 1.4)) flush()
  }
  flush()
  return out
}

/**
 * Make the short. `length` 0 = the whole video. `brand` supplies the colours and handle (falls back to Homalabs).
 */
export function applyTemplate(id: TemplateId, ev: RecordingEvents, tr: Transcript | null, length: number, brand: BrandKit, name?: string): TemplateResult {
  const dur = ev.videoDuration
  const [c1, c2] = [brand.colors[0] ?? '#FB8B73', brand.colors[1] ?? '#6E71E8']
  const base = tr ? autoEdit(ev, tr) : { cuts: [] as Cut[], zooms: [] as ManualZoom[], texts: [] as TextPop[], config: {} }
  const win: [number, number] = tr ? pickWindow(tr, base.cuts, length) : [0, length ? Math.min(dur, length) : dur]
  // A connective as the very first word ("So…", "And…") is left out so the short starts on the point.
  if (tr) {
    const ws = tr.segments.flatMap((x) => x.words).filter((w) => w.start >= win[0] - 0.05).sort((x, y) => x.start - y.start)
    if (ws.length > 3 && LEAD_BAD.test(clean(ws[0].word.trim())) && /^(and|so|but|okay|ok|um|uh|yeah|also)$/i.test(clean(ws[0].word.trim()))) win[0] = ws[1].start
  }
  const a = Math.max(0, win[0] - 0.12), b = Math.min(dur, win[1] + 0.35)
  const cuts = mergeCuts([...base.cuts, ...(a > 0.05 ? [[0, a] as Cut] : []), ...(b < dur - 0.05 ? [[b, dur] as Cut] : [])])
  const kept = (t: number) => t >= a && t <= b && !cuts.some(([x, y]) => t > x && t < y)
  const segs = (tr ? sentences(tr) : []).filter((s) => s.words.some((w) => kept((w.start + w.end) / 2)))
  const firstWords = segs.length ? segs[0].words.filter((w) => kept((w.start + w.end) / 2)) : []
  const hook = hookFor(ev, segs, firstWords[0]?.start ?? a, name)
  const t0 = a                                                         // hooks and the first card are up from the very first frame
  const end = segs.length ? segs[segs.length - 1].end + 0.3 : b
  const lenOut = keptLen(cuts, a, b)
  const zooms = base.zooms.filter((z) => kept(z.t)).map((z, i) => ({ ...z, id: `tpl-z${i}` }))
  const texts: TextPop[] = []
  const nid = (k: string) => `tpl-${k}${texts.length}`
  const span = (x: number, y: number) => keptLen(cuts, x, y)
  const after = (min: number) => beats(segs, min, kept, span).filter((x) => x.t > t0 + 2.2 && x.text)
  // The object track runs on a fixed rhythm of the finished short: a slot every `gap` seconds of output, filled from the
  // words spoken in that slot (a phrase if there is one, else a picture), so the screen never goes quiet for long.
  const keptIv: [number, number][] = []
  { let c = a; for (const [x, y] of cuts) { if (y <= a || x >= b) continue; if (x > c) keptIv.push([c, Math.min(x, b)]); c = Math.max(c, y) } if (c < b) keptIv.push([c, b]) }
  const srcAt = (o: number) => { let acc = 0; for (const [x, y] of keptIv) { if (acc + (y - x) >= o) return x + (o - acc); acc += y - x } return b }
  const allWords = segs.flatMap((u) => u.words).filter((w) => kept((w.start + w.end) / 2))
  const every = (gap: number): Beat[] => {
    const used = new Set<string>(), out: Beat[] = []
    for (let o = 2.5; o < lenOut - 1.4; o += gap) {
      const s0 = srcAt(o), s1 = srcAt(o + gap)
      const ws = allWords.filter((w) => w.start >= s0 - 0.05 && w.start < s1)
      if (!ws.length) continue
      const k = cardPhrase(ws, used)
      if (k) used.add(k.text.toLowerCase())
      out.push({ t: s0, end: s1, text: k?.text ?? '', words: ws })
    }
    return out
  }
  const common: Partial<RenderConfig> = { aspect: '9:16', outputFps: 30, padding: 0, radius: 0, zoom: 1, voice: 'clean', captions: tr ? 'word' : 'off', capHighlight: true, capEmoji: false,
    layout: 'full', look: 'none', lookAmount: 0.6, brightness: 1, contrast: 1, saturation: 1, transition: 'none', transitionAt: 'big', intro: false, outro: false,
    vignette: false, grain: false, bars: false, shake: false, progressBar: 'off', capColor: '#F5C36A', background: 'ink', sfx: false }

  // A visual object for a beat, chosen by what was said: a number counts up in a ring, a named app sends a notification,
  // a question types into a search bar, a key word becomes an icon sticker, anything else a handwritten note.
  const NUMW: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100, thousand: 1000, million: 1000000 }
  const FILL = ['sparkles', 'star', 'bulb', 'heart', 'flame', 'bolt', 'thumb', 'rocket']
  type Kind = 'stat' | 'notify' | 'search' | 'sticker' | 'note' | 'photo'
  const objectFor = (bt: Beat, allow: Kind[], lastKind?: string): Partial<TextPop> & { obj: Kind } => {
    const ws = bt.words.map((w) => clean(w.word.trim())).filter(Boolean)
    const lower = ws.map((w) => w.toLowerCase())
    const ni = lower.findIndex((w, i) => (/^[$£€₦]?\d[\d,.]*/.test(w) || (NUMW[w] != null && i < lower.length - 1 && !STOPW.has(lower[i + 1]))) && !/^(one)$/.test(w))
    const want = (k: Kind) => allow.includes(k) && k !== lastKind
    if (ni >= 0 && want('stat')) {
      const raw = lower[ni], num = NUMW[raw] ?? Number(raw.replace(/[^\d.]/g, ''))
      // The unit is the next real word or two ("years", "GB", "hours a week"), never a small word like "to".
      const after = ws.slice(ni + 1, ni + 3).filter((w, k) => !STOPW.has(w.toLowerCase()) && (k === 0 || !STOPW.has(ws[ni + 1].toLowerCase())))
      const unit = (/^[$£€₦]/.test(ws[ni]) ? ws[ni][0] + ' ' : '') + (STOPW.has((ws[ni + 1] ?? '').toLowerCase()) ? '' : after.join(' '))
      if (isFinite(num) && num > 0) return { obj: 'stat', num, unit: unit.trim() || bt.text, text: bt.text }
    }
    const br = brandIn(ws)
    // Clauses of this slot, so a card quotes one whole thought, not a slice across two.
    const parts: string[] = []
    { let cur: string[] = []; for (const w of bt.words) { const r = w.word.trim(); cur.push(r); if (/[,;:.!?]["')]*$/.test(r)) { parts.push(cur.join(' ')); cur = [] } } if (cur.length) parts.push(cur.join(' ')) }
    if (br && want('notify')) {
      const line = parts.find((c) => c.toLowerCase().includes(br.name.toLowerCase())) ?? parts[0] ?? ''
      return { obj: 'notify', icon: br.icon, bg: br.color, unit: `${br.name}|${line.split(' ').slice(0, 9).join(' ')}`, text: bt.text || br.name }
    }
    const q = parts.find((c) => /\?["')]*$/.test(c)) ?? parts.find((c) => /^(how|why|what|where|which)\b/i.test(c))
    if (q && want('search')) {
      const words = q.replace(/[?.,!]+$/, '').split(' ')
      const from = Math.max(0, words.length - 6)                                   // the end of the question carries it
      return { obj: 'search', text: words.slice(from).join(' ').toLowerCase().replace(/^(and|so|but)\s+/, '') }
    }
    const icon = iconFor(lower)
    if (icon && want('sticker')) return { obj: 'sticker', icon, text: bt.text }
    if (want('photo')) return { obj: 'photo', text: bt.text }
    if (want('note') && bt.text) return { obj: 'note', text: bt.text }
    if (allow.includes('sticker') && lastKind !== 'sticker') return { obj: 'sticker', icon: icon ?? FILL[Math.round(bt.t * 7) % FILL.length], text: bt.text }
    if (allow.includes('photo')) return { obj: 'photo', text: bt.text }
    return { obj: 'sticker', icon: icon ?? FILL[Math.round(bt.t * 7) % FILL.length], text: bt.text }
  }
  /** Lay objects along the beats: never the same kind twice in a row, alternating sides, each up for `stay` seconds. */
  const lay = (list: Beat[], allow: Kind[], place: (k: Kind, i: number) => Partial<TextPop>, stay = 2.6, colors = [c1, c2, '#F5C36A']) => {
    let last: string | undefined
    list.forEach((bt, i) => {
      const o = objectFor(bt, allow, last); last = o.obj
      const next = list[i + 1]?.t ?? end
      const bg = o.obj === 'notify' ? o.bg : colors[i % colors.length]
      texts.push({ id: nid('o'), t: bt.t, duration: Math.max(1.2, Math.min(span(bt.t, next) > stay + 1.2 ? stay : 99, next - bt.t - 0.25)), style: 'object', ...o, bg, ...place(o.obj, i) } as TextPop)
    })
  }
  const side = (i: number) => (i % 2 ? 0.24 : 0.76)
  const lowPlace = (k: Kind, i: number): Partial<TextPop> =>
    k === 'notify' ? { x: 0.5, y: 0.1 } : k === 'search' ? { x: 0.5, y: 0.14 } : k === 'stat' ? { x: side(i), y: 0.6, scale: 0.82 }
    : k === 'photo' ? { x: side(i), y: 0.58, scale: 0.78, rotate: i % 2 ? -6 : 6 } : k === 'note' ? { x: side(i), y: 0.6, scale: 0.9, rotate: i % 2 ? 5 : -5 } : { x: side(i), y: 0.58, scale: 0.85, rotate: i % 2 ? 8 : -8 }

  if (id === 'steps') {
    // Paper card panel on top: hook first, then Step 1, 2… each with an icon sticker for what it is about and an arrow to you.
    const list = [{ t: t0, text: hook, sub: '', icon: undefined as string | undefined }, ...after(Math.max(4, lenOut / 6)).slice(0, 6).map((x, i) => ({ t: x.t, text: x.text, sub: `Step ${i + 1}`, icon: iconFor(x.words.map((w) => clean(w.word.trim()).toLowerCase())) ?? 'stairs' }))].filter((x) => x.text)
    list.forEach((x, i) => texts.push({ id: nid('s'), t: x.t, duration: Math.max(1, (list[i + 1]?.t ?? end) - x.t), text: x.text, sub: x.sub || undefined, icon: x.icon, style: 'step', bg: c1 }))
    // On the video below: the odd number ring, app card or polaroid when the words call for it.
    const extra = after(Math.max(6, lenOut / 4)).filter((bt) => /\d|figma|google|linkedin|microsoft|claude|chatgpt|youtube|instagram|tiktok|notion/i.test(bt.words.map((w) => w.word).join(' ')))
    lay(extra.slice(0, 3), ['stat', 'notify', 'photo'], (k, i) => (k === 'notify' ? { x: 0.5, y: 0.47, scale: 0.9 } : { x: side(i), y: 0.66, scale: 0.7 }), 2.4)
    return { cuts, zooms: [], texts, window: win, hook, config: { ...common, layout: 'split', background: 'paper', surface: 'paper', captions: tr ? 'word' : 'off', capColor: '#F5C36A', capMarker: true, sfx: true } }
  }
  if (id === 'kinetic') {
    // Giant opening words behind you (cut out on top), then a different object every beat, a checklist that builds, doodles.
    // The giant word is the hook's key word (one or two words fill the width); the full hook follows as a handwritten note.
    const big = (cardPhrase(firstWords)?.text ?? hook.split(' ').sort((p, q) => q.length - p.length)[0] ?? '').split(' ').slice(0, 2).join(' ')
    if (big) texts.push({ id: nid('h'), t: t0, duration: 2.6, text: big, style: 'object', obj: 'behind', y: 0.33, color: c2 })
    if (hook && hook.toLowerCase() !== big.toLowerCase()) texts.push({ id: nid('h'), t: t0 + 0.35, duration: 2.25, text: hook, style: 'object', obj: 'note', x: 0.5, y: 0.11, scale: 0.85, rotate: -3, bg: '#FBF8F2' })
    const list = every(2.8)
    lay(list.filter((x, i) => i % 3 !== 2 || !x.text), ['notify', 'search', 'stat', 'sticker', 'photo'], (k, i) => (k === 'notify' || k === 'search' ? lowPlace(k, i) : { ...lowPlace(k, 0), x: 0.78, y: 0.62 }), 3.2)
    const ticks = list.filter((x, i) => i % 3 === 2 && x.text)
    ticks.forEach((x, i) => texts.push({ id: nid('c'), t: x.t, duration: Math.max(0.8, Math.min(end, (ticks[ticks.length - 1]?.t ?? x.t) + 2.6) - x.t), text: x.text, style: 'check', bg: c1, x: 0.27, y: 0.46 }))
    list.filter((_, i) => i % 4 === 1).forEach((x, i) => texts.push({ id: nid('d'), t: x.t + 0.2, duration: 1.6, text: '', style: 'object', obj: 'doodle', shape: i % 2 ? 'sparkle' : 'star', x: i % 2 ? 0.14 : 0.86, y: 0.2, scale: 0.4 }))
    return { cuts, zooms, texts, window: win, hook, config: { ...common, captions: tr ? 'pill' : 'off', capColor: c2, look: 'punchy', lookAmount: 0.5, shake: true, transition: 'zoom', sfx: true } }
  }
  if (id === 'yellow') {
    // Your video as a taped card on grey stripes, the marker headline above it, stickers and notes stuck around the card.
    if (hook) texts.push({ id: nid('h'), t: t0, duration: Math.max(1, end - t0), text: hook, style: 'pop', anim: 'pop', font: 'Marker Felt', color: '#FFD43B', x: 0.5, y: 0.1, rotate: -2, scale: 0.8 })
    lay(every(3), ['sticker', 'stat', 'notify', 'note', 'search', 'photo'], (k, i) =>
      k === 'notify' || k === 'search' ? { x: 0.5, y: 0.86, scale: 0.9 } : { x: i % 2 ? 0.2 : 0.8, y: 0.34 + (i % 3) * 0.16, scale: k === 'note' ? 0.8 : k === 'photo' ? 0.66 : 0.82, rotate: i % 2 ? -10 : 10 }, 2.8, ['#FFD43B', c1, c2])
    return { cuts, zooms: [], texts, window: win, hook, config: { ...common, layout: 'card', surface: 'stripes', background: 'paper', captions: tr ? 'clean' : 'off', capColor: '#FFD43B', capMarker: true, sfx: true } }
  }
  if (id === 'brand') {
    // Loud: edge-bleed opening words, marquee bands, icon stickers with a burst, outlined captions, whip cuts.
    const big = (cardPhrase(firstWords)?.text ?? hook.split(' ').sort((p, q) => q.length - p.length)[0] ?? '').split(' ').slice(0, 2).join(' ')
    if (big) texts.push({ id: nid('h'), t: t0, duration: 2.6, text: big, style: 'object', obj: 'edge', y: 0.62, color: c1 })
    if (hook) texts.push({ id: nid('h'), t: t0 + 0.3, duration: 2.3, text: hook, style: 'object', obj: 'note', x: 0.5, y: 0.11, scale: 0.85, rotate: -3, bg: '#FBF8F2' })
    const list = every(3)
    list.forEach((bt, i) => {
      if (!bt.text && i % 3 === 1) return
      if (i % 3 === 1) texts.push({ id: nid('m'), t: bt.t, duration: 2.2, text: bt.text, style: 'object', obj: 'marquee', bg: i % 2 ? c2 : c1, y: 0.66, rotate: i % 2 ? 4 : -4 })
    })
    lay(list.filter((_, i) => i % 3 !== 1), ['sticker', 'stat', 'notify', 'search', 'note'], lowPlace, 2.4, [c2, c1, '#F5C36A'])
    return { cuts, zooms, texts, window: win, hook, config: { ...common, captions: tr ? 'outline' : 'off', capColor: c2, capEmoji: true, transition: 'whip', sfx: true,
      outro: true, outroText: 'Follow for more', outroSub: brand.handle } }
  }
  if (id === 'points') {
    // Numbered paper cards taped above your head, an icon for each point, a polaroid or number ring when it fits.
    if (hook) texts.push({ id: nid('h'), t: t0, duration: 2.4, text: hook, style: 'title', anim: 'pop', x: 0.5, y: 0.16 })
    const list = after(Math.max(4, lenOut / 6)).slice(0, 7)
    list.forEach((x, i) => texts.push({ id: nid('p'), t: x.t, duration: Math.max(1.2, Math.min(5, (list[i + 1]?.t ?? end) - x.t - 0.1)), text: x.text, sub: String(i + 1), style: 'point', bg: c1,
      icon: iconFor(x.words.map((w) => clean(w.word.trim()).toLowerCase())) ?? undefined }))
    lay(every(3.2).filter((bt) => !list.some((q) => Math.abs(q.t - bt.t) < 1.2)), ['stat', 'notify', 'photo', 'sticker'], (k, i) => (k === 'notify' ? { x: 0.5, y: 0.36, scale: 0.86 } : { x: side(i), y: 0.6, scale: 0.72, rotate: i % 2 ? -6 : 6 }), 2.4)
    return { cuts, zooms, texts, window: win, hook, config: { ...common, captions: tr ? 'word' : 'off', capColor: c1, capMarker: true, sfx: true, outro: true, outroText: 'Follow for more', outroSub: brand.handle } }
  }
  if (id === 'calm') {
    // Soft: polaroids of your own moments, handwritten notes, small sparkles; serif words, no punch-ins.
    if (hook) texts.push({ id: nid('h'), t: t0, duration: 3, text: hook, style: 'pop', anim: 'slide', animOut: 'fade', font: 'Georgia', color: '#FFFFFF', x: 0.5, y: 0.46, rotate: 0, scale: 0.6 })
    lay(every(4.2), ['photo', 'note'], (k, i) => ({ x: side(i), y: 0.6, scale: 0.72, rotate: i % 2 ? -5 : 5 }), 3.2, ['#FBF6EC', '#F3EDF9', '#FDF0EB'])
    texts.filter((x) => x.obj === 'note' || x.obj === 'photo').forEach((x, i) => texts.push({ id: nid('d'), t: x.t + 0.4, duration: Math.min(2, x.duration - 0.4), text: '', style: 'object', obj: 'doodle', shape: i % 2 ? 'heart' : 'sparkle', x: (x.x ?? 0.5) < 0.5 ? 0.42 : 0.58, y: 0.5, scale: 0.22, color: '#FFFFFF' }))
    texts.filter((x) => x.obj === 'note').forEach((x) => { x.color = '#14140F' })
    return { cuts, zooms: [], texts, window: win, hook, config: { ...common, captions: tr ? 'soft' : 'off', capHighlight: false, look: 'soft', lookAmount: 0.55, grain: true, transition: 'blur' } }
  }
  if (id === 'studio') {
    // The colour grade from the board (@thedesignerjoyce): red studio room, neon behind, rim light; calm objects in the room's colours.
    if (hook) texts.push({ id: nid('h'), t: t0 + 0.2, duration: 2.6, text: hook, style: 'object', obj: 'note', x: 0.5, y: 0.11, scale: 0.85, rotate: -3, bg: '#FBF8F2' })
    lay(every(4), ['sticker', 'photo', 'stat', 'notify', 'note'], lowPlace, 3, ['#FF6B5E', '#FBF8F2', '#F5C36A'])
    return { cuts, zooms, texts, window: win, hook, config: { ...common, look: 'redroom', lookAmount: 0.6, captions: tr ? 'clean' : 'off', capColor: '#FF8A7A', transition: 'none', sfx: true } }
  }
  // screen: the screen taped onto warm paper, a headline above, one calm line under it, notes and stickers in the margins.
  if (hook) texts.push({ id: nid('h'), t: t0, duration: Math.max(1, end - t0), text: hook, style: 'title', anim: 'slide', bg: 'transparent', color: '#14140F', x: 0.5, y: 0.1 })
  lay(every(3.6), ['sticker', 'note', 'stat', 'search'], (k, i) => (k === 'search' ? { x: 0.5, y: 0.9, scale: 0.86 } : { x: i % 2 ? 0.17 : 0.83, y: 0.24 + (i % 2) * 0.56, scale: 0.62, rotate: i % 2 ? -8 : 8 }), 3)
  return { cuts, zooms: [], texts, window: win, hook, config: { ...common, layout: 'card', surface: 'paper', background: 'paper', zoom: ev.source === 'import' ? 1 : 1.6,
    captions: tr ? 'line' : 'off', capHighlight: false } }
}
