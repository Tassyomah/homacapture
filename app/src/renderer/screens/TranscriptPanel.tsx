import type { Cut, Transcript, TranscriptSegment } from '../../shared/types'
import { fmt } from './Timeline'

export type TranscribeStatus = { kind: 'idle' } | { kind: 'running'; message: string } | { kind: 'error'; message: string }

/**
 * Transcript (spec §43–44): sentences with timestamps; click one to jump there, remove one to cut it from the video
 * (edit by transcript). Removed sentences stay listed, struck through, with Restore.
 */
export function TranscriptPanel({ transcript, status, cuts, hasMic, playhead, onCreate, onSeek, onRemove, onRestore }: {
  transcript: Transcript | null; status: TranscribeStatus; cuts: Cut[]; hasMic: boolean; playhead: number
  onCreate: () => void; onSeek: (t: number) => void; onRemove: (s: TranscriptSegment) => void; onRestore: (s: TranscriptSegment) => void
}) {
  if (!hasMic) return null
  if (status.kind === 'running') return <div className="director"><div className="spinner small" /><span><b>Transcript</b> — {status.message}</span></div>
  if (!transcript) return (
    <div className="director muted">
      <b>Transcript</b> — turn speech into text for captions, chapters and edit-by-transcript. Runs on this computer; the first time downloads the speech model (about 1.5 GB).
      <button className="primary" onClick={onCreate}>Create transcript</button>
      {status.kind === 'error' && <span className="err">{status.message}</span>}
    </div>
  )
  const removed = (s: TranscriptSegment) => cuts.some(([a, b]) => a <= s.start + 0.05 && b >= s.end - 0.05)
  return (
    <div className="director transcript">
      <div className="head"><div><b>Transcript</b> <span className="hint">· {transcript.segments.length} sentences · {transcript.language} · click to jump, remove to cut</span></div></div>
      <div className="sentences">
        {transcript.segments.map((s, i) => {
          const live = playhead >= s.start && playhead < s.end
          const gone = removed(s)
          return (
            <div key={i} className={`sentence ${live ? 'live' : ''} ${gone ? 'gone' : ''}`}>
              <button className="when" onClick={() => onSeek(s.start)}>{fmt(s.start)}</button>
              <span className="text" onClick={() => onSeek(s.start)}>{s.text}</span>
              {gone ? <button onClick={() => onRestore(s)}>Restore</button> : <button onClick={() => onRemove(s)} title="Cut this sentence from the video">Remove</button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const FILLERS = /^(um+|uh+|erm*|hmm+|like|basically|actually|so|you know)[,.]?$/i

/** Filler-word stretches worth cutting (spec §42): standalone fillers and "you know". */
export function fillerRanges(tr: Transcript): { start: number; end: number; word: string }[] {
  const out: { start: number; end: number; word: string }[] = []
  for (const s of tr.segments) {
    const words = s.words
    for (let i = 0; i < words.length; i++) {
      const w = words[i].word.replace(/[“”"]/g, '')
      if (/^(um+|uh+|erm*|hmm+)[,.]?$/i.test(w)) out.push({ start: words[i].start, end: words[i].end, word: w })
      else if (/^you[,.]?$/i.test(w) && words[i + 1] && /^know[,.]?$/i.test(words[i + 1].word)) { out.push({ start: words[i].start, end: words[i + 1].end, word: 'you know' }); i++ }
      else if (FILLERS.test(w) && /^(like|basically|actually)[,.]?$/i.test(w) && i > 0 && /[,.]$/.test(words[i - 1].word)) out.push({ start: words[i].start, end: words[i].end, word: w })
    }
  }
  return out.filter((r) => r.end - r.start >= 0.12)
}
