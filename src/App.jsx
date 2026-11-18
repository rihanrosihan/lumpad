import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useSyncStatus, useSettings } from './store.js'
import { Icon, Sheet } from './ui.jsx'
import Home from './Home.jsx'
import Readiness from './Readiness.jsx'
import Calendar from './Calendar.jsx'
import Activity from './Activity.jsx'
import Profile from './Profile.jsx'
import Coach from './Coach.jsx'
import DayPage from './DayPage.jsx'
import Biometrics from './Biometrics.jsx'
import PlanSync from './PlanSync.jsx'
import { EMPTY_BIO, latest, classifyBP } from './lib/bio.js'
import { CHECKPOINTS, TARGET } from './lib/plan.js'
import { paces, fmtPace } from './lib/vdot.js'
import { today, diffDays, PLAN, fmtShort } from './lib/calendar.js'
import { EMPTY_DAY } from './lib/gate.js'
import { useSyncStatus2, wib } from './sync.js'
import { useModel } from './model.js'

// Pages (each its own full page, no popups). `short` = label in the phone bottom bar.
const PAGES = {
  home: { label: 'Home', icon: 'home' }, ready: { label: 'Readiness', icon: 'ready', short: 'Ready' }, activity: { label: 'Activities', icon: 'run', short: 'Activity' },
  calendar: { label: 'Calendar', icon: 'cal' }, plan: { label: 'Plan Sync', icon: 'sync', short: 'Sync' }, day: { label: 'Day Plan', icon: 'day' }, checkpoint: { label: 'Checkpoints', icon: 'bars' }, race: { label: 'Races', icon: 'flag' },
  coach: { label: 'AI Coach', icon: 'coach', short: 'Coach' }, biometrics: { label: 'Biometrics', icon: 'heart' }, profile: { label: 'Profile', icon: 'user' },
}
const GROUPS = [['Daily', ['home', 'ready', 'activity']], ['Planning', ['calendar', 'plan', 'day', 'checkpoint', 'race']], ['Intelligence', ['coach', 'biometrics', 'profile']]]
const BOTTOM = ['home', 'ready', 'activity', 'calendar', 'coach', 'profile']
const ROUTES = Object.keys(PAGES)
const RACES = PLAN.filter((d) => d.kind === 'race' && /FM|Full/.test(d.label || ''))
const THEMES = ['auto', 'light', 'dark']

// #/day/2027-01-07 and #/activity/<id> carry their argument in the hash so a reload or a shared link lands on the same page
function parse() {
  const [t, ...rest] = location.hash.replace('#/', '').split('/'), a = rest.join('/') ? decodeURIComponent(rest.join('/')) : null, tab = ROUTES.includes(t) ? t : 'home'
  return { tab, focus: tab === 'day' ? a : tab === 'activity' && a ? { id: a } : null }
}
function latestVdot(results) {
  const done = CHECKPOINTS.filter((c) => results[c.id]?.vdot != null && (c.kind === 'tt'))
  const last = done[done.length - 1]
  return last ? { v: results[last.id].vdot, src: `CP${last.id} (${last.date})` } : { v: TARGET.baseline, src: 'official 10K baseline 1:00:55 (CP1 not run yet)' }
}

