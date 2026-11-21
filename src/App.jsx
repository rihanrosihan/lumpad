import { Component, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useSyncStatus, useSettings } from './store.js'
import { Icon, Sheet } from './ui.jsx'
import Home from './Home.jsx'
import Readiness from './Readiness.jsx'
import Calendar from './Calendar.jsx'
import ActivityHub from './ActivityHub.jsx'
import Profile from './Profile.jsx'
import Coach from './Coach.jsx'
import DayPage from './DayPage.jsx'
import Biometrics from './Biometrics.jsx'
import PlanSync from './PlanSync.jsx'
import { EMPTY_BIO, latest, classifyBP } from './lib/bio.js'
import { CHECKPOINTS, TARGET } from './lib/plan.js'
import { paces, fmtPace } from './lib/vdot.js'
import { today, diffDays, PLAN, fmtShort, fmtLong } from './lib/calendar.js'
import { EMPTY_DAY } from './lib/gate.js'
import { useSyncStatus2, wib } from './sync.js'
import { useModel } from './model.js'
import { useApi } from './api.js'
import { readSub, setSubInUrl } from './useSub.js'

// Pages (each its own full page, no popups). `short` = label in the phone bottom bar.
const PAGES = {
  home: { label: 'Home', icon: 'home' }, ready: { label: 'Readiness', icon: 'ready', short: 'Ready' }, activity: { label: 'Activities', icon: 'run', short: 'Activity' },
  calendar: { label: 'Calendar', icon: 'cal', short: 'Calendar' },  analysis: { label: 'Run Analysis', icon: 'run' }, plan: { label: 'Plan Sync', icon: 'sync', short: 'Sync' }, day: { label: 'Day Plan', icon: 'day' }, checkpoint: { label: 'Checkpoints', icon: 'bars' }, race: { label: 'Races', icon: 'flag' },
  coach: { label: 'AI Coach', icon: 'coach', short: 'Coach' }, biometrics: { label: 'Biometrics', icon: 'heart', short: 'Labs' }, profile: { label: 'Profile', icon: 'user' },
}
const GROUPS = [['Menu', ['home', 'ready', 'activity', 'calendar', 'coach']]]
// breadcrumb under the brand (mockup wording)
const CRUMB = { home: 'Home Briefing', ready: 'Readiness & Load', activity: 'Activities Catalog', calendar: 'Macrocycle Calendar', plan: 'Plan Sync', day: 'Day Plan', checkpoint: 'Checkpoint Roadmap', race: 'Races Hub', coach: 'AI Coach & Rules', biometrics: 'Biometrics & Labs', profile: 'Profile & Fleet' }
// Desktop side menu: each main page lists its sections. [label, route, sub-section id]; the phone keeps the five-item bottom bar and uses the page's own tabs.
const SUBS = {
  ready: [['Overview', 'ready', 'all'], ['Conditions Now', 'ready', 'conditions'], ['Load · PMC · ACWR', 'ready', 'load'], ['Sleep', 'ready', 'sleep'], ['HRV · Autonomic', 'ready', 'auto']],
  activity: [['Recent Activities', 'activity', 'recent'], ['Fitness', 'activity', 'fitness']],
  calendar: [['Calendar', 'calendar', 'month'], ['Week Detail', 'calendar', 'week'], ['Plan', 'calendar', 'checklist'], ['Checkpoints', 'checkpoint', null], ['Race', 'race', null]],
  coach: [['Ask & Twin', 'coach', 'ask'], ['Knowledge Graph', 'coach', 'kg'], ['Monte Carlo & RAG', 'coach', 'mc'], ['Lag Explorer', 'coach', 'lag'], ['Memory Queue', 'coach', 'mem'], ['Matrices & Episodes', 'coach', 'mat'], ['Durability & Shoes', 'coach', 'dur']],
}
const BOTTOM = ['home', 'ready', 'activity', 'calendar', 'coach']
const ROUTES = Object.keys(PAGES).filter((k) => k !== 'analysis')
const RACES = PLAN.filter((d) => d.kind === 'race' && /FM|Full/.test(d.label || ''))
const THEMES = ['auto', 'light', 'dark']

