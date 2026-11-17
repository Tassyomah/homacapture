import { useEffect, useRef, useState } from 'react'
import { IconMicrophone, IconPlayerStopFilled, IconRefresh, IconX } from '@tabler/icons-react'

/**
 * Record a voiceover over the video, the CapCut way: press Record, a 3-2-1 count, then the video plays from the playhead
 * while you talk (its own sound muted so the mic doesn't pick it up), Stop, listen back, keep the take or record again.
 * The take becomes a voiceover on the timeline at the moment recording started; the video's sound dips under it.
 */
export type Take = { blob: Blob; seconds: number }
export function VoiceRecorder({ startLabel, replacing, onPlay, onStop, onSave, onClose }: {
  startLabel: string
  replacing: boolean
  /** start playing the video from the recording point; `muted` = without its own sound */
  onPlay: (muted: boolean) => void
  onStop: () => void
  onSave: (take: Take, opts: { duck: boolean; text: string }) => Promise<void>
  onClose: () => void
}) {
  const [phase, setPhase] = useState<'ready' | 'count' | 'rec' | 'review' | 'saving'>('ready')
  const [count, setCount] = useState(3)
  const [secs, setSecs] = useState(0)
  const [level, setLevel] = useState(0)
  const [muteWhile, setMuteWhile] = useState(true)
  const [duck, setDuck] = useState(true)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [take, setTake] = useState<Take | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; ac: AudioContext; t0: number; tick: number } | null>(null)
  const timers = useRef<number[]>([])

  const cleanup = () => {
    timers.current.forEach((t) => clearTimeout(t)); timers.current = []
    const r = rec.current; if (!r) return
    clearInterval(r.tick); r.stream.getTracks().forEach((t) => t.stop()); void r.ac.close().catch(() => {}); rec.current = null
  }
  useEffect(() => () => { cleanup(); if (url) URL.revokeObjectURL(url) }, [])

  const start = async () => {
    setErr(null)
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } }) }
    catch { setErr('HomaCapture could not use the microphone. Allow it in System Settings → Privacy & Security → Microphone, then try again.'); return }
    const ac = new AudioContext(), an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.fftSize)
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 192000 })
    const chunks: Blob[] = []
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    mr.onstop = () => {
      const seconds = rec.current ? (performance.now() - rec.current.t0) / 1000 : 0
      cleanup(); onStop()
      const blob = new Blob(chunks, { type: 'audio/webm' })
      if (url) URL.revokeObjectURL(url)
      setTake({ blob, seconds }); setUrl(URL.createObjectURL(blob)); setPhase('review'); setLevel(0)
    }
    // meter runs from the moment the mic opens, so you can see it hears you during the count
    const tick = window.setInterval(() => {
      an.getByteTimeDomainData(buf); let m = 0; for (const x of buf) m = Math.max(m, Math.abs(x - 128))
      setLevel(Math.min(1, m / 90))
      if (rec.current && rec.current.t0) setSecs((performance.now() - rec.current.t0) / 1000)
    }, 60)
    rec.current = { mr, stream, ac, t0: 0, tick }
    setPhase('count'); setCount(3); setSecs(0)
    for (const [i, n] of [[1, 2], [2, 1]] as const) timers.current.push(window.setTimeout(() => setCount(n), i * 800))
    timers.current.push(window.setTimeout(() => {
      if (!rec.current) return
      mr.start(250); rec.current.t0 = performance.now(); setPhase('rec'); onPlay(muteWhile)
    }, 2400))
  }
  const stop = () => {
    const r = rec.current
    if (phase === 'count') { cleanup(); onStop(); setPhase('ready'); return }
    if (r && r.mr.state === 'recording') r.mr.stop()
  }
  const again = () => { setTake(null); if (url) URL.revokeObjectURL(url); setUrl(null); setPhase('ready'); setSecs(0) }
  const keep = async () => {
    if (!take) return
    setPhase('saving')
    try { await onSave(take, { duck, text: text.trim() }) }
    catch (e) { setErr((e as Error).message); setPhase('review') }
  }
  const close = () => { if (rec.current?.mr.state === 'recording') rec.current.mr.stop(); cleanup(); onStop(); onClose() }
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div className="vrec" role="dialog" aria-label="Record a voiceover">
      <div className="vrec-head">
        <b>{replacing ? 'Record this voiceover again' : 'Record a voiceover'}</b>
        <button className="icon" aria-label="Close" onClick={close}><IconX size={16} /></button>
      </div>
      {phase === 'ready' && <>
        <p className="hint">Starts at <b>{startLabel}</b>. The video plays while you talk; press Stop when you're done.</p>
        <textarea rows={3} value={text} placeholder="What you'll say (optional). It stays here so you can read it." onChange={(e) => setText(e.target.value)} />
        <label className="vrec-opt"><input type="checkbox" checked={muteWhile} onChange={(e) => setMuteWhile(e.target.checked)} />Mute the video while I record</label>
        <label className="vrec-opt"><input type="checkbox" checked={duck} onChange={(e) => setDuck(e.target.checked)} />Lower the video's sound under my voiceover</label>
        <button className="vrec-big" onClick={() => void start()}><IconMicrophone size={20} />Record</button>
      </>}
      {(phase === 'count' || phase === 'rec') && <>
        {text && <p className="vrec-prompt">{text}</p>}
        <div className="vrec-live">
          {phase === 'count' ? <span className="vrec-count" key={count}>{count}</span> : <span className="vrec-dot" />}
          <span className="vrec-time">{phase === 'count' ? 'Get ready…' : mmss(secs)}</span>
          <div className="vrec-meter"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
        </div>
        <button className="vrec-big stop" onClick={stop}><IconPlayerStopFilled size={18} />{phase === 'count' ? 'Cancel' : 'Stop'}</button>
      </>}
      {(phase === 'review' || phase === 'saving') && take && <>
        <p className="hint">Your take · {mmss(take.seconds)}. Listen back, then keep it or record again.</p>
        {url && <audio src={url} controls />}
        <div className="row-btns">
          <button onClick={again} disabled={phase === 'saving'}><IconRefresh size={15} />Record again</button>
          <button className="primary" onClick={() => void keep()} disabled={phase === 'saving'}>{phase === 'saving' ? 'Adding…' : 'Use this take'}</button>
        </div>
      </>}
      {err && <p className="err">{err}</p>}
    </div>
  )
}
