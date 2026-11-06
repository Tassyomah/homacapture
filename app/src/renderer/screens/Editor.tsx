import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { Screencast, compositionSize, placedAt } from '../../video/Screencast'
import { insertsWithin, keptDuration, keptRanges, nextSlot, outToSrc, playLen, srcToOut } from '../../video/ranges'
import { ASPECTS, ASSET_LABEL, CAPTION_STYLES, EXPORT_PRESETS, LOOKS, STICKER_EMOJI, STICKER_SHAPES, TEXT_FONTS, defaultConfig, type AnimOut, type Blend, type BrandKit, type ClipAnim, type ClipOp, type InsertClip, type Keyframe, type OverlayShape, type VoiceFx, type Look, type Sticker, type TextAnim, type Transition, type Analysis, type BackdropFill, type Background, type CameraCorner, type CameraShape, type CaptionStyle, type Chapter, type Cut, type DerivedAsset, type ExportProgress, type ManualZoom, type Mask, type MusicTrack, type Overlay, type Project, type Proposal, type RenderConfig, type ScreencastProps, type SpeedRange, type TextPop, type TextStyle, type Voiceover, type Transcript, type TranscriptSegment } from '../../shared/types'
import { smoothCursor } from '../../video/motion'
import { revealLabel } from '../platform'
import { IconArrowBackUp, IconArrowForwardUp, IconBadgeCc, IconBrush, IconColorFilter, IconCopy, IconDownload, IconLetterT, IconLink, IconMicrophone, IconMoodSmile, IconMusic, IconPhoto, IconPlayerPause, IconPlayerPlay, IconPlus, IconRestore, IconScissors, IconSnowflake, IconSparkles, IconTrash, IconUpload, IconWand, IconX, IconZoomIn, IconZoomOut } from '@tabler/icons-react'
import { Timeline, fmt, fmtShort, piecesOf, sameItem, type DragMode, type Item, type RangeAction } from './Timeline'
import { Direct } from './Direct'
import { Director, type DirectorState, type DirectorStatus } from './Director'
import { TranscriptPanel, fillerRanges, type TranscribeStatus } from './TranscriptPanel'
import { ContentMap } from './ContentMap'
import { ContentCard } from './ContentCard'
import { SharePanel } from './SharePanel'
import { niceName } from './Home'
import { buildContent, thumbnailTimes } from '../content'
import { generateAssets } from '../generate'
import { autoEdit, keyPhrase } from '../autoedit'

