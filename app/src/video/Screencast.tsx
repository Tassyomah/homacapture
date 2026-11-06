import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'
import { useMemo } from 'react'
import { ASPECTS, LOOKS, type Mask, type Sticker, type MusicTrack, type Overlay, type Voiceover, type InsertClip, type Keyframe, type Placed, type OverlayShape, type RecordingEvents, type RenderConfig, type ScreencastProps, type ProjectAssets, type TextPop, type Transcript } from '../shared/types'
import { buildCamera, cameraAt, cursorIdAt, smoothCursor, type CamKey, type Viewport } from './motion'
import { keptRanges, srcToOut, type Range } from './ranges'
import { POP, WHOOSH } from './sfx'
import { Captions } from './Captions'

const BACKGROUNDS: Record<string, string> = {
  indigo: 'linear-gradient(135deg, #6E71E8 0%, #8B78D6 100%)',
  coral: 'linear-gradient(135deg, #FB8B73 0%, #F5C36A 100%)',
  ink: '#14140F',
  paper: '#EFEEE8',
}

/** Design-space layout: canvas size, where the screen frame sits, and the viewport the camera works in. */
export interface Layout { width: number; height: number; frame: { x: number; y: number; w: number; h: number }; vp: Viewport }

/**
 * - 'source': canvas = screen + padding; the frame is the screen at 1:1.
 * - landscape presets (16:9): the screen is fitted inside the canvas (never cropped).
 * - portrait / square presets (9:16, 4:5, 1:1): the frame fills the canvas and crops the screen; the viewport
 *   follows the cursor and zooms (content-aware reframing, add-on spec §17).
 */
export function layout(ev: RecordingEvents, cfg: RenderConfig): Layout {
  const W = ev.display.width, H = ev.display.height, pad = Math.round(W * cfg.padding)
  const even = (n: number) => { const r = Math.round(n); return r % 2 ? r + 1 : r }
  const ratio = ASPECTS.find((a) => a.id === cfg.aspect)?.ratio ?? null
  if (ratio === null) return { width: even(W + 2 * pad), height: even(H + 2 * pad), frame: { x: pad, y: pad, w: W, h: H }, vp: { FW: W, FH: H, base: 1, crop: false } }
  if (ratio >= 1) {
    const width = even(W + 2 * pad), height = even(width / ratio)
    const fit = Math.min((width - 2 * pad) / W, (height - 2 * pad) / H)
    const fw = Math.round(W * fit), fh = Math.round(H * fit)
    return { width, height, frame: { x: Math.round((width - fw) / 2), y: Math.round((height - fh) / 2), w: fw, h: fh }, vp: { FW: fw, FH: fh, base: fit, crop: false } }
  }
  const height = even(H + 2 * pad), width = even(height * ratio)
  const fw = width - 2 * pad, fh = height - 2 * pad
  return { width, height, frame: { x: pad, y: pad, w: fw, h: fh }, vp: { FW: fw, FH: fh, base: Math.max(fw / W, fh / H), crop: true } }
}

