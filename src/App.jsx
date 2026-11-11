import { useEffect, useMemo, useState } from 'react'
import { useStore } from './store.js'
import { Icon } from './ui.jsx'
import Home from './Home.jsx'
import Readiness from './Readiness.jsx'
import Calendar from './Calendar.jsx'
import Checkpoints from './Checkpoints.jsx'
import Profile from './Profile.jsx'
import { CHECKPOINTS, TARGET } from './lib/plan.js'

const TABS = [['home', 'Home', 'home'], ['ready', 'Readiness', 'ready'], ['calendar', 'Kalender', 'cal'], ['checkpoints', 'Checkpoint', 'flag'], ['profile', 'Profil', 'user']]
const fromHash = () => { const t = location.hash.replace('#/', ''); return TABS.some((x) => x[0] === t) ? t : 'home' }

function latestVdot(results) {
  const done = CHECKPOINTS.filter((c) => results[c.id]?.vdot != null && (c.kind === 'tt'))
  const last = done[done.length - 1]
  return last ? { v: results[last.id].vdot, src: `CP${last.id} (${last.date})` } : { v: TARGET.baseline, src: 'baseline 10K resmi 1:00:55 (CP1 belum dilari)' }
}

export default function App() {
  const [tab, setTab] = useState(fromHash), [focus, setFocus] = useState(null)
  const [results, setResults] = useStore('lumpad.results', {})
  const [theme] = useStore('lumpad.theme', 'auto')
  const vdot = useMemo(() => latestVdot(results), [results])
  useEffect(() => { const f = () => setTab(fromHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme === 'auto' ? '' : theme }, [theme])
  const go = (t, arg = null) => { setFocus(arg); location.hash = '#/' + t; setTab(t); window.scrollTo(0, 0) }

  return <div className="app">
    <main>
      {tab === 'home' && <Home vdot={vdot} results={results} go={go} />}
      {tab === 'ready' && <Readiness />}
      {tab === 'calendar' && <Calendar vdot={vdot} focus={focus} />}
      {tab === 'checkpoints' && <Checkpoints vdot={vdot} results={results} setResults={setResults} focus={focus} />}
      {tab === 'profile' && <Profile />}
    </main>
    <nav className="tabbar" aria-label="Menu utama">
      {TABS.map(([k, l, ic]) => <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}><Icon n={ic} /><span>{l}</span></button>)}
    </nav>
  </div>
}
