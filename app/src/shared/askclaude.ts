/**
 * Ask Claude (optional): a typed request becomes a short list of edit operations, answered by the Claude Code CLI on
 * this computer (her own Claude subscription, no API key). Shared by main (which runs the CLI) and the renderer (which
 * checks every operation and applies them all as one undo step). Claude never touches files: it only answers with JSON.
 */

export type AskOpName = 'addCut' | 'keepRange' | 'addText' | 'editText' | 'addSticker' | 'addOverlay' | 'setConfig' | 'addZoom' | 'removeItem'
export const ASK_OPS: AskOpName[] = ['addCut', 'keepRange', 'addText', 'editText', 'addSticker', 'addOverlay', 'setConfig', 'addZoom', 'removeItem']

/** One operation. Flat on purpose (one object shape for every op), so the schema stays simple; the renderer checks which fields each op needs. */
export interface AskOp {
  op: AskOpName
  /** Source seconds (see the brief's `kept` table to turn what she sees into source seconds). */
  start?: number; end?: number; t?: number; duration?: number
  /** editText / removeItem: the item's id from the brief; removeItem also names its kind. */
  id?: string; kind?: 'cut' | 'text' | 'sticker' | 'overlay' | 'zoom' | 'voiceover'
  text?: string; sub?: string; style?: 'pop' | 'title' | 'name' | 'band'; anim?: 'pop' | 'slide' | 'type' | 'slam'
  color?: string; bg?: string
  emoji?: string; shape?: 'arrow' | 'star' | 'sparkle' | 'heart' | 'burst'
  /** Position as a fraction of the frame (0..1, centre of the item); size = sticker width as a fraction of the frame. */
  x?: number; y?: number; size?: number
  file?: string; fit?: 'full' | 'card'
  key?: string; value?: string | number | boolean
  level?: number
}
export interface AskAnswer { summary: string; ops: AskOp[] }

/** Settings Claude may change, with what each accepts. Everything else in the config is off limits. */
export const ASK_CONFIG: Record<string, { type: 'enum'; values: string[] } | { type: 'bool' } | { type: 'num'; min: number; max: number } | { type: 'color' } | { type: 'text'; max: number }> = {
  captions: { type: 'enum', values: ['off', 'minimal', 'bold', 'box', 'karaoke', 'word', 'pill', 'clean', 'outline', 'soft', 'line'] },
  capHighlight: { type: 'bool' }, capEmoji: { type: 'bool' }, capMarker: { type: 'bool' }, capColor: { type: 'color' },
  look: { type: 'enum', values: ['none', 'warm', 'cool', 'punchy', 'soft', 'film', 'mono', 'redroom'] }, lookAmount: { type: 'num', min: 0, max: 1 },
  brightness: { type: 'num', min: 0.5, max: 1.5 }, contrast: { type: 'num', min: 0.5, max: 1.5 }, saturation: { type: 'num', min: 0, max: 2 },
  transition: { type: 'enum', values: ['none', 'zoom', 'flash', 'blur', 'whip'] }, transitionAt: { type: 'enum', values: ['big', 'all'] },
  vignette: { type: 'bool' }, grain: { type: 'bool' }, bars: { type: 'bool' }, shake: { type: 'bool' },
  progressBar: { type: 'enum', values: ['off', 'top', 'bottom'] },
  intro: { type: 'bool' }, introTitle: { type: 'text', max: 80 }, introSub: { type: 'text', max: 80 },
  outro: { type: 'bool' }, outroText: { type: 'text', max: 80 }, outroSub: { type: 'text', max: 80 },
  micVolume: { type: 'num', min: 0, max: 1.5 }, systemVolume: { type: 'num', min: 0, max: 1.5 },
  sfx: { type: 'bool' }, sfxVolume: { type: 'num', min: 0, max: 1 },
  aspect: { type: 'enum', values: ['source', '16:9', '9:16', '1:1', '4:5'] },
  background: { type: 'enum', values: ['indigo', 'coral', 'ink', 'paper'] },
}