export default function App() {
  const init = useMemo(parse, [])
  const [tab, setTab] = useState(init.tab), [focus, setFocus] = useState(init.focus), [menu, setMenu] = useState(false)
  const [results, setResults] = useStore('lumpad.results', {})
  const [theme, setTheme] = useStore('lumpad.theme', 'auto'), [bio] = useStore('lumpad.bio', EMPTY_BIO)
  const lbp = latest(bio.bp || []), lgl = latest(bio.glu || [])
  const [settings, setSettings] = useSettings()
  const T = today(), [fS] = useStore('lumpad.daily.' + T, EMPTY_DAY), [ovS] = useStore('lumpad.muscle.' + T, {})
  // another screen may have edited today's check-in: re-read the local copy whenever the page changes
  const readJ = (k, d) => { try { const r = localStorage.getItem(k); return r == null ? d : JSON.parse(r) } catch { return d } }
  const f0 = useMemo(() => ({ ...fS, ...readJ('lumpad.daily.' + T, {}) }), [tab, fS]), ov0 = useMemo(() => readJ('lumpad.muscle.' + T, ovS), [tab, ovS]) // eslint-disable-line
  const vdot = useMemo(() => latestVdot(results), [results])
  const M = useModel(T, settings, vdot, f0, ov0)
  const sync = useSyncStatus(), sync2 = useSyncStatus2(), [busy, setBusy] = useState('')
  const mainRef = useRef(), first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } mainRef.current?.focus({ preventScroll: true }) }, [tab])
  useEffect(() => { const f = () => { const r = parse(); setTab(r.tab); setFocus(r.focus) }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme === 'auto' ? '' : theme }, [theme])
  // go(tab, arg): callers keep the old vocabulary — calendar+{view:'cp'|'race'} and calendar+date map onto their dedicated pages
  const go = (t, arg = null) => {
    if (t === 'calendar' && arg && typeof arg === 'object') t = arg.view === 'cp' ? 'checkpoint' : arg.view === 'race' ? 'race' : 'calendar'
    else if (t === 'calendar' && typeof arg === 'string') t = 'day'
    const a = t === 'day' ? (typeof arg === 'string' ? arg : T) : t === 'activity' && arg?.id ? arg.id : null
    setFocus(t === 'day' ? a : arg); setTab(t); setMenu(false)
    location.hash = '#/' + t + (a ? '/' + encodeURIComponent(a) : ''); window.scrollTo(0, 0)
  }
  const cycleTheme = () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % 3])
  const syncNow = async () => { setBusy('run'); try { const r = await fetch('/api/sync/run', { method: 'POST' }); setBusy(r.ok ? 'ok' : 'err') } catch { setBusy('err') } setTimeout(() => setBusy(''), 4000) }

  const nextRace = RACES.find((d) => d.date >= T), dNext = nextRace ? diffDays(nextRace.date, T) : null
  const rd = M.readiness, lastRun = M.acts.filter((a) => a.sport_class === 'run')[0], p = paces(vdot.v), last = sync2?.lastRun
  const nextCp = CHECKPOINTS.find((c) => c.date >= T)
  const weekKm = (() => { const mon = new Date(T + 'T00:00:00Z'); const d = (mon.getUTCDay() + 6) % 7; const m = new Date(mon - d * 864e5).toISOString().slice(0, 10); return M.acts.filter((a) => a.sport_class === 'run' && a.date >= m && a.date <= T).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0) })()
  const BADGE = {
    home: nextRace ? 'D-' + dNext : null, ready: rd.score != null ? `${rd.score} · ${rd.caps.length ? 'GATE' : rd.tier.label.toUpperCase().slice(0, 4)}` : null, activity: `${Math.round(weekKm * 10) / 10} km`,
    checkpoint: nextCp ? 'CP' + nextCp.id : null, biometrics: (bio.bp?.length || 0) + (bio.glu?.length || 0) + (bio.weight?.length || 0) + (bio.lab?.length || 0) ? 'LOGS' : null, race: nextRace ? 'D-' + dNext : null, coach: 'AI',
  }
  const cur = tab === 'activity' && focus?.id ? 'activity-detail' : tab
  const subOf = { day: 'calendar' }
  const navBtn = (k, cls) => <button key={k} className={`${cls} ${tab === k ? 'on' : ''} ${subOf[k] ? 'sub' : ''}`} aria-current={tab === k ? 'page' : undefined}
    onClick={() => go(k, k === 'day' ? T : null)}><Icon n={PAGES[k].icon} size={cls === 'rb' ? 18 : 22} /><span>{cls === 'nb' ? PAGES[k].short || PAGES[k].label : PAGES[k].label}</span>{cls !== 'nb' && BADGE[k] && <em className={'bdg b-' + k}>{BADGE[k]}</em>}</button>
  const grouped = (cls) => GROUPS.map(([g, ks]) => <div key={g} className="ngroup"><p className="ngl">{g}</p>{ks.map((k) => navBtn(k, cls))}</div>)
  const gate = rd.score == null ? ['none', 'NO DATA', 'Not enough data for today\'s score yet.'] : rd.caps.length ? ['caution', 'CAUTION', rd.caps[0].why] : ['ok', rd.tier.label.toUpperCase(), rd.tier.advice]
  const Ribbon = ({ children }) => <div className="ribbon">{children}</div>
  const jump = (t) => () => go(t)

  return <>
    <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}>Skip to content</a>
    <header className="appbar">
      <div className="appbar-in">
        <button className="menubtn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon n="menu" size={20} /></button>
        <button className="brand" onClick={jump('home')} aria-label="LUMPAD — go Home"><span className="logo" aria-hidden="true"><i>SUB 4</i><small>COACH</small></span><span className="bt"><b>LUMPAD</b><small>{PAGES[tab]?.label}{cur === 'activity-detail' ? ' · Run Analysis' : ''}</small></span></button>
        <Ribbon>
          <span className="rp"><i className={'dot ' + (last?.ok ? 'ok' : 'warn')} />COROS<b>{last ? wib(last.received_at) + ' WIB' : '—'}</b></span>
          <button className="rp" onClick={jump('profile')}>VDOT<b className="am">{vdot.v.toFixed(1)}</b>→<b>{TARGET.vdotNeeded}</b></button>
          <button className="rp" onClick={jump('profile')}>T-Pace<b className="co">{fmtPace(p.T)}/km</b></button>
          <button className="rp" onClick={jump('ready')}>TSB<b className={M.cur?.tsb < -30 ? 'cr' : ''}>{M.cur?.tsb ?? '—'}</b></button>
          {(lbp || lgl) && <button className="rp" onClick={jump('biometrics')}>BP · Glu<b className={lbp && classifyBP(lbp.sys, lbp.dia).tone === 'green' ? 'gr' : ''}>{lbp ? `${lbp.sys}/${lbp.dia}` : '—'} · {lgl ? lgl.mgdl : '—'}</b></button>}
          {nextRace && <button className="rp" onClick={jump('race')}>Next: {nextRace.label.split(' ')[0]}<b className="dn">D-{dNext}</b></button>}
        </Ribbon>
        <button className="btn syncbtn" onClick={syncNow} disabled={busy === 'run'} aria-label="Sync COROS now"><Icon n="sync" size={16} /><span>{busy === 'run' ? 'Starting…' : busy === 'ok' ? 'Sync started' : busy === 'err' ? 'Failed' : 'Sync COROS'}</span></button>
        <button className="themebtn" onClick={cycleTheme} aria-label={`Theme: ${{ auto: 'auto', light: 'light', dark: 'dark' }[theme]}. Tap to change`}><Icon n={theme === 'dark' ? 'moon' : 'sun'} size={18} /></button>
      </div>
    </header>
    <div className="shell">
      <aside className="rail">
        <nav aria-label="Side menu">{grouped('rb')}</nav>
        <div className={'gatecard g-' + gate[0]}><p className="ngl">Daily gate status</p><b><i />{gate[1]}</b><span>{gate[2]}</span></div>
      </aside>
      <div className="app">
        {sync === 'offline' && <div className="offbar" role="status">Offline — changes are saved only in this browser and will be sent when you are back online</div>}
        <main id="main" ref={mainRef} tabIndex={-1}>
          {tab === 'home' && <Home vdot={vdot} settings={settings} results={results} go={go} M={M} />}
          {tab === 'ready' && <Readiness vdot={vdot} settings={settings} focus={focus} />}
          {tab === 'activity' && <Activity vdot={vdot} focus={focus} go={go} />}
          {tab === 'coach' && <Coach />}
          {tab === 'calendar' && <Calendar view="month" vdot={vdot} results={results} setResults={setResults} focus={null} settings={settings} go={go} />}
          {tab === 'plan' && <PlanSync go={go} />}
          {tab === 'day' && <DayPage date={focus || T} vdot={vdot} settings={settings} go={go} />}
          {tab === 'checkpoint' && <Calendar view="cp" vdot={vdot} results={results} setResults={setResults} focus={focus} settings={settings} go={go} />}
          {tab === 'race' && <Calendar view="race" vdot={vdot} results={results} setResults={setResults} focus={focus} settings={settings} go={go} />}
          {tab === 'biometrics' && <Biometrics settings={settings} setSettings={setSettings} />}
          {tab === 'profile' && <Profile vdot={vdot} results={results} settings={settings} setSettings={setSettings} />}
        </main>
      </div>
    </div>
    <nav className="tabbar" aria-label="Main menu">{BOTTOM.map((k) => navBtn(k, 'nb'))}</nav>
    <Sheet open={menu} onClose={() => setMenu(false)} label="Menu"><nav className="drawer" aria-label="All pages">{grouped('rb')}</nav>
      <div className={'gatecard g-' + gate[0]}><p className="ngl">Daily gate status</p><b><i />{gate[1]}</b><span>{gate[2]}</span></div></Sheet>
  </>
}