// Clean History API routes: /home, /ready, /day/2027-01-07, /activity/<id> (also redirects legacy #/ and /route URLs)
function parse() {
  const raw = location.hash && location.hash.startsWith('#/') ? location.hash.slice(2) : location.pathname.replace(/^\/+/, '')
  const [t0, ...rest] = raw.split('/')
  const t = t0 === 'route' ? 'race' : t0 === 'season' ? 'calendar' : t0
  const a = rest.join('/') ? decodeURIComponent(rest.join('/')) : null
  const tab = ROUTES.includes(t) ? t : 'home'
  return { tab, focus: tab === 'day' ? a : tab === 'activity' && a ? { id: a } : null }
}
function latestVdot(results) {
  const done = CHECKPOINTS.filter((c) => results[c.id]?.vdot != null && (c.kind === 'tt'))
  const last = done[done.length - 1]
  return last ? { v: results[last.id].vdot, src: `CP${last.id} (${last.date})` } : { v: TARGET.baseline, src: 'official 10K baseline 1:00:55 (CP1 not run yet)' }
}


class PageBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (!this.state.err) return this.props.children
    return <div className="screen"><div className="card"><h2>Section error</h2><p className="err">{String(this.state.err?.message || this.state.err)}</p><button className="btn sm" onClick={() => this.setState({ err: null })}>Retry</button></div></div>
  }
}