/** JSON Schema handed to the CLI (--json-schema): the answer must be exactly this shape. */
export const ASK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'ops'],
  properties: {
    summary: { type: 'string', description: 'One short line for the editor, in plain words: what was changed (and anything asked for that could not be done).' },
    ops: {
      type: 'array', maxItems: 40,
      items: {
        type: 'object', additionalProperties: false, required: ['op'],
        properties: {
          op: { type: 'string', enum: ASK_OPS },
          start: { type: 'number' }, end: { type: 'number' }, t: { type: 'number' }, duration: { type: 'number' },
          id: { type: 'string' }, kind: { type: 'string', enum: ['cut', 'text', 'sticker', 'overlay', 'zoom', 'voiceover'] },
          text: { type: 'string' }, sub: { type: 'string' }, style: { type: 'string', enum: ['pop', 'title', 'name', 'band'] },
          anim: { type: 'string', enum: ['pop', 'slide', 'type', 'slam'] }, color: { type: 'string' }, bg: { type: 'string' },
          emoji: { type: 'string' }, shape: { type: 'string', enum: ['arrow', 'star', 'sparkle', 'heart', 'burst'] },
          x: { type: 'number' }, y: { type: 'number' }, size: { type: 'number' },
          file: { type: 'string' }, fit: { type: 'string', enum: ['full', 'card'] },
          key: { type: 'string', enum: Object.keys(ASK_CONFIG) }, value: { type: ['string', 'number', 'boolean'] },
          level: { type: 'number' },
        },
      },
    },
  },
} as const

/** The fixed instructions Claude gets with every request (its whole system prompt: no tools, no files, JSON only). */
export const ASK_SYSTEM = `You are the edit assistant inside HomaCapture, a video editor. The person editing types a request about the open video.
You receive a JSON brief of the project and answer ONLY with JSON matching the schema: {"summary": "...", "ops": [...]}. You have no tools and never read or write files.

Time: every time in the brief and in your ops is in SOURCE seconds (the original recording). What the person sees and says ("at 0:20", "the first 10 seconds") is OUTPUT time, after cuts. The brief's "kept" table lists [sourceStart, sourceEnd, outputStart] for each stretch that still plays; use it to turn output time into source time. "playhead" is where the person is now ("here", "now").
Words: transcript.lines lists every spoken word as [start, end, "word"] in source seconds; words already removed are marked in "removed". To act "when I say X", find the word and use its start. To cut "the part where I talk about X", cut from the start of the first word of the sentence(s) about X to the end of the last word of them (whole sentences, never half a word).

Operations (only these; fields not listed for an op are ignored):
- addCut {start, end}: remove that stretch of the recording.
- keepRange {start, end}: keep only that stretch, remove everything before and after it.
- addText {t, duration, text, style?, anim?, color?, bg?, x?, y?, sub?}: words on screen. style pop (default, key phrase), title (big card), name (name tag; sub = role), band (full-width band). Keep text short (under 8 words). color/bg are #RRGGBB.
- editText {id, text?, t?, duration?, style?, anim?, color?, bg?, x?, y?}: change an existing text (id from the brief).
- addSticker {t, duration, emoji | shape, x?, y?, size?}: an emoji (one emoji character) or a shape (arrow, star, sparkle, heart, burst). x/y = centre as a fraction of the frame (default 0.5, 0.35), size = fraction of frame width (default 0.22).
- addOverlay {t, duration, file, fit?}: show a picture or clip from the project's media list over the video. fit full (cover the frame) or card (float above the speaker, default). Only files listed in "media".
- setConfig {key, value}: change one setting from "settings" (allowed values are listed there). These apply to the whole video; there are no per-section settings. capColor is the colour of highlighted key words in captions (it only shows when capHighlight is true); the main caption text stays white.
- addZoom {t, duration, level?, x?, y?}: punch in. level 1.1 to 3 (default 1.3 for talking videos). x/y in video pixels (default: the speaker's face or the centre).
- removeItem {kind, id}: delete a cut (brings that stretch back), text, sticker, overlay, zoom or voiceover by its id.

Rules:
- Do exactly what was asked, nothing extra. Never remove the whole video.
- If the request cannot be done with these operations, or the words asked about are not in the transcript, return "ops": [] and say why in the summary.
- If you do only part of it, say in the summary what you could not do.
- The summary is one short, friendly line in plain English, using output times like 0:20 when it helps.`

/** Status of the local CLI as the editor sees it. */
export type ClaudeStatus = { installed: false } | { installed: true; signedIn: boolean; version: string }
/** What a request comes back with: the answer, or why there is none. `code` lets the box show the right help. */
export type AskResult = { ok: true; answer: AskAnswer } | { ok: false; code: 'missing' | 'signin' | 'timeout' | 'cancelled' | 'busy' | 'bad' | 'failed'; message: string }