/** One kept range of the recording, rendered at source time = srcStart + local frame. */
const Segment: React.FC<{ ev: RecordingEvents; cfg: RenderConfig; assets: ProjectAssets; keys: CamKey[]; srcStart: number; rate: number; L: Layout; transcript: Transcript | null; masks: Mask[]; texts: TextPop[]; overlays: Overlay[]; stickers: Sticker[]; transIn: boolean; punches: number[]; ins?: InsertClip; segLen: number }> =
  ({ ev, cfg, assets, keys, srcStart, rate, L, transcript, masks, texts, overlays, stickers, transIn, punches, ins, segLen }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = srcStart + (frame / fps) * rate
  const W = ev.display.width, H = ev.display.height
  const { frame: F, vp } = L
  const cam = cameraAt(ev, keys, t, W, H, vp)
  const tx = F.w / 2 - cam.cx * cam.scale, ty = F.h / 2 - cam.cy * cam.scale
  const pos = smoothCursor(ev, t)
  const cid = cursorIdAt(ev, t)
  const shape = cid ? ev.cursors[cid] : null
  const cs = ev.display.scale * cfg.cursorScale
  const ripple = ev.clicks.find((c) => c.type === 'down' && t - (c.t - ev.t0Video) >= 0 && t - (c.t - ev.t0Video) < 0.45)
  const rp = ripple ? (t - (ripple.t - ev.t0Video)) / 0.45 : 0
  const micStart = srcStart - (ev.micOffset ?? 0)   // seconds into mic.wav where this segment begins
  const camStart = srcStart - (ev.cameraOffset ?? 0)
  const sysStart = srcStart - (ev.systemOffset ?? 0)
  // The camera starts a moment after the screen; show the overlay only once it has frames (no black box at the start).
  const cameraHasFrames = t - (ev.cameraOffset ?? 0) >= 0 && (!ev.camera?.duration || t - (ev.cameraOffset ?? 0) <= ev.camera.duration)
  // Colour look (filter preset + brightness / contrast / saturation) on the video only, never on text or captions.
  const lookCss = [LOOKS.find((l) => l.id === cfg.look)?.css ?? '', cfg.brightness !== 1 ? `brightness(${cfg.brightness})` : '',
    cfg.contrast !== 1 ? `contrast(${cfg.contrast})` : '', cfg.saturation !== 1 ? `saturate(${cfg.saturation})` : ''].filter(Boolean).join(' ') || undefined
  // Transition into this segment (it starts right after a cut): the frame zooms, flashes, blurs or whips in.
  const age = frame / fps
  const tr = transIn && cfg.transition !== 'none' ? cfg.transition : null
  const tp = tr ? Math.min(1, age / (tr === 'flash' ? 0.22 : tr === 'whip' ? 0.22 : 0.3)) : 1
  const q = 1 - tp
  const frameFx: React.CSSProperties = tr === 'zoom' ? { transform: `scale(${1 + 0.14 * q * q})`, filter: q > 0 ? `blur(${(8 * q).toFixed(2)}px)` : undefined }
    : tr === 'blur' ? { filter: q > 0 ? `blur(${(16 * q).toFixed(2)}px)` : undefined }
    : tr === 'whip' ? { transform: `translateX(${(F.w * 0.14 * q ** 3).toFixed(1)}px)`, filter: q > 0 ? `blur(${(12 * q).toFixed(2)}px)` : undefined } : {}
  // Shake: a short, decaying jolt for 0.32 s from the start of every punch-in (source time, so it follows the cut).
  const hit = cfg.shake ? punches.find((p) => t >= p && t < p + 0.32) : undefined
  if (hit !== undefined) {
    const k = 1 - (t - hit) / 0.32, a = F.w * 0.012 * k * k, ph = (t - hit) * 70
    const shake = `translate(${(a * Math.sin(ph)).toFixed(1)}px, ${(a * 0.7 * Math.cos(ph * 1.3)).toFixed(1)}px) rotate(${(0.5 * k * Math.sin(ph * 0.8)).toFixed(2)}deg)`
    frameFx.transform = frameFx.transform ? `${frameFx.transform} ${shake}` : shake
  }
  const backdropImage = cfg.backdrop === 'image' && cfg.backdropImage ? assets.media?.[cfg.backdropImage] ?? null : null
  const cutout = assets.cutout && cfg.backdrop !== 'off' && (cfg.backdrop !== 'image' || backdropImage) ? assets.cutout : null
  const webcam = assets.camera && ev.camera && cfg.cameraShape !== 'off' && cameraHasFrames ? cameraRect(cfg, ev.camera, F.w, F.h) : null

  return (
    <>
      <div data-hc-frame="" style={{ position: 'absolute', left: F.x, top: F.y, width: F.w, height: F.h, borderRadius: cfg.radius,
                    overflow: 'hidden', boxShadow: '0 40px 120px rgba(20,20,15,0.35)', background: '#14140F', ...frameFx }}>
        {ins ? <InlineClip ins={ins} src={assets.media?.[ins.file] ?? null} age={age} len={segLen} fps={fps} filter={lookCss} /> : <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${cam.scale})`, filter: lookCss }}>
          {cutout ? <>
            {/* Remove / blur background: what sits behind the speaker, then the speaker cut out (transparent video) on top. */}
            {cfg.backdrop === 'blur' && <OffthreadVideo src={assets.screen} muted startFrom={Math.round(srcStart * fps)} playbackRate={rate}
              style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'block', filter: `blur(${Math.round(Math.max(W, H) * 0.018)}px) brightness(0.92)`, transform: 'scale(1.08)' }} />}
            {cfg.backdrop === 'color' && <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, background: BACKGROUNDS[cfg.backdropColor] ?? BACKGROUNDS.paper }} />}
            {cfg.backdrop === 'image' && backdropImage && <Img src={backdropImage} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, objectFit: 'cover' }} />}
            <OffthreadVideo src={cutout} muted transparent startFrom={Math.round(srcStart * fps)} playbackRate={rate} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'block' }} />
            <div style={{ width: W, height: H }} />
          </> : <OffthreadVideo src={assets.screen} muted startFrom={Math.round(srcStart * fps)} playbackRate={rate} style={{ width: W, height: H, display: 'block' }} />}
          {/* Privacy masks live in screen coordinates, so they follow the zoom and are part of every export (spec §49). */}
          {masks.filter((m) => t >= m.start && t <= m.end).map((m) => (
            <div key={m.id} style={{ position: 'absolute', left: m.x, top: m.y, width: m.w, height: m.h, borderRadius: 8,
              background: m.kind === 'solid' ? '#14140F' : 'rgba(20,20,15,0.12)', backdropFilter: m.kind === 'blur' ? 'blur(22px) saturate(0.6)' : undefined,
              WebkitBackdropFilter: m.kind === 'blur' ? 'blur(22px) saturate(0.6)' : undefined }} />
          ))}
          {ripple && (
            <div style={{ position: 'absolute', left: ripple.x - 60 * rp, top: ripple.y - 60 * rp, width: 120 * rp, height: 120 * rp,
                          borderRadius: '50%', background: 'rgba(251,139,115,0.45)', opacity: 1 - rp }} />
          )}
          {pos && shape && cid && assets.cursors[cid] && (
            <Img src={assets.cursors[cid]} style={{ position: 'absolute',
              left: pos[0] - shape.hotspot[0] * cs, top: pos[1] - shape.hotspot[1] * cs,
              width: shape.size[0] * cs, height: shape.size[1] * cs, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.35))' }} />
          )}
        </div>}
        <Cinematic cfg={cfg} W={F.w} H={F.h} frame={frame} />
      </div>
      {!ins && webcam && assets.camera && (
        // Camera overlay sits over the screen frame and stays put while the screen zooms (spec §10, §11).
        <div style={{ position: 'absolute', left: F.x + webcam.x, top: F.y + webcam.y, width: webcam.w, height: webcam.h,
                      borderRadius: webcam.radius, overflow: 'hidden', boxShadow: '0 24px 70px rgba(20,20,15,0.4)', background: '#14140F' }}>
          <TimedVideo src={assets.camera} start={camStart} fps={fps} rate={rate}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: cfg.cameraMirror ? 'scaleX(-1)' : undefined }} />
        </div>
      )}
      {overlays.filter((o) => t >= o.t && t < o.t + o.duration && assets.media?.[o.file]).map((o) => (
        <BRoll key={o.id} o={o} src={assets.media![o.file]} t={t} srcStart={srcStart} fps={fps} rate={rate} F={F} faceLeft={(ev.focus?.[0] ?? W / 2) < W / 2} />))}
      {tr === 'flash' && q > 0 && <div style={{ position: 'absolute', left: F.x, top: F.y, width: F.w, height: F.h, background: '#EFEEE8', opacity: 0.85 * q * q, pointerEvents: 'none' }} />}
      {stickers.filter((s) => t >= s.t && t < s.t + s.duration).map((s) => <StickerView key={s.id} s={s} t={t} F={F} />)}
      {!ins && cfg.keycaps && ev.keys && ev.keys.length > 0 && <Keycaps keys={ev.keys} t={t} t0={ev.t0Video} F={F} />}
      {shownTexts(texts, t).map((x) => x.style === 'name' ? <NameTag key={x.id} x={x} t={t} F={F} portrait={F.h > F.w} L={L} /> : <TextView key={x.id} tp={x} t={t} F={F} portrait={F.h > F.w} />)}
      {!ins && transcript && cfg.captions !== 'off' && (
        <div style={{ position: 'absolute', left: F.x, top: F.y, width: F.w, height: F.h, pointerEvents: 'none' }}>
          <Captions transcript={transcript} t={t} style={cfg.captions} FW={F.w} FH={F.h} portrait={L.vp.crop || F.h > F.w} highlight={cfg.capHighlight} emoji={cfg.capEmoji} />
        </div>
      )}
      {!ins && assets.mic && cfg.micVolume > 0 && <TimedAudio src={(cfg.voiceFx !== 'none' ? assets.media?.[`media/voice-${cfg.voiceFx}.wav`] : null) ?? (cfg.voice === 'clean' && assets.micClean ? assets.micClean : assets.mic)} start={micStart} fps={fps} volume={cfg.micVolume} rate={rate} />}
      {!ins && assets.system && cfg.systemVolume > 0 && <TimedAudio src={assets.system} start={sysStart} fps={fps} volume={cfg.systemVolume} rate={rate} />}
    </>
  )
}

/**
 * Cinematic finish over the video (under text and captions): dark edges, film grain that changes every frame, and
 * letterbox bars. Flat black and a soft radial falloff only.
 */
const Cinematic: React.FC<{ cfg: RenderConfig; W: number; H: number; frame: number }> = ({ cfg, W, H, frame }) => {
  if (!cfg.vignette && !cfg.grain && !cfg.bars) return null
  const bar = Math.round(H * (H > W ? 0.07 : 0.1))
  return <>
    {cfg.vignette && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)' }} />}
    {cfg.grain && <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', opacity: 0.16, mixBlendMode: 'overlay' }}>
      <filter id={`grain${frame}`}><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={frame % 97} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
      <rect width={W} height={H} filter={`url(#grain${frame})`} /></svg>}
    {cfg.bars && <><div style={{ position: 'absolute', left: 0, top: 0, width: W, height: bar, background: '#000' }} />
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: W, height: bar, background: '#000' }} /></>}
  </>
}

