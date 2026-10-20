import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { Screencast, compositionSize } from '../../video/Screencast'
import { keptDuration, keptRanges, outToSrc, srcToOut } from '../../video/ranges'
import { ASPECTS, ASSET_LABEL, EXPORT_PRESETS, defaultConfig, type Analysis, type Background, type CameraCorner, type CameraShape, type CaptionStyle, type Chapter, type Cut, type DerivedAsset, type ExportProgress, type ManualZoom, type Mask, type Project, type Proposal, type RenderConfig, type ScreencastProps, type SpeedRange, type Transcript, type TranscriptSegment } from '../../shared/types'
import { smoothCursor } from '../../video/motion'
import { revealLabel } from '../platform'
import { IconArrowBackUp, IconArrowForwardUp, IconBadgeCc, IconDownload, IconLink, IconMicrophone, IconPalette, IconPlayerPause, IconPlayerPlay, IconPlus, IconRestore, IconSparkles, IconTrash, IconUserCircle, IconX } from '@tabler/icons-react'
import { Timeline, fmt, fmtShort, sameItem, type Item, type RangeAction } from './Timeline'
import { Director, type DirectorState, type DirectorStatus } from './Director'
import { TranscriptPanel, fillerRanges, type TranscribeStatus } from './TranscriptPanel'
import { ContentMap } from './ContentMap'
import { ContentCard } from './ContentCard'
import { SharePanel } from './SharePanel'
import { niceName } from './Home'
import { buildContent, thumbnailTimes } from '../content'
import { generateAssets } from '../generate'

