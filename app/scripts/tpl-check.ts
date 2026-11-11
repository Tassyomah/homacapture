/** Test only: apply each short template to a project and render stills (and optionally a full export) without the app. */
import { join, resolve, basename } from 'node:path'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { renderStill, selectComposition } from '@remotion/renderer'
import { AssetServer } from '../src/main/assetServer'
import { exportProject } from '../src/main/exporter'
import { defaultConfig, type Project, type RecordingEvents, type ScreencastProps } from '../src/shared/types'
import { applyTemplate, TEMPLATES, type TemplateId } from '../src/renderer/templates'
import { keptRanges } from '../src/video/ranges'
import { bundle } from '@remotion/bundler'

const [, , dirArg, outArg, lenArg, only, full] = process.argv
const dir = resolve(dirArg), outDir = resolve(outArg), len = Number(lenArg ?? 30)
mkdirSync(outDir, { recursive: true })
const server = await AssetServer.start(resolve(dir, '..'))
const events = JSON.parse(readFileSync(join(dir, 'events.json'), 'utf8')) as RecordingEvents
const transcript = existsSync(join(dir, 'transcript.json')) ? JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')) : null
const url = (f: string) => server.url(join(dir, f))
const assets = { screen: url(events.files.screen), mic: events.files.mic ? url(events.files.mic) : null, micClean: null, camera: null, system: null, cursors: Object.fromEntries(Object.entries(events.cursors).map(([k, c]) => [k, url(c.file)])), media: {} }
const brand = { colors: ['#FB8B73', '#6E71E8', '#14140F', '#EFEEE8'], font: 'Aeonik', handle: '@TassyOmah', logo: null }
const serveUrl = await bundle({ entryPoint: resolve(import.meta.dirname, '../src/video/index.ts') })
for (const t of TEMPLATES.filter((x) => !only || only === 'all' || only.split(',').includes(x.id))) {
  const r = applyTemplate(t.id as TemplateId, events, transcript, len, brand, basename(dir))
  const config = { ...defaultConfig, ...r.config, outputHeight: 1080 }
  const ranges = keptRanges(events, r.cuts)
  const total = ranges.reduce((s, x) => s + x.end - x.start, 0)
  const props: ScreencastProps = { assets, events, config, cuts: r.cuts, zooms: r.zooms, texts: r.texts, transcript }
  console.log(`${t.id}: window ${r.window.map((x) => x.toFixed(1)).join('-')} out ${total.toFixed(1)}s hook "${r.hook}" texts ${r.texts.map((x) => `${x.style}:${x.sub ?? ''}:${x.text}@${x.t.toFixed(1)}`).join(' | ')}`)
  if (process.env.DRY) continue
  const design = await selectComposition({ serveUrl, id: 'Screencast', inputProps: props })
  const k = 540 / design.width
  const comp = { ...design, width: 540, height: Math.round(design.height * k / 2) * 2 }
  for (const sec of [0.6, 3.5, total * 0.45, total * 0.75]) {
    const frame = Math.min(comp.durationInFrames - 1, Math.round(sec * comp.fps))
    await renderStill({ composition: comp, serveUrl, output: join(outDir, `${t.id}-${sec.toFixed(1)}.png`), inputProps: props, frame, imageFormat: 'png' })
  }
  writeFileSync(join(outDir, `${t.id}.json`), JSON.stringify({ ...r, config }, null, 1))
  if (full) {
    const project: Project = { dir, name: basename(dir), createdAt: '', events, file: { version: 1, config, cuts: r.cuts, zooms: r.zooms, texts: r.texts, savedAt: '' }, transcript, assets }
    const out = await exportProject(resolve(import.meta.dirname, '..'), project, { ...config, outputHeight: 720 }, r.cuts, () => {}, `tpl-${t.id}`, 'mp4', serveUrl)
    console.log('export', out)
  }
}
process.exit(0)
