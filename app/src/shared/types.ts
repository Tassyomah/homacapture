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
  /** 'import' = an outside video brought in with Upload (no cursor, no clicks); absent for recordings. */
  source?: 'import'
  originalName?: string
  /** Imports: where the speaker's face is (video pixels), for punch-ins and vertical crops; `face` is its size when found. */
  focus?: [number, number]
  face?: { w: number; h: number } | null
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
export interface ManualZoom { id: string; t: number; duration: number; x: number; y: number; level: number
  /** Punch-in: jump straight in and out on a cut instead of easing (talking heads). */
  snap?: boolean }
/** Kinetic text (auto-edit): a key phrase that pops in big over the video from `t` for `duration` (source seconds). */
export type TextStyle = 'pop' | 'title'
export type TextAnim = 'pop' | 'slide' | 'type' | 'slam'
export interface TextPop { id: string; t: number; duration: number; text: string; style: TextStyle
  /** How it comes in: pop (springs up), slide (rises in), type (typewriter), slam (drops in big). Default pop. */
  anim?: TextAnim }
/** Stickers: an emoji or a flat brand shape on top of the video. x/y = centre as a fraction of the frame; size = fraction of frame width. */
export type StickerShape = 'arrow' | 'star' | 'sparkle' | 'heart' | 'burst'
export interface Sticker { id: string; t: number; duration: number; emoji?: string; shape?: StickerShape; color?: Background; x: number; y: number; size: number; rotate: number }
export const STICKER_EMOJI = ['🔥', '👀', '💯', '🚀', '✨', '😂', '🤯', '👏', '❤️', '✅', '💡', '📌']
export const STICKER_SHAPES: StickerShape[] = ['arrow', 'star', 'sparkle', 'heart', 'burst']
/** B-roll (CapCut-style overlay): a picture or clip shown over the video from `t` for `duration` (source seconds).
 *  `file` is relative to the project folder (media/…). 'full' covers the frame; 'card' floats a rounded card above the speaker. */
export interface Overlay { id: string; t: number; duration: number; file: string; kind: 'image' | 'video'; name: string; fit: 'full' | 'card'
  /** A clip's own length in seconds (it is never shown past its end). */
  length?: number }
/** Background music: one track under the whole video, looped, ducked while anyone speaks. `file` is relative (media/…). */
export interface MusicTrack { file: string; name: string; volume: number; duck: boolean }
/** A file the user added to a project (copied into <project>/media). */
export interface MediaFile { file: string; url: string; kind: 'image' | 'video' | 'audio'; name: string; duration?: number }
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
  texts?: TextPop[]
  overlays?: Overlay[]
  stickers?: Sticker[]
  music?: MusicTrack | null
  /** When the automatic first edit of an uploaded video ran (it runs once; "Auto-edit again" redoes it). */
  autoEditedAt?: string
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

/** Caption looks: minimal pill, bold sentence, and the social ones that show a few words at a time
 *  (box = coral block behind the spoken word, karaoke = words light up as they are said, word = one big word at a time). */
export type CaptionStyle = 'off' | 'minimal' | 'bold' | 'box' | 'karaoke' | 'word'
export const CAPTION_STYLES: { id: CaptionStyle; label: string }[] = [
  { id: 'off', label: 'Off' }, { id: 'minimal', label: 'Minimal' }, { id: 'bold', label: 'Bold' },
  { id: 'box', label: 'Box' }, { id: 'karaoke', label: 'Karaoke' }, { id: 'word', label: 'One word' },
]

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
export interface ProjectAssets { screen: string; mic: string | null; micClean: string | null; camera: string | null; system: string | null; cursors: Record<string, string>
  /** screen.cutout.webm: the speaker cut out (transparent), made on request for Remove / blur background. */
  cutout?: string | null
  /** Files in <project>/media (music, B-roll), relative path → URL. */
  media?: Record<string, string> }
