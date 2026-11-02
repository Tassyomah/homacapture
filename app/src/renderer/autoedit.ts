import type { Cut, ManualZoom, RecordingEvents, RenderConfig, TextPop, Transcript, TranscriptWord } from '../shared/types'
import { fillerRanges } from './screens/TranscriptPanel'

/**
 * The automatic first edit of an uploaded talking-head video (the "content engine"): everything is an ordinary,
 * editable instruction (cuts, punch-in zooms, text pops), so the user can change any of it afterwards or ask again.
 * Ids start with "auto-" so "Auto-edit again" can replace what it made and leave the user's own additions alone.
 *
 * - Cuts: filler words and every pause longer than PAUSE, leaving a little air either side so words are never clipped.
 * - Punch-ins: every other sentence jumps to a closer framing on the speaker's face (a cut, not a zoom move), so one
 *   static shot keeps changing; long sentences change framing halfway through instead.
 * - Text pops: one key phrase per beat (numbers, names, strong words), at most one every MIN_GAP seconds; the opening
 *   line becomes a title card when it is short enough to read at a glance.
 */
const PAUSE = 0.55, AIR_BEFORE = 0.08, AIR_AFTER = 0.12, MIN_GAP = 2.8

const STOP = new Set(('a an the and or but so if then than that this these those there here it its it\'s i i\'m i\'ve i\'ll me my mine we we\'re our you you\'re your yours he she him her his they them their ' +
  'is are was were be been being am do does did done doing have has had having will would can could should may might must shall ' +
  'to of in on at by for with from up down out over under about into onto off as just really very also too only even still ' +
  'what which who whom whose when where why how all any some no not none each every both more most other such own same ' +
  'like get got go going gonna want wanna know think thing things stuff way lot lots kind sort yeah okay ok right well um uh').split(' '))
const STRONG = new Set(('never always secret mistake mistakes free money best worst stop first only everything nothing biggest ' +
  'important truth problem fix hack rule rules fail failed win wins million thousand hundred billion broke rich fast ' +
  'easy hard simple wrong wrong mindset strategy goal goals habit habits interview job salary income budget save saving').split(' '))
const clean = (w: string) => w.replace(/^[^\w$£€₦%]+|[^\w%]+$/g, '')
const isNumber = (w: string) => /^[$£€₦]?\d[\d,.]*(%|x|k|m|bn)?$/i.test(w) || /^(one|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|hundred|thousand|million)$/i.test(w)

export interface AutoEdit { cuts: Cut[]; zooms: ManualZoom[]; texts: TextPop[]; config: Partial<RenderConfig> }

export function autoEdit(ev: RecordingEvents, tr: Transcript, level = 1.28): AutoEdit {
  const dur = ev.videoDuration
  const words: TranscriptWord[] = tr.segments.flatMap((s) => s.words).filter((w) => w.end > w.start).sort((a, b) => a.start - b.start)

  // ---- cuts: fillers + pauses
  const raw: Cut[] = fillerRanges(tr).map((f) => [Math.max(0, f.start - 0.04), f.end + 0.04])
  if (words.length) {
    if (words[0].start > PAUSE) raw.push([0, words[0].start - 0.15])
    for (let i = 1; i < words.length; i++) {
      const a = words[i - 1].end + AIR_AFTER, b = words[i].start - AIR_BEFORE
      if (words[i].start - words[i - 1].end > PAUSE && b - a > 0.2) raw.push([a, b])
    }
    const last = words[words.length - 1].end + 0.35
    if (dur - last > 0.3) raw.push([last, dur])
  }
  const cuts = mergeCuts(raw)
  const kept = (t: number) => !cuts.some(([a, b]) => t > a && t < b)

  // ---- punch-ins on the face, alternating by sentence
  const [fx, fy] = ev.focus ?? [ev.display.width / 2, ev.display.height * 0.42]
  const zooms: ManualZoom[] = []
  let k = 0
  for (const s of tr.segments) {
    const len = s.end - s.start
    if (len < 1.2) continue
    const close = (k++ % 2) === 1
    if (len > 7) zooms.push({ id: `auto-z${zooms.length}`, t: s.start + len / 2, duration: len / 2, x: Math.round(fx), y: Math.round(fy), level, snap: true })
    else if (close) zooms.push({ id: `auto-z${zooms.length}`, t: s.start, duration: len, x: Math.round(fx), y: Math.round(fy), level, snap: true })
  }

  // ---- text pops
  const texts: TextPop[] = []
  tr.segments.forEach((s, si) => {
    const ws = s.words.filter((w) => kept((w.start + w.end) / 2))
    if (!ws.length) return
    const prev = texts[texts.length - 1]
    if (si === 0) {
      const line = ws.map((w) => w.word).join(' ').trim().replace(/[.,!?]+$/, '')
      if (ws.length >= 2 && ws.length <= 6 && line.length <= 32) {
        texts.push({ id: 'auto-t0', t: ws[0].start, duration: Math.min(2.6, Math.max(1.4, ws[ws.length - 1].end - ws[0].start + 0.5)), text: line, style: 'title' })
        return
      }
    }
    const pick = keyPhrase(ws)
    if (!pick) return
    if (prev && pick.start - prev.t < MIN_GAP) return
    const until = Math.min(pick.end + 1.0, s.end + 0.4)
    const duration = Math.max(1.0, Math.min(2.2, until - pick.start))
    if (prev && prev.t + prev.duration > pick.start) prev.duration = Math.max(0.6, pick.start - prev.t - 0.05)
    texts.push({ id: `auto-t${texts.length}`, t: pick.start, duration, text: pick.text, style: 'pop' })
  })

  return { cuts, zooms, texts, config: { padding: 0, radius: 0, zoom: 1, background: 'ink', captions: 'bold', voice: 'clean' } }
}

