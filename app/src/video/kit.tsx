import { Freeze, OffthreadVideo } from 'remotion'
import type { TextPop } from '../shared/types'
import { Icon } from './icons'

/**
 * The short-template element kit: visual objects built from what was said, in Tassy's scrapbook language (warm grainy
 * paper, washi tape, die-cut stickers with a white edge, Bradley Hand marks, hand-drawn doodles that draw themselves on).
 * Everything is drawn here — no generated images. Sizes are fractions of the space they sit in, so they hold at any size.
 */
type Rect = { x: number; y: number; w: number; h: number }
export const INK = '#14140F', PAPER = '#EFEEE8', CORAL = '#FB8B73', INDIGO = '#6E71E8', MUSTARD = '#F5C36A', WARM = '#F4EEE3'
export const HAND = '"Bradley Hand", "Marker Felt", cursive'
export const SANS = 'Aeonik, Archivo, Inter, system-ui, sans-serif'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const easeOutBack = (p: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2 }
const easeOut = (p: number) => 1 - (1 - clamp01(p)) ** 3
/** In and out of an item: p = 0→1 over `d` s, alpha fades over the last 0.25 s, age in seconds. */
export function life(x: TextPop, t: number, d = 0.4) {
  const age = t - x.t, left = x.t + x.duration - t
  return { age, p: clamp01(age / d), alpha: clamp01(Math.min(age / 0.06, left / 0.25)), out: clamp01(1 - left / 0.25) }
}
/** Small, steady hand-made wobble so nothing sits machine-still. */
const wobble = (age: number, seed: number, amt = 1.5) => Math.sin(age * 2.1 + seed) * amt

/** Shared SVG defs: grain noise and the die-cut white edge (dilate the shape's alpha, fill white, add a soft shadow). */
export const KitDefs: React.FC<{ scale: number }> = ({ scale }) => (
  <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
    <defs>
      <filter id="hc-diecut" x="-30%" y="-30%" width="160%" height="160%">
        <feMorphology in="SourceAlpha" operator="dilate" radius={Math.max(2, 7 * scale)} result="grow" />
        <feFlood floodColor="#ffffff" /><feComposite in2="grow" operator="in" result="edge" />
        <feGaussianBlur in="grow" stdDeviation={Math.max(2, 9 * scale)} result="blur" />
        <feOffset in="blur" dy={Math.max(2, 8 * scale)} result="off" /><feFlood floodColor="rgba(20,20,15,0.32)" /><feComposite in2="off" operator="in" result="shadow" />
        <feMerge><feMergeNode in="shadow" /><feMergeNode in="edge" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="hc-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={7} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" />
        <feComponentTransfer><feFuncA type="linear" slope="0.55" /></feComponentTransfer></filter>
    </defs>
  </svg>)

/** Warm paper: base tone, fine grain, a soft vignette. */
export const Paper: React.FC<{ r: Rect; tone?: string; radius?: number }> = ({ r, tone = WARM, radius = 0 }) => (
  <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, background: tone, borderRadius: radius, overflow: 'hidden' }}>
    <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, mixBlendMode: 'multiply', opacity: 0.35 }}><rect width="100%" height="100%" filter="url(#hc-grain)" /></svg>
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 75% at 50% 45%, rgba(0,0,0,0) 60%, rgba(60,40,20,0.16) 100%)' }} />
  </div>)

/** Grey diagonal stripes (the screen-recording backdrop from the references). */
export const Stripes: React.FC<{ r: Rect }> = ({ r }) => (
  <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, overflow: 'hidden',
    background: `repeating-linear-gradient(135deg, #D9D8D2 0 ${r.w * 0.03}px, #E6E5DF ${r.w * 0.03}px ${r.w * 0.06}px)` }}>
    <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, mixBlendMode: 'multiply', opacity: 0.25 }}><rect width="100%" height="100%" filter="url(#hc-grain)" /></svg>
  </div>)