/** Name tag (lower third): a flat paper card with the name in ink and the role in indigo, sliding in from the left. */
const NameTag: React.FC<{ x: TextPop; t: number; F: { x: number; y: number; w: number; h: number }; portrait: boolean; L: Layout }> = ({ x, t, F, portrait, L }) => {
  const age = t - x.t, left = x.t + x.duration - t
  const hand = x.x != null || !!x.kf?.length
  const at = placedAt({ x: x.x ?? 0.5, y: x.y ?? 0.7, scale: x.scale ?? 1, rotate: x.rotate ?? 0, opacity: x.opacity ?? 1 }, x.kf, age)
  const p = Math.min(1, age / 0.4), out = Math.min(1, left / 0.3)
  const ease = 1 - (1 - p) ** 3
  const fs = Math.round(F.w * (portrait ? 0.044 : 0.026) * at.scale)
  return (
    // Sits just above where captions start (they take the bottom 16-25 %), clear of the speaker's chin on vertical video.
    <div data-hc-item={`text:${x.id}`} style={{ position: 'absolute', ...(hand ? { left: F.x + F.w * at.x, top: F.y + F.h * at.y } : { left: F.x + Math.round(F.w * 0.05), bottom: L.height - (F.y + F.h) + Math.round(F.h * (portrait ? 0.26 : 0.2)) }), pointerEvents: 'none',
                  transform: `${hand ? 'translate(-50%, -50%) ' : ''}translateX(${((1 - ease) * -40).toFixed(1)}%) rotate(${at.rotate}deg)`, opacity: Math.min(ease * 1.5, out) * at.opacity }}>
      <div style={{ background: '#EFEEE8', borderRadius: Math.round(fs * 0.35), padding: `${Math.round(fs * 0.45)}px ${Math.round(fs * 0.8)}px`, boxShadow: '0 12px 40px rgba(20,20,15,0.25)',
                    fontFamily: `${x.font ? `"${x.font}", ` : ''}Aeonik, Archivo, Inter, system-ui, sans-serif`, display: 'flex', alignItems: 'center', gap: Math.round(fs * 0.6) }}>
        <div style={{ width: Math.round(fs * 0.22), alignSelf: 'stretch', borderRadius: 99, background: '#FB8B73' }} />
        <div>
          <div style={{ fontSize: fs, fontWeight: 800, color: '#14140F', lineHeight: 1.1 }}>{x.text}</div>
          {x.sub && <div style={{ fontSize: Math.round(fs * 0.62), fontWeight: 600, color: '#6E71E8', lineHeight: 1.3, marginTop: Math.round(fs * 0.12) }}>{x.sub}</div>}
        </div>
      </div>
    </div>)
}

