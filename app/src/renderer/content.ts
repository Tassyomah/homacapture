import type { Analysis, Chapter, RecordingEvents, Transcript } from '../shared/types'
import { keptRanges, srcToOut, type Range } from '../video/ranges'
import type { Cut, InsertClip, SpeedRange } from '../shared/types'

/**
 * Text content drawn only from the recording (add-on §13 "CONTENT", §16 "do not fabricate"): a title, a description
 * and LinkedIn copy assembled from the transcript and chapters. No model, no invention — if there is no transcript,
 * there is no copy, and the UI says so.
 */
export interface Content { title: string; description: string; linkedin: string }

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…')

export function buildContent(transcript: Transcript | null, chapters: Chapter[], durationOut: number): Content | null {
  if (!transcript || !transcript.segments.length) return null
  const sentences = transcript.segments.map((s) => clean(s.text)).filter((s) => s.length > 2)
  const hook = sentences[0] ?? ''
  const closing = sentences.length > 2 ? sentences[sentences.length - 1] : ''
  const titleSource = chapters[0]?.title && !/^Section \d+$/.test(chapters[0].title) ? chapters[0].title : hook
  const title = clip(sentenceCase(titleSource.replace(/[.!?]+$/, '')), 70)
  const description = clip(sentences.slice(0, 3).join(' '), 300)
  const sections = chapters.filter((c) => !/^Section \d+$/.test(c.title)).map((c) => `• ${c.title}`)
  const mins = Math.round(durationOut / 60)
  const linkedin = [
    hook,
    '',
    sections.length ? `What's covered:\n${sections.join('\n')}` : (sentences[1] ? sentences[1] : ''),
    '',
    closing && closing !== hook ? closing : '',
    mins >= 1 ? `(${mins} min)` : '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim()
  return { title, description, linkedin }
}

/** Output seconds worth a thumbnail: chapter starts, highlight centres, scene changes — deduplicated, at most `n`. */
export function thumbnailTimes(ev: RecordingEvents, cuts: Cut[], speeds: SpeedRange[], chapters: Chapter[], highlights: [number, number][], analysis: Analysis | null, n = 4, inserts: InsertClip[] = []): number[] {
  const kept = keptRanges(ev, cuts, speeds, inserts)
  const total = kept.reduce((s, r) => s + (r.end - r.start) / r.rate, 0)
  const candidatesSrc: number[] = [
    ...highlights.map(([a, b]) => (a + b) / 2),
    ...chapters.map((c) => c.t + 1),
    ...(analysis?.signals.scenes ?? []).map(([t]) => t + 0.5),
    total > 6 ? ev.videoDuration * 0.35 : 1,
  ]
  const inKept = (t: number) => kept.some((r: Range) => t >= r.start && t <= r.end)
  const out: number[] = []
  for (const t of candidatesSrc) {
    if (!inKept(t)) continue
    const o = srcToOut(kept, t)
    if (out.every((x) => Math.abs(x - o) > 2)) out.push(o)
    if (out.length >= n) break
  }
  if (!out.length) out.push(Math.min(total / 2, 1))
  return out
}
