import { useEffect, useState } from 'react'
import type { Project, RecorderEvent } from '../shared/types'
import { Home, niceName } from './screens/Home'
import { Recording } from './screens/Recording'
import { Editor } from './screens/Editor'
import { ControlBar } from './screens/ControlBar'
import { IconChevronLeft } from '@tabler/icons-react'
import { isWin } from './platform'

type Screen = { name: 'home' } | { name: 'recording' } | { name: 'editor'; project: Project }

document.body.classList.add(isWin ? 'win' : 'mac')

export function App() {
  if (window.location.hash === '#bar') return <ControlBar />
  return <MainWindow />
}

function MainWindow() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [projects, setProjects] = useState<Project[]>([])
  const [lastEvent, setLastEvent] = useState<RecorderEvent | null>(null)
  const [session, setSession] = useState<Extract<RecorderEvent, { event: 'started' }> | null>(null)
  const refresh = () => window.narrate.listProjects().then(setProjects)

  useEffect(() => {
    const offDev = window.narrate.onDevOpen((dir) => {
      window.narrate.listProjects().then((ps) => { const p = ps.find((x) => x.dir === dir); if (p) setScreen({ name: 'editor', project: p }) })
    })
    return offDev
  }, [])
  useEffect(() => {
    refresh()
    return window.narrate.onRecorderEvent((e) => {
      setLastEvent(e)
      if (e.event === 'started') { setSession(e); setScreen({ name: 'recording' }) }
      if (e.event === 'ready') { refresh(); setScreen({ name: 'editor', project: e.project }) }
      if (e.event === 'error') setScreen({ name: 'home' })
    })
  }, [])

  return (
    <div className="shell">
      <div className="titlebar drag">
        {screen.name === 'editor'
          ? <><button className="back no-drag" onClick={() => { refresh(); setScreen({ name: 'home' }) }}><IconChevronLeft size={16} />All recordings</button>
              <span className="crumb">{niceName(screen.project.name)}</span></>
          : <span className="brand">HomaCapture</span>}
        <span className="spacer" />
      </div>
      <div className="content">
        {screen.name === 'home' && <Home projects={projects} onOpen={(p) => setScreen({ name: 'editor', project: p })} onChanged={refresh}
                                         lastError={lastEvent?.event === 'error' ? lastEvent.message : null} />}
        {screen.name === 'recording' && <Recording lastEvent={lastEvent} session={session} />}
        {screen.name === 'editor' && <Editor project={screen.project} />}
      </div>
    </div>
  )
}