const FPS = 60
const RATES = [0.5, 0.75, 1.25, 1.5, 2, 3]
type Tab = 'style' | 'camera' | 'sound' | 'words' | 'smart' | 'export'
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`
const SHAPE: Record<CameraShape, string> = { off: 'Hidden', circle: 'Circle', rounded: 'Rounded' }
const BGS: { id: Background; label: string; css: string }[] = [
  { id: 'indigo', label: 'Indigo', css: 'linear-gradient(135deg,#6E71E8,#8B78D6)' },
  { id: 'coral', label: 'Coral', css: 'linear-gradient(135deg,#FB8B73,#F5C36A)' },
  { id: 'ink', label: 'Ink', css: '#14140F' },
  { id: 'paper', label: 'Paper', css: '#EFEEE8' },
]

/** Everything the user can change; one snapshot per undo step. */
type Edits = { config: RenderConfig; cuts: Cut[]; assets: DerivedAsset[]; zooms: ManualZoom[]; speeds: SpeedRange[]; masks: Mask[]; chapters: Chapter[]; highlights: [number, number][]; director: DirectorState }

export function Editor({ project }: { project: Project }) {
  // Saved edits win; defaults fill in settings that did not exist when the project was last saved.
  const [edits, setEdits] = useState<Edits>(() => ({
    config: { ...defaultConfig, ...(project.file?.config ?? {}) }, cuts: project.file?.cuts ?? [],
    assets: project.file?.assets ?? [], zooms: project.file?.zooms ?? [], speeds: project.file?.speeds ?? [], masks: project.file?.masks ?? [],
    chapters: project.file?.chapters ?? [], highlights: project.file?.highlights ?? [],
    director: project.file?.director ?? { accepted: [], rejected: [] },
  }))
  const { assets, zooms, speeds, masks, chapters, highlights, director } = edits
  // Which asset is being edited: the master, or one derivative (add-on §5: derivatives stay editable).
  const [selected, setSelected] = useState<string>('master')
  const asset = assets.find((a) => a.id === selected) ?? null
  const config: RenderConfig = asset ? { ...edits.config, ...asset.config } : edits.config
  const cuts: Cut[] = asset ? asset.cuts : edits.cuts
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
  const [tab, setTab] = useState<Tab>('style')
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
      window.narrate.saveProject(project.dir, { version: 1, config: edits.config, cuts: edits.cuts, assets, zooms, speeds, masks, chapters, highlights, director, savedAt: new Date().toISOString() })
        .catch((e) => console.warn('autosave failed', e))
    }, 400)
    return () => clearTimeout(t)
  }, [edits, assets, zooms, speeds, masks, chapters, highlights, director, project.dir])

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
    window.narrate.renderThumbnails(project.dir, edits.config, edits.cuts, times, { zooms, speeds, masks })
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

  const props: ScreencastProps = useMemo(() => ({ assets: { ...project.assets, micClean }, events: project.events, config, cuts, zooms, speeds, masks, transcript }), [project, micClean, config, cuts, zooms, speeds, masks, transcript])
  const size = compositionSize(props)
  const kept = useMemo(() => keptRanges(project.events, cuts, speeds), [project.events, cuts, speeds])
  const frames = Math.max(1, Math.ceil(keptDuration(project.events, cuts, speeds) * FPS))
  const pauses = project.events.pauses?.length ?? 0
  const busy = prog && (prog.stage === 'bundling' || prog.stage === 'rendering')

  // Player ↔ timeline: the player runs in output time, the timeline shows source time.
  useEffect(() => {
    const p = playerRef.current; if (!p) return
    const h = (e: { detail: { frame: number } }) => setPlayheadSrc(outToSrc(kept, e.detail.frame / FPS))
    p.addEventListener('frameupdate', h); return () => p.removeEventListener('frameupdate', h)
  }, [kept])
  const seekSrc = (tSrc: number) => {
    const t = Math.max(0, Math.min(project.events.videoDuration, tSrc))
    setPlayheadSrc(t); playerRef.current?.seekTo(Math.round(srcToOut(kept, t) * FPS))
  }

  // Cutting (spec §39): trim to the playhead, or mark a start then an end. All reversible.
  const dur = project.events.videoDuration
  // Never let a cut remove the whole video (spec §41: never delete without showing); at least half a second must stay.
  const addCut = (a: number, b: number) => {
    if (Math.abs(b - a) < 0.1) return false
    const next: Cut[] = [...cuts, [Math.min(a, b), Math.max(a, b)]]
    if (keptDuration(project.events, next, speeds) < 0.5) { alert('That would remove the whole recording. Select a shorter stretch.'); return false }
    setCuts(() => next); return true
  }
  const trimStart = () => addCut(0, playheadSrc)
  const trimEnd = () => addCut(playheadSrc, dur)
  const restore = (i: number) => setCuts((c) => c.filter((_, k) => k !== i))

  // Manual zoom (spec §26), speed (§40), privacy blur (§49): over a selected stretch, or a default length at the playhead.
  // Whatever is created becomes the selection, so its settings open in the inspector straight away.
  const W = project.events.display.width, H = project.events.display.height
  const zoomAt = (t: number, duration: number) => {
    const pos = smoothCursor(project.events, t) ?? [W / 2, H / 2]
    const id = newId('z')
    apply((e) => ({ ...e, zooms: [...e.zooms, { id, t, duration, x: Math.round(pos[0]), y: Math.round(pos[1]), level: Math.max(1.5, e.config.zoom) }] }))
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
  const zoomHere = () => zoomAt(playheadSrc, 2.5)
  const maskHere = () => maskAt(playheadSrc, Math.min(dur, playheadSrc + 5))
  const rangeAction = (act: RangeAction) => {
    if (!range) return
    const [a, b] = range
    if (act === 'cut') { const i = cuts.length; if (addCut(a, b)) setSel({ kind: 'cut', i }) }
    if (act === 'zoom') zoomAt(a, Math.max(0.5, b - a))
    if (act === 'speed') speedOver(a, b)
    if (act === 'mask') maskAt(a, Math.max(a + 0.5, b))
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
  const assetDuration = (a: DerivedAsset | null) => keptDuration(project.events, a ? a.cuts : edits.cuts, speeds)
  const exportOne = (a: DerivedAsset | null) => window.narrate.exportProject(project.dir, a ? { ...edits.config, ...a.config } : edits.config, a ? a.cuts : edits.cuts, a ? a.name : 'master', format, { zooms, speeds, masks })
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
    : (!asset && masks.some((m) => m.id === sel.id) ? sel : null)
  const removeItem = (it: Item) => {
    if (it.kind === 'cut') restore(it.i)
    if (it.kind === 'zoom') removeZoom(it.id)
    if (it.kind === 'speed') removeSpeed(it.i)
    if (it.kind === 'mask') removeMask(it.id)
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
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
        return
      }
      if (k === ' ') { e.preventDefault(); playerRef.current?.toggle() }
      else if (k === 'escape') { setRange(null); setSel(null) }
      else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); seekSrc(playheadSrc + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 5 : 1)) }
      else if ((k === 'delete' || k === 'backspace') && selItem) removeItem(selItem)
      else if (range && k === 'c') rangeAction('cut')
      else if (range && !asset && k === 'z') rangeAction('zoom')
      else if (range && !asset && k === 's') rangeAction('speed')
      else if (range && !asset && k === 'b') rangeAction('mask')
      else if (!range && !asset && k === 'z') zoomHere()
      else if (!range && !asset && k === 'b') maskHere()
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })

  const pendingCount = analysisWithFillers && !asset
    ? analysisWithFillers.proposals.filter((p) => p.type !== 'ZOOM' && !director.accepted.includes(p.id) && !director.rejected.includes(p.id)).length : 0
  const tabs: { id: Tab; label: string; Icon: typeof IconPalette; show: boolean; badge?: number }[] = [
    { id: 'style', label: 'Style', Icon: IconPalette, show: true },
    { id: 'camera', label: 'Camera', Icon: IconUserCircle, show: !!project.assets.camera },
    { id: 'sound', label: 'Sound', Icon: IconMicrophone, show: !!(project.assets.mic || project.assets.system) },
    { id: 'words', label: 'Transcript', Icon: IconBadgeCc, show: !!project.assets.mic },
    { id: 'smart', label: 'Smart', Icon: IconSparkles, show: !asset, badge: pendingCount },
    { id: 'export', label: 'Export', Icon: IconDownload, show: true },
  ]
  const shownTab = tabs.find((t) => t.id === tab && t.show) ? tab : 'style'
  const outLen = keptDuration(project.events, cuts, speeds)
  const go = (t: Tab) => { setSel(null); setTab(t) }
  const seg = <T extends string | number | boolean>(value: T, opts: [T, string][], onPick: (v: T) => void) => (
    <div className="seg">{opts.map(([v, l]) => <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onPick(v)}>{l}</button>)}</div>)
  const slider = (label: string, shown: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void, tip?: string) => (
    <div className="control"><div className="lbl"><span data-tip={tip}>{label}</span><span>{shown}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--p': `${((value - min) / (max - min || 1)) * 100}%` } as React.CSSProperties} /></div>)
  const paneHead = (title: string, sub: string, close?: boolean) => (
    <div className="pane-head"><div><h3>{title}</h3><p className="note">{sub}</p></div>
      {close && <button className="icon" aria-label="Close" data-tip="Close · Esc" onClick={() => setSel(null)}><IconX size={16} /></button>}</div>)

  const itemPane = (it: Item) => {
    const foot = (t: number) => (
      <div className="pane-foot"><button onClick={() => seekSrc(t)}>Jump to it</button>
        <button className="danger" onClick={() => removeItem(it)}><IconTrash size={15} />Remove</button></div>)
    if (it.kind === 'cut') {
      const [a, b] = [Math.min(...cuts[it.i]), Math.max(...cuts[it.i])]
      return <>{paneHead('Cut', `${fmt(a)} – ${fmt(b)} (${fmt(b - a)}) is left out of the video. Nothing is deleted from your recording.`, true)}
        <div className="pane-foot"><button onClick={() => seekSrc(a)}>Jump to it</button>
          <button className="primary" onClick={() => removeItem(it)}><IconRestore size={15} />Restore this part</button></div></>
    }
    if (it.kind === 'zoom') {
      const z = zooms.find((x) => x.id === it.id)!
      return <>{paneHead('Zoom', `From ${fmt(z.t)}, centred on where your cursor was.`, true)}
        {slider('Zoom level', `${z.level.toFixed(1)}×`, 1.2, 4, 0.1, z.level, (v) => editZoom(z.id, { level: v }))}
        {slider('Hold for', `${z.duration.toFixed(1)} s`, 0.5, 15, 0.5, z.duration, (v) => editZoom(z.id, { duration: v }))}
        {foot(z.t)}</>
    }
    if (it.kind === 'speed') {
      const sp = speeds[it.i]
      return <>{paneHead('Speed', `${fmt(sp.start)} – ${fmt(sp.end)} plays at a different speed.`, true)}
        <div className="control"><div className="lbl"><span>Speed</span></div>
          {seg(sp.rate, RATES.map((r) => [r, `${r}×`] as [number, string]), (v) => setSpeedRateAt(it.i, v))}</div>
        {foot(sp.start)}</>
    }
    const m = masks.find((x) => x.id === it.id)!
    return <>{paneHead('Blur', `Hides part of the screen from ${fmt(m.start)} to ${fmt(m.end)}.`, true)}
      <div className="control"><div className="lbl"><span>Style</span></div>{seg(m.kind, [['blur', 'Blur'], ['solid', 'Solid box']], (v) => editMask(m.id, { kind: v }))}</div>
      {slider('Left', `${Math.round(m.x / W * 100)}%`, 0, W - m.w, 4, m.x, (v) => editMask(m.id, { x: v }))}
      {slider('Top', `${Math.round(m.y / H * 100)}%`, 0, H - m.h, 4, m.y, (v) => editMask(m.id, { y: v }))}
      {slider('Width', `${Math.round(m.w / W * 100)}%`, 40, W, 4, m.w, (v) => editMask(m.id, { w: v, x: Math.min(m.x, W - v) }))}
      {slider('Height', `${Math.round(m.h / H * 100)}%`, 24, H, 4, m.h, (v) => editMask(m.id, { h: v, y: Math.min(m.y, H - v) }))}
      {slider('Until', fmt(m.end), m.start + 0.5, dur, 0.1, m.end, (v) => editMask(m.id, { end: v }))}
      {foot(m.start)}</>
  }

  const tabPane = () => {
    if (shownTab === 'style') return <>
      {paneHead('Style', 'How the recording is framed and dressed.')}
      <div className="control"><div className="lbl"><span>Shape</span><span>{config.aspect === 'source' ? `${W}×${H}` : config.aspect}</span></div>
        {seg(config.aspect, ASPECTS.map((a) => [a.id, a.label] as [typeof config.aspect, string]), (v) => set('aspect', v))}
        {config.aspect !== 'source' && ASPECTS.find((a) => a.id === config.aspect)!.ratio! < 1 &&
          <span className="note">Vertical and square crops follow your cursor and clicks.</span>}</div>
      <div className="control"><div className="lbl"><span>Background</span></div>
        <div className="swatches">{BGS.map((b) => (
          <button key={b.id} className={config.background === b.id ? 'on' : ''} aria-label={b.label} data-tip={b.label} onClick={() => set('background', b.id)}>
            <span style={{ background: b.css }} /></button>))}</div></div>
      {slider('Automatic zoom', config.zoom === 1 ? 'Off' : `${config.zoom.toFixed(1)}×`, 1, 3, 0.1, config.zoom, (v) => set('zoom', v), 'How far it zooms in when you click. 1× turns it off.')}
      {slider('Padding', `${Math.round(config.padding * 100)}%`, 0, 0.2, 0.01, config.padding, (v) => set('padding', v), 'Space between the screen and the edge')}
      {slider('Corners', `${config.radius}px`, 0, 64, 2, config.radius, (v) => set('radius', v))}
      {slider('Cursor size', `${config.cursorScale.toFixed(1)}×`, 1, 3, 0.1, config.cursorScale, (v) => set('cursorScale', v))}
      {!!project.events.keys?.length && <div className="control"><div className="lbl"><span>Keyboard shortcuts</span><span>{project.events.keys.length} pressed</span></div>
        {seg(config.keycaps, [[true, 'Show'], [false, 'Hide']], (v) => set('keycaps', v))}</div>}
    </>
    if (shownTab === 'camera') return <>
      {paneHead('Camera', 'Your face in a corner of the video.')}
      <div className="control"><div className="lbl"><span>Shape</span></div>{seg(config.cameraShape, (['off', 'circle', 'rounded'] as CameraShape[]).map((s) => [s, SHAPE[s]] as [CameraShape, string]), (v) => set('cameraShape', v))}</div>
      {config.cameraShape !== 'off' && <>
        {slider('Size', `${Math.round(config.cameraSize * 100)}%`, 0.1, 0.4, 0.01, config.cameraSize, (v) => set('cameraSize', v))}
        <div className="control"><div className="lbl"><span>Corner</span></div>
          <div className="corners">{([['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']] as [CameraCorner, string][]).map(([c, l]) => (
            <button key={c} className={config.cameraCorner === c ? 'on' : ''} aria-label={l} data-tip={l} onClick={() => set('cameraCorner', c)}><i className={c} /></button>))}</div></div>
        <div className="control"><div className="lbl"><span>Mirror</span></div>{seg(config.cameraMirror, [[true, 'Mirrored'], [false, 'As others see you']], (v) => set('cameraMirror', v))}</div>
      </>}
    </>
    if (shownTab === 'sound') return <>
      {paneHead('Sound', 'Your voice and the computer’s sound.')}
      {project.assets.mic && <div className="control"><div className="lbl"><span>Voice clean-up</span></div>
        {micClean ? seg(config.voice, [['clean', 'Cleaned'], ['raw', 'As recorded']], (v) => set('voice', v))
          : <button disabled={enhancing !== 'idle'} onClick={enhance}>{enhancing === 'idle' ? 'Clean up voice' : enhancing}</button>}
        <span className="note">Removes hum and background noise and evens out loudness. Your original is kept.</span></div>}
      {project.assets.mic && slider('Voice volume', config.micVolume === 0 ? 'Muted' : `${Math.round(config.micVolume * 100)}%`, 0, 1.5, 0.05, config.micVolume, (v) => set('micVolume', v))}
      {project.assets.system && slider('Computer sound', config.systemVolume === 0 ? 'Muted' : `${Math.round(config.systemVolume * 100)}%`, 0, 1.5, 0.05, config.systemVolume, (v) => set('systemVolume', v))}
    </>
    if (shownTab === 'words') return <>
      {paneHead('Transcript', 'What you said. Remove a sentence to cut it from the video.')}
      {transcript && <div className="control"><div className="lbl"><span>Captions</span></div>
        {seg(config.captions, (['off', 'minimal', 'bold'] as CaptionStyle[]).map((s) => [s, s === 'off' ? 'Off' : s === 'minimal' ? 'Minimal' : 'Bold'] as [CaptionStyle, string]), (v) => set('captions', v))}</div>}
      <TranscriptPanel transcript={transcript} status={tstatus} cuts={cuts} hasMic={!!project.assets.mic} playhead={playheadSrc}
        onCreate={transcribe} onSeek={seekSrc} onRemove={removeSentence} onRestore={restoreSentence} />
    </>
    if (shownTab === 'smart') return <>
      {paneHead('Smart', 'Suggestions, chapters, thumbnails and post copy, all from this recording.')}
      <Director analysis={analysisWithFillers} status={dstatus} state={director} onAccept={onAccept} onReject={onReject} onAcceptAll={onAcceptAll}
        onDismiss={onDismiss} onSeek={seekSrc} onRerun={() => runAnalysis(true)} />
      <ContentMap chapters={chapters} transcript={transcript} duration={dur} playhead={playheadSrc} onSeek={seekSrc}
        onRename={(i, title) => apply((ed) => ({ ...ed, chapters: ed.chapters.map((x, k) => k === i ? { ...x, title } : x) }))}
        onRemove={(i) => apply((ed) => ({ ...ed, chapters: ed.chapters.filter((_, k) => k !== i) }))}
        onAddHere={() => apply((ed) => ({ ...ed, chapters: [...ed.chapters.filter((c) => Math.abs(c.t - playheadSrc) > 0.5), { t: playheadSrc, title: `Section ${ed.chapters.length + 2}` }].sort((a, b) => a.t - b.t) }))} />
      <ContentCard content={buildContent(transcript, chapters, keptDuration(project.events, edits.cuts, speeds))} thumbs={thumbs} thumbStatus={thumbStatus}
        onMakeThumbs={makeThumbs} onReveal={(p) => window.narrate.reveal(p)} revealLabel={revealLabel} hasTranscript={!!transcript} />
    </>
    return <>
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
        {seg(config.outputHeight, [[1080, '1080p'], [1440, '1440p'], [0, 'Original']], (v) => set('outputHeight', v))}</div>}
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
  }

  const hint = range ? `${fmt(range[1] - range[0])} selected. Choose what to do with it above.`
    : `Final length ${fmtShort(outLen)} of ${fmtShort(dur)} recorded`

  return (
    <div className="ed">
      <header className="ed-head">
        <div className="versions">
          <button className={'ver' + (selected === 'master' ? ' on' : '')} onClick={() => { setSelected('master'); setSel(null) }} title="Your full edit. Versions start from it.">
            <b>Master</b><span>{fmtShort(assetDuration(null))}</span></button>
          {assets.map((a) => (
            <button key={a.id} className={'ver' + (selected === a.id ? ' on' : '')} onClick={() => { setSelected(a.id); setSel(null) }} title={a.note}>
              <b>{a.name}</b><span>{fmtShort(assetDuration(a))}{a.config.aspect ? ` · ${a.config.aspect}` : ''}</span>
              {selected === a.id && <i className="rm" role="button" aria-label={`Remove ${a.name}`} onClick={(e) => { e.stopPropagation(); removeAsset(a.id) }}><IconX size={12} /></i>}
            </button>))}
          <button className="ver add" onClick={generate} disabled={dstatus.kind === 'running'}
            title="Quick demo, LinkedIn, vertical teaser, 15 s teaser and clips, cut from this recording">
            <IconPlus size={15} />{assets.length ? 'Remake versions' : 'Make versions'}</button>
        </div>
        <span className="spacer" />
        <button className="icon" aria-label="Undo" data-tip="Undo · Ctrl+Z" disabled={history.current.past.length === 0} onClick={undo}><IconArrowBackUp size={18} /></button>
        <button className="icon" aria-label="Redo" data-tip="Redo · Ctrl+Y" disabled={history.current.future.length === 0} onClick={redo}><IconArrowForwardUp size={18} /></button>
        <button onClick={() => go('export')} data-tip="Export, then get a link anyone can watch"><IconLink size={16} />Share</button>
        <button className="primary" onClick={() => go('export')}><IconDownload size={16} />Export</button>
      </header>
      {asset && <p className="ed-note">Editing <b>{asset.name}</b> · {ASSET_LABEL[asset.kind]}. {asset.note} Changes here leave the master untouched.</p>}
      <div className="ed-main">
        <div className="ed-left">
          <div className="stage">
            <Player ref={playerRef} component={Screencast} inputProps={props} durationInFrames={frames} fps={FPS} acknowledgeRemotionLicense
              compositionWidth={size.width} compositionHeight={size.height} clickToPlay style={{ width: '100%', height: '100%' }} />
          </div>
          <div className="transport">
            <button className="play" aria-label={playing ? 'Pause' : 'Play'} data-tip={`${playing ? 'Pause' : 'Play'} · Space`} onClick={() => playerRef.current?.toggle()}>
              {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}</button>
            <span className="time"><b>{fmt(srcToOut(kept, playheadSrc))}</b> / {fmt(outLen)}</span>
            <button className="small" onClick={trimStart} disabled={playheadSrc < 0.1} data-tip="Cut everything before the playhead">Trim start</button>
            <button className="small" onClick={trimEnd} disabled={playheadSrc < 0.5 || playheadSrc > dur - 0.1} data-tip="Cut everything after the playhead">Trim end</button>
            <span className="spacer" />
            <span className="hint">{hint}</span>
            {pendingCount > 0 && <button className="suggest" onClick={() => go('smart')} data-tip="Pauses, filler words and slow stretches worth tidying">
              <IconSparkles size={15} />{pendingCount} suggestion{pendingCount === 1 ? '' : 's'}</button>}
          </div>
          <Timeline ev={project.events} cuts={cuts} chapters={asset ? [] : chapters} highlights={asset ? [] : highlights} zooms={zooms} speeds={speeds} masks={masks}
            transcript={transcript} playhead={playheadSrc} range={range} selected={selItem} editable={!asset}
            onSeek={seekSrc} onRange={setRange} onSelect={setSel} onAction={rangeAction} />
          <p className="tl-help">Click to move the playhead · drag to select a stretch · click a block to edit it · <kbd>Space</kbd> plays · <kbd>←</kbd><kbd>→</kbd> step</p>
        </div>
        <aside className="inspector">
          <nav className="rail">{tabs.filter((t) => t.show).map((t) => (
            <button key={t.id} className={shownTab === t.id && !selItem ? 'on' : ''} onClick={() => go(t.id)}>
              <t.Icon size={20} stroke={1.6} /><span>{t.label}</span>{!!t.badge && <i className="badge">{t.badge}</i>}</button>))}</nav>
          <div className="pane">{selItem ? itemPane(selItem) : tabPane()}</div>
        </aside>
      </div>
    </div>
  )
}
