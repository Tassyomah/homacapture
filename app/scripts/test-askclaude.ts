/** Headless checks for Ask Claude: `npx tsx scripts/test-askclaude.ts <project dir>`. No Claude call, no window. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyOps, buildBrief, type AskEdits } from '../src/renderer/askclaude'
import { parseAnswer } from '../src/main/claude'
import { defaultConfig, type Transcript, type RecordingEvents } from '../src/shared/types'

const dir = process.argv[2]
const events = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8')) as RecordingEvents
const transcript = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')) as Transcript
let n = 0, failed = 0
const ok = (cond: unknown, what: string) => { n++; if (!cond) { failed++; console.log('FAIL', what) } else console.log('ok  ', what) }
let seq = 0
const ctx = { events, transcript, playhead: 3, media: [{ file: 'media/logo.png', kind: 'image' as const }], newId: (p: string) => `${p}-${++seq}` }
const base: AskEdits = { config: { ...defaultConfig }, cuts: [[1, 1.5]], texts: [{ id: 't-a', t: 2, duration: 2, text: 'Hello', style: 'pop' }], stickers: [], overlays: [], zooms: [], voiceovers: [], speeds: [], inserts: [] }
const frozen = JSON.stringify(base)
const word = (w: string) => transcript.segments.flatMap((s) => s.words).find((x) => x.word.toLowerCase().includes(w))!

const brief = JSON.parse(buildBrief(base, ctx))
ok(brief.transcript.length === transcript.segments.length && brief.items.cuts[0].id === 'cut-0' && brief.settings.captions.allowed.includes('bold'), 'brief has transcript, ids and settings')
ok(brief.kept.rows[0][0] === 0 && brief.kept.rows[1][0] === 1.5, 'brief kept table maps source to output')
ok(!/\/Users\//.test(JSON.stringify(brief)), 'brief carries no file paths outside the project')

// 1. cut a sentence
const sub = word('subscription')
const r1 = applyOps(base, [{ op: 'addCut', start: sub.start - 2, end: sub.end }], ctx)
ok(r1.ok && r1.next.cuts.length === 2 && r1.pick?.kind === 'cut' && (r1.pick as { i: number }).i === 1, 'addCut adds one cut and selects it')
// 2. sticker on a word
const logos = word('logo')
const r2 = applyOps(base, [{ op: 'addSticker', t: logos.start, duration: 2, emoji: '🔥' }], ctx)
ok(r2.ok && r2.next.stickers.length === 1 && r2.next.stickers[0].t === Math.round(logos.start * 100) / 100 && r2.pick?.kind === 'sticker', 'addSticker at the word')
// 3. captions + key word colour
const r3 = applyOps(base, [{ op: 'setConfig', key: 'captions', value: 'bold' }, { op: 'setConfig', key: 'capHighlight', value: true }, { op: 'setConfig', key: 'capColor', value: '#ffd43b' }], ctx)
ok(r3.ok && r3.next.config.captions === 'bold' && r3.next.config.capHighlight === true && r3.next.config.capColor === '#FFD43B', 'setConfig captions bold, yellow key words')
// mixed batch: text, edit, overlay, zoom, keepRange, remove
const r4 = applyOps(base, [{ op: 'addText', t: 5, text: 'Watch this' }, { op: 'editText', id: 't-a', text: 'Hi there', color: '#FB8B73' }, { op: 'addOverlay', t: 6, file: 'media/logo.png', fit: 'full' },
  { op: 'addZoom', t: 8, duration: 2 }, { op: 'keepRange', start: 4, end: 30 }, { op: 'removeItem', kind: 'cut', id: 'cut-0' }], ctx)
ok(r4.ok && r4.next.texts.length === 2 && r4.next.texts.find((x) => x.id === 't-a')!.text === 'Hi there' && r4.next.overlays[0].fit === 'full' && r4.next.zooms[0].snap === true
  && JSON.stringify(r4.next.cuts) === JSON.stringify([[0, 4], [30, Math.round(events.videoDuration * 100) / 100]]), 'mixed batch applies every op')
ok(r4.ok && r4.lines.length === 6, 'one line per change')
// empty answer
const r5 = applyOps(base, [], ctx)
ok(r5.ok && r5.empty && r5.next === base, 'empty answer changes nothing')
// bad answers: all or nothing
const bad: [unknown, string][] = [
  [[{ op: 'deleteFiles', path: '/' }], 'unknown op'],
  [[{ op: 'addText', t: 5, text: 'fine' }, { op: 'editText', id: 'nope', text: 'x' }], 'missing id (after a good op)'],
  [[{ op: 'addCut', start: 0, end: 9999 }], 'time outside the video'],
  [[{ op: 'keepRange', start: 10, end: 10.2 }], 'keep shorter than half a second'],
  [[{ op: 'addCut', start: 0, end: events.videoDuration }], 'cut the whole video'],
  [[{ op: 'addOverlay', t: 1, file: '../../etc/passwd' }], 'file not in media'],
  [[{ op: 'setConfig', key: 'outputHeight', value: 4320 }], 'setting not allowed'],
  [[{ op: 'setConfig', key: 'captions', value: 'rainbow' }], 'bad enum value'],
  [[{ op: 'setConfig', key: 'capColor', value: 'yellow' }], 'bad colour'],
  [[{ op: 'addSticker', t: 1, emoji: 'fire' }], 'word instead of emoji'],
  [[{ op: 'addText', t: 1, text: '   ' }], 'empty text'],
  [[{ op: 'addCut', start: 'a', end: 3 }], 'not a number'],
  [[{ op: 'removeItem', kind: 'cut', id: 'cut-7' }], 'unknown cut'],
  ['not a list', 'ops not a list'],
]
for (const [ops, what] of bad) { const r = applyOps(base, ops, ctx); ok(!r.ok, `rejects: ${what}${r.ok ? '' : ` → “${r.error}”`}`) }
ok(JSON.stringify(base) === frozen, 'the original edits were never modified')

// CLI output parsing
const wrap = (o: object) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...o })
const p1 = parseAnswer(wrap({ result: '', structured_output: { summary: 'Done', ops: [{ op: 'addCut', start: 1, end: 2 }] } }))
ok(p1.ok && p1.answer.ops.length === 1, 'parses structured_output')
const p2 = parseAnswer(wrap({ result: '```json\n{"summary":"Hi","ops":[]}\n```' }))
ok(p2.ok && p2.answer.summary === 'Hi', 'parses JSON in a fenced text answer')
const p3 = parseAnswer(JSON.stringify({ type: 'result', is_error: true, result: 'Failed to authenticate: this login reached its time limit' }))
ok(!p3.ok && p3.code === 'signin', 'login error → sign in')
const p4 = parseAnswer(wrap({ result: 'Sure! I cut it.' }))
ok(!p4.ok && p4.code === 'bad', 'prose answer → nothing changes')
const p5 = parseAnswer('garbage')
ok(!p5.ok && p5.code === 'bad', 'unreadable output → nothing changes')
console.log(`\n${n - failed}/${n} passed`)
process.exit(failed ? 1 : 0)
