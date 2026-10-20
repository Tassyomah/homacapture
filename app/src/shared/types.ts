/** Shared between main, preload, renderer and the Remotion composition. */

export interface DisplayInfo {
  id: number; scale: number
  pointWidth: number; pointHeight: number
  width: number; height: number
}
export interface CursorShape { file: string; hotspot: [number, number]; size: [number, number] }
export interface ClickEvent { t: number; type: 'down' | 'up'; button: string; x: number; y: number }

/** events.json written by recorder/narrate.py. All `t` are host-clock seconds. */
export interface RecordingEvents {
  version: number
  display: DisplayInfo
  fps: number
  tLaunch: number; tEnd: number
  t0Video: number; t0Mic: number | null
  videoDuration: number; videoFrames: number
  cursors: Record<string, CursorShape>
  cursorChanges: [number, string][]
  moves: [number, number, number][]
  clicks: ClickEvent[]
  scrolls: unknown[]
  /** Keyboard shortcuts only (combos with Ctrl/Alt/Win, function keys), host-clock seconds; never plain typing. */
  keys?: { t: number; keys: string }[]
  micOffset: number | null
  pauses?: [number, number][]
  /** Camera (spec §10): its own file on the shared clock, composited at render time, never baked in. */
  t0Camera?: number | null
  cameraOffset?: number | null
  camera?: { width: number; height: number; duration: number } | null
  /** System audio (spec §15): its own file on the shared clock. */
  t0System?: number | null
  systemOffset?: number | null
  /** Set by recorder/narrate_win.py; absent on macOS recordings. */
  platform?: Platform
  encoder?: string
  files: { screen: string; mic: string | null; camera?: string | null; system?: string | null }
}

export interface Project {
  dir: string
  name: string
  createdAt: string
  events: RecordingEvents
  /** http URLs served by the app for the renderer + Remotion. */
  assets: ProjectAssets
  /** Saved edits (project.json); null for a recording that has never been opened in the editor. */
  file: ProjectFile | null
  /** transcript.json, when the recording has been transcribed. */
  transcript: Transcript | null
}

/** A removed stretch of the recording, in seconds relative to the start of screen.mp4. */
export type Cut = [number, number]

export interface Chapter { t: number; title: string }
/** A zoom the user placed by hand (spec §26): zoom in before `t`, hold on (x, y) for `duration`, zoom out. Screen pixels. */
export interface ManualZoom { id: string; t: number; duration: number; x: number; y: number; level: number }
/** Playback speed for a stretch of the recording (spec §40); 1 = normal. Source seconds. */
export interface SpeedRange { start: number; end: number; rate: number }
/** Privacy mask (spec §49): a rectangle in screen pixels, blurred or painted over, from `start` to `end` (source seconds). */
export interface Mask { id: string; start: number; end: number; x: number; y: number; w: number; h: number; kind: 'blur' | 'solid' }

/**
 * A derivative of the master (add-on §4–5): the same recording with its own removed stretches and a few config
 * overrides (aspect, camera…). Never a rendered file — always editable, always re-exportable from the master.
 */
export type AssetKind = 'quick' | 'linkedin' | 'vertical' | 'teaser' | 'clip'
export interface DerivedAsset {
  id: string
  kind: AssetKind
  name: string
  cuts: Cut[]                      // its own removed stretches (the complement of its selected segments)
  config: Partial<RenderConfig>    // overrides on top of the master config
  createdAt: string
  fromMasterSavedAt: string | null // which master state it was generated from
  note?: string                    // why the generator chose what it chose
}
export const ASSET_LABEL: Record<AssetKind, string> = { quick: 'Quick Demo', linkedin: 'LinkedIn', vertical: 'Vertical Teaser', teaser: '15s Teaser', clip: 'Clip' }

/** project.json — every edit is an instruction here; raw media are never touched (spec §38, §60). Autosaved (§61). */
export interface ProjectFile {
  version: 1
  config: RenderConfig
  cuts: Cut[]
  assets?: DerivedAsset[]
  zooms?: ManualZoom[]
  speeds?: SpeedRange[]
  masks?: Mask[]
  chapters?: Chapter[]
  /** Stand-alone moments (source seconds) the user kept from the Smart Director; future clip sources (add-on §19). */
  highlights?: [number, number][]
  /** Smart Director bookkeeping: proposal ids the user accepted or rejected (add-on §8–9). */
  director?: { accepted: string[]; rejected: string[]; dismissedAt?: string }
  savedAt: string
}

/** transcript.json — written by `narrate_win.py transcribe` (spec §43). Times are source seconds (already shifted by micOffset). */
export interface TranscriptWord { start: number; end: number; word: string; p: number }
export interface TranscriptSegment { start: number; end: number; text: string; words: TranscriptWord[] }
export interface Transcript { version: number; language: string; model: string; createdAt: string; duration: number; segments: TranscriptSegment[] }

