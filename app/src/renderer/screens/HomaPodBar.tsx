import { useEffect, useState } from 'react'
import type { HomapodStatus } from '../../shared/types'

/** Floating HomaPod bar: sits on top of Chrome or the call window so Record and Stop are always one click away. */
export function HomaPodBar() {
  const [st, setSt] = useState<HomapodStatus | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    void window.narrate.homapodStatus().then(setSt)
    const off = window.narrate.onHomapodStatus(setSt)
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => { off(); clearInterval(t) }
  }, [])
  const ls = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
  const record = () => {
    const cam = ls('hp.cam')
    void window.narrate.homapodRecord({ micLabel: ls('hp.mic') || null, camLabel: !cam || cam === 'none' ? null : cam, headphones: ls('hp.hp') !== '0' })
  }
  if (!st) return <div className="hpcard drag" />
  const s = st.since ? Math.max(0, Math.floor((now - st.since) / 1000)) : 0
  const time = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const who = st.guests.length === 0 ? 'Waiting for your guest…' : st.guests.length === 1 ? `${st.guests[0].label} is here` : `${st.guests.length} guests here`
  return (
    <div className="hpcard drag">
      {st.phase === 'recording' ? <>
        <div className="hpcard-top"><span className="dot" /><span className="time">{time}</span></div>
        <span className={'hpcard-who' + (st.guests.length ? '' : ' warn')}>{st.guests.length ? who : 'No guest yet, recording only you'}</span>
        <button className="no-drag stop" onClick={() => void window.narrate.homapodStop()}>Stop</button>
      </> : st.phase === 'saving' ? <>
        <div className="hpcard-top"><span className="dot off" /><span className="time">Saving</span></div>
        <span className="hpcard-who">{st.message ?? 'Saving…'}</span>
      </> : <>
        <div className="hpcard-top"><span className={st.guests.length ? 'hpbar-live' : 'hpbar-wait'} /><b>HomaPod</b></div>
        <span className={'hpcard-who' + (!st.saved && !st.guests.length ? ' warn' : '')}>{st.saved ? 'Saved ✓' : st.guests.length ? who : 'No guest in the call yet'}
          {!st.saved && st.auto && !st.hostInCall && <em className="hpcard-sub">Recording starts when you press START in the call</em>}</span>
        <div className="hpcard-btns">
          {st.saved ? <button className="no-drag" onClick={() => void window.narrate.homapodFocusMain()}>Show</button>
            : <button className="no-drag rec" onClick={record}>● Record</button>}
        </div>
      </>}
    </div>
  )
}