/** Opening title card and closing follow card, over the video (which blurs and darkens behind them). Output time. */
const Bookends: React.FC<{ cfg: RenderConfig; W: number; H: number; total: number }> = ({ cfg, W, H, total }) => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig()
  const t = frame / fps
  const INTRO = Math.min(2.6, total * 0.3), OUTRO = Math.min(3, total * 0.3)
  const portrait = H > W, fs = Math.round(W * (portrait ? 0.085 : 0.05))
  const card = (k: number, title: string, sub: string, pill: boolean) => {
    if (k <= 0 || !title.trim()) return null
    const e = easeOutBack(Math.min(1, k * 1.4))
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: Math.round(fs * 0.35),
                    background: `rgba(20,20,15,${(0.72 * Math.min(1, k * 2)).toFixed(3)})`, backdropFilter: `blur(${Math.round(18 * Math.min(1, k * 2))}px)`, pointerEvents: 'none',
                    fontFamily: 'Aeonik, Archivo, Inter, system-ui, sans-serif', textAlign: 'center' }}>
        <div style={{ transform: `scale(${(0.8 + 0.2 * e).toFixed(3)})`, opacity: Math.min(1, k * 3), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(fs * 0.3), maxWidth: '84%' }}>
          {pill ? <div style={{ background: '#FB8B73', color: '#14140F', fontWeight: 800, fontSize: fs, borderRadius: 999, padding: `${Math.round(fs * 0.35)}px ${Math.round(fs * 0.9)}px` }}>{title}</div>
            : <div style={{ color: '#EFEEE8', fontWeight: 800, fontSize: Math.round(fs * 1.15), lineHeight: 1.02, letterSpacing: '-0.015em', textWrap: 'balance' as never }}>{title}</div>}
          {sub.trim() && <div style={{ color: pill ? '#EFEEE8' : '#FB8B73', fontWeight: 600, fontSize: Math.round(fs * 0.5) }}>{sub}</div>}
        </div>
      </div>)
  }
  const kin = cfg.intro ? Math.min(1, (INTRO - t) / 0.35) : 0
  const kout = cfg.outro ? Math.min(1, (t - (total - OUTRO)) / 0.45) : 0
  return <>{t < INTRO && card(kin, cfg.introTitle, cfg.introSub, false)}{t > total - OUTRO && card(kout, cfg.outroText, cfg.outroSub, true)}</>
}

/** Keyboard shortcut keycaps (spec §46): the most recent combo, bottom-left of the frame, fading after 1.4 s. */
const Keycaps: React.FC<{ keys: { t: number; keys: string }[]; t: number; t0: number; F: { x: number; y: number; w: number; h: number } }> = ({ keys, t, t0, F }) => {
  let shown: { t: number; keys: string } | null = null
  for (const k of keys) { const rel = k.t - t0; if (rel <= t && t - rel < 1.4) shown = k; else if (rel > t) break }
  if (!shown) return null
  const age = t - (shown.t - t0)
  const alpha = age < 0.1 ? age / 0.1 : age > 1.1 ? Math.max(0, (1.4 - age) / 0.3) : 1
  const size = Math.round(F.w * 0.018)
  return (
    <div style={{ position: 'absolute', left: F.x + Math.round(F.w * 0.03), top: F.y + F.h - Math.round(F.h * 0.06) - size * 2.4, display: 'flex', gap: size * 0.4, opacity: alpha,
                  transform: `translateY(${(1 - Math.min(1, age / 0.1)) * 8}px)`, pointerEvents: 'none' }}>
      {shown.keys.split('+').map((k, i) => (
        <span key={i} style={{ fontFamily: 'Aeonik, Archivo, Inter, system-ui, sans-serif', fontWeight: 600, fontSize: size, lineHeight: 1, color: '#14140F',
          background: '#EFEEE8', borderRadius: size * 0.45, padding: `${size * 0.55}px ${size * 0.8}px`, boxShadow: `0 ${size * 0.25}px 0 rgba(20,20,15,0.25), 0 ${size * 0.6}px ${size * 1.2}px rgba(20,20,15,0.25)`, minWidth: size * 1.2, textAlign: 'center' }}>{k}</span>
      ))}
    </div>
  )
}

const easeOutBack = (p: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2 }

/** Where an item is at t, moving between its keyframes (`at` = seconds from its start) with a gentle ease. */
export function placedAt(base: Required<Omit<Placed, 'kf'>>, kf: Keyframe[] | undefined, age: number): Required<Omit<Placed, 'kf'>> {
  if (!kf?.length) return base
  const k = [...kf].sort((a, b) => a.at - b.at)
  if (age <= k[0].at) return k[0]
  const last = k[k.length - 1]
  if (age >= last.at) return last
  const i = k.findIndex((f) => f.at > age), a = k[i - 1], b = k[i]
  const p = (age - a.at) / Math.max(0.001, b.at - a.at), e = p * p * (3 - 2 * p)
  const mix = (x: number, y: number) => x + (y - x) * e
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), scale: mix(a.scale, b.scale), rotate: mix(a.rotate, b.rotate), opacity: mix(a.opacity, b.opacity) }
}

/** The way out, in the last 0.3 s of an item: fade, slide away or shrink. */
function leaving(out: string | undefined, left: number): { lift: number; shrink: number; alpha: number } {
  const q = Math.max(0, Math.min(1, 1 - left / 0.3))
  if (out === 'slide') return { lift: -0.5 * q * q, shrink: 1, alpha: 1 - q }
  if (out === 'shrink') return { lift: 0, shrink: 1 - 0.7 * q * q, alpha: 1 - q }
  if (out === 'fade') return { lift: 0, shrink: 1, alpha: 1 - q }
  return { lift: 0, shrink: 1, alpha: 1 }
}

/** Texts showing at t: hand-placed ones and name tags always; auto-placed ones share one spot, so only the latest. */
function shownTexts(texts: TextPop[], t: number): TextPop[] {
  const on = texts.filter((x) => t >= x.t && t < x.t + x.duration)
  const shared = on.filter((x) => x.style !== 'name' && x.x == null && !x.kf?.length)
  return on.filter((x) => !shared.includes(x) || x === shared[shared.length - 1])
}

