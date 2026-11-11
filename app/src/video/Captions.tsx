import type { CaptionStyle, Transcript, TranscriptSegment, TranscriptWord } from '../shared/types'

const FONT = 'Aeonik, Archivo, Inter, system-ui, sans-serif'
const PAPER = '#EFEEE8', INK = '#14140F', CORAL = '#FB8B73', MUSTARD = '#F5C36A'

/** The transcript segment spoken at source time t (or the one about to start within 0.2 s). */
export function segmentAt(tr: Transcript, t: number): TranscriptSegment | null {
  for (const s of tr.segments) if (t >= s.start - 0.2 && t <= s.end + 0.3) return s
  return null
}

/** A sentence split into short lines the way social captions show them: at most `max` words, breaking after punctuation. */
function chunks(words: TranscriptWord[], max: number): TranscriptWord[][] {
  const out: TranscriptWord[][] = []
  let cur: TranscriptWord[] = []
  for (const w of words) {
    cur.push(w)
    if (cur.length >= max || /[.,!?;:]$/.test(w.word.trim())) { out.push(cur); cur = [] }
  }
  if (cur.length) out.push(cur)
  return out
}

// Caption highlights: numbers, money, names mid-sentence and strong words show in mustard; a matching emoji ends the line.
const STRONG = new Set(('never always secret mistake mistakes free money best worst stop first only everything nothing biggest important truth problem ' +
  'fix hack rule rules fail failed win wins million thousand hundred billion broke rich fast easy hard simple wrong mindset strategy goal goals ' +
  'habit habits interview job salary income budget save saving love hate amazing crazy huge massive').split(' '))
const EMOJI: [RegExp, string][] = [
  [/^(money|cash|salary|income|paid|pay|rich|\$|£|€|₦)/i, '💰'], [/^(million|billion|thousand|\d)/i, '💰'], [/^(idea|ideas|tip|tips|hack|learn|learned)/i, '💡'],
  [/^(win|wins|won|success|best|goal|goals)/i, '🏆'], [/^(mistake|mistakes|wrong|fail|failed|never|stop)/i, '❌'], [/^(love|loved|heart)/i, '❤️'],
  [/^(fast|quick|quickly|time|hours|minutes|deadline)/i, '⏰'], [/^(grow|growth|growing|scale|more)/i, '📈'], [/^(ai|claude|chatgpt|robot|automation)$/i, '🤖'],
  [/^(job|work|career|interview|office|team)/i, '💼'], [/^(fire|crazy|insane|amazing|huge|massive)/i, '🔥'], [/^(think|thought|why|question)/i, '🤔'],
  [/^(secret|truth|honest|honestly)/i, '🤫'], [/^(happy|fun|funny|laugh)/i, '😂'], [/^(design|designer|build|building|app)/i, '🛠️'],
]
const COMMON = new Set('the a an and but so this that these those it it\'s its i\'m i\'ve we you they he she my our your when what why how if then there here just like'.split(' '))
const bare = (w: string) => w.trim().replace(/^[^\w$£€₦]+|[^\w%]+$/g, '')
export function isKeyWord(w: string, i: number): boolean {
  const b = bare(w), l = b.toLowerCase()
  if (!b) return false
  if (/^[$£€₦]?\d/.test(b)) return true
  if (i > 0 && /^[A-Z][a-z]{2,}/.test(b) && !COMMON.has(l)) return true
  return STRONG.has(l)
}
function emojiFor(words: TranscriptWord[]): string {
  for (const w of words) { const b = bare(w.word); if (b.length < 2 && !/\d|[$£€₦]/.test(b)) continue; for (const [re, e] of EMOJI) if (re.test(b)) return e }
  return ''
}

const easeOutBack = (p: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2 }

/**
 * Burned-in captions (spec §45), inside the safe area at the bottom of the frame.
 * - minimal: small ink pill with the sentence; bold: big sentence, spoken word in mustard.
 * - box / karaoke / one word: the CapCut-style looks, a few words at a time (box puts a flat coral block behind the
 *   spoken word, karaoke lights words up as they are said, one word shows a single big word popping in).
 */