/** A strip of washi tape: translucent, jagged torn ends, faint stripes. */
export const Tape: React.FC<{ w: number; h: number; color?: string; rotate?: number; style?: React.CSSProperties }> = ({ w, h, color = CORAL, rotate = -4, style }) => {
  const teeth = 7, zig = (side: 0 | 1) => Array.from({ length: teeth + 1 }, (_, i) => `${side ? 100 - (i % 2 ? 4 : 0) : (i % 2 ? 4 : 0)}% ${(i / teeth) * 100}%`)
  const clip = `polygon(${[...zig(0)].join(',')}, ${[...zig(1)].reverse().join(',')})`
  return <div style={{ position: 'absolute', width: w, height: h, transform: `rotate(${rotate}deg)`, clipPath: clip, opacity: 0.86,
    background: `repeating-linear-gradient(90deg, ${color} 0 ${h * 0.35}px, ${color}DD ${h * 0.35}px ${h * 0.5}px)`, boxShadow: 'inset 0 0 0 999px rgba(255,255,255,0.08)', ...style }} />
}

/** A hand-drawn mark that draws itself on: drawn twice, slightly apart, like a real pen. */
const DOODLE: Record<string, string> = {
  circle: 'M50 8 C78 6 96 26 94 50 C92 76 70 94 46 92 C20 90 4 70 7 46 C10 22 30 9 56 10',
  underline: 'M4 60 C30 52 62 66 96 54',
  arrow: 'M8 20 C30 60 55 78 86 82 M70 66 L88 82 L68 94',
  star: 'M50 6 L61 38 L95 38 L67 58 L78 92 L50 71 L22 92 L33 58 L5 38 L39 38 Z',
  sparkle: 'M50 4 C53 38 62 47 96 50 C62 53 53 62 50 96 C47 62 38 53 4 50 C38 47 47 38 50 4 Z',
  heart: 'M50 88 C22 68 6 52 8 32 C10 16 24 8 36 10 C44 12 48 18 50 24 C52 18 56 12 64 10 C76 8 90 16 92 32 C94 52 78 68 50 88 Z',
  squiggle: 'M4 50 C14 30 22 30 30 50 C38 70 46 70 54 50 C62 30 70 30 78 50 C86 70 92 66 96 56',
}
export const Doodle: React.FC<{ shape: string; size: number; p: number; color?: string; fill?: boolean; stroke?: number }> = ({ shape, size, p, color = CORAL, fill, stroke = 4.5 }) => (
  <svg viewBox="0 0 100 100" width={size} height={size} style={{ overflow: 'visible', display: 'block' }}>
    {[0, 1].map((k) => <path key={k} d={DOODLE[shape] ?? DOODLE.star} fill={fill && p >= 1 && k === 0 ? color : 'none'} stroke={color} strokeWidth={stroke - k * 1.6} strokeLinecap="round" strokeLinejoin="round"
      pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01(p * 1.15 - k * 0.15)} transform={k ? 'translate(1.2 -1) rotate(1.5 50 50)' : undefined} opacity={k ? 0.55 : 1} />)}
  </svg>)

/** Where an object sits: its own x/y if placed, else the template's default. Returns the top-left of a w×h box centred there. */
const at = (x: TextPop, S: Rect, dx: number, dy: number, w: number, h: number) => ({ left: S.x + S.w * (x.x ?? dx) - w / 2, top: S.y + S.h * (x.y ?? dy) - h / 2 })
const box = (x: TextPop, S: Rect, dx: number, dy: number, w: number, h: number, extra: React.CSSProperties = {}): React.CSSProperties =>
  ({ position: 'absolute', ...at(x, S, dx, dy, w, h), width: w, height: h, pointerEvents: 'none', ...extra })

// ---------------------------------------------------------------- objects