const FPS = 60
const RATES = [0.5, 0.75, 1.25, 1.5, 2, 3]
type Panel = 'media' | 'text' | 'stickers' | 'audio' | 'captions' | 'effects' | 'brand' | 'smart'
const TEXT_LOOKS: { id: string; label: string; patch: Partial<TextPop>; css: React.CSSProperties }[] = [
  { id: 'pop', label: 'Pop', patch: { style: 'pop', color: undefined, bg: undefined }, css: { color: '#FB8B73', background: '#14140F' } },
  { id: 'title', label: 'Title card', patch: { style: 'title', color: undefined, bg: undefined }, css: { color: '#14140F', background: '#EFEEE8' } },
  { id: 'plain', label: 'Plain', patch: { style: 'pop', color: '#EFEEE8', bg: undefined }, css: { color: '#EFEEE8', background: '#55554F' } },
  { id: 'coral', label: 'Coral block', patch: { style: 'pop', color: '#14140F', bg: '#FB8B73' }, css: { color: '#14140F', background: '#FB8B73' } },
  { id: 'indigo', label: 'Indigo block', patch: { style: 'pop', color: '#EFEEE8', bg: '#6E71E8' }, css: { color: '#EFEEE8', background: '#6E71E8' } },
  { id: 'ink', label: 'Ink block', patch: { style: 'pop', color: '#EFEEE8', bg: '#14140F' }, css: { color: '#EFEEE8', background: '#14140F' } },
]
const VOICE_FX: [VoiceFx, string][] = [['none', 'Normal'], ['deep', 'Deep'], ['high', 'High'], ['radio', 'Radio'], ['robot', 'Robot'], ['echo', 'Echo']]
const IN_ANIMS: [ClipAnim, string][] = [['none', 'Cut'], ['fade', 'Fade'], ['zoom', 'Zoom'], ['slide', 'Slide']]
const OUT_ANIMS: [AnimOut, string][] = [['none', 'Cut'], ['fade', 'Fade'], ['slide', 'Slide'], ['shrink', 'Shrink']]
const isPicture = (f: string) => /\.(png|jpe?g|webp|gif)$/i.test(f), isClip = (f: string) => /\.(mp4|webm|mov|m4v)$/i.test(f)
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`
const SHAPE: Record<CameraShape, string> = { off: 'Hidden', circle: 'Circle', rounded: 'Rounded' }
const BGS: { id: Background; label: string; css: string }[] = [
  { id: 'indigo', label: 'Indigo', css: 'linear-gradient(135deg,#6E71E8,#8B78D6)' },
  { id: 'coral', label: 'Coral', css: 'linear-gradient(135deg,#FB8B73,#F5C36A)' },
  { id: 'ink', label: 'Ink', css: '#14140F' },
  { id: 'paper', label: 'Paper', css: '#EFEEE8' },
]

/** Everything the user can change; one snapshot per undo step. */
type Edits = { config: RenderConfig; cuts: Cut[]; assets: DerivedAsset[]; zooms: ManualZoom[]; speeds: SpeedRange[]; masks: Mask[]; texts: TextPop[]; overlays: Overlay[]; stickers: Sticker[]; music: MusicTrack | null; voiceovers: Voiceover[]; inserts: InsertClip[]; splits: number[]; chapters: Chapter[]; highlights: [number, number][]; director: DirectorState; autoEditedAt?: string }

export function Editor({ project }: { project: Project }) {
  // Saved edits win; defaults fill in settings that did not exist when the project was last saved.
  const [edits, setEdits] = useState<Edits>(() => ({
    config: { ...defaultConfig, ...(project.file?.config ?? {}) }, cuts: project.file?.cuts ?? [],
    assets: project.file?.assets ?? [], zooms: project.file?.zooms ?? [], speeds: project.file?.speeds ?? [], masks: project.file?.masks ?? [],
    texts: project.file?.texts ?? [], overlays: project.file?.overlays ?? [], stickers: project.file?.stickers ?? [], music: project.file?.music ?? null, voiceovers: project.file?.voiceovers ?? [], inserts: project.file?.inserts ?? [], splits: project.file?.splits ?? [], autoEditedAt: project.file?.autoEditedAt,
    chapters: project.file?.chapters ?? [], highlights: project.file?.highlights ?? [],
    director: project.file?.director ?? { accepted: [], rejected: [] },
  }))
  const { assets, zooms, speeds, masks, texts, overlays, stickers, music, voiceovers, inserts, splits, chapters, highlights, director } = edits
  const [media, setMedia] = useState<Record<string, string>>(project.assets.media ?? {})
  const [cutout, setCutout] = useState<string | null>(project.assets.cutout ?? null)
  const [matting, setMatting] = useState<string | null>(null)
  const upload = project.events.source === 'import'
  // Which asset is being edited: the master, or one derivative (add-on §5: derivatives stay editable).
  const [selected, setSelected] = useState<string>('master')
  const asset = assets.find((a) => a.id === selected) ?? null
  const config: RenderConfig = asset ? { ...edits.config, ...asset.config } : edits.config
  const cuts: Cut[] = asset ? asset.cuts : edits.cuts
  // A version keeps only the clips that stand inside what it keeps.
  const shownInserts = useMemo(() => (asset ? insertsWithin(project.events, asset.cuts, inserts) : inserts), [asset, inserts, project.events])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [dstatus, setDstatus] = useState<DirectorStatus>({ kind: 'idle' })
  const [transcript, setTranscript] = useState<Transcript | null>(project.transcript)
  const [tstatus, setTstatus] = useState<TranscribeStatus>({ kind: 'idle' })
  const history = useRef<{ past: Edits[]; future: Edits[] }>({ past: [], future: [] })
  const dirty = useRef(false)
  const [, bump] = useState(0)
  const [prog, setProg] = useState<ExportProgress | null>(null)
  const [queue, setQueue] = useState<{ total: number; done: number; current: string } | null>(null)
  const [format, setFormat] = useState<'mp4' | 'gif'>('mp4')
  const [playheadSrc, setPlayheadSrc] = useState(0)
  const [panel, setPanel] = useState<Panel>('media')
  const [exporting, setExporting] = useState(false)
  const [tlScale, setTlScale] = useState(1)
  const [working, setWorking] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ it: Item; x: number; y: number } | null>(null)
  const [brand, setBrandState] = useState<BrandKit>({ colors: ['#FB8B73', '#6E71E8', '#14140F', '#EFEEE8'], font: 'Aeonik', handle: '', logo: null })
  const [lengths, setLengths] = useState<Record<string, number>>({})
  const wordsInput = useRef<HTMLInputElement>(null)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [sel, setSel] = useState<Item | null>(null)
  const [playing, setPlaying] = useState(false)
  const playerRef = useRef<PlayerRef>(null)
  useEffect(() => window.narrate.onExportProgress(setProg), [])
  // Time left while rendering, from the pace so far (shown once there is enough to go on).
  const renderStart = useRef<number | null>(null)
  useEffect(() => { if (prog?.stage === 'rendering' && prog.progress === 0) renderStart.current = Date.now(); if (prog?.stage !== 'rendering') renderStart.current = null }, [prog])
  const eta = (() => {
    if (prog?.stage !== 'rendering' || !renderStart.current || prog.progress < 0.03) return null
    const left = ((Date.now() - renderStart.current) / prog.progress) * (1 - prog.progress) / 1000
    return left < 60 ? 'under a minute left' : `about ${Math.round(left / 60)} min left`
  })()

  /** Apply a change as a new undo step. */
  const apply = useCallback((next: (e: Edits) => Edits) => {
    setEdits((e) => {
      const n = next(e)
      history.current.past.push(e); history.current.future = []
      if (history.current.past.length > 100) history.current.past.shift()
      dirty.current = true
      return n
    })
  }, [])
  // A drag on the preview or timeline is one undo step: the snapshot is taken as it starts, then changes flow in quietly.
  const editsNow = useRef(edits); editsNow.current = edits
  const gestureStart = () => { history.current.past.push(editsNow.current); history.current.future = []; dirty.current = true; bump((n) => n + 1) }
  const quiet = (next: (e: Edits) => Edits) => { dirty.current = true; setEdits(next) }
  /** Edit the selected asset's config (override) or the master's. */
  const set = <K extends keyof RenderConfig>(k: K, v: RenderConfig[K]) => apply((e) => asset
    ? { ...e, assets: e.assets.map((a) => a.id === asset.id ? { ...a, config: { ...a.config, [k]: v } } : a) }
    : { ...e, config: { ...e.config, [k]: v } })
  /** Edit the selected asset's cut list or the master's. */
  const setCuts = (f: (c: Cut[]) => Cut[]) => apply((e) => asset
    ? { ...e, assets: e.assets.map((a) => a.id === asset.id ? { ...a, cuts: f(a.cuts) } : a) }
    : { ...e, cuts: f(e.cuts) })
  const undo = () => { const p = history.current.past.pop(); if (!p) return; history.current.future.push(edits); dirty.current = true; setEdits(p); bump((n) => n + 1) }
  const redo = () => { const f = history.current.future.pop(); if (!f) return; history.current.past.push(edits); dirty.current = true; setEdits(f); bump((n) => n + 1) }

  // Autosave (spec §61): every change is written to project.json shortly after it happens.
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => {
      window.narrate.saveProject(project.dir, { version: 1, config: edits.config, cuts: edits.cuts, assets, zooms, speeds, masks, texts, overlays, stickers, music, voiceovers, inserts, splits, autoEditedAt: edits.autoEditedAt,
        chapters, highlights, director, savedAt: new Date().toISOString() })
        .catch((e) => console.warn('autosave failed', e))
    }, 400)
    return () => clearTimeout(t)
  }, [edits, assets, zooms, speeds, masks, texts, overlays, stickers, music, voiceovers, inserts, splits, chapters, highlights, director, project.dir])

  // Smart Director (add-on §7–9): analyse on first open (cached in analysis.json afterwards), show progress meanwhile.
  const runAnalysis = useCallback((force = false) => {
    setDstatus({ kind: 'running', step: 'audio' })
    window.narrate.analyzeProject(project.dir, force)
      .then((a) => { setAnalysis(a); setDstatus({ kind: 'idle' }) })
      .catch((e: Error) => setDstatus(/not available/i.test(e.message) ? { kind: 'unavailable', message: e.message } : { kind: 'error', message: e.message }))
  }, [project.dir])
  useEffect(() => { runAnalysis(false) }, [runAnalysis])
  useEffect(() => window.narrate.onRecorderEvent((e) => {
    if (e.event === 'analyzing' && e.step !== 'done') setDstatus({ kind: 'running', step: e.step })
    if (e.event === 'transcribing' && e.stage !== 'done') setTstatus({ kind: 'running', message: e.message ?? (e.stage === 'transcribing' && e.done != null && e.total ? `Transcribing… ${Math.round(e.done / e.total * 100)}%` : 'Transcribing…') })
  }), [])

  // Transcript (spec §43): on demand; cached in transcript.json. Filler words become extra Smart Director proposals (§42).
  const transcribe = () => {
    setTstatus({ kind: 'running', message: 'Starting the speech engine…' })
    window.narrate.transcribeProject(project.dir).then((t) => { setTranscript(t); setTstatus({ kind: 'idle' }) })
      .catch((e: Error) => setTstatus({ kind: 'error', message: e.message }))
  }
  // Smart edit (uploads): a first edit made on request, never on its own: cuts, punch-ins, text pops, captions. Running it
  // again replaces only what it made itself (ids "auto-…") and keeps the user's own additions. Undo takes it all back.
  const runAutoEdit = (tr: Transcript) => {
    const r = autoEdit(project.events, tr)
    // On a re-run the user's own caption look and sound-effects choice stay; the first run sets them.
    apply((e) => ({ ...e, cuts: r.cuts, config: { ...e.config, ...r.config,
      captions: e.autoEditedAt && e.config.captions !== 'off' ? e.config.captions : r.config.captions ?? e.config.captions,
      sfx: e.autoEditedAt ? e.config.sfx : true, voice: micClean || project.assets.micClean ? 'clean' : e.config.voice },
      zooms: [...e.zooms.filter((z) => !z.id.startsWith('auto-')), ...r.zooms], texts: [...e.texts.filter((x) => !x.id.startsWith('auto-') || x.style === 'name'), ...r.texts],
      autoEditedAt: new Date().toISOString() }))
  }
  const [smartWanted, setSmartWanted] = useState(false)     // pressed before the transcript existed: run once it arrives
  const smartEdit = () => { if (transcript) runAutoEdit(transcript); else { setSmartWanted(true); if (tstatus.kind !== 'running') transcribe() } }
  useEffect(() => { if (smartWanted && transcript) { setSmartWanted(false); runAutoEdit(transcript) } }, [smartWanted, transcript])
  useEffect(() => { if (tstatus.kind === 'error') setSmartWanted(false) }, [tstatus.kind])
  const smartBusy = smartWanted && tstatus.kind === 'running'
  const autoState = smartBusy ? `Smart edit · ${tstatus.message.replace(/…$/, '')}` : null

  const analysisWithFillers = useMemo<Analysis | null>(() => {
    if (!analysis) return null
    if (!transcript) return analysis
    const fill = fillerRanges(transcript).map((f, i): Proposal => ({ id: `filler-${i}`, type: 'REMOVE', start: Math.max(0, f.start - 0.05), end: f.end + 0.05, reason: `filler word “${f.word}”`, confidence: 'medium' }))
    if (!fill.length) return analysis
    const proposals = [...analysis.proposals.filter((p) => !p.id.startsWith('filler-')), ...fill]
    return { ...analysis, proposals, summary: { ...analysis.summary, REMOVE: proposals.filter((p) => p.type === 'REMOVE').length,
      removableSeconds: Math.round(proposals.filter((p) => p.type === 'REMOVE').reduce((s, p) => s + p.end - p.start, 0) * 100) / 100 } }
  }, [analysis, transcript])
  // Voice clean-up (spec §16): produces mic.clean.wav beside the raw track and switches the project to it.
  const [micClean, setMicClean] = useState<string | null>(project.assets.micClean)
  const [enhancing, setEnhancing] = useState<string>('idle')
  const enhance = () => {
    setEnhancing('Measuring…')
    window.narrate.enhanceAudio(project.dir).then((p) => { setMicClean(p.assets.micClean); project.assets.micClean = p.assets.micClean; setEnhancing('idle'); set('voice', 'clean') })
      .catch((e: Error) => { setEnhancing('idle'); alert(e.message) })
  }
  // Clean the voice automatically the first time a recording with a mic opens; the raw track stays one click away.
  useEffect(() => { if (project.assets.mic && !project.assets.micClean) enhance() }, [])
  useEffect(() => window.narrate.onRecorderEvent((e) => { if (e.event === 'enhancing' && e.step !== 'done') setEnhancing(e.step === 'measure' ? 'Measuring…' : 'Cleaning…') }), [])
  // Content (add-on §13): copy from the transcript + chapters; thumbnails rendered from the polished master on request.
  const [thumbs, setThumbs] = useState<{ path: string; url: string }[]>([])
  const [thumbStatus, setThumbStatus] = useState<'idle' | 'running' | string>('idle')
  const makeThumbs = () => {
    setThumbStatus('running')
    const times = thumbnailTimes(project.events, edits.cuts, speeds, chapters, highlights, analysis)
    window.narrate.renderThumbnails(project.dir, edits.config, edits.cuts, times, { zooms, speeds, masks, texts, overlays, stickers, music, voiceovers, inserts })
      .then((t) => { setThumbs(t); setThumbStatus('idle') })
      .catch((e: Error) => setThumbStatus(e.message))
  }
  const removeSentence = (s: TranscriptSegment) => setCuts((c) => [...c, [s.start, s.end]])
  const restoreSentence = (s: TranscriptSegment) => setCuts((c) => c.filter(([a, b]) => !(a <= s.start + 0.05 && b >= s.end - 0.05)))

  const acceptProposal = (e: Edits, p: Proposal): Edits => {
    const d = { ...e.director, accepted: [...e.director.accepted.filter((id) => id !== p.id), p.id], rejected: e.director.rejected.filter((id) => id !== p.id) }
    if (p.type === 'REMOVE') return { ...e, director: d, cuts: [...e.cuts, [p.start, p.end]] }
    if (p.type === 'CHAPTER') return { ...e, director: d, chapters: [...e.chapters.filter((c) => Math.abs(c.t - p.start) > 0.5), { t: p.start, title: `Section ${e.chapters.length + 2}` }].sort((a, b) => a.t - b.t) }
    if (p.type === 'HIGHLIGHT') return { ...e, director: d, highlights: [...e.highlights, [p.start, p.end]] }
    if (p.type === 'SPEED') return { ...e, director: d, speeds: [...e.speeds.filter((s) => s.end <= p.start || s.start >= p.end), { start: p.start, end: p.end, rate: p.rate ?? 1.5 }] }
    return { ...e, director: d }
  }
  const onAccept = (p: Proposal) => apply((e) => acceptProposal(e, p))
  const onAcceptAll = (ps: Proposal[]) => apply((e) => ps.reduce(acceptProposal, e))
  const onReject = (p: Proposal) => apply((e) => ({ ...e, director: { ...e.director, rejected: [...e.director.rejected, p.id], accepted: e.director.accepted.filter((id) => id !== p.id) } }))
  const onDismiss = () => apply((e) => ({ ...e, director: { ...e.director, dismissedAt: new Date().toISOString() } }))

  const props: ScreencastProps = useMemo(() => ({ assets: { ...project.assets, micClean, media, cutout }, events: project.events, config, cuts, zooms, speeds, masks, texts, overlays, stickers, music, voiceovers, inserts: shownInserts, transcript }),
    [project, micClean, media, cutout, config, cuts, zooms, speeds, masks, texts, overlays, stickers, music, voiceovers, shownInserts, transcript])
  const size = compositionSize(props)
  const kept = useMemo(() => keptRanges(project.events, cuts, speeds, shownInserts), [project.events, cuts, speeds, shownInserts])
  const pieces = useMemo(() => piecesOf(kept, splits), [kept, splits])
  const frames = Math.max(1, Math.ceil(keptDuration(project.events, cuts, speeds, shownInserts) * FPS))
  const pauses = project.events.pauses?.length ?? 0
  const busy = prog && (prog.stage === 'bundling' || prog.stage === 'rendering')

  // Player ↔ timeline: the player runs in output time, the timeline shows source time.
  useEffect(() => {
    const p = playerRef.current; if (!p) return
    const h = (e: { detail: { frame: number } }) => setPlayheadSrc(outToSrc(kept, e.detail.frame / FPS))
    p.addEventListener('frameupdate', h); return () => p.removeEventListener('frameupdate', h)
  }, [kept])
  const seekSrc = (tSrc: number) => {
    const t = Math.max(0, tSrc)
    setPlayheadSrc(t); playerRef.current?.seekTo(Math.min(frames - 1, Math.round(srcToOut(kept, t) * FPS)))
  }

  // Cutting (spec §39): trim to the playhead, or mark a start then an end. All reversible.
  const dur = project.events.videoDuration
  // Never let a cut remove the whole video (spec §41: never delete without showing); at least half a second must stay.
  const addCut = (a: number, b: number) => {
    if (Math.abs(b - a) < 0.1) return false
    const next: Cut[] = [...cuts, [Math.min(a, b), Math.max(a, b)]]
    if (keptDuration(project.events, next, speeds, shownInserts) < 0.5) { alert('That would remove the whole video. Select a shorter stretch.'); return false }
    setCuts(() => next); return true
  }
  const restore = (i: number) => setCuts((c) => c.filter((_, k) => k !== i))

  // Manual zoom (spec §26), speed (§40), privacy blur (§49): over a selected stretch, or a default length at the playhead.
  // Whatever is created becomes the selection, so its settings open in the inspector straight away.
  const W = project.events.display.width, H = project.events.display.height
  const zoomAt = (t: number, duration: number) => {
    const pos = smoothCursor(project.events, t) ?? project.events.focus ?? [W / 2, H / 2]
    const id = newId('z')
    apply((e) => ({ ...e, zooms: [...e.zooms, upload ? { id, t, duration, x: Math.round(pos[0]), y: Math.round(pos[1]), level: 1.3, snap: true }
      : { id, t, duration, x: Math.round(pos[0]), y: Math.round(pos[1]), level: Math.max(1.5, e.config.zoom) }] }))
    setSel({ kind: 'zoom', id })
  }
  const maskAt = (start: number, end: number) => {
    const pos = smoothCursor(project.events, start) ?? [W / 2, H / 2]
    const w = Math.round(W * 0.2), h = Math.round(H * 0.1), id = newId('m')
    apply((e) => ({ ...e, masks: [...e.masks, { id, start, end, kind: 'blur',
      x: Math.round(Math.max(0, Math.min(W - w, pos[0] - w / 2))), y: Math.round(Math.max(0, Math.min(H - h, pos[1] - h / 2))), w, h }] }))
    setSel({ kind: 'mask', id })
  }
  const speedOver = (a: number, b: number) => {
    if (b - a < 0.5) { alert('Select at least half a second to change its speed.'); return }
    const next = [...speeds.filter((x) => x.end <= a || x.start >= b), { start: a, end: b, rate: 1.5 }]
    apply((e) => ({ ...e, speeds: next }))
    setSel({ kind: 'speed', i: next.length - 1 })
  }
  const textAt = (a: number, b: number) => {
    const ws = (transcript?.segments ?? []).flatMap((s) => s.words).filter((w) => w.start >= a - 0.05 && w.end <= b + 0.05)
    const k = ws.length ? keyPhrase(ws) : null
    const id = newId('t')
    apply((e) => ({ ...e, texts: [...e.texts, { id, t: k?.start ?? a, duration: Math.max(1, Math.min(3, b - a)), text: k?.text ?? (ws.slice(0, 3).map((w) => w.word).join(' ') || 'Your words'), style: 'pop' as TextStyle }]
      .sort((x, y) => x.t - y.t) }))
    setSel({ kind: 'text', id })
  }
  // Music, B-roll and background pictures: the file is copied into the project, then used from there.
  const pickMedia = async (kind: 'music' | 'broll' | 'image') => {
    try {
      const m = await window.narrate.addMedia(project.dir, kind)
      if (m) setMedia((x) => ({ ...x, [m.file]: m.url }))
      return m
    } catch (e) { alert((e as Error).message); return null }
  }
  const brollAt = async (a: number, b: number) => {
    const m = await pickMedia('broll'); if (!m) return
    const id = newId('o'), kind = m.kind === 'video' ? 'video' : 'image'
    const duration = Math.max(0.5, Math.min(b - a < 0.5 ? 3 : b - a, m.duration ?? 60))
    apply((e) => ({ ...e, overlays: [...e.overlays, { id, t: a, duration, file: m.file, kind, name: m.name, fit: 'full', length: m.duration } as Overlay].sort((x, y) => x.t - y.t) }))
    setSel({ kind: 'broll', id })
  }
  const stickerAt = (a: number, b: number) => {
    const id = newId('k')
    apply((e) => ({ ...e, stickers: [...e.stickers, { id, t: a, duration: Math.max(0.8, Math.min(4, b - a < 0.5 ? 2 : b - a)), emoji: '🔥', x: 0.78, y: 0.2, size: 0.2, rotate: -8 }].sort((x, y) => x.t - y.t) }))
    setSel({ kind: 'sticker', id })
  }
  const editSticker = (id: string, patch: Partial<Sticker>) => apply((e) => ({ ...e, stickers: e.stickers.map((x) => x.id === id ? { ...x, ...patch } : x) }))
  const removeSticker = (id: string) => apply((e) => ({ ...e, stickers: e.stickers.filter((x) => x.id !== id) }))
  const editOverlay = (id: string, patch: Partial<Overlay>) => apply((e) => ({ ...e, overlays: e.overlays.map((o) => o.id === id ? { ...o, ...patch } : o) }))
  const removeOverlay = (id: string) => apply((e) => ({ ...e, overlays: e.overlays.filter((o) => o.id !== id) }))
  const addMusic = async () => {
    const m = await pickMedia('music'); if (!m) return
    apply((e) => ({ ...e, music: { file: m.file, name: m.name, volume: e.music?.volume ?? 0.3, duck: e.music?.duck ?? true } }))
  }
  // Voiceover from typed text with one of the Mac's own voices, placed at the playhead.
  const [voiceList, setVoiceList] = useState<{ name: string; lang: string }[]>([])
  const [vo, setVo] = useState<{ text: string; voice: string; busy: boolean }>({ text: '', voice: 'Samantha', busy: false })
  useEffect(() => { if (window.narrate.platform === 'darwin') window.narrate.listVoices().then((v) => { setVoiceList(v); if (v.length && !v.some((x) => x.name === 'Samantha')) setVo((o) => ({ ...o, voice: v[0].name })) }).catch(() => {}) }, [])
  const addVoice = async () => {
    const text = vo.text.trim(); if (!text) return
    setVo((o) => ({ ...o, busy: true }))
    try {
      const r = await window.narrate.speak(project.dir, text, vo.voice)
      setMedia((x) => ({ ...x, [r.file]: r.url }))
      const id = newId('v'), t = playheadSrc
      apply((e) => ({ ...e, voiceovers: [...e.voiceovers, { id, t, text, voice: vo.voice, file: r.file, duration: r.duration, volume: 1 }].sort((a, b) => a.t - b.t) }))
      setVo((o) => ({ ...o, text: '', busy: false })); setSel({ kind: 'voice', id })
    } catch (err) { setVo((o) => ({ ...o, busy: false })); alert((err as Error).message) }
  }
  const editVoice = (id: string, patch: Partial<Voiceover>) => apply((e) => ({ ...e, voiceovers: e.voiceovers.map((x) => x.id === id ? { ...x, ...patch } : x) }))
  const removeVoice = (id: string) => apply((e) => ({ ...e, voiceovers: e.voiceovers.filter((x) => x.id !== id) }))
  const setMusic = (patch: Partial<MusicTrack>) => apply((e) => ({ ...e, music: e.music ? { ...e.music, ...patch } : null }))
  const removeBackground = () => {
    setMatting('Cutting you out…')
    window.narrate.matteProject(project.dir)
      .then((p) => { setCutout(p.assets.cutout ?? null); setMatting(null); if (config.backdrop === 'off') set('backdrop', 'blur') })
      .catch((e: Error) => { setMatting(null); alert(e.message) })
  }
  useEffect(() => window.narrate.onRecorderEvent((e) => { if (e.event === 'matting') setMatting(`Cutting you out… ${Math.round((e.done / Math.max(1, e.total)) * 100)}%`) }), [])
  const editText = (id: string, patch: Partial<TextPop>) => apply((e) => ({ ...e, texts: e.texts.map((x) => x.id === id ? { ...x, ...patch } : x) }))
  const removeText = (id: string) => apply((e) => ({ ...e, texts: e.texts.filter((x) => x.id !== id) }))
  const zoomHere = () => zoomAt(playheadSrc, 2.5)
  const maskHere = () => maskAt(playheadSrc, Math.min(dur, playheadSrc + 5))
  const rangeAction = (act: RangeAction) => {
    if (!range) return
    const [a, b] = range
    if (act === 'cut') { if (a >= dur || b > dur + 0.01) alert('Click the clip on the timeline, then Delete.'); else { const i = cuts.length; if (addCut(a, b)) setSel({ kind: 'cut', i }) } }
    if (act === 'zoom') zoomAt(a, Math.max(0.5, b - a))
    if (act === 'speed') speedOver(a, b)
    if (act === 'mask') maskAt(a, Math.max(a + 0.5, b))
    if (act === 'text') textAt(a, b)
    if (act === 'broll') void brollAt(a, b)
    if (act === 'sticker') stickerAt(a, b)
    setRange(null)
  }
  const editZoom = (id: string, patch: Partial<ManualZoom>) => apply((e) => ({ ...e, zooms: e.zooms.map((z) => z.id === id ? { ...z, ...patch } : z) }))
  const removeZoom = (id: string) => apply((e) => ({ ...e, zooms: e.zooms.filter((z) => z.id !== id) }))
  const removeSpeed = (i: number) => apply((e) => ({ ...e, speeds: e.speeds.filter((_, k) => k !== i) }))
  const editMask = (id: string, patch: Partial<Mask>) => apply((e) => ({ ...e, masks: e.masks.map((m) => m.id === id ? { ...m, ...patch } : m) }))
  const removeMask = (id: string) => apply((e) => ({ ...e, masks: e.masks.filter((m) => m.id !== id) }))
  const setSpeedRateAt = (i: number, rate: number) => apply((e) => ({ ...e, speeds: e.speeds.map((s, k) => k === i ? { ...s, rate } : s) }))

  // Asset Studio (add-on §13): generate the standard set from the analysis; each is master + its own cuts + overrides.
  const generate = () => apply((e) => ({ ...e, assets: generateAssets({
    ev: project.events, analysis, masterCuts: e.cuts, chapters: e.chapters, highlights: e.highlights, masterSavedAt: project.file?.savedAt ?? null }) }))
  const removeAsset = (id: string) => { if (selected === id) setSelected('master'); apply((e) => ({ ...e, assets: e.assets.filter((a) => a.id !== id) })) }
  const assetDuration = (a: DerivedAsset | null) => keptDuration(project.events, a ? a.cuts : edits.cuts, speeds, a ? insertsWithin(project.events, a.cuts, inserts) : inserts)
  const exportOne = (a: DerivedAsset | null) => window.narrate.exportProject(project.dir, a ? { ...edits.config, ...a.config } : edits.config, a ? a.cuts : edits.cuts, a ? a.name : 'master', format, { zooms, speeds, masks, texts, overlays, stickers, music, voiceovers, inserts: a ? insertsWithin(project.events, a.cuts, inserts) : inserts })
  const exportAll = async () => {
    const list: (DerivedAsset | null)[] = [null, ...assets]
    setQueue({ total: list.length, done: 0, current: 'Master' })
    for (let i = 0; i < list.length; i++) {
      setQueue({ total: list.length, done: i, current: list[i]?.name ?? 'Master' })
      try { await exportOne(list[i]) } catch { /* progress shows the error for this asset; keep going */ }
    }
    setQueue(null)
  }


  // The selection must still exist (undo can take it away).
  const selItem = !sel ? null
    : sel.kind === 'cut' ? (cuts[sel.i] ? sel : null)
    : sel.kind === 'speed' ? (!asset && speeds[sel.i] ? sel : null)
    : sel.kind === 'zoom' ? (!asset && zooms.some((z) => z.id === sel.id) ? sel : null)
    : sel.kind === 'text' ? (!asset && texts.some((x) => x.id === sel.id) ? sel : null)
    : sel.kind === 'broll' ? (!asset && overlays.some((x) => x.id === sel.id) ? sel : null)
    : sel.kind === 'sticker' ? (!asset && stickers.some((x) => x.id === sel.id) ? sel : null)
    : sel.kind === 'voice' ? (!asset && voiceovers.some((x) => x.id === sel.id) ? sel : null)
    : sel.kind === 'insert' ? (!asset && inserts.some((x) => x.id === sel.id) ? sel : null)
    : sel.kind === 'piece' ? (pieces.some((p) => !p.ins && sameItem(sel, { kind: 'piece', a: p.start, b: p.end })) ? sel : null)
    : (!asset && masks.some((m) => m.id === sel.id) ? sel : null)
  const removeItem = (it: Item) => {
    if (it.kind === 'cut') restore(it.i)
    if (it.kind === 'zoom') removeZoom(it.id)
    if (it.kind === 'speed') removeSpeed(it.i)
    if (it.kind === 'mask') removeMask(it.id)
    if (it.kind === 'text') removeText(it.id)
    if (it.kind === 'broll') removeOverlay(it.id)
    if (it.kind === 'sticker') removeSticker(it.id)
    if (it.kind === 'voice') removeVoice(it.id)
    if (it.kind === 'insert') removeInsert(it.id)
    if (it.kind === 'piece') addCut(it.a, it.b)
    setSel(null)
  }

  // Player state for the play button (the player's own controls are hidden; the transport below drives it).
  useEffect(() => {
    const p = playerRef.current; if (!p) return
    const on = () => setPlaying(true), off = () => setPlaying(false)
    p.addEventListener('play', on); p.addEventListener('pause', off); p.addEventListener('ended', off)
    return () => { p.removeEventListener('play', on); p.removeEventListener('pause', off); p.removeEventListener('ended', off) }
  }, [])

  // Keyboard (shown in every tooltip): Space play, arrows step, C/Z/S/B act on the selected stretch, Delete removes the
  // selected block, Esc clears, Ctrl/Cmd+Z / Y undo and redo. Ignored while typing in a field.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, select, textarea')) return
      const k = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (k === 'b') { e.preventDefault(); splitHere() }
        if (k === 'd' && selItem) { e.preventDefault(); void duplicate(selItem) }
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
        return
      }
      if (k === ' ') { e.preventDefault(); playerRef.current?.toggle() }
      else if (k === 'escape') { setRange(null); setSel(null); setMenu(null) }
      else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); seekSrc(playheadSrc + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 5 : 1)) }
      else if ((k === 'delete' || k === 'backspace') && selItem) removeItem(selItem)
      else if (range && k === 'c') rangeAction('cut')
      else if (range && !asset && k === 'z') rangeAction('zoom')
      else if (range && !asset && k === 's') rangeAction('speed')
      else if (range && !asset && k === 'b') rangeAction('mask')
      else if (range && !asset && k === 't') rangeAction('text')
      else if (range && !asset && k === 'r') rangeAction('broll')
      else if (range && !asset && k === 'k') rangeAction('sticker')
      else if (!range && !asset && k === 'z') zoomHere()
      else if (!range && !asset && k === 'b') maskHere()
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })

  const pendingCount = analysisWithFillers && !asset
    ? analysisWithFillers.proposals.filter((p) => p.type !== 'ZOOM' && !director.accepted.includes(p.id) && !director.rejected.includes(p.id)).length : 0
  const panels: { id: Panel; label: string; Icon: typeof IconPhoto; show: boolean; badge?: number }[] = [
    { id: 'media', label: 'Media', Icon: IconPhoto, show: !asset },
    { id: 'text', label: 'Text', Icon: IconLetterT, show: !asset },
    { id: 'stickers', label: 'Stickers', Icon: IconMoodSmile, show: !asset },
    { id: 'audio', label: 'Audio', Icon: IconMusic, show: true },
    { id: 'captions', label: 'Captions', Icon: IconBadgeCc, show: !!project.assets.mic },
    { id: 'effects', label: 'Effects', Icon: IconColorFilter, show: true },
    { id: 'brand', label: 'Brand', Icon: IconBrush, show: !asset },
    { id: 'smart', label: 'Smart', Icon: IconSparkles, show: !asset, badge: pendingCount },
  ]
  const shownPanel = panels.find((t) => t.id === panel && t.show) ? panel : 'effects'
  const outLen = keptDuration(project.events, cuts, speeds, shownInserts)
  const go = (t: Panel) => { setPanel(t) }
  const seg = <T extends string | number | boolean>(value: T, opts: [T, string][], onPick: (v: T) => void) => (
    <div className="seg">{opts.map(([v, l]) => <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onPick(v)}>{l}</button>)}</div>)
  const slider = (label: string, shown: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void, tip?: string) => (
    <div className="control"><div className="lbl"><span data-tip={tip}>{label}</span><span>{shown}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--p': `${((value - min) / (max - min || 1)) * 100}%` } as React.CSSProperties} /></div>)
  const captionPicker = () => (
    <div className="control"><div className="lbl"><span>Captions</span></div>
      <div className="capstyles">{CAPTION_STYLES.map((c) => (
        <button key={c.id} className={'cap-' + c.id + (config.captions === c.id ? ' on' : '')} onClick={() => set('captions', c.id as CaptionStyle)}>
          <span className="cap-sample">{c.id === 'off' ? '—' : c.id === 'word' ? <b>THIS</b> : c.id === 'box' ? <>THIS <b>ONE</b></> : c.id === 'karaoke' ? <>THIS <b>ONE</b></> : <>This <b>one</b></>}</span>
          <span>{c.label}</span></button>))}</div>
      {config.captions !== 'off' && <div className="row-btns">
        <button className={config.capHighlight ? 'on' : ''} aria-pressed={config.capHighlight} onClick={() => set('capHighlight', !config.capHighlight)}>Highlight key words</button>
        <button className={config.capEmoji ? 'on' : ''} aria-pressed={config.capEmoji} onClick={() => set('capEmoji', !config.capEmoji)}>Add emoji</button></div>}</div>)
  const paneHead = (title: string, sub: string, close?: boolean) => (
    <div className="pane-head"><div><h3>{title}</h3><p className="note">{sub}</p></div>
      {close && <button className="icon" aria-label="Close" data-tip="Close · Esc" onClick={() => setSel(null)}><IconX size={16} /></button>}</div>)


  // ---------- Direct actions: everything below acts at once, at the playhead, and selects what it made.
  const runTool = async <T,>(label: string, job: () => Promise<T>): Promise<T | null> => {
    setWorking(label)
    try { return await job() } catch (e) { alert((e as Error).message); return null } finally { setWorking(null) }
  }
  const itemSpan = (it: Item): [number, number] | null => {
    if (it.kind === 'text') { const x = texts.find((y) => y.id === it.id); return x ? [x.t, x.t + x.duration] : null }
    if (it.kind === 'sticker') { const x = stickers.find((y) => y.id === it.id); return x ? [x.t, x.t + x.duration] : null }
    if (it.kind === 'broll') { const x = overlays.find((y) => y.id === it.id); return x ? [x.t, x.t + x.duration] : null }
    if (it.kind === 'voice') { const x = voiceovers.find((y) => y.id === it.id); return x ? [x.t, x.t + x.duration] : null }
    if (it.kind === 'zoom') { const x = zooms.find((y) => y.id === it.id); return x ? [x.t, x.t + x.duration] : null }
    if (it.kind === 'mask') { const x = masks.find((y) => y.id === it.id); return x ? [x.start, x.end] : null }
    return null
  }
  // Selecting something off-screen brings the playhead to it, so you always see what you are editing.
  const pick = (it: Item | null) => {
    setExporting(false); setSel(it); setMenu(null)
    const span = it && itemSpan(it)
    if (span && (playheadSrc < span[0] || playheadSrc >= span[1])) seekSrc(span[0] + Math.min(0.4, (span[1] - span[0]) / 2))
  }
  const addText = (patch: Partial<TextPop> = { style: 'pop' }, text = 'Your words') => {
    const id = newId('t'), t = playheadSrc
    const name = patch.style === 'name'
    apply((e) => ({ ...e, texts: [...e.texts, { id, t, duration: name ? 4 : 3, text, style: 'pop' as TextStyle, ...(name ? {} : { x: 0.5, y: 0.3 }), ...patch }].sort((a, b) => a.t - b.t) }))
    setExporting(false); setSel({ kind: 'text', id })
    setTimeout(() => { wordsInput.current?.focus(); wordsInput.current?.select() }, 60)
  }
  const addSticker = (patch: Partial<Sticker>) => {
    const id = newId('k')
    apply((e) => ({ ...e, stickers: [...e.stickers, { id, t: playheadSrc, duration: 2.5, x: 0.5, y: 0.35, size: 0.22, rotate: -6, ...patch }].sort((a, b) => a.t - b.t) }))
    setExporting(false); setSel({ kind: 'sticker', id })
  }
  /** A file becomes a clip in the main line at the playhead (a clip you are standing on is split there). */
  const clipAtPlayhead = (file: string, name: string, kind: 'image' | 'video', length: number | undefined, at = playheadSrc, cut?: [number, number]) => {
    const id = newId('c')
    apply((e) => {
      // Standing on another clip: the new one lands right after it.
      const inClip = e.inserts.find((i) => at >= i.v && at <= i.v + (i.out - i.in))
      const place = inClip ? inClip.at + 0.001 : Math.min(at, project.events.videoDuration)
      return { ...e, cuts: cut ? [...e.cuts, cut] : e.cuts, inserts: [...e.inserts, { id, at: place, v: nextSlot(project.events, e.inserts), file, kind, name, in: 0, out: kind === 'image' ? 3 : (length ?? 5), volume: 1, length: kind === 'image' ? 60 : length }] }
    })
    setExporting(false); setSel({ kind: 'insert', id })
  }
  const overlayAtPlayhead = (file: string, name: string, kind: 'image' | 'video', length: number | undefined, patch: Partial<Overlay> = {}) => {
    const id = newId('o')
    apply((e) => ({ ...e, overlays: [...e.overlays, { id, t: playheadSrc, duration: Math.min(4, length ?? 4), file, kind, name, fit: 'card', length, x: 0.5, y: 0.4, scale: 1, rotate: 0, ...patch } as Overlay].sort((a, b) => a.t - b.t) }))
    setExporting(false); setSel({ kind: 'broll', id })
  }
  const importMedia = async () => { const m = await pickMedia('broll'); if (m?.duration) setLengths((l) => ({ ...l, [m.file]: m.duration! })) }
  const editInsert = (id: string, patch: Partial<InsertClip>) => apply((e) => ({ ...e, inserts: e.inserts.map((x) => x.id === id ? { ...x, ...patch } : x) }))
  const removeInsert = (id: string) => apply((e) => {
    const ins = e.inserts.find((x) => x.id === id); if (!ins) return e
    const on = (t: number) => t >= ins.v && t < ins.v + (ins.length ?? 60) + 1
    return { ...e, inserts: e.inserts.filter((x) => x.id !== id), texts: e.texts.filter((x) => !on(x.t)), stickers: e.stickers.filter((x) => !on(x.t)), overlays: e.overlays.filter((x) => !on(x.t)), voiceovers: e.voiceovers.filter((x) => !on(x.t)) }
  })
  const rangeAt = (t: number) => kept.find((r) => t >= r.start && t < r.end) ?? null
  const splitHere = () => {
    const t = playheadSrc
    if (selItem?.kind === 'text' || selItem?.kind === 'sticker') {
      const span = itemSpan(selItem)
      if (span && t > span[0] + 0.1 && t < span[1] - 0.1) {
        const id = newId(selItem.kind === 'text' ? 't' : 'k'), left = t - span[0], right = span[1] - t, sid = selItem.id
        if (selItem.kind === 'text') apply((e) => ({ ...e, texts: e.texts.flatMap((x) => x.id === sid ? [{ ...x, duration: left }, { ...x, id, t, duration: right }] : [x]) }))
        else apply((e) => ({ ...e, stickers: e.stickers.flatMap((x) => x.id === sid ? [{ ...x, duration: left }, { ...x, id, t, duration: right }] : [x]) }))
        return
      }
    }
    const r = rangeAt(t); if (!r) return
    if (r.ins) {
      const o = t - r.start, ins = r.ins, len = ins.out - ins.in
      if (o < 0.1 || len - o < 0.1) return
      const id = newId('c')
      apply((e) => {
        const v = nextSlot(project.events, e.inserts), moved = (x: number) => x >= ins.v + o && x <= ins.v + len
        const shift = <X extends { t: number }>(x: X): X => moved(x.t) ? { ...x, t: v + (x.t - ins.v - o) } : x
        return { ...e, inserts: e.inserts.flatMap((x) => x.id === ins.id ? [{ ...x, out: x.in + o }, { ...x, id, v, in: x.in + o }] : [x]),
          texts: e.texts.map(shift), stickers: e.stickers.map(shift), overlays: e.overlays.map(shift), voiceovers: e.voiceovers.map(shift) }
      })
      return
    }
    if (t - r.start < 0.05 || r.end - t < 0.05) return
    apply((e) => ({ ...e, splits: [...e.splits.filter((x) => Math.abs(x - t) > 0.02), t] }))
  }
  const duplicate = async (it: Item) => {
    const copy = <X extends { id: string; t: number; duration: number }>(xs: X[], id: string, pre: string): X[] => { const x = xs.find((y) => y.id === id); return x ? [...xs, { ...x, id: newId(pre), t: x.t + x.duration }] : xs }
    if (it.kind === 'text') apply((e) => ({ ...e, texts: copy(e.texts, it.id, 't') }))
    if (it.kind === 'sticker') apply((e) => ({ ...e, stickers: copy(e.stickers, it.id, 'k') }))
    if (it.kind === 'broll') apply((e) => ({ ...e, overlays: copy(e.overlays, it.id, 'o') }))
    if (it.kind === 'voice') apply((e) => ({ ...e, voiceovers: copy(e.voiceovers, it.id, 'v') }))
    if (it.kind === 'zoom') apply((e) => ({ ...e, zooms: copy(e.zooms, it.id, 'z') }))
    if (it.kind === 'insert') apply((e) => { const x = e.inserts.find((y) => y.id === it.id); return x ? { ...e, inserts: [...e.inserts, { ...x, id: newId('c'), v: nextSlot(project.events, e.inserts) }] } : e })
    if (it.kind === 'piece') {
      const m = await runTool('Copying…', () => window.narrate.processClip(project.dir, 'copy', it.a, it.b))
      if (m) { setMedia((x) => ({ ...x, [m.file]: m.url })); clipAtPlayhead(m.file, 'Copy', 'video', m.duration, it.b) }
    }
  }
  const freezeHere = async () => {
    if (rangeAt(playheadSrc)?.ins) { alert('Freeze works on your main video. Move the playhead onto it first.'); return }
    const t = playheadSrc
    const m = await runTool('Freezing…', () => window.narrate.grabFrame(project.dir, t))
    if (m) { setMedia((x) => ({ ...x, [m.file]: m.url })); clipAtPlayhead(m.file, 'Freeze frame', 'image', undefined, t) }
  }
  /** Reverse, smooth slow motion or steadying: makes a new file and swaps it in. The original stays underneath the cut, so undo brings it back. */
  const processItem = async (it: Item, op: ClipOp) => {
    const label = op === 'reverse' ? 'Reversing…' : op === 'slowmo' ? 'Making slow motion…' : 'Steadying…'
    if (it.kind === 'piece') {
      const m = await runTool(label, () => window.narrate.processClip(project.dir, op, it.a, it.b))
      if (m) { setMedia((x) => ({ ...x, [m.file]: m.url })); clipAtPlayhead(m.file, m.name, 'video', m.duration, it.a, [it.a, it.b]) }
    }
    if (it.kind === 'insert') {
      const c = inserts.find((x) => x.id === it.id); if (!c || c.kind !== 'video') return
      const m = await runTool(label, () => window.narrate.processClip(project.dir, op, c.in, c.out, c.file))
      if (m) { setMedia((x) => ({ ...x, [m.file]: m.url })); apply((e) => ({ ...e, inserts: e.inserts.map((x) => x.id === c.id ? { ...x, file: m.file, name: m.name, in: 0, out: m.duration ?? c.out - c.in, length: m.duration, v: nextSlot(project.events, e.inserts) } : x) })) }
    }
  }
  const setPieceSpeed = (a: number, b: number, rate: number) => apply((e) => ({ ...e, speeds: [...e.speeds.filter((x) => x.end <= a + 0.01 || x.start >= b - 0.01), ...(rate === 1 ? [] : [{ start: a, end: b, rate }])] }))
  const chooseVoice = async (fx: VoiceFx) => {
    if (fx === 'none') { set('voiceFx', 'none'); return }
    const m = await runTool('Changing the voice…', () => window.narrate.voiceChange(project.dir, fx, config.voice === 'clean'))
    if (m) { setMedia((x) => ({ ...x, [m.file]: m.url + `?v=${Date.now()}` })); set('voiceFx', fx) }
  }
  const [key, setKey] = useState({ color: '#00FF00', similarity: 0.22 })
  const keyOverlay = async (o: Overlay) => {
    const m = await runTool('Removing the background colour…', () => window.narrate.chromaKey(project.dir, o.file, key.color, key.similarity))
    if (m) { setMedia((x) => ({ ...x, [m.file]: m.url })); editOverlay(o.id, { file: m.file }) }
  }
  useEffect(() => { void window.narrate.getBrand().then(setBrandState).catch(() => {}) }, [])
  const saveBrand = (patch: Partial<BrandKit>) => { const b = { ...brand, ...patch }; setBrandState(b); void window.narrate.setBrand(b) }
  const addLogo = async () => {
    if (!brand.logo) return
    const m = await runTool('Adding your logo…', () => window.narrate.addMediaPath(project.dir, brand.logo!))
    if (m) { setMedia((x) => ({ ...x, [m.file]: m.url })); overlayAtPlayhead(m.file, 'Logo', 'image', undefined, { x: 0.86, y: 0.08, scale: 0.28, shape: 'rect', duration: Math.min(10, outLen) }) }
  }
  // A real frame from this video on the look tiles, so a filter shows what it does to your footage.
  const [poster, setPoster] = useState<string | null>(null)
  useEffect(() => { void window.narrate.grabFrame(project.dir, Math.min(1.5, dur / 2), true).then((m) => setPoster(m.url)).catch(() => {}) }, [project.dir])

  // ---------- On-preview editing
  const selKey = selItem && (selItem.kind === 'text' || selItem.kind === 'sticker' || selItem.kind === 'broll') ? `${selItem.kind}:${selItem.id}` : null
  const selOverlay = selItem?.kind === 'broll' ? overlays.find((o) => o.id === selItem.id) : undefined
  const canMove = !!selKey && !(selOverlay?.fit === 'full')
  const posFromScreen = (k: string) => {
    const el = document.querySelector(`[data-hc-item="${k}"]`)?.getBoundingClientRect(), F = document.querySelector('[data-hc-frame]')?.getBoundingClientRect()
    return el && F ? { x: (el.left + el.width / 2 - F.left) / F.width, y: (el.top + el.height / 2 - F.top) / F.height } : { x: 0.5, y: 0.3 }
  }
  type Pose = Omit<Keyframe, 'at'>
  const poseOf = (it: Item): { pose: Pose; kf?: Keyframe[]; age: number } | null => {
    if (it.kind === 'text') { const x = texts.find((y) => y.id === it.id); if (!x) return null; const age = playheadSrc - x.t
      const base = { x: x.x ?? posFromScreen(`text:${x.id}`).x, y: x.y ?? posFromScreen(`text:${x.id}`).y, scale: x.scale ?? 1, rotate: x.rotate ?? 0, opacity: x.opacity ?? 1 }
      return { pose: placedAt(base, x.kf, age), kf: x.kf, age } }
    if (it.kind === 'sticker') { const x = stickers.find((y) => y.id === it.id); if (!x) return null; const age = playheadSrc - x.t
      return { pose: placedAt({ x: x.x, y: x.y, scale: x.size, rotate: x.rotate, opacity: x.opacity ?? 1 }, x.kf, age), kf: x.kf, age } }
    if (it.kind === 'broll') { const x = overlays.find((y) => y.id === it.id); if (!x) return null; const age = playheadSrc - x.t
      const base = { x: x.x ?? posFromScreen(`broll:${x.id}`).x, y: x.y ?? posFromScreen(`broll:${x.id}`).y, scale: x.scale ?? 1, rotate: x.rotate ?? 0, opacity: x.opacity ?? 1 }
      return { pose: placedAt(base, x.kf, age), kf: x.kf, age } }
    return null
  }
  const withPose = (it: Item, e: Edits, kf: Keyframe[] | undefined, p: Partial<Pose>): Edits => {
    if (it.kind === 'text') return { ...e, texts: e.texts.map((x) => x.id === it.id ? { ...x, ...p, kf } : x) }
    if (it.kind === 'broll') return { ...e, overlays: e.overlays.map((x) => x.id === it.id ? { ...x, ...p, kf } : x) }
    if (it.kind === 'sticker') { const { scale, ...rest } = p; return { ...e, stickers: e.stickers.map((x) => x.id === it.id ? { ...x, ...rest, ...(scale != null ? { size: scale } : {}), kf } : x) } }
    return e
  }
  /** Changing an item: with movement points it edits the point at the playhead (adding one if needed), otherwise the item itself. */
  const pose = (p: Partial<Pose>, how: (f: (e: Edits) => Edits) => void = quiet) => {
    if (!selItem) return
    const cur = poseOf(selItem); if (!cur) return
    if (cur.kf?.length) {
      const at = Math.round(Math.max(0, cur.age) * 100) / 100
      const next = [...cur.kf.filter((k) => Math.abs(k.at - at) > 0.04), { ...cur.pose, ...p, at }].sort((a, b) => a.at - b.at)
      how((e) => withPose(selItem, e, next, {}))
    } else how((e) => withPose(selItem, e, undefined, p))
  }
  const addMovementPoint = () => {
    if (!selItem) return
    const cur = poseOf(selItem); if (!cur) return
    const at = Math.round(Math.max(0, cur.age) * 100) / 100
    const start = cur.kf?.length ? cur.kf : (at > 0.05 ? [{ ...cur.pose, at: 0 }] : [])
    apply((e) => withPose(selItem, e, [...start.filter((k) => Math.abs(k.at - at) > 0.04), { ...cur.pose, at }].sort((a, b) => a.at - b.at), cur.kf?.length ? {} : cur.pose))
  }
  const clearMovement = () => { if (selItem) apply((e) => withPose(selItem, e, undefined, {})) }

  // ---------- Timeline dragging: items follow the pointer; anything that reshuffles the video lands on release.
  const dragOrigin = useRef<{ t: number; end: number } | null>(null)
  const dragStart = (it: Item) => { pick(it); dragOrigin.current = null; const span = itemSpan(it); if (span) { gestureStart(); dragOrigin.current = { t: span[0], end: span[1] } } }
  const dragItem = (it: Item, mode: DragMode, tOut: number) => {
    const o = dragOrigin.current; if (!o) return
    const t = outToSrc(kept, tOut), min = 0.3
    const span = (): [number, number] => mode === 'move' ? [t, t + (o.end - o.t)] : mode === 'l' ? [Math.min(t, o.end - min), o.end] : [o.t, Math.max(t, o.t + min)]
    const [a, b] = span()
    const timed = <X extends { id: string; t: number; duration: number }>(xs: X[], cap?: (x: X) => number) => xs.map((x) => x.id === (it as { id: string }).id ? { ...x, t: a, duration: Math.min(b - a, cap?.(x) ?? Infinity) } : x)
    if (it.kind === 'text') quiet((e) => ({ ...e, texts: timed(e.texts) }))
    if (it.kind === 'sticker') quiet((e) => ({ ...e, stickers: timed(e.stickers) }))
    if (it.kind === 'broll') quiet((e) => ({ ...e, overlays: timed(e.overlays, (x) => x.kind === 'video' ? x.length ?? Infinity : Infinity) }))
    if (it.kind === 'zoom') quiet((e) => ({ ...e, zooms: timed(e.zooms) }))
    if (it.kind === 'voice' && mode === 'move') quiet((e) => ({ ...e, voiceovers: e.voiceovers.map((x) => x.id === it.id ? { ...x, t } : x) }))
    if (it.kind === 'mask') quiet((e) => ({ ...e, masks: e.masks.map((x) => x.id === it.id ? { ...x, start: a, end: b } : x) }))
  }
  const restoreStretch = (a: number, b: number) => setCuts((cs) => cs.flatMap(([x, y]): Cut[] => {
    const lo = Math.min(x, y), hi = Math.max(x, y)
    if (hi <= a || lo >= b) return [[x, y]]
    return [...(lo < a ? [[lo, a] as Cut] : []), ...(hi > b ? [[b, hi] as Cut] : [])]
  }))
  const dragEnd = (it: Item, mode: DragMode, tOut: number) => {
    if (dragOrigin.current) { dragOrigin.current = null; return }
    if (it.kind === 'insert') {
      const c = inserts.find((x) => x.id === it.id); if (!c) return
      const startOut = srcToOut(kept, c.v), len = c.out - c.in
      if (mode === 'move') {
        const r = kept.find((x) => { const s = srcToOut(kept, x.start); return tOut >= s && tOut < s + playLen(x) })
        const at = r?.ins ? r.ins.at + (tOut > srcToOut(kept, r.start) + playLen(r) / 2 ? 0.001 : -0.001) : outToSrc(kept, tOut)
        if (r?.ins?.id !== c.id) editInsert(c.id, { at: Math.max(0, Math.min(dur, at)) })
      } else if (mode === 'l') {
        if (c.kind === 'video') editInsert(c.id, { in: Math.max(0, Math.min(c.out - 0.2, c.in + (tOut - startOut))) })
        else editInsert(c.id, { out: Math.max(0.2, c.out - (tOut - startOut)) })
      } else editInsert(c.id, { out: Math.max(c.in + 0.2, Math.min(c.length ?? 60, c.in + (tOut - startOut))) })
      void len
    }
    if (it.kind === 'piece') {
      const r = pieces.find((p) => !p.ins && sameItem(it, { kind: 'piece', a: p.start, b: p.end })); if (!r) return
      const startOut = srcToOut(kept, r.start), endOut = startOut + playLen(r)
      if (mode === 'l') { const a = Math.max(0, r.start + (tOut - startOut) * r.rate); if (a > r.start) addCut(r.start, Math.min(a, r.end - 0.2)); else if (a < r.start) restoreStretch(a, r.start) }
      if (mode === 'r') { const b = Math.min(dur, r.end + (tOut - endOut) * r.rate); if (b < r.end) addCut(Math.max(b, r.start + 0.2), r.end); else if (b > r.end) restoreStretch(r.end, b) }
      setSel(null)
    }
  }

  // ---------- Right panel: follows what is selected
  const colorRow = (label: string, value: string | undefined, onPick: (c: string | undefined) => void, none?: string) => (
    <div className="control"><div className="lbl"><span>{label}</span></div>
      <div className="colors">{none && <button className={'none' + (!value ? ' on' : '')} aria-label={none} data-tip={none} onClick={() => onPick(undefined)} />}
        {[...new Set([...brand.colors, '#FFFFFF'])].map((c) => <button key={c} className={value?.toLowerCase() === c.toLowerCase() ? 'on' : ''} aria-label={c} style={{ background: c }} onClick={() => onPick(c)} />)}
        <label className="custom" data-tip="Any colour"><input type="color" value={value ?? '#FB8B73'} onChange={(e) => onPick(e.target.value)} /></label></div></div>)
  const movement = (it: Item) => {
    const cur = poseOf(it); if (!cur) return null
    const n = cur.kf?.length ?? 0
    return <div className="control"><div className="lbl"><span>Movement</span><span>{n ? `${n} point${n === 1 ? '' : 's'}` : ''}</span></div>
      <div className="row-btns"><button onClick={addMovementPoint}>Add point here</button>{n > 0 && <button onClick={clearMovement}>Clear</button>}</div>
      <span className="note">{n ? 'Move the playhead, then drag it on the video. It travels smoothly between points.' : 'Add a point, move the playhead, drag it somewhere else: it glides between them.'}</span></div>
  }
  const placeSliders = (it: Item, sizeMax = 3) => {
    const cur = poseOf(it); if (!cur) return null
    const big = it.kind === 'sticker'
    return <>
      {slider('Size', `${Math.round(cur.pose.scale * 100)}%`, big ? 0.08 : 0.2, big ? 0.8 : sizeMax, 0.01, cur.pose.scale, (v) => pose({ scale: v }, apply))}
      {slider('Tilt', `${Math.round(cur.pose.rotate)}°`, -180, 180, 1, cur.pose.rotate, (v) => pose({ rotate: v }, apply))}
      {slider('See-through', `${Math.round((1 - cur.pose.opacity) * 100)}%`, 0, 0.9, 0.01, 1 - cur.pose.opacity, (v) => pose({ opacity: 1 - v }, apply))}
    </>
  }
  const pieceTools = (it: Item, isVideo: boolean) => (
    <div className="control"><div className="lbl"><span>Tools</span></div>
      <div className="tools">
        <button onClick={splitHere} disabled={!!working}><IconScissors size={15} />Split here</button>
        <button onClick={() => void duplicate(it)} disabled={!!working}><IconCopy size={15} />Duplicate</button>
        {it.kind === 'piece' && <button onClick={() => void freezeHere()} disabled={!!working}><IconSnowflake size={15} />Freeze</button>}
        {isVideo && <>
          <button onClick={() => void processItem(it, 'reverse')} disabled={!!working}>Reverse</button>
          <button onClick={() => void processItem(it, 'slowmo')} disabled={!!working}>Smooth slow-mo</button>
          <button onClick={() => void processItem(it, 'stabilise')} disabled={!!working}>Stabilise</button></>}
      </div>{working && <span className="note">{working}</span>}</div>)

  const itemPane = (it: Item) => {
    const foot = (t: number) => (
      <div className="pane-foot"><button onClick={() => seekSrc(t)}>Jump to it</button>
        <button className="danger" onClick={() => removeItem(it)}><IconTrash size={15} />Delete</button></div>)
    if (it.kind === 'cut') {
      const [a, b] = [Math.min(...cuts[it.i]), Math.max(...cuts[it.i])]
      return <>{paneHead('Removed part', `${fmt(b - a)} is left out here. Nothing is deleted from your recording.`, true)}
        <div className="pane-foot"><button className="primary" onClick={() => removeItem(it)}><IconRestore size={15} />Bring it back</button></div></>
    }
    if (it.kind === 'piece') {
      const r = pieces.find((p) => !p.ins && sameItem(it, { kind: 'piece', a: p.start, b: p.end }))
      return <>{paneHead('Clip', `${fmt(r ? playLen(r) : it.b - it.a)} of your video.`, true)}
        {!asset && <div className="control"><div className="lbl"><span>Speed</span></div>
          {seg(r?.rate ?? 1, [0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((x) => [x, `${x}×`] as [number, string]), (v) => setPieceSpeed(it.a, it.b, v))}</div>}
        {!asset && pieceTools(it, true)}
        <div className="pane-foot"><button onClick={() => seekSrc(it.a)}>Jump to it</button>
          <button className="danger" onClick={() => removeItem(it)}><IconTrash size={15} />Delete</button></div></>
    }
    if (it.kind === 'insert') {
      const c = inserts.find((x) => x.id === it.id)!
      return <>{paneHead(c.name, `${fmt(c.out - c.in)} in your video. Drag it on the timeline to move it.`, true)}
        {media[c.file] && <div className="broll-thumb">{c.kind === 'video' ? <video src={media[c.file]} muted /> : <img src={media[c.file]} alt="" />}</div>}
        {c.kind === 'video' && slider('Volume', `${Math.round(c.volume * 100)}%`, 0, 1.5, 0.05, c.volume, (v) => editInsert(c.id, { volume: v }))}
        {c.kind === 'image' && slider('Show for', `${(c.out - c.in).toFixed(1)} s`, 0.5, 15, 0.1, c.out - c.in, (v) => editInsert(c.id, { out: c.in + v }))}
        <div className="control"><div className="lbl"><span>Comes in</span></div>{seg(c.animIn ?? 'none', IN_ANIMS, (v) => editInsert(c.id, { animIn: v }))}</div>
        <div className="control"><div className="lbl"><span>Goes out</span></div>{seg(c.animOut === 'fade' ? 'fade' : 'none', [['none', 'Cut'], ['fade', 'Fade']] as [AnimOut, string][], (v) => editInsert(c.id, { animOut: v }))}</div>
        {pieceTools(it, c.kind === 'video')}
        {foot(c.v)}</>
    }
    if (it.kind === 'text') {
      const x = texts.find((y) => y.id === it.id)!
      return <>{paneHead(x.style === 'name' ? 'Name tag' : 'Text', `${x.style === 'name' ? 'Slides in' : 'Pops up'} for ${x.duration.toFixed(1)} s. Drag it on the video to move it.`, true)}
        <div className="control"><div className="lbl"><span>{x.style === 'name' ? 'Name' : 'Words'}</span></div>
          <input ref={wordsInput} type="text" value={x.text} maxLength={60} onChange={(e) => editText(x.id, { text: e.target.value })} /></div>
        {x.style === 'name' && <div className="control"><div className="lbl"><span>Role</span></div>
          <input type="text" value={x.sub ?? ''} maxLength={48} placeholder="Principal engineer, Microsoft" onChange={(e) => editText(x.id, { sub: e.target.value })} /></div>}
        <div className="control"><div className="lbl"><span>Font</span></div>
          <select value={x.font ?? 'Aeonik'} onChange={(e) => editText(x.id, { font: e.target.value === 'Aeonik' ? undefined : e.target.value })} style={{ fontFamily: x.font }}>
            {[...new Set([brand.font, ...TEXT_FONTS])].map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
        {x.style !== 'name' && colorRow('Colour', x.color, (c) => editText(x.id, { color: c }), 'Default')}
        {x.style !== 'name' && colorRow('Background', x.bg, (c) => editText(x.id, { bg: c }), 'None')}
        {placeSliders(it)}
        {x.style !== 'name' && <div className="control"><div className="lbl"><span>Comes in</span></div>{seg(x.anim ?? 'pop', [['pop', 'Pop'], ['slide', 'Slide'], ['type', 'Type'], ['slam', 'Slam']] as [TextAnim, string][], (v) => editText(x.id, { anim: v }))}</div>}
        {x.style !== 'name' && <div className="control"><div className="lbl"><span>Goes out</span></div>{seg(x.animOut ?? 'none', OUT_ANIMS, (v) => editText(x.id, { animOut: v }))}</div>}
        {movement(it)}
        {slider('Show for', `${x.duration.toFixed(1)} s`, 0.6, 15, 0.1, x.duration, (v) => editText(x.id, { duration: v }))}
        {foot(x.t)}</>
    }
    if (it.kind === 'voice') {
      const v = voiceovers.find((y) => y.id === it.id)!
      return <>{paneHead('Voiceover', `${v.voice} · ${v.duration.toFixed(1)} s.`, true)}
        <p className="vo-quote">“{v.text}”</p>
        {slider('Volume', `${Math.round(v.volume * 100)}%`, 0.1, 1.5, 0.05, v.volume, (n) => editVoice(v.id, { volume: n }))}
        {foot(v.t)}</>
    }
    if (it.kind === 'sticker') {
      const k = stickers.find((y) => y.id === it.id)!
      return <>{paneHead('Sticker', `Shows for ${k.duration.toFixed(1)} s. Drag it on the video to move it.`, true)}
        <div className="control"><div className="lbl"><span>Sticker</span></div>
          <div className="stickers">{STICKER_EMOJI.map((em) => <button key={em} className={k.emoji === em ? 'on' : ''} onClick={() => editSticker(k.id, { emoji: em, shape: undefined })}>{em}</button>)}
            {STICKER_SHAPES.map((sh) => <button key={sh} className={!k.emoji && k.shape === sh ? 'on' : ''} aria-label={sh} data-tip={sh} onClick={() => editSticker(k.id, { emoji: undefined, shape: sh, color: k.color ?? 'coral' })}><i className={'shape ' + sh} /></button>)}</div></div>
        {!k.emoji && <div className="control"><div className="lbl"><span>Colour</span></div>
          <div className="swatches">{BGS.map((b) => <button key={b.id} className={(k.color ?? 'coral') === b.id ? 'on' : ''} aria-label={b.label} data-tip={b.label} onClick={() => editSticker(k.id, { color: b.id })}><span style={{ background: b.css }} /></button>)}</div></div>}
        {placeSliders(it)}
        {movement(it)}
        {slider('Show for', `${k.duration.toFixed(1)} s`, 0.5, 15, 0.1, k.duration, (v) => editSticker(k.id, { duration: v }))}
        {foot(k.t)}</>
    }
    if (it.kind === 'broll') {
      const o = overlays.find((y) => y.id === it.id)!
      return <>{paneHead('Overlay', `${o.name} · shows for ${o.duration.toFixed(1)} s.`, true)}
        {media[o.file] && <div className="broll-thumb">{o.kind === 'video' ? <video src={media[o.file]} muted /> : <img src={media[o.file]} alt="" />}</div>}
        <div className="control"><div className="lbl"><span>Fit</span></div>{seg(o.fit, [['card', 'Over the video'], ['full', 'Full screen']] as ['full' | 'card', string][], (v) => editOverlay(o.id, { fit: v }))}</div>
        {o.fit === 'card' && <div className="control"><div className="lbl"><span>Shape</span></div>{seg(o.shape ?? 'round', [['round', 'Rounded'], ['rect', 'Square'], ['circle', 'Circle'], ['heart', 'Heart'], ['star', 'Star']] as [OverlayShape, string][], (v) => editOverlay(o.id, { shape: v }))}</div>}
        {o.fit === 'card' && placeSliders(it)}
        {o.fit === 'full' && slider('See-through', `${Math.round((1 - (o.opacity ?? 1)) * 100)}%`, 0, 0.9, 0.01, 1 - (o.opacity ?? 1), (v) => editOverlay(o.id, { opacity: 1 - v }))}
        <div className="control"><div className="lbl"><span>Blend</span></div>{seg(o.blend ?? 'normal', [['normal', 'Normal'], ['screen', 'Screen'], ['multiply', 'Multiply'], ['overlay', 'Overlay']] as [Blend, string][], (v) => editOverlay(o.id, { blend: v }))}</div>
        <div className="control"><div className="lbl"><span>Comes in</span></div>{seg(o.animIn ?? 'none', IN_ANIMS, (v) => editOverlay(o.id, { animIn: v }))}</div>
        <div className="control"><div className="lbl"><span>Goes out</span></div>{seg(o.animOut ?? 'none', OUT_ANIMS, (v) => editOverlay(o.id, { animOut: v }))}</div>
        <div className="control"><div className="lbl"><span>Green screen</span></div>
          <div className="row-btns"><label className="keycolor"><input type="color" value={key.color} onChange={(e) => setKey((k) => ({ ...k, color: e.target.value }))} /></label>
            <button disabled={!!working} onClick={() => void keyOverlay(o)}>{working ?? 'Remove this colour'}</button></div>
          {slider('How much', `${Math.round(key.similarity * 100)}%`, 0.05, 0.5, 0.01, key.similarity, (v) => setKey((k) => ({ ...k, similarity: v })))}</div>
        {o.fit === 'card' && movement(it)}
        {slider('Show for', `${o.duration.toFixed(1)} s`, 0.5, Math.max(1, Math.min(30, o.length ?? 30)), 0.1, o.duration, (v) => editOverlay(o.id, { duration: v }))}
        {foot(o.t)}</>
    }
    if (it.kind === 'zoom') {
      const z = zooms.find((x) => x.id === it.id)!
      return <>{paneHead(z.snap ? 'Punch-in' : 'Zoom', z.snap ? 'Cuts to a closer framing on the speaker.' : 'Centred on where your cursor was.', true)}
        {slider('Zoom level', `${z.level.toFixed(1)}×`, 1.2, 4, 0.1, z.level, (v) => editZoom(z.id, { level: v }))}
        {slider('Hold for', `${z.duration.toFixed(1)} s`, 0.5, 15, 0.5, z.duration, (v) => editZoom(z.id, { duration: v }))}
        {foot(z.t)}</>
    }
    if (it.kind === 'speed') {
      const sp = speeds[it.i]
      return <>{paneHead('Speed', 'This stretch plays at a different speed.', true)}
        <div className="control"><div className="lbl"><span>Speed</span></div>
          {seg(sp.rate, RATES.map((r) => [r, `${r}×`] as [number, string]), (v) => setSpeedRateAt(it.i, v))}</div>
        {foot(sp.start)}</>
    }
    const m = masks.find((x) => x.id === it.id)!
    return <>{paneHead('Blur', 'Hides part of the screen.', true)}
      <div className="control"><div className="lbl"><span>Style</span></div>{seg(m.kind, [['blur', 'Blur'], ['solid', 'Solid box']], (v) => editMask(m.id, { kind: v }))}</div>
      {slider('Left', `${Math.round(m.x / W * 100)}%`, 0, W - m.w, 4, m.x, (v) => editMask(m.id, { x: v }))}
      {slider('Top', `${Math.round(m.y / H * 100)}%`, 0, H - m.h, 4, m.y, (v) => editMask(m.id, { y: v }))}
      {slider('Width', `${Math.round(m.w / W * 100)}%`, 40, W, 4, m.w, (v) => editMask(m.id, { w: v, x: Math.min(m.x, W - v) }))}
      {slider('Height', `${Math.round(m.h / H * 100)}%`, 24, H, 4, m.h, (v) => editMask(m.id, { h: v, y: Math.min(m.y, H - v) }))}
      {foot(m.start)}</>
  }

  /** Nothing selected: how the whole video is framed. */
  const videoPane = () => <>
    {paneHead('Video', 'Click anything on the video or the timeline to edit it.')}
    <div className="control"><div className="lbl"><span>Shape</span><span>{config.aspect === 'source' ? `${W}×${H}` : config.aspect}</span></div>
      {seg(config.aspect, ASPECTS.map((a) => [a.id, a.label] as [typeof config.aspect, string]), (v) => set('aspect', v))}
      {config.aspect !== 'source' && ASPECTS.find((a) => a.id === config.aspect)!.ratio! < 1 &&
        <span className="note">{upload ? 'Vertical and square crops stay on the speaker.' : 'Vertical and square crops follow your cursor and clicks.'}</span>}</div>
    <div className="control"><div className="lbl"><span>Background</span></div>
      <div className="swatches">{BGS.map((b) => (
        <button key={b.id} className={config.background === b.id ? 'on' : ''} aria-label={b.label} data-tip={b.label} onClick={() => set('background', b.id)}>
          <span style={{ background: b.css }} /></button>))}</div></div>
    {upload && window.narrate.platform === 'darwin' && <div className="control"><div className="lbl"><span>Background behind you</span></div>
      {!cutout ? <><button className="wide" disabled={!!matting} onClick={removeBackground}><IconWand size={16} />{matting ?? 'Remove background'}</button>
        <span className="note">Cuts you out of the video so you can blur what is behind you or swap it for a colour or a picture. Takes about half the video’s length, once.</span></>
        : <>{seg(config.backdrop, [['off', 'As filmed'], ['blur', 'Blur'], ['color', 'Colour'], ['image', 'Picture']] as [BackdropFill, string][], (v) => {
            if (v === 'image' && !config.backdropImage) { void pickMedia('image').then((m) => { if (m) apply((e) => ({ ...e, config: { ...e.config, backdrop: 'image', backdropImage: m.file } })) }); return }
            set('backdrop', v) })}
          {config.backdrop === 'color' && <div className="swatches">{BGS.map((b) => (
            <button key={b.id} className={config.backdropColor === b.id ? 'on' : ''} aria-label={b.label} data-tip={b.label} onClick={() => set('backdropColor', b.id)}>
              <span style={{ background: b.css }} /></button>))}</div>}
          {config.backdrop === 'image' && <button onClick={() => void pickMedia('image').then((m) => { if (m) set('backdropImage', m.file) })}><IconPhoto size={15} />Choose another picture</button>}</>}
    </div>}
    {!upload && slider('Automatic zoom', config.zoom === 1 ? 'Off' : `${config.zoom.toFixed(1)}×`, 1, 3, 0.1, config.zoom, (v) => set('zoom', v), 'How far it zooms in when you click. 1× turns it off.')}
    {slider('Padding', `${Math.round(config.padding * 100)}%`, 0, 0.2, 0.01, config.padding, (v) => set('padding', v), 'Space between the screen and the edge')}
    {slider('Corners', `${config.radius}px`, 0, 64, 2, config.radius, (v) => set('radius', v))}
    {!upload && slider('Cursor size', `${config.cursorScale.toFixed(1)}×`, 1, 3, 0.1, config.cursorScale, (v) => set('cursorScale', v))}
    {!!project.events.keys?.length && <div className="control"><div className="lbl"><span>Keyboard shortcuts</span><span>{project.events.keys.length} pressed</span></div>
      {seg(config.keycaps, [[true, 'Show'], [false, 'Hide']], (v) => set('keycaps', v))}</div>}
    {!!project.assets.camera && <>
      <div className="control"><div className="lbl"><span>Your camera</span></div>{seg(config.cameraShape, (['off', 'circle', 'rounded'] as CameraShape[]).map((s) => [s, SHAPE[s]] as [CameraShape, string]), (v) => set('cameraShape', v))}</div>
      {config.cameraShape !== 'off' && <>
        {slider('Camera size', `${Math.round(config.cameraSize * 100)}%`, 0.1, 0.4, 0.01, config.cameraSize, (v) => set('cameraSize', v))}
        <div className="control"><div className="lbl"><span>Corner</span></div>
          <div className="corners">{([['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']] as [CameraCorner, string][]).map(([c, l]) => (
            <button key={c} className={config.cameraCorner === c ? 'on' : ''} aria-label={l} data-tip={l} onClick={() => set('cameraCorner', c)}><i className={c} /></button>))}</div></div>
        <div className="control"><div className="lbl"><span>Mirror</span></div>{seg(config.cameraMirror, [[true, 'Mirrored'], [false, 'As others see you']], (v) => set('cameraMirror', v))}</div>
      </>}</>}
  </>

  const exportPane = () => <>
    {paneHead('Export', `${asset ? asset.name : 'Master'} · ${fmtShort(outLen)}${pauses > 0 ? ` · ${pauses} pause${pauses > 1 ? 's' : ''} removed` : ''}`)}
    <div className="control"><div className="lbl"><span>Made for</span></div>
      <select value="" onChange={(e) => { const pr = EXPORT_PRESETS.find((x) => x.id === e.target.value); if (pr) apply((ed) => asset
        ? { ...ed, assets: ed.assets.map((a) => a.id === asset.id ? { ...a, config: { ...a.config, ...pr.config } } : a) }
        : { ...ed, config: { ...ed.config, ...pr.config } }) }}>
        <option value="">Choose a platform…</option>
        {EXPORT_PRESETS.map((pr) => <option key={pr.id} value={pr.id}>{pr.label}</option>)}
      </select>
      <span className="note">Sets the shape, size and captions. You can still change them.</span></div>
    <div className="control"><div className="lbl"><span>File</span></div>{seg(format, [['mp4', 'Video (MP4)'], ['gif', 'GIF']], setFormat)}
      {format === 'gif' && <span className="note">Silent, 15 fps, small. Best for clips under 15 seconds.</span>}</div>
    {format === 'mp4' && <div className="control"><div className="lbl"><span>Quality</span></div>
      {seg(config.outputHeight, [[1080, '1080p'], [1440, '1440p'], [2160, '4K'], [0, 'Original']], (v) => set('outputHeight', v))}</div>}
    {format === 'mp4' && <div className="control"><div className="lbl"><span>Smoothness</span></div>
      {seg(config.outputFps ?? 60, [[60, '60 fps'], [30, '30 fps']] as [30 | 60, string][], (v) => set('outputFps', v))}
      <span className="note">{(config.outputFps ?? 60) === 60 ? 'Smoothest motion. 30 fps exports about twice as fast.' : 'Exports about twice as fast. Fine for most social posts.'}</span></div>}
    <button className="primary wide" disabled={!!busy || !!queue} onClick={() => { setProg({ stage: 'bundling', progress: 0 }); exportOne(asset).catch(() => {}) }}>
      <IconDownload size={16} />{busy ? (prog!.stage === 'bundling' ? 'Preparing…' : `Exporting ${Math.round(prog!.progress * 100)}%${eta ? ` · ${eta}` : ''}`) : `Export ${asset ? asset.name : 'master'}`}
    </button>
    {assets.length > 0 && <button className="wide" disabled={!!busy || !!queue} onClick={exportAll}>{queue ? `Exporting ${queue.done + 1} of ${queue.total}: ${queue.current}` : `Export all ${assets.length + 1} versions`}</button>}
    {busy && <div className="progress"><i style={{ width: `${prog!.progress * 100}%` }} /></div>}
    {prog?.stage === 'done' && prog.output && !queue && <button className="wide" onClick={() => window.narrate.reveal(prog.output!)}>{revealLabel}</button>}
    {prog?.stage === 'error' && <p className="err">{prog.message}</p>}
    <SharePanel file={prog?.stage === 'done' && prog.output && /\.mp4$/i.test(prog.output) ? prog.output : null} title={niceName(project.name)} />
  </>

  // ---------- Left panel: what you can add. One click adds it at the playhead.
  const library = Object.keys(media).filter((f) => { const n = f.split('/').pop() ?? ''; return !n.startsWith('.') && (isPicture(f) || isClip(f)) })
  const addPanel = () => {
    if (shownPanel === 'media') return <>
      <h3 className="drawer-title">Media</h3>
      <button className="wide" onClick={() => void importMedia()}><IconUpload size={16} />Import clips and pictures</button>
      {library.length ? <div className="gallery">{library.map((f) => {
        const clip = isClip(f), name = f.split('/').pop()!, len = lengths[f]
        return <div key={f} className="tile">
          <button className="tile-main" aria-label={`Add ${name} to the video`} data-tip="Add to the video here" onClick={() => clipAtPlayhead(f, name, clip ? 'video' : 'image', len)}>
            {clip ? <video src={media[f]} muted preload="metadata" onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (isFinite(d)) setLengths((l) => l[f] === d ? l : { ...l, [f]: d }) }} /> : <img src={media[f]} alt="" />}
            {clip && len != null && <span className="tile-len">{fmtShort(len)}</span>}</button>
          <button className="tile-over" data-tip="Show over the video" onClick={() => overlayAtPlayhead(f, name, clip ? 'video' : 'image', len)}>Overlay</button>
        </div> })}</div>
        : <p className="note">Bring in clips and pictures. Click one to add it to the video at the playhead, or Overlay to show it on top.</p>}
    </>
    if (shownPanel === 'text') return <>
      <h3 className="drawer-title">Text</h3>
      <button className="add-big" onClick={() => addText({ style: 'title', x: 0.5, y: 0.3 }, 'Your title')}>Add title</button>
      <button className="add-mid" onClick={() => addText()}>Add text</button>
      <button className="add-mid" onClick={() => addText({ style: 'name' }, 'Your name')}>Add name tag</button>
      <div className="control"><div className="lbl"><span>{selItem?.kind === 'text' ? 'Change the look' : 'Looks'}</span></div>
        <div className="text-looks">{TEXT_LOOKS.map((l) => <button key={l.id} style={l.css} aria-label={l.label} data-tip={l.label} onClick={() => selItem?.kind === 'text' ? editText(selItem.id, l.patch) : addText(l.patch)}>Aa</button>)}</div></div>
    </>
    if (shownPanel === 'stickers') return <>
      <h3 className="drawer-title">Stickers</h3>
      <div className="stickers big">{STICKER_EMOJI.map((em) => <button key={em} onClick={() => addSticker({ emoji: em })}>{em}</button>)}
        {STICKER_SHAPES.map((sh) => <button key={sh} aria-label={sh} data-tip={sh} onClick={() => addSticker({ shape: sh, color: 'coral' })}><i className={'shape ' + sh} /></button>)}</div>
      <span className="note">Click one to add it at the playhead, then drag it on the video.</span>
    </>
    if (shownPanel === 'audio') return <>
      <h3 className="drawer-title">Audio</h3>
      <div className="control"><div className="lbl"><span>Music</span>{music && <span>{music.name}</span>}</div>
        {!music ? <button onClick={addMusic}><IconMusic size={15} />Add music</button> : <>
          {slider('Music volume', `${Math.round(music.volume * 100)}%`, 0.05, 1, 0.05, music.volume, (v) => setMusic({ volume: v }))}
          {seg(music.duck, [[true, 'Dips when you talk'], [false, 'Same level']], (v) => setMusic({ duck: v }))}
          <div className="row-btns"><button onClick={addMusic}>Change</button><button className="danger" onClick={() => apply((e) => ({ ...e, music: null }))}><IconTrash size={15} />Remove</button></div></>}
        <span className="note">Use music you have the rights to; the YouTube Audio Library is safe.</span></div>
      {voiceList.length > 0 && <div className="control"><div className="lbl"><span>Voiceover</span><span>{voiceovers.length ? `${voiceovers.length} added` : ''}</span></div>
        <textarea rows={3} value={vo.text} maxLength={600} placeholder="Type what the voice should say" onChange={(e) => setVo((o) => ({ ...o, text: e.target.value }))} />
        <select value={vo.voice} onChange={(e) => setVo((o) => ({ ...o, voice: e.target.value }))}>
          {voiceList.map((v) => <option key={v.name} value={v.name}>{v.name} · {v.lang.replace('en_', '')}</option>)}</select>
        <button disabled={!vo.text.trim() || vo.busy} onClick={addVoice}><IconMicrophone size={15} />{vo.busy ? 'Making the voice…' : `Add at ${fmt(srcToOut(kept, playheadSrc))}`}</button></div>}
      {project.assets.mic && <div className="control"><div className="lbl"><span>Your voice</span></div>
        {micClean ? seg(config.voice, [['clean', 'Cleaned'], ['raw', 'As recorded']], (v) => set('voice', v))
          : <button disabled={enhancing !== 'idle'} onClick={enhance}>{enhancing === 'idle' ? 'Clean up voice' : enhancing}</button>}
        {slider('Voice volume', config.micVolume === 0 ? 'Muted' : `${Math.round(config.micVolume * 100)}%`, 0, 1.5, 0.05, config.micVolume, (v) => set('micVolume', v))}</div>}
      {project.assets.mic && <div className="control"><div className="lbl"><span>Voice changer</span></div>
        <div className="toggles">{VOICE_FX.map(([fx, l]) => <button key={fx} disabled={!!working} className={config.voiceFx === fx ? 'on' : ''} aria-pressed={config.voiceFx === fx} onClick={() => void chooseVoice(fx)}>{l}</button>)}</div>
        {working && <span className="note">{working}</span>}</div>}
      <div className="control"><div className="lbl"><span>Sound effects</span></div>
        {seg(config.sfx, [[true, 'On'], [false, 'Off']], (v) => set('sfx', v))}
        {config.sfx && slider('Effects volume', `${Math.round(config.sfxVolume * 100)}%`, 0.05, 1, 0.05, config.sfxVolume, (v) => set('sfxVolume', v))}
        <span className="note">A whoosh on every zoom and overlay, a pop on every text. Made in HomaCapture, so no copyright claims.</span></div>
      {project.assets.system && slider('Computer sound', config.systemVolume === 0 ? 'Muted' : `${Math.round(config.systemVolume * 100)}%`, 0, 1.5, 0.05, config.systemVolume, (v) => set('systemVolume', v))}
    </>
    if (shownPanel === 'captions') return <>
      <h3 className="drawer-title">Captions</h3>
      {transcript && captionPicker()}
      <TranscriptPanel transcript={transcript} status={tstatus} cuts={cuts} hasMic={!!project.assets.mic} playhead={playheadSrc}
        onCreate={transcribe} onSeek={seekSrc} onRemove={removeSentence} onRestore={restoreSentence} />
    </>
    if (shownPanel === 'effects') return <>
      <h3 className="drawer-title">Effects</h3>
      <div className="control"><div className="lbl"><span>Look</span></div>
        <div className="looks">{LOOKS.map((l) => (
          <button key={l.id} className={config.look === l.id ? 'on' : ''} onClick={() => set('look', l.id as Look)}>
            <span className="look-swatch" style={{ filter: l.css || undefined, backgroundImage: poster ? `url("${poster}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} /><span>{l.label}</span></button>))}</div></div>
      {slider('Brightness', `${Math.round(config.brightness * 100)}%`, 0.6, 1.4, 0.02, config.brightness, (v) => set('brightness', v))}
      {slider('Contrast', `${Math.round(config.contrast * 100)}%`, 0.6, 1.4, 0.02, config.contrast, (v) => set('contrast', v))}
      {slider('Saturation', `${Math.round(config.saturation * 100)}%`, 0, 1.8, 0.02, config.saturation, (v) => set('saturation', v))}
      {(config.brightness !== 1 || config.contrast !== 1 || config.saturation !== 1) && <button onClick={() => apply((e) => ({ ...e, config: { ...e.config, brightness: 1, contrast: 1, saturation: 1 } }))}><IconRestore size={15} />Reset adjustments</button>}
      <div className="control"><div className="lbl"><span>Transitions</span></div>
        <div className="toggles">{([['none', 'None'], ['zoom', 'Zoom'], ['flash', 'Flash'], ['blur', 'Blur'], ['whip', 'Whip']] as [Transition, string][]).map(([v, l]) => <button key={v} className={config.transition === v ? 'on' : ''} onClick={() => set('transition', v)}>{l}</button>)}</div>
        {config.transition !== 'none' && seg(config.transitionAt, [['big', 'Big cuts only'], ['all', 'Every cut']] as ['big' | 'all', string][], (v) => set('transitionAt', v))}</div>
      <div className="control"><div className="lbl"><span>Cinematic</span></div>
        <div className="toggles">{([['vignette', 'Dark edges'], ['grain', 'Film grain'], ['bars', 'Movie bars'], ['shake', 'Shake on punch-ins']] as ['vignette' | 'grain' | 'bars' | 'shake', string][]).map(([k, l]) => (
          <button key={k} className={config[k] ? 'on' : ''} aria-pressed={config[k]} onClick={() => set(k, !config[k])}>{l}</button>))}</div></div>
      <div className="control"><div className="lbl"><span>Progress bar</span></div>
        {seg(config.progressBar, [['off', 'Off'], ['top', 'Top'], ['bottom', 'Bottom']] as ['off' | 'top' | 'bottom', string][], (v) => set('progressBar', v))}</div>
      <div className="control"><div className="lbl"><span>Opening title</span></div>
        {seg(config.intro, [[false, 'Off'], [true, 'On']], (v) => { set('intro', v); if (v && !config.introTitle.trim()) set('introTitle', niceName(project.name)) })}
        {config.intro && <>
          <input type="text" value={config.introTitle} maxLength={40} placeholder="What this video is about" onChange={(e) => set('introTitle', e.target.value)} />
          <input type="text" value={config.introSub} maxLength={48} placeholder="Second line (optional)" onChange={(e) => set('introSub', e.target.value)} /></>}</div>
      <div className="control"><div className="lbl"><span>Closing card</span></div>
        {seg(config.outro, [[false, 'Off'], [true, 'On']], (v) => { set('outro', v); if (v && !config.outroSub.trim() && brand.handle) set('outroSub', brand.handle) })}
        {config.outro && <>
          <input type="text" value={config.outroText} maxLength={32} placeholder="Follow for more" onChange={(e) => set('outroText', e.target.value)} />
          <input type="text" value={config.outroSub} maxLength={48} placeholder="@yourhandle (optional)" onChange={(e) => set('outroSub', e.target.value)} /></>}</div>
    </>
    if (shownPanel === 'brand') return <>
      <h3 className="drawer-title">Brand kit</h3>
      <div className="control"><div className="lbl"><span>Colours</span></div>
        <div className="colors">{brand.colors.map((c, i) => <label key={i} className="custom big" style={{ background: c }}><input type="color" value={c} aria-label={`Brand colour ${i + 1}`} onChange={(e) => saveBrand({ colors: brand.colors.map((x, k) => k === i ? e.target.value : x) })} /></label>)}</div>
        <span className="note">These show up every time you pick a colour for text.</span></div>
      <div className="control"><div className="lbl"><span>Font</span></div>
        <select value={brand.font} onChange={(e) => saveBrand({ font: e.target.value })} style={{ fontFamily: brand.font }}>{TEXT_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
      <div className="control"><div className="lbl"><span>Handle</span></div>
        <input type="text" value={brand.handle} maxLength={40} placeholder="@yourhandle" onChange={(e) => saveBrand({ handle: e.target.value })} />
        <span className="note">Fills in on the closing card.</span></div>
      <div className="control"><div className="lbl"><span>Logo</span></div>
        <div className="row-btns"><button onClick={() => void window.narrate.pickBrandLogo().then((l) => { if (l) saveBrand({ logo: l }) })}>{brand.logo ? 'Change logo' : 'Choose logo'}</button>
          {brand.logo && <button disabled={!!working} onClick={() => void addLogo()}>Add to this video</button>}</div></div>
    </>
    return <>
      <h3 className="drawer-title">Smart</h3>
      {upload && <div className="control"><div className="lbl"><span>Smart edit</span></div>
        <button className="wide" disabled={smartBusy || !project.assets.mic} onClick={smartEdit}><IconWand size={16} />{smartBusy ? 'Working…' : edits.autoEditedAt ? 'Smart edit again' : 'Smart edit'}</button>
        <span className="note">Cuts pauses and filler words, punches in on the speaker, pops key words on screen and turns captions on. Undo brings everything back.</span></div>}
      <div className="control"><div className="lbl"><span>Shorts from this video</span></div>
        <button className="wide" disabled={dstatus.kind === 'running'} onClick={generate}><IconPlus size={16} />{assets.length ? 'Make them again' : 'Make shorts and versions'}</button>
        <span className="note">Vertical clips and teasers cut from the best moments. They appear at the top; each one stays editable.</span></div>
      <Director analysis={analysisWithFillers} status={dstatus} state={director} onAccept={onAccept} onReject={onReject} onAcceptAll={onAcceptAll}
        onDismiss={onDismiss} onSeek={seekSrc} onRerun={() => runAnalysis(true)} />
      <ContentMap chapters={chapters} transcript={transcript} duration={dur} playhead={playheadSrc} onSeek={seekSrc}
        onRename={(i, title) => apply((ed) => ({ ...ed, chapters: ed.chapters.map((x, k) => k === i ? { ...x, title } : x) }))}
        onRemove={(i) => apply((ed) => ({ ...ed, chapters: ed.chapters.filter((_, k) => k !== i) }))}
        onAddHere={() => apply((ed) => ({ ...ed, chapters: [...ed.chapters.filter((c) => Math.abs(c.t - playheadSrc) > 0.5), { t: playheadSrc, title: `Section ${ed.chapters.length + 2}` }].sort((a, b) => a.t - b.t) }))} />
      <ContentCard content={buildContent(transcript, chapters, keptDuration(project.events, edits.cuts, speeds))} thumbs={thumbs} thumbStatus={thumbStatus}
        onMakeThumbs={makeThumbs} onReveal={(p) => window.narrate.reveal(p)} revealLabel={revealLabel} hasTranscript={!!transcript} />
    </>
  }

  const hint = working ?? (range ? `${fmt(srcToOut(kept, range[1]) - srcToOut(kept, range[0]))} selected. Choose what to do with it above.` : `Final length ${fmtShort(outLen)}`)
  const onClipNow = rangeAt(playheadSrc)

  return (
    <div className="ed" onPointerDown={() => { if (menu) setMenu(null) }}>
      <header className="ed-head">
        <div className="versions">
          <button className={'ver' + (selected === 'master' ? ' on' : '')} onClick={() => { setSelected('master'); setSel(null) }} title="Your full edit. Versions start from it.">
            <b>Master</b><span>{fmtShort(assetDuration(null))}</span></button>
          {assets.map((a) => (
            <button key={a.id} className={'ver' + (selected === a.id ? ' on' : '')} onClick={() => { setSelected(a.id); setSel(null) }} title={a.note}>
              <b>{a.name}</b><span>{fmtShort(assetDuration(a))}{a.config.aspect ? ` · ${a.config.aspect}` : ''}</span>
              {selected === a.id && <i className="rm" role="button" aria-label={`Remove ${a.name}`} onClick={(e) => { e.stopPropagation(); removeAsset(a.id) }}><IconX size={12} /></i>}
            </button>))}
        </div>
        <span className="spacer" />
        {upload && project.assets.mic && <button className="smart-btn" disabled={smartBusy} onClick={smartEdit}
          data-tip="Cuts pauses and fillers, punches in on you, pops key words, adds captions. You can change or undo all of it.">
          <IconWand size={16} />{smartBusy ? 'Smart editing…' : edits.autoEditedAt ? 'Smart edit again' : 'Smart edit'}</button>}
        <button className="icon" aria-label="Undo" data-tip="Undo · Cmd+Z" disabled={history.current.past.length === 0} onClick={undo}><IconArrowBackUp size={18} /></button>
        <button className="icon" aria-label="Redo" data-tip="Redo · Cmd+Y" disabled={history.current.future.length === 0} onClick={redo}><IconArrowForwardUp size={18} /></button>
        <button onClick={() => { setSel(null); setExporting(true) }} data-tip="Export, then get a link anyone can watch"><IconLink size={16} />Share</button>
        <button className="primary" onClick={() => { setSel(null); setExporting(true) }}><IconDownload size={16} />Export</button>
      </header>
      {asset && <p className="ed-note">Editing <b>{asset.name}</b> · {ASSET_LABEL[asset.kind]}. {asset.note} Changes here leave the master untouched.</p>}
      <div className="ed-top">
        <nav className="rail">{panels.filter((t) => t.show).map((t) => (
          <button key={t.id} className={shownPanel === t.id ? 'on' : ''} onClick={() => go(t.id)}>
            <t.Icon size={20} stroke={1.6} /><span>{t.label}</span>{!!t.badge && <i className="badge">{t.badge}</i>}</button>))}</nav>
        <aside className="drawer">{addPanel()}</aside>
        <div className="stage">
          <Player ref={playerRef} component={Screencast} inputProps={props} durationInFrames={frames} fps={FPS} acknowledgeRemotionLicense
            compositionWidth={size.width} compositionHeight={size.height} clickToPlay={false} style={{ width: '100%', height: '100%' }} />
          <Direct selKey={selKey} canMove={canMove} onPick={(k) => { playerRef.current?.pause(); if (!k) { setSel(null); return } const [kind, id] = k.split(':') as ['text' | 'sticker' | 'broll', string]; setExporting(false); setSel({ kind, id }) }}
            onStart={gestureStart} onMove={(x, y) => pose({ x, y })} onScale={(v) => pose({ scale: v })} onRotate={(deg) => pose({ rotate: deg })}
            onEdit={() => { wordsInput.current?.focus(); wordsInput.current?.select() }}
            onDuplicate={() => { if (selItem) void duplicate(selItem) }} onDelete={() => { if (selItem) removeItem(selItem) }}
            scaleOf={() => (selItem ? poseOf(selItem)?.pose.scale ?? 1 : 1)} rotateOf={() => (selItem ? poseOf(selItem)?.pose.rotate ?? 0 : 0)} />
        </div>
        <aside className="inspector"><div className="pane">{selItem ? itemPane(selItem) : exporting ? exportPane() : videoPane()}</div></aside>
      </div>
      <div className="transport">
        <button className="play" aria-label={playing ? 'Pause' : 'Play'} data-tip={`${playing ? 'Pause' : 'Play'} · Space`} onClick={() => playerRef.current?.toggle()}>
          {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}</button>
        <span className="time"><b>{fmt(srcToOut(kept, playheadSrc))}</b> / {fmt(outLen)}</span>
        {!asset && <div className="verbs">
          <button aria-label="Split" data-tip="Split at the playhead · Cmd+B" onClick={splitHere}><IconScissors size={16} />Split</button>
          <button aria-label="Duplicate" data-tip="Duplicate · Cmd+D" disabled={!selItem || selItem.kind === 'cut' || selItem.kind === 'speed' || selItem.kind === 'mask'} onClick={() => { if (selItem) void duplicate(selItem) }}><IconCopy size={16} />Duplicate</button>
          <button aria-label="Delete" data-tip="Delete · Backspace" disabled={!selItem} onClick={() => { if (selItem) removeItem(selItem) }}><IconTrash size={16} />Delete</button>
          <button aria-label="Freeze" data-tip="Hold this frame for 3 seconds" disabled={!!working || !onClipNow || !!onClipNow.ins} onClick={() => void freezeHere()}><IconSnowflake size={16} />Freeze</button>
        </div>}
        <span className="spacer" />
        <span className="hint">{autoState ?? hint}</span>
        {pendingCount > 0 && <button className="suggest" onClick={() => go('smart')} data-tip="Pauses, filler words and slow stretches worth tidying">
          <IconSparkles size={15} />{pendingCount} suggestion{pendingCount === 1 ? '' : 's'}</button>}
        <div className="tlzoom"><button className="icon" aria-label="Zoom timeline out" onClick={() => setTlScale((z) => Math.max(1, z / 1.5))}><IconZoomOut size={16} /></button>
          <button className="icon" aria-label="Zoom timeline in" onClick={() => setTlScale((z) => Math.min(30, z * 1.5))}><IconZoomIn size={16} /></button></div>
      </div>
      <Timeline ev={project.events} cuts={cuts} ranges={kept} splits={splits} chapters={asset ? [] : chapters} highlights={asset ? [] : highlights} zooms={zooms} speeds={speeds} masks={masks} texts={texts}
        overlays={overlays} stickers={stickers} music={music} voiceovers={voiceovers} inserts={shownInserts} transcript={transcript} playhead={playheadSrc} range={range} selected={selItem} editable={!asset} scale={tlScale}
        onSeek={seekSrc} onRange={setRange} onSelect={pick} onAction={rangeAction} onDragStart={dragStart} onDragItem={dragItem} onDragEnd={dragEnd} onMenu={(it, x, y) => setMenu({ it, x, y })} />
      {menu && <div className="ctx" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => { setMenu(null); splitHere() }}>Split at playhead<kbd>⌘B</kbd></button>
        {menu.it.kind !== 'cut' && menu.it.kind !== 'speed' && menu.it.kind !== 'mask' && <button onClick={() => { const it = menu.it; setMenu(null); void duplicate(it) }}>Duplicate<kbd>⌘D</kbd></button>}
        {(menu.it.kind === 'piece') && <button onClick={() => { setMenu(null); void freezeHere() }}>Freeze this frame</button>}
        {(menu.it.kind === 'piece' || menu.it.kind === 'insert') && <>
          <button onClick={() => { const it = menu.it; setMenu(null); void processItem(it, 'reverse') }}>Reverse</button>
          <button onClick={() => { const it = menu.it; setMenu(null); void processItem(it, 'slowmo') }}>Smooth slow motion</button>
          <button onClick={() => { const it = menu.it; setMenu(null); void processItem(it, 'stabilise') }}>Stabilise</button></>}
        <button className="danger" onClick={() => { const it = menu.it; setMenu(null); removeItem(it) }}>{menu.it.kind === 'cut' ? 'Bring it back' : 'Delete'}</button>
      </div>}
    </div>
  )
}
