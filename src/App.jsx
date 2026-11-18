import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useSyncStatus, useSettings } from './store.js'
import { Icon } from './ui.jsx'
import Home from './Home.jsx'
import Readiness from './Readiness.jsx'
import Calendar from './Calendar.jsx'
import Activity from './Activity.jsx'
import Profile from './Profile.jsx'
import Coach from './Coach.jsx'
import { CHECKPOINTS, TARGET } from './lib/plan.js'

const TABS = [['home', 'Home', 'home'], ['ready', 'Readiness', 'ready'], ['activity', 'Aktivitas', 'run'], ['coach', 'Coach', 'coach'], ['calendar', 'Kalender', 'cal'], ['profile', 'Profil', 'user']]
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
  const [settings, setSettings] = useSettings()
  const vdot = useMemo(() => latestVdot(results), [results])
  const sync = useSyncStatus()
  const mainRef = useRef(), first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } mainRef.current?.focus({ preventScroll: true }) }, [tab])
  useEffect(() => { const f = () => setTab(fromHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme === 'auto' ? '' : theme }, [theme])
  const go = (t, arg = null) => { setFocus(arg); location.hash = '#/' + t; setTab(t); window.scrollTo(0, 0) }

  return <div className="app">
    <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}>Lewati ke konten</a>
    {sync === 'offline' && <div className="offbar" role="status">Offline — perubahan tersimpan hanya di browser ini dan akan dikirim saat tersambung</div>}
    <main id="main" ref={mainRef} tabIndex={-1}>
      {tab === 'home' && <Home vdot={vdot} settings={settings} results={results} go={go} />}
      {tab === 'ready' && <Readiness vdot={vdot} settings={settings} focus={focus} />}
      {tab === 'activity' && <Activity vdot={vdot} focus={focus} />}
      {tab === 'coach' && <Coach />}
      {tab === 'calendar' && <Calendar vdot={vdot} results={results} setResults={setResults} focus={focus} settings={settings} go={go} />}
      {tab === 'profile' && <Profile vdot={vdot} results={results} settings={settings} setSettings={setSettings} />}
    </main>
    <nav className="tabbar" aria-label="Menu utama">
      {TABS.map(([k, l, ic]) => <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}><Icon n={ic} /><span>{l}</span></button>)}
    </nav>
  </div>
}