/** Icon sticker: a flat colour blob with the icon, die-cut white edge and shadow, springing in, with a handwritten label. */
const StickerObj: React.FC<{ x: TextPop; t: number; S: Rect }> = ({ x, t, S }) => {
  const { age, p, alpha, out } = life(x, t, 0.45)
  const sc = (x.scale ?? 1), d = S.w * 0.3 * sc
  const pop = 0.3 + 0.7 * easeOutBack(p)
  return <div style={box(x, S, 0.76, 0.3, d, d * 1.5, { opacity: alpha })}>
    <div data-hc-item={`text:${x.id}`} style={{ width: d, height: d, filter: 'url(#hc-diecut)', transform: `scale(${pop * (1 - 0.3 * out)}) rotate(${(x.rotate ?? -8) + wobble(age, x.t, 3)}deg)` }}>
      <div style={{ width: '100%', height: '100%', borderRadius: '42% 58% 50% 50% / 50% 44% 56% 50%', background: x.bg ?? CORAL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={x.icon} size={d * 0.56} color={x.color ?? INK} stroke={2} /></div></div>
    {x.text && <div style={{ display: 'flex', justifyContent: 'center', marginTop: d * 0.1, opacity: clamp01((age - 0.25) / 0.25), transform: `rotate(-4deg) translateY(${(1 - easeOut((age - 0.25) / 0.3)) * 20}%)` }}>
      {/* the label is a little paper slip, so the handwriting reads on any video */}
      <span style={{ background: '#FBF8F2', padding: `${d * 0.03}px ${d * 0.09}px`, boxShadow: '0 6px 16px rgba(20,20,15,0.25)', fontFamily: HAND, fontWeight: 700, fontSize: d * 0.17, lineHeight: 1.1, color: INK, whiteSpace: 'nowrap' }}>{x.text}</span></div>}
  </div>
}

/** Number ring: a paper card, a ring that fills, the number counting up, its unit in handwriting; taped on. */
const StatObj: React.FC<{ x: TextPop; t: number; S: Rect }> = ({ x, t, S }) => {
  const { age, p, alpha } = life(x, t, 0.4)
  const sc = x.scale ?? 1, w = S.w * 0.42 * sc, h = w * 1.12, n = x.num ?? 0
  const k = easeOut(age / 1.1)
  const shown = n >= 100 ? Math.round(n * k).toLocaleString() : Number.isInteger(n) ? String(Math.round(n * k)) : (n * k).toFixed(1)
  const R = 40, C = 2 * Math.PI * R
  return <div style={box(x, S, 0.74, 0.3, w, h, { opacity: alpha, transform: `translateY(${(1 - easeOutBack(p)) * 30}%) rotate(${(x.rotate ?? 3) + wobble(age, x.t, 0.8)}deg)` })}>
    <div data-hc-item={`text:${x.id}`} style={{ position: 'absolute', inset: 0, background: '#FBF8F2', borderRadius: w * 0.07, boxShadow: '0 18px 50px rgba(20,20,15,0.28)', overflow: 'hidden' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, mixBlendMode: 'multiply', opacity: 0.3 }}><rect width="100%" height="100%" filter="url(#hc-grain)" /></svg>
      <svg viewBox="0 0 100 100" width={w * 0.78} height={w * 0.78} style={{ position: 'absolute', left: w * 0.11, top: w * 0.08 }}>
        <circle cx={50} cy={50} r={R} fill="none" stroke="rgba(20,20,15,0.08)" strokeWidth={9} />
        <circle cx={50} cy={50} r={R} fill="none" stroke={x.bg ?? CORAL} strokeWidth={9} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - 0.78 * k)} transform="rotate(-90 50 50)" />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: w * 0.08, height: w * 0.78, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: SANS, fontWeight: 800, fontSize: w * (shown.length > 4 ? 0.17 : 0.24), color: INK, letterSpacing: '-0.03em' }}>{shown}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: w * 0.07, textAlign: 'center', fontFamily: HAND, fontWeight: 700, fontSize: w * 0.12, color: INK, transform: 'rotate(-2deg)' }}>{x.unit || x.text}</div>
    </div>
    <Tape w={w * 0.42} h={w * 0.11} color={MUSTARD} rotate={-6} style={{ left: w * 0.29, top: -w * 0.05 }} />
  </div>
}

