import type { BrandKit, Cut, ManualZoom, RecordingEvents, RenderConfig, TextPop, Transcript, TranscriptWord } from '../shared/types'
import { autoEdit } from './autoedit'

/**
 * Short templates: upload a video, pick a look and a length, and it is edited in that style. No AI generation: the
 * local transcript gives the words and their timing; everything else is rules. The strongest stretch is scored by
 * key words and how it opens; cards and hooks are the key phrases of what was said. Everything the template makes is
 * an ordinary, editable item with an id starting "tpl-", so another template (or Undo) replaces only its own work.
 */
export type TemplateId = 'steps' | 'kinetic' | 'yellow' | 'brand' | 'points' | 'calm' | 'screen'
export interface TemplateDef { id: TemplateId; name: string; line: string; forScreen?: boolean }
export const TEMPLATES: TemplateDef[] = [
  { id: 'steps', name: 'Step cards', line: 'Split screen: a card on top for each step, you below' },
  { id: 'kinetic', name: 'Kinetic hook', line: 'Huge opening words, a checklist that builds, white caption box' },
  { id: 'yellow', name: 'Yellow word', line: 'Marker headline on top, one yellow word per caption' },
  { id: 'brand', name: 'Brand pop', line: 'Outlined captions, colour bands, punch-ins and a follow card' },
  { id: 'points', name: 'Numbered points', line: 'Each point as a numbered card above your head' },
  { id: 'calm', name: 'Calm aesthetic', line: 'Soft colour, serif words, gentle fades, no punch-ins' },
  { id: 'screen', name: 'Screen + caption', line: 'Your screen framed, a headline above, one calm line below', forScreen: true },
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
function beats(units: Unit[], min: number, kept: (t: number) => boolean): { t: number; end: number; text: string }[] {
  const out: { t: number; end: number; text: string }[] = []
  const used = new Set<string>()
  let cur: TranscriptWord[] = []
  const flush = () => {
    const ws = cur.filter((w) => kept((w.start + w.end) / 2)); cur = []
    if (!ws.length) return
    const k = cardPhrase(ws, used)
    if (!k) return
    used.add(k.text.toLowerCase())
    out.push({ t: Math.max(ws[0].start, k.start - 0.4), end: ws[ws.length - 1].end, text: k.text })
  }
  for (const c of units.flatMap(clauses)) {
    cur.push(...c.words)
    if (c.end - cur[0].start >= min) flush()
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
  const after = (min: number) => beats(segs, min, kept).filter((x) => x.t > t0 + 2.2)
  const common: Partial<RenderConfig> = { aspect: '9:16', outputFps: 30, padding: 0, radius: 0, zoom: 1, voice: 'clean', captions: tr ? 'word' : 'off', capHighlight: true, capEmoji: false,
    layout: 'full', look: 'none', brightness: 1, contrast: 1, saturation: 1, transition: 'none', transitionAt: 'big', intro: false, outro: false,
    vignette: false, grain: false, bars: false, shake: false, progressBar: 'off', capColor: '#F5C36A', background: 'ink', sfx: false }

  if (id === 'steps') {
    // Hook card first (no label), then Step 1, 2… one per beat; each card stays until the next one.
    const list = [{ t: t0, end: 0, text: hook, sub: '' }, ...after(Math.max(4, lenOut / 6)).slice(0, 6).map((x, i) => ({ ...x, sub: `Step ${i + 1}` }))].filter((x) => x.text)
    list.forEach((x, i) => texts.push({ id: nid('s'), t: x.t, duration: Math.max(1, (list[i + 1]?.t ?? end) - x.t), text: x.text, sub: x.sub || undefined, style: 'step', bg: c1 }))
    return { cuts, zooms: [], texts, window: win, hook, config: { ...common, layout: 'split', background: 'paper', captions: tr ? 'word' : 'off', capColor: '#F5C36A', sfx: true } }
  }
  if (id === 'kinetic') {
    if (hook) texts.push({ id: nid('h'), t: t0, duration: 2.4, text: hook, style: 'pop', anim: 'slam', color: '#FFFFFF', x: 0.5, y: 0.4, rotate: 0, scale: 1.3, animOut: 'shrink' })
    // Checklist: up to four ticks per panel; each panel stays until its last line has been on for a while.
    const items = after(Math.max(3.5, lenOut / 8)).slice(0, 6)
    for (let g = 0; g < items.length; g += 4) {
      const group = items.slice(g, g + 4), close = Math.min(end, (items[g + 4]?.t ?? end) - 0.1, group[group.length - 1].t + 4)
      for (const x of group) texts.push({ id: nid('c'), t: x.t, duration: Math.max(0.8, close - x.t), text: x.text, style: 'check', bg: c1 })
    }
    return { cuts, zooms, texts, window: win, hook, config: { ...common, captions: tr ? 'pill' : 'off', capColor: c2, look: 'punchy', shake: true, transition: 'zoom', sfx: true } }
  }
  if (id === 'yellow') {
    // The marker headline stays on top for the whole short.
    if (hook) texts.push({ id: nid('h'), t: t0, duration: Math.max(1, end - t0), text: hook, style: 'pop', anim: 'pop', font: 'Marker Felt', color: '#FFD43B', x: 0.5, y: 0.12, rotate: -2, scale: 0.85 })
    return { cuts, zooms, texts, window: win, hook, config: { ...common, captions: tr ? 'clean' : 'off', capColor: '#FFD43B' } }
  }
  if (id === 'brand') {
    if (hook) texts.push({ id: nid('h'), t: t0, duration: 2.5, text: hook, style: 'title', anim: 'pop', x: 0.5, y: 0.2, animOut: 'fade' })
    for (const x of after(Math.max(5, lenOut / 5)).slice(0, 5)) texts.push({ id: nid('b'), t: x.t, duration: 1.8, text: x.text, style: 'band', bg: c2 })
    return { cuts, zooms, texts, window: win, hook, config: { ...common, captions: tr ? 'outline' : 'off', capColor: c2, capEmoji: true, transition: 'whip', sfx: true,
      outro: true, outroText: 'Follow for more', outroSub: brand.handle } }
  }
  if (id === 'points') {
    if (hook) texts.push({ id: nid('h'), t: t0, duration: 2.4, text: hook, style: 'title', anim: 'pop', x: 0.5, y: 0.18 })
    after(Math.max(4, lenOut / 6)).slice(0, 7).forEach((x, i, all) => texts.push({ id: nid('p'), t: x.t, duration: Math.max(1.2, Math.min(5, (all[i + 1]?.t ?? end) - x.t - 0.1)), text: x.text, sub: String(i + 1), style: 'point', bg: c1 }))
    return { cuts, zooms, texts, window: win, hook, config: { ...common, captions: tr ? 'word' : 'off', capColor: c1, sfx: true, outro: true, outroText: 'Follow for more', outroSub: brand.handle } }
  }
  if (id === 'calm') {
    if (hook) texts.push({ id: nid('h'), t: t0, duration: 3, text: hook, style: 'pop', anim: 'slide', animOut: 'fade', font: 'Georgia', color: '#FFFFFF', x: 0.5, y: 0.46, rotate: 0, scale: 0.6 })
    return { cuts, zooms: [], texts, window: win, hook, config: { ...common, captions: tr ? 'soft' : 'off', capHighlight: false, look: 'soft', grain: true, transition: 'blur', saturation: 0.92 } }
  }
  // screen: framed, cursor-following crop with click zooms; the headline above stays, one calm line under it.
  if (hook) texts.push({ id: nid('h'), t: t0, duration: Math.max(1, end - t0), text: hook, style: 'title', anim: 'slide', bg: '#EFEEE8', color: '#14140F', x: 0.5, y: 0.11 })
  return { cuts, zooms: [], texts, window: win, hook, config: { ...common, layout: 'stack', background: 'paper', radius: 28, zoom: ev.source === 'import' ? 1 : 1.6,
    captions: tr ? 'line' : 'off', capHighlight: false } }
}
