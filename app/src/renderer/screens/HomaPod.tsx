import { useEffect, useRef, useState } from 'react'
import type { HomapodFile, HomapodStatus, Project } from '../../shared/types'
import { IconBrandChrome, IconCheck, IconCopy, IconDeviceMobile, IconMicrophone, IconPlayerRecordFilled, IconPlayerStopFilled, IconRefresh, IconUser, IconVideo, IconWindow } from '@tabler/icons-react'

/**
 * HomaPod: record a remote guest. The guest gets one VDO.Ninja link (any browser, nothing to install); HomaCapture
 * joins the same room quietly and records every guest, plus your own camera and mic, as separate files on one clock.
 */
const word = () => Math.random().toString(36).slice(2, 8)
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const mb = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`

export function HomaPod({ projects, onOpen, onChanged }: { projects: Project[]; onOpen: (p: Project) => void; onChanged: () => void }) {
  const [st, setSt] = useState<HomapodStatus | null>(null)
  const [guest, setGuest] = useState(() => localStorage.getItem('hp.guest') ?? '')
  const [room, setRoom] = useState(() => localStorage.getItem('hp.room') ?? `homapod${word()}`)
  const [mode, setMode] = useState<'here' | 'chrome'>(() => (localStorage.getItem('hp.mode') as 'here' | 'chrome') ?? 'chrome')
  const [mics, setMics] = useState<string[]>([]), [cams, setCams] = useState<string[]>([])
  const [mic, setMic] = useState<string>(() => localStorage.getItem('hp.mic') ?? '')
  const [cam, setCam] = useState<string>(() => localStorage.getItem('hp.cam') ?? '')
  const [headphones, setHeadphones] = useState(() => localStorage.getItem('hp.hp') !== '0')
  const [copied, setCopied] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [done, setDone] = useState<Project | null>(null)
  const [files, setFiles] = useState<Record<string, HomapodFile | null>>({})
  const [lining, setLining] = useState<string | null>(null)
  const roomRef = useRef(room)

  useEffect(() => {
    void window.narrate.homapodStatus().then((s) => { setSt(s); if (s.room) { setRoom(s.room); setMode(s.mode) } })
    return window.narrate.onHomapodStatus(setSt)
  }, [])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [])
  // saved from the floating bar: show the same "Saved" card here
  useEffect(() => {
    if (!st?.saved || done?.dir === st.saved) return
    const dir = st.saved
    void window.narrate.listProjects().then((ps) => { const p = ps.find((x) => x.dir === dir); if (p) { setDone(p); onChanged() } })
  }, [st?.saved])
  useEffect(() => {
    void (async () => {
      try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()) } catch { /* labels stay hidden */ }
      const all = await navigator.mediaDevices.enumerateDevices()
      const m = all.filter((d) => d.kind === 'audioinput' && d.label && d.deviceId !== 'default').map((d) => d.label)
      const c = all.filter((d) => d.kind === 'videoinput' && d.label).map((d) => d.label)
      setMics(m); setCams(c)
      setMic((x) => m.includes(x) ? x : m[0] ?? ''); setCam((x) => x === 'none' || c.includes(x) ? x : c[0] ?? 'none')
    })()
  }, [])
  const pods = projects.filter((p) => p.name.startsWith('homapod-'))
  useEffect(() => { for (const p of pods) if (!(p.dir in files)) void window.narrate.homapodRead(p.dir).then((f) => setFiles((o) => ({ ...o, [p.dir]: f }))) }, [projects])
  useEffect(() => { localStorage.setItem('hp.guest', guest); localStorage.setItem('hp.room', room); localStorage.setItem('hp.mode', mode)
    localStorage.setItem('hp.mic', mic); localStorage.setItem('hp.cam', cam); localStorage.setItem('hp.hp', headphones ? '1' : '0') }, [guest, room, mode, mic, cam, headphones])

  const phase = st?.phase ?? 'off'
  const live = phase === 'recording' || phase === 'saving'
  const joined = phase !== 'off' && st?.room === room
  const guestLink = joined && st ? st.guestLink : `https://vdo.ninja/?room=${room}&webcam&quality=0${guest.trim() ? `&label=${encodeURIComponent(guest.trim())}` : ''}`

  const copy = async (what: string, text: string) => { await window.narrate.copyText(text); setCopied(what); setTimeout(() => setCopied(null), 1600) }
  const recCard = useRef<HTMLElement>(null)
  const go = async (m: 'here' | 'chrome') => {
    setErr(null); setMode(m); setBusy(true); roomRef.current = room
    try { setSt(await window.narrate.homapodPrepare({ room, guest, host: 'Tassy', mode: m })); if (m === 'chrome') void window.narrate.homapodOpenChrome()
      setTimeout(() => recCard.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 100) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const record = async () => {
    setErr(null); setDone(null)
    try { setSt(await window.narrate.homapodRecord({ micLabel: mic || null, camLabel: cam === 'none' ? null : cam || null, headphones })) }
    catch (e) { setErr((e as Error).message) }
  }
  const stop = async () => {
    try { const p = await window.narrate.homapodStop(); if (p) { setDone(p); onChanged() } }
    catch (e) { setErr((e as Error).message) }
  }
  const addPhone = async (dir: string) => {
    setErr(null); setLining(dir)
    try { const f = await window.narrate.homapodAddPhone(dir); setFiles((o) => ({ ...o, [dir]: f })); onChanged() }
    catch (e) { setErr((e as Error).message) } finally { setLining(null) }
  }

  return (
    <div className="home hp">
      <header className="hp-head">
        <h1>HomaPod</h1>
        <p>Record a guest from anywhere. They tap one link in any browser, phone or laptop, with nothing to install. HomaCapture records each of you as your own file.</p>
      </header>

      <section className="hp-card">
        <div className="hp-step"><span>1</span><b>Send your guest the link</b></div>
        <div className="hp-fields">
          <label><span>Guest’s name</span><input value={guest} disabled={live} placeholder="e.g. Mrs Adeyemi" onChange={(e) => setGuest(e.target.value)} /></label>
          <label><span>Room</span><div className="hp-room"><input value={room} disabled={live} onChange={(e) => setRoom(e.target.value.replace(/[^\w]/g, ''))} />
            <button className="icon" title="New room name" disabled={live} onClick={() => setRoom(`homapod${word()}`)}><IconRefresh size={15} /></button></div></label>
        </div>
        <div className="hp-link"><code>{guestLink}</code>
          <button className="primary" onClick={() => void copy('guest', guestLink)}>{copied === 'guest' ? <><IconCheck size={15} />Copied</> : <><IconCopy size={15} />Copy guest link</>}</button></div>
        <p className="hp-note">The room name is the key to the call: anyone with the link can join, so keep it private. Their name shows on their tile and on their file.</p>
      </section>

      <section className="hp-card">
        <div className="hp-step"><span>2</span><b>Where will you talk?</b></div>
        <div className="hp-modes">
          <button className={`hp-mode${joined && mode === 'here' ? ' on' : ''}`} disabled={busy || live} onClick={() => void go('here')}>
            <IconWindow size={22} stroke={1.6} /><b>Open the call here</b><span>The call opens in a HomaCapture window. One Record button records everyone.</span></button>
          <button className={`hp-mode${joined && mode === 'chrome' ? ' on' : ''}`} disabled={busy || live} onClick={() => void go('chrome')}>
            <IconBrandChrome size={22} stroke={1.6} /><b>I’ll talk in Chrome</b><span>The call opens in Chrome as usual. HomaCapture records quietly in the background as your backup.</span></button>
        </div>
        {joined && st && <div className="hp-link small"><span>Your link</span><code>{st.hostLink}</code>
          <button onClick={() => void copy('host', st.hostLink)}>{copied === 'host' ? 'Copied' : 'Copy'}</button>
          {mode === 'here' ? <button onClick={() => void window.narrate.homapodOpenCall()}>Show the call</button> : <button onClick={() => void window.narrate.homapodOpenChrome()}>Open in Chrome</button>}</div>}
      </section>

      <section ref={recCard} className={`hp-card${phase === 'recording' ? ' rec' : ''}`}>
        <div className="hp-step"><span>3</span><b>Record</b></div>
        <div className="hp-fields">
          <label><span><IconMicrophone size={14} />Your mic</span><select value={mic} disabled={live} onChange={(e) => setMic(e.target.value)}>{mics.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label><span><IconVideo size={14} />Your camera</span><select value={cam} disabled={live} onChange={(e) => setCam(e.target.value)}>
            {cams.map((c) => <option key={c}>{c}</option>)}<option value="none">Don’t record my camera</option></select></label>
        </div>
        <label className="vrec-opt"><input type="checkbox" checked={headphones} disabled={live} onChange={(e) => setHeadphones(e.target.checked)} />I’m wearing headphones (your voice is recorded clean, with no echo removal)</label>
        <div className="hp-guests">
          {!joined ? <span className="hint">Pick where you’ll talk first. Then your guest shows up here when they join.</span>
            : st!.guests.length === 0 ? <span className="hint"><i className="hp-wait" />Waiting for your guest to join…</span>
            : st!.guests.map((g) => <span key={g.sid} className="hp-guest"><i className="hp-dot" /><IconUser size={14} />{g.label}<em>{g.width ? `${g.height}p` : 'sound only'}{g.audio ? '' : ' · no sound'}</em></span>)}
        </div>
        {phase === 'recording' && st && <div className="hp-tracks">{st.tracks.map((t) => <span key={t.key}>{t.label}<em>{mb(t.bytes)}</em></span>)}</div>}
        <div className="hp-rec-row">
          {phase === 'recording'
            ? <><span className="hp-time"><i className="vrec-dot" />{mmss((now - (st?.since ?? now)) / 1000)}</span>
                <button className="vrec-big stop" onClick={() => void stop()}><IconPlayerStopFilled size={18} />Stop</button></>
            : phase === 'saving' ? <span className="hint">{st?.message ?? 'Saving…'}</span>
            : <button className="vrec-big" disabled={!joined} onClick={() => void record()}><IconPlayerRecordFilled size={18} />Record</button>}
        </div>
        {st?.message && phase !== 'saving' && <p className="err">{st.message}</p>}
        {err && <p className="err">{err}</p>}
        {done && <div className="hp-done"><b>Saved.</b><span>Each voice and camera is its own file. The project uses your camera with everyone’s voices mixed in.</span>
          <button className="primary" onClick={() => onOpen(done)}>Open in the editor</button></div>}
      </section>

      {pods.length > 0 && <>
        <div className="list-head"><h2>Your HomaPods</h2><span>{pods.length}</span></div>
        <div className="hp-pods">{pods.map((p) => {
          const f = files[p.dir]
          return <div className="hp-pod" key={p.dir}>
            <div className="hp-pod-main"><b>{f?.tracks.filter((t) => t.kind === 'guest').map((t) => t.label).join(', ') || p.name}</b>
              <span>{new Date(f?.startedAt ?? p.createdAt).toLocaleString()} · {f?.tracks.length ?? 0} tracks{f?.phones.length ? ` · ${f.phones.length} phone video${f.phones.length > 1 ? 's' : ''}` : ''}</span>
              {f?.phones.map((ph) => <span key={ph.file} className={`hp-phone${ph.confident ? '' : ' unsure'}`}><IconDeviceMobile size={13} />{ph.file.split('/').pop()}
                <em>{ph.confident ? `starts at ${ph.start >= 0 ? '' : '−'}${mmss(Math.abs(ph.start))} · matched to ${ph.matchedTo}` : 'could not match it by sound'}</em></span>)}</div>
            <button disabled={!f || lining === p.dir} onClick={() => void addPhone(p.dir)}><IconDeviceMobile size={15} />{lining === p.dir ? (st?.message ?? 'Lining up…') : 'Add phone videos'}</button>
            <button className="primary" onClick={() => onOpen(p)}>Open</button>
          </div>
        })}</div>
      </>}
    </div>
  )
}
