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
import { paces, fmtPace } from './lib/vdot.js'
import { today, diffDays } from './lib/calendar.js'
import { useSyncStatus2, wib, ago } from './sync.js'

const TABS = [['home', 'Home', 'home'], ['ready', 'Readiness', 'ready', 'Ready'], ['activity', 'Aktivitas', 'run'], ['coach', 'Coach', 'coach'], ['calendar', 'Kalender', 'cal'], ['profile', 'Profil', 'user']]
const fromHash = () => { const t = location.hash.replace('#/', ''); return TABS.some((x) => x[0] === t) ? t : 'home' }

function latestVdot(results) {
  const done = CHECKPOINTS.filter((c) => results[c.id]?.vdot != null && (c.kind === 'tt'))
  const last = done[done.length - 1]
  return last ? { v: results[last.id].vdot, src: `CP${last.id} (${last.date})` } : { v: TARGET.baseline, src: 'baseline 10K resmi 1:00:55 (CP1 belum dilari)' }
}

const THEMES = ['auto', 'light', 'dark']
// desktop side rail: live status of the data pipeline and the numbers the athlete checks most
function Hub({ vdot, settings }) {
  const sync = useSyncStatus2(), [busy, setBusy] = useState(''), p = paces(vdot.v), last = sync?.lastRun
  const run = async () => { setBusy('run'); try { const r = await fetch('/api/sync/run', { method: 'POST' }); setBusy(r.ok ? 'ok' : 'err') } catch { setBusy('err') } setTimeout(() => setBusy(''), 4000) }
  return <div className="hub">
    <div className="hub-h"><b>Telemetry hub</b><span className={'live ' + (last?.ok ? 'ok' : 'warn')}><i />{last ? 'LIVE' : 'BELUM SYNC'}</span></div>
    <dl>
      <div><dt>COROS sync</dt><dd>{last ? `${wib(last.received_at)} WIB` : '—'}</dd></div>
      <div><dt>VDOT → target</dt><dd className="am">{vdot.v.toFixed(1)}→{TARGET.vdotNeeded}</dd></div>
      <div><dt>T-pace</dt><dd className="co">{fmtPace(p.T)} /km</dd></div>
      <div><dt>Hari ke JRF</dt><dd className="cr">H-{Math.max(0, diffDays(settings.raceDate, today()))}</dd></div>
    </dl>
    <button className="btn hub-sync" onClick={run} disabled={busy === 'run'}><Icon n="sync" size={16} />{busy === 'run' ? 'Memulai…' : busy === 'ok' ? 'Sync dimulai' : busy === 'err' ? 'Gagal — cek Profil' : 'Sync sekarang'}</button>
    {last && <small>{ago(last.received_at)}</small>}
  </div>
}

export default function App() {
  const [tab, setTab] = useState(fromHash), [focus, setFocus] = useState(null)
  const [results, setResults] = useStore('lumpad.results', {})
  const [theme, setTheme] = useStore('lumpad.theme', 'auto')
  const cycleTheme = () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % 3])
  const [settings, setSettings] = useSettings()
  const vdot = useMemo(() => latestVdot(results), [results])
  const sync = useSyncStatus()
  const mainRef = useRef(), first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } mainRef.current?.focus({ preventScroll: true }) }, [tab])
  useEffect(() => { const f = () => setTab(fromHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme === 'auto' ? '' : theme }, [theme])
  const go = (t, arg = null) => { setFocus(arg); location.hash = '#/' + t; setTab(t); window.scrollTo(0, 0) }

  const nextCp = CHECKPOINTS.find((c) => c.date >= today())
  const BADGE = { ready: null, activity: null, coach: 'AI', calendar: nextCp ? 'CP' + nextCp.id : null }
  const tabBtn = (cls) => ([k, l, ic, sh]) => <button key={k} aria-label={cls === 'nb' ? l : undefined} className={`${cls} ${tab === k ? 'on' : ''}`} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}><Icon n={ic} size={cls === 'rb' ? 18 : 22} /><span>{cls === 'nb' && sh ? sh : l}</span>{cls === 'rb' && BADGE[k] && <em className={'bdg b-' + k}>{BADGE[k]}</em>}</button>

  return <>
    <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}>Lewati ke konten</a>
    <div className="stripe" aria-hidden="true" />
    <header className="appbar">
      <div className="appbar-in">
        <span className="logo" aria-hidden="true">LP</span><b className="wordmark">LUMPAD</b><span className="osChip">Performance OS</span>
        <button className="themebtn" onClick={cycleTheme} aria-label={`Tema: ${{ auto: 'otomatis', light: 'terang', dark: 'gelap' }[theme]}. Ketuk untuk mengganti`}><Icon n={theme === 'dark' ? 'moon' : 'sun'} size={18} /><small>{{ auto: 'Auto', light: 'Terang', dark: 'Gelap' }[theme]}</small></button>
      </div>
    </header>
    <div className="shell">
      <aside className="rail"><nav aria-label="Menu samping">{TABS.map(tabBtn('rb'))}</nav><Hub vdot={vdot} settings={settings} /></aside>
      <div className="app">
        {sync === 'offline' && <div className="offbar" role="status">Offline — perubahan tersimpan hanya di browser ini dan akan dikirim saat tersambung</div>}
        <main id="main" ref={mainRef} tabIndex={-1}>
          {tab === 'home' && <Home vdot={vdot} settings={settings} results={results} go={go} />}
          {tab === 'ready' && <Readiness vdot={vdot} settings={settings} focus={focus} />}
          {tab === 'activity' && <Activity vdot={vdot} focus={focus} />}
          {tab === 'coach' && <Coach />}
          {tab === 'calendar' && <Calendar vdot={vdot} results={results} setResults={setResults} focus={focus} settings={settings} go={go} />}
          {tab === 'profile' && <Profile vdot={vdot} results={results} settings={settings} setSettings={setSettings} />}
        </main>
      </div>
    </div>
    <nav className="tabbar" aria-label="Menu utama">{TABS.map(tabBtn('nb'))}</nav>
  </>
}