/**
 * Text on the video: pops in big above the speaker's head unless it was placed by hand. It sits on the frame, not on
 * the zoomed video, so it stays put through punch-ins. Flat brand shapes only.
 * 'pop' = coral word(s); 'title' = a paper card with ink type for the opening hook.
 */
const TextView: React.FC<{ tp: TextPop; t: number; F: { x: number; y: number; w: number; h: number }; portrait: boolean }> = ({ tp, t, F, portrait }) => {
  const age = t - tp.t, left = tp.t + tp.duration - t
  const anim = tp.anim ?? 'pop'
  const full = tp.font && tp.font !== 'Aeonik' ? tp.text : tp.text.toUpperCase()
  // pop: springs up from 62 %; slide: rises 40 % of its height; slam: drops in from 180 % and lands; type: letters appear one by one.
  const p = Math.min(1, age / (anim === 'slam' ? 0.18 : anim === 'slide' ? 0.3 : 0.24))
  const scale = anim === 'pop' ? 0.62 + 0.38 * easeOutBack(p) : anim === 'slam' ? 1 + 0.8 * (1 - p) ** 2 : 1
  const lift = anim === 'slide' ? (1 - (1 - (1 - p) ** 3)) * 0.4 : 0
  const gone = leaving(tp.animOut, left)
  const alpha = Math.min(1, age / (anim === 'type' ? 0.02 : 0.08), tp.animOut && tp.animOut !== 'none' ? 1 : left / 0.16) * gone.alpha
  const text = anim === 'type' ? full.slice(0, Math.max(1, Math.ceil(full.length * Math.min(1, age / Math.min(0.9, 0.05 * full.length))))) : full
  const title = tp.style === 'title'
  const hand = tp.x != null || !!tp.kf?.length
  const at = placedAt({ x: tp.x ?? 0.5, y: tp.y ?? 0.2, scale: tp.scale ?? 1, rotate: tp.rotate ?? (title ? 0 : -2), opacity: tp.opacity ?? 1 }, tp.kf, age)
  const base = F.w * (portrait ? (title ? 0.075 : 0.12) : (title ? 0.045 : 0.07))
  const fontSize = Math.round(Math.min(base, (F.w * (portrait ? 0.84 : 0.7)) / Math.max(4, Math.min(text.length, 14) * 0.6)) * at.scale)
  const boxed = title || !!tp.bg
  const body = (
    <div data-hc-item={`text:${tp.id}`} style={{ transform: `translateY(${((lift + gone.lift) * 100).toFixed(1)}%) scale(${scale * gone.shrink}) rotate(${at.rotate}deg)`, opacity: alpha * at.opacity, transformOrigin: '50% 60%', maxWidth: hand ? F.w * 0.94 : portrait ? '86%' : '72%', textAlign: 'center',
                  fontFamily: `${tp.font ? `"${tp.font}", ` : ''}Aeonik, Archivo, Inter, system-ui, sans-serif`, fontWeight: 800, fontSize, lineHeight: 1.02, letterSpacing: '-0.01em', textWrap: 'balance' as never,
                  color: tp.color ?? (title ? '#14140F' : '#FB8B73'), background: tp.bg ?? (title ? '#EFEEE8' : 'transparent'), borderRadius: boxed ? fontSize * 0.45 : 0,
                  padding: boxed ? `${Math.round(fontSize * 0.4)}px ${Math.round(fontSize * 0.7)}px` : 0,
                  textShadow: boxed ? undefined : `0 ${Math.round(fontSize * 0.06)}px ${Math.round(fontSize * 0.3)}px rgba(20,20,15,0.55)` }}>{text}</div>)
  if (hand) return <div style={{ position: 'absolute', left: F.x + F.w * at.x, top: F.y + F.h * at.y, transform: 'translate(-50%, -50%)', width: 'max-content', pointerEvents: 'none' }}>{body}</div>
  return <div style={{ position: 'absolute', left: F.x, top: F.y + Math.round(F.h * (portrait ? 0.13 : 0.1)), width: F.w, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>{body}</div>
}

/** A clip, picture or freeze frame playing in the main line: fills the frame, with its own way in and out. */
const InlineClip: React.FC<{ ins: InsertClip; src: string | null; age: number; len: number; fps: number; filter?: string }> = ({ ins, src, age, len, fps, filter }) => {
  const pin = Math.min(1, age / 0.35), left = len - age
  const inn = ins.animIn ?? 'none'
  const eased = 1 - (1 - pin) ** 3
  const opacity = (inn === 'fade' ? pin : 1) * (ins.animOut === 'fade' ? Math.min(1, left / 0.35) : 1)
  const transform = inn === 'zoom' ? `scale(${1.18 - 0.18 * eased})` : inn === 'slide' ? `translateY(${((1 - eased) * 100).toFixed(1)}%)` : undefined
  const style: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity, transform, filter }
  if (!src) return null
  return ins.kind === 'video' ? <OffthreadVideo src={src} startFrom={Math.round(ins.in * fps)} volume={ins.volume} style={style} /> : <Img src={src} style={style} />
}

/**
 * B-roll: a picture or clip over the video. 'full' fills the frame (pictures drift in slowly, Ken Burns style);
 * 'card' floats a rounded card clear of the speaker's face (above it on vertical video, beside it on landscape). Flat card, soft shadow, no border.
 */
const CLIP_SHAPE: Record<OverlayShape, string | undefined> = { rect: undefined, round: undefined, circle: 'circle(50% at 50% 50%)',
  heart: undefined,
  star: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' }
const BRoll: React.FC<{ o: Overlay; src: string; t: number; srcStart: number; fps: number; rate: number; F: { x: number; y: number; w: number; h: number }; faceLeft: boolean }> = ({ o, src, t, srcStart, fps, rate, F, faceLeft }) => {
  const age = t - o.t, left = o.t + o.duration - t
  const gone = leaving(o.animOut, left)
  const inn = o.animIn ?? 'none'
  const fadeIn = inn === 'fade' ? Math.min(1, age / 0.35) : Math.min(1, age / 0.12)
  const alpha = Math.min(fadeIn, o.animOut && o.animOut !== 'none' ? 1 : left / 0.12) * gone.alpha
  const blend = o.blend && o.blend !== 'normal' ? o.blend : undefined
  const media = (style: React.CSSProperties) => o.kind === 'video'
    ? <TimedVideo src={src} start={srcStart - o.t} fps={fps} rate={rate} style={style} transparent={o.file.endsWith('.webm')} />
    : <Img src={src} style={style} />
  if (o.fit === 'full') {
    const drift = o.kind === 'image' ? 1 + 0.06 * Math.min(1, age / Math.max(0.5, o.duration)) : 1
    return (
      <div data-hc-item={`broll:${o.id}`} style={{ position: 'absolute', left: F.x, top: F.y, width: F.w, height: F.h, overflow: 'hidden', opacity: alpha * (o.opacity ?? 1), background: o.file.endsWith('.webm') || o.file.endsWith('.png') ? undefined : '#14140F', mixBlendMode: blend }}>
        {media({ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: `scale(${drift * (1.04 - 0.04 * Math.min(1, age / 0.25))})` })}
      </div>)
  }
  const portrait = F.h > F.w
  const shape = o.shape ?? 'round', round = shape === 'circle' || shape === 'heart' || shape === 'star'
  const clear = o.file.endsWith('.webm') || o.file.endsWith('.png')    // keyed clips and logos: no card behind them
  const hand = o.x != null || !!o.kf?.length
  const defW = F.w * (portrait ? 0.8 : 0.42)
  const at = placedAt({ x: o.x ?? (portrait ? 0.5 : (faceLeft ? 0.54 + defW / F.w / 2 : 0.04 + defW / F.w / 2)), y: o.y ?? (portrait ? 0.05 + (defW * 0.625) / F.h / 2 : 0.5), scale: o.scale ?? 1, rotate: o.rotate ?? (hand ? 0 : -1.5), opacity: o.opacity ?? 1 }, o.kf, age)
  const w = Math.round(defW * at.scale), h = round ? w : Math.round(w * 0.625)
  const scale = (inn === 'none' || inn === 'zoom' ? 0.7 + 0.3 * easeOutBack(Math.min(1, age / 0.28)) : 1) * gone.shrink
  const slide = (inn === 'slide' ? (1 - (1 - Math.min(1, age / 0.3)) ** 3) * -1 + 1 : 0) * 0.5 + gone.lift
  // Heart is drawn in a 0–1 box, so it is scaled to the card through a matching SVG clipPath.
  const clipId = `hc-heart-${o.id}`
  return (
    <div data-hc-item={`broll:${o.id}`} style={{ position: 'absolute', left: F.x + F.w * at.x - w / 2, top: F.y + F.h * at.y - h / 2, width: w, height: h, borderRadius: shape === 'rect' ? 0 : shape === 'round' ? Math.round(w * 0.05) : 0, overflow: 'hidden',
                  opacity: alpha * at.opacity, transform: `translateY(${(slide * 100).toFixed(1)}%) scale(${scale}) rotate(${at.rotate}deg)`, boxShadow: round || clear ? undefined : '0 30px 90px rgba(20,20,15,0.45)', background: round || clear ? undefined : '#14140F', mixBlendMode: blend,
                  clipPath: shape === 'heart' ? `url(#${clipId})` : CLIP_SHAPE[shape] }}>
      {shape === 'heart' && <svg width={0} height={0} style={{ position: 'absolute' }}><clipPath id={clipId} clipPathUnits="objectBoundingBox"><path d="M0.5 0.92 C0.2 0.68 0 0.5 0 0.28 C0 0.12 0.13 0 0.28 0 C0.37 0 0.45 0.05 0.5 0.13 C0.55 0.05 0.63 0 0.72 0 C0.87 0 1 0.12 1 0.28 C1 0.5 0.8 0.68 0.5 0.92 Z" /></clipPath></svg>}
      {media({ width: '100%', height: '100%', objectFit: 'cover', display: 'block' })}
    </div>)
}

const SOLID: Record<string, string> = { indigo: '#6E71E8', coral: '#FB8B73', ink: '#14140F', paper: '#EFEEE8' }
/** Flat brand shapes for stickers, drawn in a 100×100 box. */
const SHAPES: Record<string, string> = {
  arrow: 'M6 40 H58 V18 L96 50 L58 82 V60 H6 Z',
  star: 'M50 4 L62 36 L96 37 L69 58 L79 92 L50 72 L21 92 L31 58 L4 37 L38 36 Z',
  sparkle: 'M50 2 C54 36 64 46 98 50 C64 54 54 64 50 98 C46 64 36 54 2 50 C36 46 46 36 50 2 Z',
  heart: 'M50 90 C20 68 4 52 4 32 C4 16 16 6 30 6 C40 6 46 12 50 20 C54 12 60 6 70 6 C84 6 96 16 96 32 C96 52 80 68 50 90 Z',
  burst: Array.from({ length: 24 }, (_, i) => { const r = i % 2 ? 34 : 48, a = (i / 24) * Math.PI * 2; return `${i ? 'L' : 'M'}${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}` }).join(' ') + ' Z',
}
/** A sticker: pops in, bobs gently while it is up, fades out. Sits on the frame, so punch-ins never move it. */
const StickerView: React.FC<{ s: Sticker; t: number; F: { x: number; y: number; w: number; h: number } }> = ({ s, t, F }) => {
  const age = t - s.t, left = s.t + s.duration - t
  const scale = 0.4 + 0.6 * easeOutBack(Math.min(1, age / 0.3))
  const alpha = Math.min(1, age / 0.06, left / 0.15)
  const at = placedAt({ x: s.x, y: s.y, scale: s.size, rotate: s.rotate, opacity: s.opacity ?? 1 }, s.kf, age)
  const size = F.w * at.scale
  const rot = at.rotate + Math.sin(age * 4) * 3
  return (
    <div data-hc-item={`sticker:${s.id}`} style={{ position: 'absolute', left: F.x + F.w * at.x - size / 2, top: F.y + F.h * at.y - size / 2, width: size, height: size, opacity: alpha * at.opacity,
                  transform: `scale(${scale}) rotate(${rot}deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                  filter: 'drop-shadow(0 8px 18px rgba(20,20,15,0.3))' }}>
      {s.emoji ? <span style={{ fontSize: size * 0.82, lineHeight: 1 }}>{s.emoji}</span>
        : <svg viewBox="0 0 100 100" width={size} height={size}><path d={SHAPES[s.shape ?? 'star']} fill={SOLID[s.color ?? 'coral']} /></svg>}
    </div>)
}

/** Output-time spans where someone is speaking (transcript words that survive the cuts), merged across short gaps. */
function speechSpans(transcript: Transcript | null, ranges: Range[]): [number, number][] {
  if (!transcript) return []
  const inside = (t: number) => ranges.some((r) => t >= r.start && t < r.end)
  const spans: [number, number][] = []
  for (const s of transcript.segments) for (const w of s.words) {
    const mid = (w.start + w.end) / 2
    if (!inside(mid)) continue
    const a = srcToOut(ranges, Math.max(w.start, s.start)), b = srcToOut(ranges, w.end)
    const last = spans[spans.length - 1]
    if (last && a - last[1] < 0.6) last[1] = Math.max(last[1], b); else spans.push([a, b])
  }
  return spans
}

/** Background music, looped under the whole video: dips to a quarter while anyone speaks (auto-duck), fades in and out. */
const Music: React.FC<{ src: string; music: MusicTrack; spans: [number, number][]; total: number; hasVoice: boolean }> = ({ src, music, spans, total, hasVoice }) => {
  const { fps } = useVideoConfig()
  const volume = (f: number) => {
    const t = f / fps
    let duck = 1
    if (music.duck) {
      if (!spans.length) duck = hasVoice ? 0.28 : 1
      else {
        let d = Infinity
        for (const [a, b] of spans) { if (t >= a && t <= b) { d = 0; break } d = Math.min(d, t < a ? a - t : t - b) }
        duck = 0.28 + 0.72 * Math.min(1, d / 0.35)
      }
    }
    const fade = Math.min(1, t / 0.6, Math.max(0, total - t) / 1.5)
    return Math.max(0, music.volume * duck * fade)
  }
  return <Audio src={src} loop volume={volume} />
}

/** How far through the video we are: a flat coral bar along the top or bottom edge. */
const ProgressBar: React.FC<{ where: 'top' | 'bottom'; W: number; H: number }> = ({ where, W, H }) => {
  const frame = useCurrentFrame(), { durationInFrames } = useVideoConfig()
  const h = Math.max(6, Math.round(Math.min(W, H) * 0.012))
  return (
    <div style={{ position: 'absolute', left: 0, [where]: 0, width: W, height: h, background: 'rgba(20,20,15,0.18)', pointerEvents: 'none' }}>
      <div style={{ width: `${(Math.min(1, (frame + 1) / durationInFrames) * 100).toFixed(3)}%`, height: '100%', background: '#FB8B73' }} />
    </div>)
}

/** A video whose own time axis starts `start` seconds into this segment (negative = it begins later than the segment). */
const TimedVideo: React.FC<{ src: string; start: number; fps: number; rate: number; style: React.CSSProperties; transparent?: boolean }> = ({ src, start, fps, rate, style, transparent }) =>
  start >= 0
    ? <OffthreadVideo src={src} muted transparent={transparent} startFrom={Math.round(start * fps)} playbackRate={rate} style={style} />
    : <Sequence from={Math.round((-start / rate) * fps)} layout="none"><OffthreadVideo src={src} muted transparent={transparent} playbackRate={rate} style={style} /></Sequence>

/** An audio track whose own time axis starts `start` seconds into this segment (negative = it begins later). */
const TimedAudio: React.FC<{ src: string; start: number; fps: number; volume: number; rate: number }> = ({ src, start, fps, volume, rate }) =>
  start >= 0
    ? <Audio src={src} startFrom={Math.round(start * fps)} volume={volume} playbackRate={rate} />
    : <Sequence from={Math.round((-start / rate) * fps)} layout="none"><Audio src={src} volume={volume} playbackRate={rate} /></Sequence>

/** Camera box in frame pixels, relative to the frame's top-left. Size is a fraction of the frame width. */
export function cameraRect(cfg: RenderConfig, camera: { width: number; height: number }, FW: number, FH: number) {
  const w = Math.round(FW * cfg.cameraSize)
  const aspect = camera.width && camera.height ? camera.width / camera.height : 4 / 3
  const h = cfg.cameraShape === 'circle' ? w : Math.round(w / aspect)
  const margin = Math.round(FW * 0.025)
  const x = cfg.cameraCorner.endsWith('l') ? margin : FW - w - margin
  const y = cfg.cameraCorner.startsWith('t') ? margin : FH - h - margin
  const radius = cfg.cameraShape === 'circle' ? w / 2 : Math.round(w * 0.12)
  return { x, y, w, h, radius }
}

/**
 * Lays the screencast out in its design size and scales that to whatever the composition is rendered at,
 * so the exporter can pick any integer output size without the layout maths changing.
 */
export const Screencast: React.FC<ScreencastProps> = (props) => {
  const { assets, events: ev, config: cfg, cuts = [], zooms = [], speeds = [], masks = [], texts = [], overlays = [], stickers = [], music = null, voiceovers = [], inserts = [], transcript = null } = props
  const { fps, width: VW } = useVideoConfig()
  const L = useMemo(() => layout(ev, cfg), [ev, cfg])
  const keys = useMemo(() => buildCamera(ev, cfg, L.vp, zooms), [ev, cfg, L, zooms])
  const ranges = useMemo(() => keptRanges(ev, cuts, speeds, inserts), [ev, cuts, speeds, inserts])
  const total = ranges.reduce((s, r) => s + Math.max(1, Math.round(((r.end - r.start) / r.rate) * fps)), 0) / fps
  // Voiceovers play in output time from where their source moment lands (or the next kept moment after a cut).
  const voices = useMemo(() => voiceovers.filter((v) => assets.media?.[v.file]).map((v) => ({ v, at: srcToOut(ranges, v.t) })), [voiceovers, assets.media, ranges])
  const spans = useMemo(() => (music?.duck ? [...speechSpans(transcript, ranges), ...voices.map(({ v, at }) => [at, at + v.duration] as [number, number])].sort((a, b) => a[0] - b[0]) : []),
    [music?.duck, transcript, ranges, voices])
  const punches = useMemo(() => zooms.map((z) => z.t), [zooms])
  // Sound effects (output seconds): a whoosh that peaks on each zoom / punch-in and B-roll, a pop on each text.
  // A transition plays where a cut joins two kept stretches ('big' = more than 2 s was removed there).
  const transIn = useMemo(() => ranges.map((r, i) => i > 0 && (!!r.ins || !!ranges[i - 1].ins || r.start - ranges[i - 1].end > (cfg.transitionAt === 'all' ? 0.01 : 2))), [ranges, cfg.transitionAt])
  const sfx = useMemo(() => {
    if (!cfg.sfx) return []
    const kept = (t: number) => ranges.some((r) => t >= r.start - 0.01 && t < r.end)
    const list = [...zooms.map((z) => ({ t: z.t, src: WHOOSH, lead: 0.26 })), ...overlays.map((o) => ({ t: o.t, src: WHOOSH, lead: 0.26 })), ...texts.map((x) => ({ t: x.t, src: POP, lead: 0 })), ...stickers.map((x) => ({ t: x.t, src: POP, lead: 0 }))]
      .filter((e) => kept(e.t)).map((e) => ({ at: Math.max(0, srcToOut(ranges, e.t) - e.lead), src: e.src }))
      .concat(cfg.transition !== 'none' ? ranges.flatMap((r, i) => transIn[i] ? [{ at: Math.max(0, srcToOut(ranges, r.start) - 0.2), src: WHOOSH }] : []) : []).sort((a, b) => a.at - b.at)
    return list.filter((e, i) => !list.slice(0, i).some((p) => p.src === e.src && e.at - p.at < 0.15))
  }, [cfg.sfx, cfg.transition, zooms, overlays, texts, stickers, ranges, transIn])
  const musicSrc = music ? assets.media?.[music.file] ?? null : null
  let from = 0
  return (
    <AbsoluteFill style={{ background: BACKGROUNDS[cfg.background] ?? BACKGROUNDS.indigo }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: L.width, height: L.height, transformOrigin: '0 0', transform: `scale(${VW / L.width})` }}>
        {ranges.map((r, i) => {
          const len = Math.max(1, Math.round(((r.end - r.start) / r.rate) * fps))
          const seq = (
            <Sequence key={i} from={from} durationInFrames={len}>
              <Segment ev={ev} cfg={cfg} assets={assets} keys={keys} srcStart={r.start} rate={r.rate} L={L} transcript={transcript} masks={masks} texts={texts} overlays={overlays} stickers={stickers} transIn={transIn[i]} punches={punches} ins={r.ins} segLen={len / fps} />
            </Sequence>
          )
          from += len
          return seq
        })}
        {(cfg.intro || cfg.outro) && <Bookends cfg={cfg} W={L.width} H={L.height} total={total} />}
        {cfg.progressBar !== 'off' && <ProgressBar where={cfg.progressBar} W={L.width} H={L.height} />}
      </div>
      {music && musicSrc && <Music src={musicSrc} music={music} spans={spans} total={total} hasVoice={!!assets.mic} />}
      {voices.map(({ v, at }) => (
        <Sequence key={v.id} from={Math.round(at * fps)} durationInFrames={Math.max(1, Math.round((v.duration + 0.2) * fps))} layout="none">
          <Audio src={assets.media![v.file]} volume={v.volume} />
        </Sequence>))}
      {sfx.map((e, i) => (
        <Sequence key={'fx' + i} from={Math.round(e.at * fps)} durationInFrames={Math.round(0.6 * fps)} layout="none">
          <Audio src={e.src} volume={cfg.sfxVolume} />
        </Sequence>))}
    </AbsoluteFill>
  )
}

/** Design size of the composition (even numbers for 4:2:0 encoders). */
export function compositionSize(p: ScreencastProps) {
  const L = layout(p.events, p.config)
  return { width: L.width, height: L.height }
}

/**
 * Output size for a quality setting (0 = design size): same aspect as the design, both dimensions even integers.
 * The setting names the shorter side, so "1080p" is 1920×1080 for landscape and 1080×1920 for 9:16.
 */
export function outputSize(design: { width: number; height: number }, outputHeight: number, aspect: RenderConfig['aspect'] = 'source') {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? null
  const short = Math.min(design.width, design.height)
  // Platform shapes get exact platform sizes (1080×1920, 1080×1080, 1080×1350…) at the chosen quality, even when the
  // cropped screen is smaller: the composition lays itself out at whatever size it is given. "Original" keeps the design's size.
  if (ratio !== null) {
    const t = outputHeight || short
    return ratio >= 1 ? { width: even(t * ratio), height: even(t) } : { width: even(t), height: even(t / ratio) }
  }
  const target = !outputHeight || outputHeight >= short ? short : outputHeight
  const s = target / short
  return { width: even(design.width * s), height: even(design.height * s) }
}