/** Search bar: drops in, types the words with a blinking caret, then the button pulses. */
const SearchObj: React.FC<{ x: TextPop; t: number; S: Rect }> = ({ x, t, S }) => {
  const { age, p, alpha } = life(x, t, 0.35)
  const w = S.w * 0.84 * (x.scale ?? 1), h = w * 0.16
  const typed = x.text.slice(0, Math.max(0, Math.ceil(x.text.length * clamp01((age - 0.3) / Math.min(1.2, 0.06 * x.text.length)))))
  const done = typed.length >= x.text.length
  return <div style={box(x, S, 0.5, 0.2, w, h, { opacity: alpha, transform: `translateY(${(1 - easeOutBack(p)) * -60}%) rotate(${x.rotate ?? -1}deg)` })}>
    <div data-hc-item={`text:${x.id}`} style={{ position: 'absolute', inset: 0, background: '#fff', borderRadius: h, boxShadow: '0 16px 40px rgba(20,20,15,0.28)', display: 'flex', alignItems: 'center', gap: h * 0.28, padding: `0 ${h * 0.18}px 0 ${h * 0.36}px` }}>
      <Icon name="search" size={h * 0.44} color="#8A8A82" stroke={2.2} />
      <span style={{ flex: 1, fontFamily: SANS, fontWeight: 500, fontSize: h * 0.36, color: INK, whiteSpace: 'nowrap', overflow: 'hidden' }}>{typed}
        <span style={{ display: 'inline-block', width: h * 0.04, height: h * 0.42, background: CORAL, marginLeft: h * 0.04, verticalAlign: 'middle', opacity: Math.floor(age * 2.4) % 2 || !done ? 1 : 0 }} /></span>
      <span style={{ height: h * 0.72, padding: `0 ${h * 0.34}px`, borderRadius: h, background: x.bg ?? CORAL, display: 'flex', alignItems: 'center', fontFamily: SANS, fontWeight: 700, fontSize: h * 0.3, color: INK,
        transform: `scale(${done ? 1 + 0.08 * Math.max(0, Math.sin((age - 1) * 9)) * clamp01(1.6 - age + 1) : 1})` }}>Search</span>
    </div>
  </div>
}