export type CaptionStyle = 'off' | 'minimal' | 'bold'

/** analysis.json — written by `narrate_win.py analyze` (add-on spec §7–9). Signals are raw; proposals are editable suggestions. */
export type ProposalType = 'REMOVE' | 'ZOOM' | 'CHAPTER' | 'HIGHLIGHT' | 'SPEED'
export interface Proposal {
  id: string; type: ProposalType; start: number; end: number
  reason: string; confidence: 'high' | 'medium' | 'low'
  score?: number; clicks?: number; x?: number; y?: number; rate?: number
}
export interface Analysis {
  version: number; analyzedAt: string; duration: number
  signals: { silences: [number, number][]; scenes: [number, number][]; idle: [number, number][]; clickGroups: [number, number, number][] }
  proposals: Proposal[]
  summary: Record<ProposalType, number> & { removableSeconds: number }
}
export interface ProjectAssets { screen: string; mic: string | null; micClean: string | null; camera: string | null; system: string | null; cursors: Record<string, string> }

export type Background = 'indigo' | 'coral' | 'ink' | 'paper'
export type CameraShape = 'off' | 'circle' | 'rounded'
export type CameraCorner = 'br' | 'bl' | 'tr' | 'tl'
/** Output aspect (spec §28–29). 'source' = the screen's own aspect; portrait/square presets crop and follow the action. */
export type Aspect = 'source' | '16:9' | '9:16' | '1:1' | '4:5'
export const ASPECTS: { id: Aspect; label: string; ratio: number | null }[] = [
  { id: 'source', label: 'Screen', ratio: null }, { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 }, { id: '1:1', label: '1:1', ratio: 1 }, { id: '4:5', label: '4:5', ratio: 4 / 5 },
]
export interface RenderConfig {
  aspect: Aspect
  zoom: number          // 1 = off, 2 = Screen-Studio-like
  padding: number       // fraction of screen width on each side
  radius: number        // px at source scale
  background: Background
  cursorScale: number
  outputHeight: number  // 0 = source size
  outputFps: 30 | 60    // export frame rate (spec Phase 6); 30 renders about twice as fast
  cameraShape: CameraShape
  cameraSize: number    // fraction of screen width
  cameraCorner: CameraCorner
  cameraMirror: boolean // selfie view: flip horizontally
  micVolume: number     // 0..1.5, 1 = as recorded
  systemVolume: number  // 0..1.5, 0 = muted
  captions: CaptionStyle
  voice: 'raw' | 'clean' // 'clean' uses mic.clean.wav when it exists (spec §16); the raw track is always kept
  keycaps: boolean      // show pressed shortcuts as keycaps (spec §46)
}
export const defaultConfig: RenderConfig = {
  aspect: 'source', zoom: 2, padding: 0.06, radius: 24, background: 'indigo', cursorScale: 1.6, outputHeight: 1080, outputFps: 60,
  cameraShape: 'circle', cameraSize: 0.2, cameraCorner: 'br', cameraMirror: true,
  micVolume: 1, systemVolume: 0.8, captions: 'off', voice: 'raw', keycaps: true,
}

export type ScreencastProps = { assets: ProjectAssets; events: RecordingEvents; config: RenderConfig; cuts?: Cut[]; zooms?: ManualZoom[]; speeds?: SpeedRange[]; masks?: Mask[]; transcript?: Transcript | null; [k: string]: unknown }
/** Master-level instructions every derivative inherits. */
export interface MasterExtras { zooms: ManualZoom[]; speeds: SpeedRange[]; masks: Mask[] }

export type MicPermission = 'authorized' | 'denied' | 'restricted' | 'notDetermined' | 'unknown'
export interface Permissions { screen: boolean; mic: MicPermission }
export type RecorderEvent =
  | { event: 'started'; out: string; mic?: string | null; camera?: string | null; systemAudio?: boolean; warning?: string | null }
  | { event: 'paused'; t: number } | { event: 'resumed'; t: number }
  | { event: 'stopped'; out: string; duration: number }
  | { event: 'finalizing'; step: 'video' | 'audio' }
  | { event: 'recovering'; step: 'video' | 'audio' | 'done' }
  | { event: 'analyzing'; step: 'audio' | 'screen' | 'interaction' | 'done' }
  | { event: 'transcribing'; stage: 'installing' | 'loading' | 'transcribing' | 'done'; message?: string; done?: number; total?: number }
  | { event: 'enhancing'; step: 'measure' | 'render' | 'done' }
  | { event: 'ready'; out: string; project: Project }
  | { event: 'error'; code: string; message: string }
export type RecState = 'idle' | 'countdown' | 'recording' | 'paused' | 'finalizing'