/** What sits behind the speaker once they are cut out: nothing (the original video), a blurred copy, a colour or a picture. */
export type BackdropFill = 'off' | 'blur' | 'color' | 'image'

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
  sfx: boolean          // whoosh on punch-ins and B-roll, pop on text pops
  sfxVolume: number     // 0..1
  backdrop: BackdropFill
  backdropColor: Background
  backdropImage: string | null  // media/… file
  progressBar: 'off' | 'top' | 'bottom'
  /** Colour look on the video (CapCut "filters") plus three fine adjustments, 1 = unchanged. */
  look: Look
  brightness: number; contrast: number; saturation: number
  /** Transition at each cut: 'big' = only where more than 2 s was removed (pause trims stay clean jump cuts). */
  transition: Transition
  transitionAt: 'big' | 'all'
}
export type Look = 'none' | 'warm' | 'cool' | 'punchy' | 'soft' | 'film' | 'mono'
export const LOOKS: { id: Look; label: string; css: string }[] = [
  { id: 'none', label: 'None', css: '' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.16) saturate(1.12) hue-rotate(-6deg) brightness(1.02)' },
  { id: 'cool', label: 'Cool', css: 'saturate(0.95) hue-rotate(8deg) brightness(1.02) contrast(1.03)' },
  { id: 'punchy', label: 'Punchy', css: 'contrast(1.14) saturate(1.3)' },
  { id: 'soft', label: 'Soft', css: 'contrast(0.9) brightness(1.06) saturate(0.92)' },
  { id: 'film', label: 'Film', css: 'sepia(0.22) contrast(1.08) saturate(0.85) brightness(0.98)' },
  { id: 'mono', label: 'B&W', css: 'grayscale(1) contrast(1.12)' },
]
export type Transition = 'none' | 'zoom' | 'flash' | 'blur' | 'whip'
export const defaultConfig: RenderConfig = {
  aspect: 'source', zoom: 2, padding: 0.06, radius: 24, background: 'indigo', cursorScale: 1.6, outputHeight: 1080, outputFps: 60,
  cameraShape: 'circle', cameraSize: 0.2, cameraCorner: 'br', cameraMirror: true,
  micVolume: 1, systemVolume: 0.8, captions: 'off', voice: 'raw', keycaps: true,
  sfx: false, sfxVolume: 0.55, backdrop: 'off', backdropColor: 'paper', backdropImage: null,
  progressBar: 'off', look: 'none', brightness: 1, contrast: 1, saturation: 1, transition: 'none', transitionAt: 'big',
}

export type ScreencastProps = { assets: ProjectAssets; events: RecordingEvents; config: RenderConfig; cuts?: Cut[]; zooms?: ManualZoom[]; speeds?: SpeedRange[]; masks?: Mask[]; texts?: TextPop[]; overlays?: Overlay[]; stickers?: Sticker[]; music?: MusicTrack | null; transcript?: Transcript | null; [k: string]: unknown }
/** Master-level instructions every derivative inherits. */
export interface MasterExtras { zooms: ManualZoom[]; speeds: SpeedRange[]; masks: Mask[]; texts?: TextPop[]; overlays?: Overlay[]; stickers?: Sticker[]; music?: MusicTrack | null }

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
  | { event: 'importing'; step: 'reading' | 'video' | 'audio' | 'framing' }
  | { event: 'matting'; done: number; total: number }
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
  /** Upload (spec add-on): bring an outside video in as a project. No path = show the file picker; null = cancelled.
   *  Progress arrives via onRecorderEvent 'importing'. */
  importVideo(path?: string): Promise<Project | null>
  /** The file path of a file dropped on the window (Electron webUtils). */
  pathForFile(file: File): string
  /** Add a music track or a B-roll picture/clip: file picker, copied into <project>/media. null = cancelled. */
  addMedia(dir: string, kind: 'music' | 'broll' | 'image'): Promise<MediaFile | null>
  /** Cut the speaker out (screen.cutout.webm) for Remove / blur background. Progress via onRecorderEvent 'matting'. */
  matteProject(dir: string): Promise<Project>
  /** Developer screenshots only (NARRATE_OPEN): open a recording folder in the editor on launch. */
  onDevOpen(cb: (dir: string) => void): () => void
}