/** Notification card from the app that was named: slides down from the top with a spring. */
const NotifyObj: React.FC<{ x: TextPop; t: number; S: Rect }> = ({ x, t, S }) => {
  const { age, p, alpha } = life(x, t, 0.5)
  const w = S.w * 0.88 * (x.scale ?? 1), h = w * 0.24
  const [app, ...rest] = (x.unit ?? 'Message').split('|')
  return <div style={box(x, S, 0.5, 0.11, w, h, { opacity: alpha, transform: `translateY(${(1 - easeOutBack(p)) * -140}%) rotate(${x.rotate ?? 0}deg)` })}>
    <div data-hc-item={`text:${x.id}`} style={{ position: 'absolute', inset: 0, background: 'rgba(250,249,246,0.95)', borderRadius: h * 0.28, boxShadow: '0 18px 46px rgba(20,20,15,0.3)', display: 'flex', alignItems: 'center', gap: h * 0.2, padding: `0 ${h * 0.2}px` }}>
      <div style={{ flex: 'none', width: h * 0.56, height: h * 0.56, borderRadius: h * 0.15, background: x.bg ?? INDIGO, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={x.icon} size={h * 0.34} color="#fff" stroke={2} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: SANS, fontSize: h * 0.15, color: '#77776F', fontWeight: 500 }}><span>{app.toUpperCase()}</span><span>now</span></div>
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: h * 0.21, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: h * 0.03 }}>{x.text}</div>
        {rest.length > 0 && <div style={{ fontFamily: SANS, fontSize: h * 0.16, color: '#55554F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rest.join('|')}</div>}
      </div>
    </div>
  </div>
}

/** Taped paper note in handwriting, with a small doodle that draws on. */
const NoteObj: React.FC<{ x: TextPop; t: number; S: Rect }> = ({ x, t, S }) => {
  const { age, p, alpha } = life(x, t, 0.4)
  const w = S.w * 0.52 * (x.scale ?? 1), fs = w * (x.text.length > 18 ? 0.11 : 0.14)
  return <div style={box(x, S, 0.3, 0.26, w, w * 0.62, { opacity: alpha, transform: `scale(${0.6 + 0.4 * easeOutBack(p)}) rotate(${(x.rotate ?? -5) + wobble(age, x.t, 0.7)}deg)` })}>
    <div data-hc-item={`text:${x.id}`} style={{ position: 'absolute', inset: 0, background: x.bg ?? '#FFF4CF', boxShadow: '0 14px 34px rgba(20,20,15,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: w * 0.08, overflow: 'hidden' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, mixBlendMode: 'multiply', opacity: 0.3 }}><rect width="100%" height="100%" filter="url(#hc-grain)" /></svg>
      <span style={{ position: 'relative', fontFamily: HAND, fontWeight: 700, fontSize: fs, lineHeight: 1.1, color: x.color ?? INK, textAlign: 'center', textWrap: 'balance' as never }}>{x.text}</span>
    </div>
    <Tape w={w * 0.36} h={w * 0.12} color={INDIGO} rotate={4} style={{ left: w * 0.32, top: -w * 0.06 }} />
    <div style={{ position: 'absolute', right: -w * 0.1, bottom: -w * 0.1 }}><Doodle shape={x.shape ?? 'sparkle'} size={w * 0.26} p={(age - 0.3) / 0.5} color={CORAL} fill /></div>
  </div>
}

/** Polaroid of this very moment of the video (a frozen frame), taped on, handwritten caption. */
const PhotoObj: React.FC<{ x: TextPop; t: number; S: Rect; screen: string; fps: number; pos: string }> = ({ x, t, S, screen, fps, pos }) => {
  const { age, p, alpha } = life(x, t, 0.45)
  const w = S.w * 0.5 * (x.scale ?? 1), m = w * 0.06
  return <div style={box(x, S, 0.7, 0.3, w, w * 1.18, { opacity: alpha, transform: `translateY(${(1 - easeOut(p)) * 40}%) rotate(${(x.rotate ?? 6) * (0.4 + 0.6 * easeOutBack(p))}deg)` })}>
    <div data-hc-item={`text:${x.id}`} style={{ position: 'absolute', inset: 0, background: '#FDFCF8', boxShadow: '0 20px 50px rgba(20,20,15,0.32)', padding: m }}>
      <div style={{ width: w - 2 * m, height: w - 2 * m, overflow: 'hidden', background: INK }}>
        <Freeze frame={0}><OffthreadVideo src={screen} muted startFrom={Math.round(x.t * fps)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: pos, filter: 'saturate(1.08) contrast(1.04)' }} /></Freeze></div>
      <div style={{ height: w * 1.18 - (w - 2 * m) - 2 * m, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HAND, fontWeight: 700, fontSize: w * 0.1, color: INK, whiteSpace: 'nowrap', overflow: 'hidden' }}>{x.text}</div>
    </div>
    <Tape w={w * 0.4} h={w * 0.12} color={MUSTARD} rotate={-8} style={{ left: -w * 0.08, top: -w * 0.03 }} />
  </div>
}

/** Huge words bleeding off the side of the frame, drifting slowly. Used on its own or (with the cut-out) behind the speaker. */
export const EdgeWords: React.FC<{ x: TextPop; t: number; S: Rect; behind?: boolean }> = ({ x, t, S, behind }) => {
  const { age, p, alpha } = life(x, t, 0.35)
  // Sized so the words just fill the width (a touch of bleed), then they drift slowly sideways.
  const fs = Math.min(S.w * (behind ? 0.34 : 0.3), (S.w * 1.08) / Math.max(1, x.text.length * 0.6)) * (x.scale ?? 1)
  return <div style={{ position: 'absolute', left: S.x, top: S.y + S.h * (x.y ?? (behind ? 0.3 : 0.62)) - fs * 0.5, width: S.w, height: fs * 1.1, overflow: 'hidden', pointerEvents: 'none', opacity: alpha }}>
    <div data-hc-item={`text:${x.id}`} style={{ position: 'absolute', whiteSpace: 'nowrap', left: 0, top: 0, fontFamily: SANS, fontWeight: 900, fontSize: fs, lineHeight: 1, letterSpacing: '-0.04em', textTransform: 'uppercase',
      color: x.color ?? (behind ? PAPER : CORAL), transform: `translateX(${(-0.03 - age * 0.02) * S.w + (1 - easeOut(p)) * S.w * 0.5}px)`, textShadow: behind ? undefined : '0 6px 30px rgba(20,20,15,0.25)' }}>{x.text}</div>
  </div>
}

/** Tilted marquee band, the words repeating with a sparkle between. */
const MarqueeObj: React.FC<{ x: TextPop; t: number; S: Rect }> = ({ x, t, S }) => {
  const { age, p, alpha } = life(x, t, 0.3)
  const h = S.w * 0.13 * (x.scale ?? 1), fs = h * 0.5
  const unit = `${x.text.toUpperCase()}  ✦  `
  return <div style={{ position: 'absolute', left: S.x - S.w * 0.1, width: S.w * 1.2, top: S.y + S.h * (x.y ?? 0.64) - h / 2, height: h, pointerEvents: 'none', opacity: alpha,
    transform: `rotate(${x.rotate ?? -5}deg) scaleX(${0.2 + 0.8 * easeOut(p)})`, background: x.bg ?? INDIGO, overflow: 'hidden', display: 'flex', alignItems: 'center', boxShadow: '0 10px 30px rgba(20,20,15,0.25)' }}>
    <div data-hc-item={`text:${x.id}`} style={{ whiteSpace: 'nowrap', fontFamily: SANS, fontWeight: 900, fontSize: fs, color: x.color ?? PAPER, letterSpacing: '0.01em', transform: `translateX(${-((age * S.w * 0.18) % (S.w * 0.9))}px)` }}>{unit.repeat(8)}</div>
  </div>
}

/** A hand-drawn mark on its own: circle, underline, arrow, star… drawn on at its place. */
const DoodleObj: React.FC<{ x: TextPop; t: number; S: Rect }> = ({ x, t, S }) => {
  const { age, alpha } = life(x, t, 0.5)
  const d = S.w * 0.36 * (x.scale ?? 1)
  return <div style={box(x, S, 0.5, 0.36, d, d, { opacity: alpha, transform: `rotate(${x.rotate ?? 0}deg)` })}>
    <div data-hc-item={`text:${x.id}`}><Doodle shape={x.shape ?? 'circle'} size={d} p={age / 0.55} color={x.color ?? CORAL} stroke={3.4} /></div>
  </div>
}

export const KitObject: React.FC<{ x: TextPop; t: number; S: Rect; screen: string; fps: number; pos: string; hasCutout: boolean }> = ({ x, t, S, screen, fps, pos, hasCutout }) => {
  switch (x.obj) {
    case 'sticker': return <StickerObj x={x} t={t} S={S} />
    case 'stat': return <StatObj x={x} t={t} S={S} />
    case 'search': return <SearchObj x={x} t={t} S={S} />
    case 'notify': return <NotifyObj x={x} t={t} S={S} />
    case 'note': return <NoteObj x={x} t={t} S={S} />
    case 'photo': return <PhotoObj x={x} t={t} S={S} screen={screen} fps={fps} pos={pos} />
    case 'marquee': return <MarqueeObj x={x} t={t} S={S} />
    case 'doodle': return <DoodleObj x={x} t={t} S={S} />
    case 'behind': return hasCutout ? null : <EdgeWords x={x} t={t} S={S} />     // drawn inside the frame, under the cut-out, when there is one
    case 'edge': return <EdgeWords x={x} t={t} S={S} />
    default: return null
  }
}