/** The most "poppable" 1–3 words of a sentence: numbers (with the word they count), names, strong words, long words. */
export function keyPhrase(ws: TranscriptWord[]): { text: string; start: number; end: number } | null {
  let best: { score: number; i: number; j: number } | null = null
  for (let i = 0; i < ws.length; i++) {
    const w = clean(ws[i].word), lw = w.toLowerCase()
    if (!w || STOP.has(lw)) continue
    let score = 0, j = i
    if (isNumber(w)) {
      const nx = ws[i + 1] && clean(ws[i + 1].word)
      const counts = !!nx && !STOP.has(nx.toLowerCase())
      if (!counts && !/\d/.test(w)) continue                                   // "one thing", "this one": not a number worth showing
      score = counts ? 7 : 5; if (counts) j = i + 1
    } else if (i > 0 && /^[A-Z][a-z]/.test(w)) score = 4.5                      // a name mid-sentence: Microsoft, Lagos…
    else if (STRONG.has(lw)) score = 3.2
    else if (w.length >= 6) score = 1 + w.length / 4
    else continue
    // pair with a neighbouring content word for a two-word phrase ("cash flow", "biggest mistake")
    if (j === i) {
      const nx = ws[i + 1] && clean(ws[i + 1].word), pv = ws[i - 1] && clean(ws[i - 1].word)
      if (nx && !STOP.has(nx.toLowerCase()) && !isNumber(nx) && nx.length >= 3) { j = i + 1; score += 0.8 }
      else if (pv && !STOP.has(pv.toLowerCase()) && pv.length >= 3 && (STRONG.has(pv.toLowerCase()) || /^[A-Z]/.test(pv) === /^[A-Z]/.test(w))) { score += 0.6; if (!best || score > best.score) best = { score, i: i - 1, j: i }; continue }
    }
    if (!best || score > best.score) best = { score, i, j }
  }
  if (!best || best.score < 2.2) return null
  const text = ws.slice(best.i, best.j + 1).map((w) => clean(w.word)).join(' ')
  if (text.length > 18) return { text: clean(ws[best.i].word), start: ws[best.i].start, end: ws[best.i].end }
  return { text, start: ws[best.i].start, end: ws[best.j].end }
}

function mergeCuts(cs: Cut[]): Cut[] {
  const s = cs.map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as Cut).filter(([a, b]) => b - a > 0.05).sort((x, y) => x[0] - y[0])
  const out: Cut[] = []
  for (const c of s) { const l = out[out.length - 1]; if (l && c[0] <= l[1] + 0.05) l[1] = Math.max(l[1], c[1]); else out.push([c[0], c[1]]) }
  return out
}