export const Captions: React.FC<{ transcript: Transcript; t: number; style: CaptionStyle; FW: number; FH: number; portrait: boolean; highlight?: boolean; emoji?: boolean
  /** Colour of highlighted words. */ color?: string
  /** 'top' = the captions hang from the top of their box (the line under a framed screen) instead of sitting at the bottom. */ anchor?: 'bottom' | 'top' }> =
  ({ transcript, t, style, FW, FH, portrait, highlight = false, emoji = false, color, anchor = 'bottom' }) => {
  const HI = color || MUSTARD
  const key = (w: string, i: number) => highlight && isKeyWord(w, i)
  if (style === 'off') return null
  const seg = segmentAt(transcript, t)
  if (!seg) return null
  // keeps clear of player controls and platform UI; the white box sits higher, at chest height
  const bottom = Math.round(FH * (style === 'pill' ? (portrait ? 0.27 : 0.12) : portrait ? 0.16 : 0.07))
  const wrap = (child: React.ReactNode) => (
    <div style={{ position: 'absolute', left: '6%', right: '6%', ...(anchor === 'top' ? { top: 0 } : { bottom }), display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>{child}</div>)
  const emo = (ws: TranscriptWord[]) => (emoji && emojiFor(ws) ? <span style={{ textShadow: 'none', WebkitTextStroke: 0 }}>{' ' + emojiFor(ws)}</span> : null)

  // The template looks: a few words at a time, sentence case unless noted.
  if (seg.words.length && (style === 'pill' || style === 'clean' || style === 'outline' || style === 'soft' || style === 'line')) {
    const groups = chunks(seg.words, style === 'soft' || style === 'line' ? (portrait ? 6 : 9) : style === 'outline' ? 3 : 4)
    let line = groups[0]
    for (const g of groups) if (g[0].start <= t + 0.05) line = g
    const lineAge = t - line[0].start
    const idx = (w: TranscriptWord) => seg.words.indexOf(w)
    const nowOf = (i: number) => t >= line[i].start && t < (line[i + 1]?.start ?? line[i].end + 0.3)
    if (style === 'pill') {
      const fs = Math.round(FW * (portrait ? 0.056 : 0.03))
      return wrap(
        <div style={{ background: '#FFFFFF', color: INK, borderRadius: Math.round(fs * 0.5), padding: `${Math.round(fs * 0.32)}px ${Math.round(fs * 0.6)}px`, fontFamily: FONT, fontWeight: 800, fontSize: fs,
                      lineHeight: 1.2, textAlign: 'center', boxShadow: '0 10px 30px rgba(20,20,15,0.25)', maxWidth: '100%', textWrap: 'balance' as never,
                      transform: `scale(${(0.92 + 0.08 * easeOutBack(Math.min(1, lineAge / 0.14))).toFixed(3)})` }}>
          {line.map((w, i) => <span key={i} style={{ color: key(w.word, idx(w)) ? HI : undefined, opacity: t >= w.start ? 1 : 0.45 }}>{(i ? ' ' : '') + w.word.trim()}</span>)}{emo(line)}
        </div>)
    }
    if (style === 'outline') {
      const fs = Math.round(FW * (portrait ? 0.085 : 0.045))
      return wrap(
        <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: fs, lineHeight: 1.1, textAlign: 'center', textTransform: 'uppercase', color: PAPER, maxWidth: '100%', textWrap: 'balance' as never,
                      WebkitTextStroke: `${Math.max(2, Math.round(fs * 0.11))}px ${INK}`, paintOrder: 'stroke fill' as never }}>
          {line.map((w, i) => {
            const now = nowOf(i), hi = key(w.word, idx(w))
            return <span key={i} style={{ display: 'inline-block', margin: `0 ${Math.round(fs * 0.12)}px`, color: now && hi ? HI : now ? PAPER : hi ? HI : PAPER,
              transform: now ? `scale(${(1 + 0.14 * easeOutBack(Math.min(1, (t - w.start) / 0.15))).toFixed(3)})` : undefined }}>{w.word.trim()}</span>
          })}{emo(line)}
        </div>)
    }
    if (style === 'clean') {
      const fs = Math.round(FW * (portrait ? 0.066 : 0.035))
      return wrap(
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: fs, lineHeight: 1.18, textAlign: 'center', color: PAPER, maxWidth: '100%', textWrap: 'balance' as never,
                      textShadow: '0 3px 14px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.75)', opacity: Math.min(1, lineAge / 0.08) }}>
          {line.map((w, i) => <span key={i} style={{ color: key(w.word, idx(w)) ? HI : undefined }}>{(i ? ' ' : '') + w.word.trim()}</span>)}{emo(line)}
        </div>)
    }
    // soft (serif italic on video) and line (calm grey line under a framed screen): whole short lines that fade in.
    const soft = style === 'soft'
    const fs = Math.round(FW * (soft ? (portrait ? 0.056 : 0.03) : (portrait ? 0.05 : 0.028)))
    return wrap(
      <div style={{ fontFamily: soft ? 'Georgia, "Times New Roman", serif' : FONT, fontStyle: soft ? 'italic' : undefined, fontWeight: soft ? 400 : 500, fontSize: fs, lineHeight: 1.3, textAlign: 'center',
                    color: soft ? PAPER : '#55554F', maxWidth: '100%', textWrap: 'balance' as never, textShadow: soft ? '0 2px 18px rgba(0,0,0,0.45)' : undefined,
                    opacity: Math.min(1, lineAge / 0.25), transform: `translateY(${((1 - Math.min(1, lineAge / 0.25)) * 12).toFixed(1)}%)` }}>
        {line.map((w, i) => <span key={i} style={{ color: key(w.word, idx(w)) ? HI : undefined }}>{(i ? ' ' : '') + w.word.trim()}</span>)}{emo(line)}
      </div>)
  }

  if (style === 'minimal' || style === 'bold' || !seg.words.length) {
    const bold = style !== 'minimal'
    const fontSize = Math.round(FW * (bold ? (portrait ? 0.065 : 0.034) : (portrait ? 0.048 : 0.024)))
    return wrap(
      <div style={{ background: bold ? 'transparent' : 'rgba(20,20,15,0.82)', color: PAPER, borderRadius: 14, padding: bold ? 0 : `${Math.round(fontSize * 0.35)}px ${Math.round(fontSize * 0.7)}px`,
                    fontFamily: FONT, fontWeight: bold ? 800 : 600, fontSize, lineHeight: 1.25, textAlign: 'center',
                    textShadow: bold ? '0 3px 14px rgba(0,0,0,0.6), 0 0 2px rgba(0,0,0,0.8)' : undefined, maxWidth: '100%', textWrap: 'balance' as never }}>
        {seg.words.length ? seg.words.map((w, i) => {
          const now = t >= w.start && t < w.end
          return <span key={i} style={{ color: now || key(w.word, i) ? HI : undefined }}>{(i ? ' ' : '') + w.word}</span>
        }) : seg.text}{emoji && seg.words.length ? ' ' + emojiFor(seg.words) : ''}
      </div>)
  }

  const shadow = '0 3px 16px rgba(20,20,15,0.55), 0 0 2px rgba(20,20,15,0.7)'
  if (style === 'word') {
    let cur: TranscriptWord | null = null, next: TranscriptWord | null = null
    for (let i = 0; i < seg.words.length; i++) if (seg.words[i].start <= t + 0.02) { cur = seg.words[i]; next = seg.words[i + 1] ?? null }
    if (!cur || (!next && t > cur.end + 0.4)) return null
    const age = t - cur.start
    const scale = 0.7 + 0.3 * easeOutBack(Math.min(1, Math.max(0, age) / 0.16))
    const text = cur.word.trim().replace(/[.,!?;:]+$/, '').toUpperCase()
    const fontSize = Math.round(Math.min(FW * (portrait ? 0.13 : 0.075), (FW * 0.86) / Math.max(3, text.length * 0.62)))
    return wrap(
      <div style={{ transform: `scale(${scale})`, transformOrigin: '50% 70%', fontFamily: FONT, fontWeight: 900, fontSize, lineHeight: 1, letterSpacing: '-0.01em',
                    color: key(cur.word, 1) ? HI : PAPER, textShadow: shadow }}>{text}{emoji ? emojiFor([cur]) && ' ' + emojiFor([cur]) : ''}</div>)
  }

  const groups = chunks(seg.words, portrait ? 4 : 6)
  let line = groups[0]
  for (const g of groups) if (g[0].start <= t + 0.05) line = g
  const fontSize = Math.round(FW * (portrait ? 0.068 : 0.036))
  const pad = Math.round(fontSize * 0.14)
  return wrap(
    <div style={{ fontFamily: FONT, fontWeight: 900, fontSize, lineHeight: 1.18, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '-0.005em',
                  maxWidth: '100%', textWrap: 'balance' as never, color: PAPER, textShadow: style === 'karaoke' ? shadow : undefined }}>
      {line.map((w, i) => {
        const now = t >= w.start && t < (line[i + 1]?.start ?? w.end + 0.3)
        const said = t >= w.start
        if (style === 'box') return (
          <span key={i} style={{ display: 'inline-block', padding: `${pad}px ${Math.round(pad * 1.6)}px`, borderRadius: fontSize * 0.22,
            background: now ? CORAL : 'transparent', color: now ? INK : key(w.word, seg.words.indexOf(w)) ? HI : PAPER, textShadow: now ? undefined : shadow,
            transform: now ? 'scale(1.06) rotate(-1.5deg)' : undefined }}>{w.word.trim()}</span>)
        const hi = key(w.word, seg.words.indexOf(w))
        return <span key={i} style={{ color: said ? (now ? CORAL : hi ? HI : PAPER) : hi ? 'rgba(245,195,106,0.6)' : 'rgba(239,238,232,0.5)' }}>{(i ? ' ' : '') + w.word.trim()}</span>
      })}{emoji && emojiFor(line) ? <span style={{ textShadow: 'none' }}>{' ' + emojiFor(line)}</span> : null}
    </div>)
}
