import type { Aspect, PodcastConfig, PodShot, PodShotKind, PodTalk } from '../../shared/types'
import { IconTrash } from '@tabler/icons-react'

/**
 * Scenes (podcast projects): how the people are arranged, Riverside-style.
 *   Auto mix and match: solo on whoever talks, side by side (stacked in 9:16) when both talk.
 *   Side by side · Speaker big, other small · Stacked for shorts (9:16).
 * Any stretch can be changed by hand from the playhead; hand-picked shots win over the layout.
 */
type Layout = PodcastConfig['layout']
const LAYOUTS: { id: Layout; name: string; note: string }[] = [
  { id: 'auto', name: 'Auto mix and match', note: 'Whoever talks; both when you both do' },
  { id: 'side', name: 'Side by side', note: 'Both of you, always' },
  { id: 'speaker', name: 'Speaker big', note: 'Talker full, other small' },
  { id: 'stack', name: 'Stacked for shorts', note: 'Top and bottom, 9:16' },
]
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function Mini({ id, poster }: { id: Layout; poster: string | null }) {
  const img = (style: React.CSSProperties, tint: string) => <i style={{ position: 'absolute', borderRadius: 3, background: tint, backgroundImage: poster ? `url("${poster}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', ...style }} />
  const A = '#D85A30', B = '#534AB7'
  if (id === 'stack') return <span className="pod-mini tall">{img({ left: '6%', right: '6%', top: '4%', height: '44%' }, A)}{img({ left: '6%', right: '6%', bottom: '4%', height: '44%' }, B)}</span>
  if (id === 'side') return <span className="pod-mini">{img({ left: '4%', top: '8%', width: '44%', bottom: '8%' }, A)}{img({ right: '4%', top: '8%', width: '44%', bottom: '8%' }, B)}</span>
  if (id === 'speaker') return <span className="pod-mini">{img({ inset: 0 }, B)}{img({ right: '6%', bottom: '8%', width: '30%', height: '32%', outline: '2px solid #fff' }, A)}</span>
  return <span className="pod-mini">{img({ inset: 0 }, A)}<em className="pod-strip"><b style={{ background: A, flex: 2 }} /><b style={{ background: '#888780', flex: 2 }} /><b style={{ background: B, flex: 2 }} /><b style={{ background: '#888780', flex: 1 }} /></em></span>
}

export function PodScenesPanel({ talk, pc, shots, now, playhead, portrait, poster, onChange, onAspect, onSeek }: {
  talk: PodTalk; pc: PodcastConfig; shots: PodShot[]; now: PodShot | null; playhead: number; portrait: boolean; poster: string | null
  onChange: (pc: PodcastConfig) => void; onAspect: (a: Aspect) => void; onSeek: (t: number) => void
}) {
  const name = (id: string | null) => talk.people.find((p) => p.id === id)?.label ?? 'Everyone'
  const describe = (s: PodShot) => s.shot === 'solo' ? `${name(s.focus)} alone` : s.shot === 'speaker' ? `${name(s.focus)} big` : s.shot === 'stack' ? 'Stacked' : 'Side by side'
  const pick = (id: Layout) => {
    onChange({ ...pc, on: true, layout: id })
    if (id === 'stack' && !portrait) onAspect('9:16')
    if ((id === 'side' || id === 'speaker') && portrait) onAspect('16:9')
  }
  /** Change the shot from the playhead to the end of the shot that is on screen now. */
  const change = (shot: PodShotKind, focus: string | null) => {
    if (!now) return
    const t = Math.max(now.t, playhead), end = now.end
    if (end - t < 0.3) return
    const kept = pc.overrides.filter((o) => o.end <= t || o.t >= end)
    onChange({ ...pc, on: true, overrides: [...kept, { t, end, shot, focus }].sort((a, b) => a.t - b.t) })
  }
  const pair: PodShotKind = portrait ? 'stack' : 'side'
  const cuts = shots.length - 1
  return <>
    <h3 className="drawer-title">Scenes</h3>
    <label className="pod-on"><input type="checkbox" checked={pc.on} onChange={(e) => onChange({ ...pc, on: e.target.checked })} />Show everyone’s cameras (off = your camera only)</label>
    {pc.on && <>
      <div className="tpl-grid pod-grid">{LAYOUTS.map((l) => (
        <button key={l.id} className={'tpl' + (pc.layout === l.id ? ' on' : '')} onClick={() => pick(l.id)} aria-label={`Use ${l.name}`}>
          <Mini id={l.id} poster={poster} />
          <b>{l.name}</b><i>{l.note}</i>
        </button>))}</div>
      {pc.layout === 'auto' && <p className="hint">{cuts} cut{cuts === 1 ? '' : 's'} between {talk.people.map((p) => p.label).join(' and ')}, from who is talking.</p>}

      <div className="control"><div className="lbl"><span>Change the shot from here</span><span>{now ? `now: ${describe(now)}` : ''}</span></div>
        <div className="pod-shots">
          {talk.people.map((p) => <button key={p.id} onClick={() => change('solo', p.id)}>{p.label} alone</button>)}
          <button onClick={() => change(pair, null)}>{portrait ? 'Stacked' : 'Side by side'}</button>
          {!portrait && talk.people.map((p) => <button key={'b' + p.id} onClick={() => change('speaker', p.id)}>{p.label} big</button>)}
        </div>
        <span className="hint">Runs from the playhead to the next change.</span>
      </div>
      {pc.overrides.length > 0 && <div className="pod-overrides">
        {pc.overrides.map((o, i) => (
          <div key={i} className="pod-ov">
            <button className="pod-ov-t" onClick={() => onSeek(o.t + 0.01)}>{mmss(o.t)}–{mmss(o.end)}</button><span>{describe(o)}</span>
            <button className="icon" aria-label="Remove this change" onClick={() => onChange({ ...pc, overrides: pc.overrides.filter((_, j) => j !== i) })}><IconTrash size={14} /></button>
          </div>))}
        <button className="pod-reset" onClick={() => onChange({ ...pc, overrides: [] })}>Undo all hand changes</button>
      </div>}

      <div className="control"><div className="lbl"><span>Space around</span></div>
        <div className="seg">{([[0, 'None'], [0.02, 'Small'], [0.045, 'Large']] as [number, string][]).map(([v, l]) =>
          <button key={l} className={Math.abs(pc.gap - v) < 0.001 ? 'on' : ''} onClick={() => onChange({ ...pc, gap: v })}>{l}</button>)}</div></div>
      <div className="control"><div className="lbl"><span>Corners</span></div>
        <div className="seg">{([[0, 'Square'], [0.02, 'Round'], [0.05, 'Very round']] as [number, string][]).map(([v, l]) =>
          <button key={l} className={Math.abs(pc.corner - v) < 0.001 ? 'on' : ''} onClick={() => onChange({ ...pc, corner: v })}>{l}</button>)}</div></div>
      <label className="pod-on"><input type="checkbox" checked={pc.names} onChange={(e) => onChange({ ...pc, names: e.target.checked })} />Name labels</label>
    </>}
  </>
}
