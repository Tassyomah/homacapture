import { useEffect, useRef, useState } from 'react'
import type { Devices, Permissions, Project, UnfinishedRecording } from '../../shared/types'
import { IconCamera, IconClock, IconDeviceDesktop, IconMicrophone, IconPlayerPlay, IconTrash, IconVolume } from '@tabler/icons-react'
import { isWin, keys, machine } from '../platform'

type Phase = { kind: 'idle' } | { kind: 'countdown'; n: number } | { kind: 'starting' }

export function Home({ projects, onOpen, onChanged, lastError }: {
  projects: Project[]; onOpen: (p: Project) => void; onChanged: () => void; lastError: string | null
}) {
  const [devices, setDevices] = useState<Devices | null>(null)
  const [perms, setPerms] = useState<Permissions | null>(null)
  const [screen, setScreen] = useState(0)
  const [mic, setMic] = useState<number | null>(null)
  const [camera, setCamera] = useState<number | null>(null)   // default off (spec §96)
  const [systemAudio, setSystemAudio] = useState(false)       // default off (spec §96)
  const [countdown, setCountdown] = useState(3)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [unfinished, setUnfinished] = useState<UnfinishedRecording[]>([])
  const [recovering, setRecovering] = useState<string | null>(null)   // dir being recovered
  const [level, setLevel] = useState(0)

  const loadPerms = (request = false) => window.narrate.checkPermissions(request).then(setPerms)
  useEffect(() => {
    loadPerms()
    window.narrate.listUnfinished().then(setUnfinished).catch(() => {})
    window.narrate.listDevices().then((d) => {
      setDevices(d)
      const builtIn = d.mics.find((m) => /Microphone/.test(m.name) && !/iPhone/.test(m.name)) ?? d.mics[0]
      setMic(builtIn ? builtIn.index : null)
    }).catch((e) => setError(String(e)))
  }, [])
  useEffect(() => { if (lastError) setError(lastError) }, [lastError])

  // Live input level for the selected microphone while idle on this screen (spec §14).
  useEffect(() => {
    if (mic === null || phase.kind !== 'idle') { setLevel(0); return }
    window.narrate.startMicMeter(mic)
    const off = window.narrate.onMicLevel(setLevel)
    return () => { off(); window.narrate.stopMicMeter(); setLevel(0) }
  }, [mic, phase.kind])

  // Live camera preview (spec §10) through the browser camera API, matched to the chosen device by name.
  const previewRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (camera === null || phase.kind !== 'idle' || !devices) return
    let stream: MediaStream | null = null; let cancelled = false
    const want = devices.cameras?.find((c) => c.index === camera)?.name.trim().toLowerCase()
    ;(async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        const match = all.find((d) => d.kind === 'videoinput' && want && d.label.trim().toLowerCase().startsWith(want.slice(0, 12)))
        stream = await navigator.mediaDevices.getUserMedia({ video: match ? { deviceId: { exact: match.deviceId } } : true, audio: false })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        if (previewRef.current) previewRef.current.srcObject = stream
      } catch { /* no preview is fine; recording uses the recorder's own capture */ }
    })()
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); if (previewRef.current) previewRef.current.srcObject = null }
  }, [camera, phase.kind, devices])

  const recover = async (u: UnfinishedRecording) => {
    setRecovering(u.dir); setError(null)
    try {
      const p = await window.narrate.recoverRecording(u.dir)
      setUnfinished((l) => l.filter((x) => x.dir !== u.dir)); onChanged(); onOpen(p)
    } catch (e) { setError(`This recording could not be recovered. ${(e as Error).message}`) }
    finally { setRecovering(null) }
  }
  const discard = async (u: UnfinishedRecording) => {
    if (!confirm(`Move the unfinished recording from ${fmtDate(u.startedAt)} to the Bin?`)) return
    await window.narrate.trashProject(u.dir)
    setUnfinished((l) => l.filter((x) => x.dir !== u.dir))
  }

  const begin = async () => {
    setError(null)
    for (let n = countdown; n > 0; n--) { setPhase({ kind: 'countdown', n }); await new Promise((r) => setTimeout(r, 1000)) }
    setPhase({ kind: 'starting' })
    try { await window.narrate.startRecording({ screen, mic, camera, systemAudio, fps: 60 }) }
    catch (e) { setError(friendly((e as Error).message)); setPhase({ kind: 'idle' }) }
  }

  if (phase.kind === 'countdown') return (
    <div className="recording"><div className="timer">{phase.n}</div><p className="note">Recording starts in a moment. Switch to what you want to show.</p>
      <button onClick={() => setPhase({ kind: 'idle' })}>Cancel</button></div>
  )
  if (phase.kind === 'starting') return <div className="recording"><p className="note">Preparing recording…</p></div>

  const needsScreen = perms && !perms.screen
  const micBlocked = perms?.mic === 'denied'
  return (
    <div className="home">
      {needsScreen && (
        <div className="permission">
          <b>HomaCapture needs permission to record the screen.</b>
          <p>macOS asks once. Nothing is captured until you press Record, and recordings stay on {machine}.
             After allowing it, quit and reopen the app.</p>
          <div className="row">
            <button className="primary" onClick={() => loadPerms(true)}>Allow screen recording</button>
            <button onClick={() => window.narrate.openSettings('screen')}>Open System Settings</button>
          </div>
        </div>
      )}
      {unfinished.map((u) => (
        <div className="permission" key={u.dir}>
          <b>We recovered an unsaved recording.</b>
          <p>Started {fmtDate(u.startedAt)} · {u.display.width}×{u.display.height}{u.mic ? ` · ${u.mic}` : ''}.
             HomaCapture closed before it was saved. Restore it to finish saving and open it in the editor.</p>
          <div className="row">
            <button className="primary" disabled={!!recovering} onClick={() => recover(u)}>{recovering === u.dir ? 'Restoring…' : 'Restore'}</button>
            <button disabled={!!recovering} onClick={() => discard(u)}>Discard</button>
          </div>
        </div>
      ))}
      {micBlocked && (
        <div className="permission">
          <b>Microphone access is turned off for desktop apps.</b>
          <p>{isWin ? 'Turn on "Let desktop apps access your microphone" in Windows Settings, then come back. You can still record without a microphone.'
                    : 'Allow HomaCapture under Privacy & Security → Microphone, then reopen the app. You can still record without a microphone.'}</p>
          <div className="row">
            <button onClick={() => window.narrate.openSettings('mic')}>{isWin ? 'Open Windows Settings' : 'Open System Settings'}</button>
            <button onClick={() => loadPerms()}>Check again</button>
          </div>
        </div>
      )}

      <section className="rec-card">
        <div className="rec-main">
          <h1>Record now, talk later.</h1>
          <p className="lede">Capture your screen. Zooms, cursor and framing are added for you afterwards.</p>
          <div className="opts">
            <div className="opt"><span className="opt-name"><IconDeviceDesktop size={18} stroke={1.6} />Screen</span>
              <select value={screen} onChange={(e) => setScreen(Number(e.target.value))} disabled={!devices}>
                {!devices && <option>Looking for screens…</option>}
                {devices?.displays.map((d) => <option key={d.ordinal} value={d.ordinal}>{d.name} · {d.width}×{d.height}</option>)}
              </select></div>
            <div className="opt"><span className="opt-name"><IconMicrophone size={18} stroke={1.6} />Microphone</span>
              <div className="opt-ctl">
                <select value={mic ?? ''} onChange={(e) => setMic(e.target.value === '' ? null : Number(e.target.value))}>
                  <option value="">No microphone</option>
                  {devices?.mics.map((m) => <option key={m.index} value={m.index}>{m.name}</option>)}
                </select>
                {mic !== null && <div className="meter" data-tip="Speak to test: the bar moves with your voice"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>}
                {devices && devices.mics.length === 0 && <span className="note">No microphone detected.</span>}
              </div></div>
            {devices?.cameras && devices.cameras.length > 0 && (
              <div className="opt"><span className="opt-name"><IconCamera size={18} stroke={1.6} />Camera</span>
                <select value={camera ?? ''} onChange={(e) => setCamera(e.target.value === '' ? null : Number(e.target.value))}>
                  <option value="">No camera</option>
                  {devices.cameras.map((c) => <option key={c.index} value={c.index}>{c.name}</option>)}
                </select></div>
            )}
            {isWin && (
              <div className="opt"><span className="opt-name" data-tip="Sound playing on this PC, like a video or app alerts"><IconVolume size={18} stroke={1.6} />Computer sound</span>
                <div className="seg">
                  <button className={!systemAudio ? 'on' : ''} onClick={() => setSystemAudio(false)}>Off</button>
                  <button className={systemAudio ? 'on' : ''} onClick={() => setSystemAudio(true)}>Record it</button>
                </div></div>
            )}
            <div className="opt"><span className="opt-name"><IconClock size={18} stroke={1.6} />Countdown</span>
              <div className="seg">{[[0, 'None'], [3, '3 s'], [5, '5 s']].map(([v, l]) => (
                <button key={v} className={countdown === v ? 'on' : ''} onClick={() => setCountdown(v as number)}>{l}</button>))}</div></div>
          </div>
          <div className="rec-go">
            <button className="record" disabled={!devices || !!needsScreen} onClick={begin}>Start recording</button>
            <span className="note"><kbd>{keys.pause}</kbd> pause · <kbd>{keys.stop}</kbd> stop. A small control bar stays on screen.</span>
          </div>
          {error && <p className="err">{error}</p>}
        </div>
        <div className="rec-side">
          {camera !== null
            ? <video ref={previewRef} className="campreview" autoPlay muted playsInline />
            : <div className="rec-art" aria-hidden="true"><div className="scr"><i /><i /><i /><b /></div><span className="cam" /></div>}
          <span className="note">{camera !== null ? 'Camera preview. It is mirrored here like a selfie.' : 'Your screen, polished: background, rounded corners and smooth zooms.'}</span>
        </div>
      </section>

      <div className="list-head"><h2>Your recordings</h2>{projects.length > 0 && <span>{projects.length}</span>}</div>
      {projects.length === 0 ? <div className="empty">Your recordings will appear here. Press Start recording to make the first one.</div> : (
        <div className="cards">
          {projects.map((p) => (
            <div className="card" key={p.dir} onClick={() => onOpen(p)}
              onMouseEnter={(e) => { const v = e.currentTarget.querySelector('video'); v?.play().catch(() => {}) }}
              onMouseLeave={(e) => { const v = e.currentTarget.querySelector('video'); if (v) { v.pause(); v.currentTime = 0.5 } }}>
              <div className="thumbwrap">
                <video className="thumb" src={p.assets.screen + '#t=0.5'} muted preload="metadata" loop />
                <span className="dur">{fmt(p.events.videoDuration)}</span>
                <span className="open"><IconPlayerPlay size={16} />Open</span>
              </div>
              <div className="meta">
                <div><b>{niceName(p.name)}</b><span>{p.events.display.width}×{p.events.display.height}{p.assets.mic ? ' · voice' : ''}{p.assets.camera ? ' · camera' : ''}</span></div>
                <button className="icon" aria-label="Move to Bin" data-tip="Move to the Bin (you can restore it from there)"
                  onClick={(e) => { e.stopPropagation(); window.narrate.trashProject(p.dir).then(onChanged) }}><IconTrash size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Recording folders are named by timestamp (2026-10-07-15-02-58); show that as a date people read. Other names stay as they are. */
export function niceName(name: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(name)
  if (!m) return name
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
function friendly(msg: string) {
  if (/ffmpeg is not installed|Python 3/i.test(msg)) return msg
  if (/microphone/i.test(msg)) return msg
  if (isWin) {
    if (/no frames/i.test(msg)) return 'The screen capture produced no frames. Try again; if it keeps happening, restart HomaCapture.\n' + msg
    return msg
  }
  if (/permission/i.test(msg)) return 'macOS is blocking screen recording for this app. Allow it in System Settings → Privacy & Security → Screen Recording, then reopen HomaCapture.'
  if (/no frames/i.test(msg)) return 'The screen capture produced no frames. This is almost always the Screen Recording permission. Allow it and reopen HomaCapture.'
  return msg
}