export interface Devices {
  screens: { index: number; name: string }[]
  mics: { index: number; name: string }[]
  /** Absent from the macOS recorder for now. */
  cameras?: { index: number; name: string }[]
  displays: { ordinal: number; id: number; width: number; height: number; name: string }[]
}
export interface StartOptions { screen: number; mic: number | null; camera?: number | null; systemAudio?: boolean; fps: number }
/** A recording folder whose recorder died before writing events.json (recording.json still present). */
export interface UnfinishedRecording { dir: string; name: string; startedAt: string; display: DisplayInfo; mic: string | null }
export type ExportFormat = 'mp4' | 'gif'
/** Sharing on the owner's Cloudflare R2 bucket; the secret never leaves the main process. */
export type ShareSettings = { configured: false } | { configured: true; endpoint: string; bucket: string; publicUrl: string; accessKeyId: string }
export type ShareSettingsInput = { endpoint: string; bucket: string; publicUrl: string; accessKeyId: string; secret: string }
/** Export presets (spec §56): output and safe-area choices only, no platform branding. */
export const EXPORT_PRESETS: { id: string; label: string; config: Partial<RenderConfig> }[] = [
  { id: 'youtube', label: 'YouTube', config: { aspect: '16:9', outputHeight: 1080, outputFps: 60 } },
  { id: 'shorts', label: 'Shorts / TikTok / Reels', config: { aspect: '9:16', outputHeight: 1080, outputFps: 30, captions: 'bold', cameraCorner: 'tr', cameraSize: 0.3 } },
  { id: 'instagram', label: 'Instagram feed', config: { aspect: '1:1', outputHeight: 1080, outputFps: 30, captions: 'minimal' } },
  { id: 'linkedin', label: 'LinkedIn', config: { aspect: '4:5', outputHeight: 1080, outputFps: 30, captions: 'minimal' } },
  { id: 'web', label: 'Web (compact)', config: { aspect: 'source', outputHeight: 720, outputFps: 30 } },
]
export interface ExportProgress { progress: number; stage: 'bundling' | 'rendering' | 'done' | 'error'; message?: string; output?: string; suffix?: string }

export type Platform = 'darwin' | 'win32' | 'linux'

/** The API exposed to the renderer by preload. */
export interface NarrateApi {
  platform: Platform
  listDevices(): Promise<Devices>
  checkPermissions(request: boolean): Promise<Permissions>
  openSettings(which: 'screen' | 'mic'): Promise<void>
  startRecording(opts: StartOptions): Promise<void>
  pauseRecording(): Promise<void>
  resumeRecording(): Promise<void>
  stopRecording(): Promise<void>
  onRecorderEvent(cb: (e: RecorderEvent) => void): () => void
  getRecState(): Promise<{ state: RecState; since: number; pausedTotal: number; startedAt: number }>
  listProjects(): Promise<Project[]>
  /** Crash recovery (spec §62): unfinished recordings and the call that finalises one into a project. */
  listUnfinished(): Promise<UnfinishedRecording[]>
  recoverRecording(dir: string): Promise<Project>
  /** Live microphone level (spec §14): 0..1 at ~10 Hz while the meter runs. */
  startMicMeter(mic: number): Promise<void>
  stopMicMeter(): Promise<void>
  onMicLevel(cb: (level: number) => void): () => void
  saveProject(dir: string, file: ProjectFile): Promise<void>
  /** Smart Director: cached analysis.json, or run the analysis (force = redo). Progress arrives via onRecorderEvent 'analyzing'. */
  analyzeProject(dir: string, force?: boolean): Promise<Analysis>
  /** Local speech recognition → transcript.json. Progress arrives via onRecorderEvent 'transcribing'. */
  transcribeProject(dir: string): Promise<Transcript>
  /** Cleaned voice track (noise reduction + loudness) → mic.clean.wav; resolves with the reloaded project. */
  enhanceAudio(dir: string): Promise<Project>
  /** Render one asset of the recording; `suffix` names the output file (`<stamp>-<suffix>.mp4`). */
  getShareSettings(): Promise<ShareSettings>
  saveShareSettings(s: ShareSettingsInput): Promise<ShareSettings>
  /** Uploads an exported MP4 + player page; resolves to the public link. Progress arrives on onShareProgress (0–1). */
  shareFile(file: string, title: string): Promise<string>
  onShareProgress(cb: (p: number) => void): () => void
  copyText(text: string): Promise<void>
  exportProject(dir: string, config: RenderConfig, cuts: Cut[], suffix?: string, format?: ExportFormat, extra?: MasterExtras): Promise<string>
  /** Thumbnail candidates at the given output seconds → PNG paths plus http URLs for display. */
  renderThumbnails(dir: string, config: RenderConfig, cuts: Cut[], timesOut: number[], extra?: MasterExtras): Promise<{ path: string; url: string }[]>
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  reveal(path: string): Promise<void>
  trashProject(dir: string): Promise<void>
  /** Developer screenshots only (NARRATE_OPEN): open a recording folder in the editor on launch. */
  onDevOpen(cb: (dir: string) => void): () => void
}