export default function App() {
  const init = useMemo(parse, [])
  const [tab, setTab] = useState(init.tab), [focus, setFocus] = useState(init.focus), [menu, setMenu] = useState(false), [sub, setSub] = useState(() => readSub())
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
  useEffect(() => {
    const cleanPath = '/' + init.tab + (init.tab === 'day' && init.focus ? '/' + encodeURIComponent(init.focus) : init.tab === 'activity' && init.focus?.id ? '/' + encodeURIComponent(init.focus.id) : '')
    if (location.hash.startsWith('#/') || location.pathname === '/' || location.pathname === '/route') {
      history.replaceState(null, '', cleanPath + (location.search || ''))
    }
    const f = () => { const r = parse(); setTab(r.tab); setFocus((o) => (o?.id && o.id === r.focus?.id ? o : r.focus)); setSub(readSub()) }
    addEventListener('popstate', f)
    return () => removeEventListener('popstate', f)
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme === 'auto' ? '' : theme }, [theme])
  // go(tab, arg): callers keep the old vocabulary — calendar+{view:'cp'|'race'} and calendar+date map onto their dedicated pages
  const go = (t, arg = null) => {
    if (t === 'route') t = 'race'
    if (t === 'calendar' && arg && typeof arg === 'object') t = arg.view === 'cp' ? 'checkpoint' : arg.view === 'race' ? 'race' : 'calendar'
    else if (t === 'calendar' && typeof arg === 'string') t = 'day'
    const a = t === 'day' ? (typeof arg === 'string' ? arg : T) : t === 'activity' && arg?.id ? arg.id : null
    setFocus(t === 'day' ? a : arg); setTab(t); setMenu(false); setSub(null)
    const nextUrl = '/' + t + (a ? '/' + encodeURIComponent(a) : '')
    if (location.pathname !== nextUrl || location.hash) history.pushState(null, '', nextUrl)
    window.scrollTo(0, 0)
  }
  const cycleTheme = () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % 3])
  const syncNow = async () => { setBusy('run'); try { const r = await fetch('/api/sync/run', { method: 'POST' }); setBusy(r.ok ? 'ok' : 'err') } catch { setBusy('err') } setTimeout(() => setBusy(''), 4000) }

  const nextRace = RACES.find((d) => d.date >= T), dNext = nextRace ? diffDays(nextRace.date, T) : null
  const rd = M.readiness, lastRun = M.acts.filter((a) => a.sport_class === 'run')[0], p = paces(vdot.v), last = sync2?.lastRun
  const nextCp = CHECKPOINTS.find((c) => c.date >= T)
  const weekKm = (() => { const mon = new Date(T + 'T00:00:00Z'); const d = (mon.getUTCDay() + 6) % 7; const m = new Date(mon - d * 864e5).toISOString().slice(0, 10); return M.acts.filter((a) => a.sport_class === 'run' && a.date >= m && a.date <= T).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0) })()
  const gear = useApi('/api/gear'), mem = useApi('/api/memory?tier=procedural&status=active&kind=rule&limit=100')
  const monthKm = M.acts.filter((a) => a.sport_class === 'run' && a.date.slice(0, 7) === T.slice(0, 7)).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)
  const seasonKm = Math.round(PLAN.reduce((s, d) => s + (d.km || 0), 0)), nShoes = (gear.data || []).filter((g) => !g.retired).length, nRules = Array.isArray(mem.data) ? mem.data.length : mem.data?.items?.length
  const lastRunId = lastRun ? (lastRun.ids?.[0] || lastRun.id) : null
  const BADGE = {
    calendar: seasonKm ? seasonKm.toLocaleString('en-US') + ' km' : null, analysis: 'AI + FIT', profile: nShoes ? nShoes + ' Shoes' : null, coach: nRules ? nRules + ' Rules' : 'AI',
    home: nextRace ? 'D-' + dNext : null, ready: rd.score != null ? `${rd.score} · ${rd.caps.length ? 'GATE' : ({ prime: 'PRM', optimal: 'OPT', compromised: 'LOW', depleted: 'RED' }[rd.tier.id] || 'OK')}` : null, activity: `${Math.round(monthKm * 10) / 10} km`,
    checkpoint: nextCp ? 'CP1–' + CHECKPOINTS.length : null, biometrics: (bio.bp?.length || 0) + (bio.glu?.length || 0) + (bio.weight?.length || 0) + (bio.lab?.length || 0) ? 'LABS' : null, race: nextRace ? 'D-' + dNext : null,
  }
  const cur = tab === 'activity' && focus?.id ? 'activity-detail' : tab
  const subOf = { day: 'calendar', plan: 'calendar', checkpoint: 'calendar', race: 'calendar', analysis: 'activity' }
  const navBtn = (k, cls) => <button key={k} className={`${cls} ${(k === 'analysis' ? cur === 'activity-detail' : (tab === k || (cls === 'nb' && subOf[tab] === k)) && !(k === 'activity' && cur === 'activity-detail')) ? 'on' : ''} ${subOf[k] ? 'sub' : ''}`} aria-current={(k === 'analysis' ? cur === 'activity-detail' : tab === k) ? 'page' : undefined}
    onClick={() => (k === 'analysis' ? (lastRunId ? go('activity', { id: lastRunId }) : go('activity')) : go(k, k === 'day' ? T : null))}><Icon n={PAGES[k].icon} size={cls === 'rb' ? 18 : 22} /><span>{cls === 'nb' ? PAGES[k].short || PAGES[k].label : PAGES[k].label}</span></button>
  const goSub = (route, sid) => { setMenu(false); const url = '/' + route + (sid ? '?s=' + sid : ''); if (location.pathname + location.search !== url) history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0) }
  const railNav = () => <div className="ngroup"><p className="ngl">Menu</p>{GROUPS[0][1].map((k) => <div key={k} className="rgroup">{navBtn(k, 'rb')}
    {SUBS[k] && <div className="rsubs" role="group" aria-label={PAGES[k].label + ' sections'}>{SUBS[k].map(([label, route, sid]) => {
      const first = SUBS[k].find((x) => x[1] === route)?.[2], on = tab === route && (sid ? (sub || first) === sid : true)
      return <button key={label} type="button" className={`rsub ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => goSub(route, sid)}>{label}</button> })}</div>}</div>)}</div>
  const grouped = (cls) => GROUPS.map(([g, ks]) => <div key={g} className="ngroup"><p className="ngl">{g}</p>{ks.map((k) => navBtn(k, cls))}</div>)
  const gate = rd.score == null ? ['none', 'NO DATA', 'Not enough data for today\'s score yet.'] : rd.caps.length ? ['caution', 'CAUTION', rd.caps[0].why] : ['ok', rd.tier.label.toUpperCase(), rd.tier.advice]
  const Ribbon = ({ children }) => <div className="ribbon">{children}</div>
  const jump = (t) => () => go(t)

  return <>
    <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}>Skip to content</a>
    <div className="stripe" aria-hidden="true" />
    <header className="appbar">
      <div className="appbar-in">
        <button className="menubtn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon n="menu" size={20} /></button>
        <button className="brand" onClick={jump('home')} aria-label="LUMPAD — go Home"><span className="logo" aria-hidden="true"><i>SUB 4</i><small>COACH</small></span><span className="bt"><b>LUMPAD<em className="osv">OS 4.5 · Fluid Telemetry</em></b><small><i>{fmtLong(T).replace(/^(\w{3})\w*, (\w{3})\w* /, '$1, $2 ')}</i><u> · </u>{cur === 'activity-detail' ? 'Run Analysis & AI Narrative' : CRUMB[tab]}</small></span></button>
        <Ribbon>
          <span className="rp"><i className={'dot ' + (last?.ok ? 'ok' : 'warn')} />COROS<b>{last ? wib(last.received_at) + ' WIB' : '—'}</b></span>
          <button className="rp" onClick={jump('profile')}>VDOT<b className="am">{vdot.v.toFixed(1)}</b>→<b>{TARGET.vdotNeeded}</b></button>
          <button className="rp" onClick={jump('profile')}>T-Pace<b className="co">{fmtPace(p.T)}/km</b></button>
          <button className="rp" onClick={jump('ready')}>TSB<b className={M.cur?.tsb < -30 ? 'cr' : ''}>{M.cur?.tsb ?? '—'}</b></button>
          {(lbp || lgl) && <button className="rp" onClick={jump('biometrics')}>BP · Glu<b className={lbp && classifyBP(lbp.sys, lbp.dia).tone === 'green' ? 'gr' : ''}>{lbp ? `${lbp.sys}/${lbp.dia}` : '—'} · {lgl ? lgl.mgdl : '—'}</b></button>}
          {nextRace && <button className="rp" onClick={jump('race')}>Next: {nextRace.label.split(' ')[0]}<b className="dn">D-{dNext}</b></button>}
        </Ribbon>
        <button className="btn syncbtn" onClick={syncNow} disabled={busy === 'run'} aria-label="Sync COROS now"><Icon n="sync" size={16} /><span>{busy === 'run' ? 'Starting…' : busy === 'ok' ? 'Sync started' : busy === 'err' ? 'Failed' : 'Sync COROS'}</span></button>
        <button className="themebtn gearbtn" onClick={jump('profile')} aria-label="Settings" aria-current={tab === 'profile' ? 'page' : undefined}><Icon n="gear" size={18} /></button>
        <button className="themebtn" onClick={cycleTheme} aria-label={`Theme: ${{ auto: 'auto', light: 'light', dark: 'dark' }[theme]}. Tap to change`}><Icon n={theme === 'dark' ? 'moon' : 'sun'} size={18} /></button>
      </div>
    </header>
    <div className="shell">
      <aside className="rail">
        <nav aria-label="Side menu">{railNav()}</nav>
        <div className={'gatecard g-' + gate[0]}><p className="ngl">Daily gate status</p><b><i />{gate[1]}</b><span>{gate[2]}</span></div>
      </aside>
      <div className="app">
        {sync === 'offline' && <div className="offbar" role="status">Offline — changes are saved only in this browser and will be sent when you are back online</div>}
        <main id="main" ref={mainRef} tabIndex={-1}><PageBoundary key={tab}>
          {tab === 'home' && <Home vdot={vdot} settings={settings} results={results} go={go} M={M} />}
          {tab === 'ready' && <Readiness vdot={vdot} settings={settings} focus={focus} M={M} />}
          {tab === 'activity' && <ActivityHub vdot={vdot} focus={focus} go={go} settings={settings} results={results} M={M} />}
          {tab === 'coach' && <Coach go={go} focus={focus} />}
          {tab === 'calendar' && <Calendar view="month" vdot={vdot} results={results} setResults={setResults} focus={null} settings={settings} go={go} />}
          {tab === 'plan' && <PlanSync go={go} />}
          {tab === 'day' && <DayPage date={focus || T} vdot={vdot} settings={settings} go={go} />}
          {tab === 'checkpoint' && <Calendar view="cp" vdot={vdot} results={results} setResults={setResults} focus={focus} settings={settings} go={go} />}
          {tab === 'race' && <Calendar view="race" vdot={vdot} results={results} setResults={setResults} focus={focus} settings={settings} go={go} />}
          {tab === 'biometrics' && <Biometrics settings={settings} setSettings={setSettings} />}
          {tab === 'profile' && <Profile vdot={vdot} results={results} settings={settings} setSettings={setSettings} go={go} />}
        </PageBoundary></main>
      </div>
    </div>
    <nav className="tabbar" aria-label="Main menu">{BOTTOM.map((k) => navBtn(k, 'nb'))}</nav>
    <Sheet open={menu} onClose={() => setMenu(false)} label="Menu"><nav className="drawer" aria-label="All pages">{grouped('rb')}</nav>
      <div className={'gatecard g-' + gate[0]}><p className="ngl">Daily gate status</p><b><i />{gate[1]}</b><span>{gate[2]}</span></div></Sheet>
  </>
}
