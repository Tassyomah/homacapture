/**
 * Export a recording from the command line, through the same pipeline the app uses
 * (AssetServer → Remotion bundle → renderMedia). For testing and CI; the app never calls this.
 *
 *   npx tsx scripts/export.ts <recording dir> [outputHeight=1080] [zoom=2] [--gif]
 */
import { join, resolve, basename } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { AssetServer } from '../src/main/assetServer'
import { exportProject } from '../src/main/exporter'
import { defaultConfig, type Project, type RecordingEvents } from '../src/shared/types'

const gif = process.argv.includes('--gif')
const [, , dirArg, heightArg, zoomArg] = process.argv.filter((a) => a !== '--gif')
if (!dirArg) { console.error('usage: tsx scripts/export.ts <recording dir> [outputHeight] [zoom]'); process.exit(2) }
const dir = resolve(dirArg)
const eventsPath = join(dir, 'events.json')
if (!existsSync(eventsPath)) { console.error(`no events.json in ${dir}`); process.exit(2) }

const server = await AssetServer.start(resolve(dir, '..'))
const events = JSON.parse(readFileSync(eventsPath, 'utf8')) as RecordingEvents
const url = (f: string) => server.url(join(dir, f))
const cursors: Record<string, string> = {}
for (const [id, c] of Object.entries(events.cursors)) cursors[id] = url(c.file)
const projectFile = join(dir, 'project.json')
const saved = existsSync(projectFile) ? (JSON.parse(readFileSync(projectFile, 'utf8')) as Project['file']) : null
const transcriptFile = join(dir, 'transcript.json')
const project: Project = {
  dir, name: basename(dir), createdAt: statSync(eventsPath).mtime.toISOString(), events, file: saved,
  transcript: existsSync(transcriptFile) ? JSON.parse(readFileSync(transcriptFile, 'utf8')) : null,
  assets: { screen: url(events.files.screen), mic: events.files.mic ? url(events.files.mic) : null,
            micClean: existsSync(join(dir, 'mic.clean.wav')) ? url('mic.clean.wav') : null,
            camera: events.files.camera ? url(events.files.camera) : null,
            system: events.files.system ? url(events.files.system) : null, cursors,
            cutout: existsSync(join(dir, 'screen.cutout.webm')) ? url('screen.cutout.webm') : null,
            media: Object.fromEntries((existsSync(join(dir, 'media')) ? readdirSync(join(dir, 'media')) : []).map((f) => [`media/${f}`, url(join('media', f))])) },
}
// Saved edits apply, as in the app; the CLI arguments override height and zoom.
const base = { ...defaultConfig, ...(saved?.config ?? {}) }
const config = { ...base, outputHeight: Number(heightArg ?? base.outputHeight), zoom: Number(zoomArg ?? base.zoom) }
let last = -1
const started = Date.now()
const out = await exportProject(resolve(import.meta.dirname, '..'), project, config, saved?.cuts ?? [], (p) => {
  const pct = Math.round(p.progress * 100)
  if (p.stage !== 'rendering' || pct !== last) { last = pct; console.log(`${p.stage} ${pct}% ${p.message ?? ''}`.trim()) }
}, 'narrate', gif ? 'gif' : 'mp4')
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s → ${out}`)
process.exit(0)
