import { useMemo, useRef } from 'react'
import { useStore, useSyncStatus } from './store.js'
import { TARGET, CHECKPOINTS, tone } from './lib/plan.js'
import { paces, fmtPace, fmtTime, raceTime } from './lib/vdot.js'
import { fmtLong, today, diffDays, addDays, PLAN } from './lib/calendar.js'
import { tandaMarathon, trainingIndices, prs, shoeStats, SHOE_LIFE } from './lib/analysis.js'
import { mean, r1 } from './lib/stats.js'
import Data from './Data.jsx'
import CorosCard from './CorosCard.jsx'
import { Card, Screen, Chip, Evidence } from './ui.jsx'
import { GLOSSARY } from './lib/glossary.js'
import StravaCard from './StravaCard.jsx'
import CoachConfig from './CoachConfig.jsx'
import ShoeDegradation from './ShoeDegradation.jsx'
import { useSyncStatus2, wib, ago } from './sync.js'
import { useApi } from './api.js'
import { BandLine, Donut, GroupedBars } from './charts2.jsx'

const ROLES = [['', 'Not set'], ['easy', 'Easy / recovery'], ['daily', 'Daily trainer'], ['plated', 'Plated — quality / long / race'], ['short', 'Short intervals']]
const RULES = [['Race & TT', 'plated'], ['Tempo / threshold', 'plated'], ['Long run', 'daily'], ['Short intervals / strides', 'short'], ['Easy / recovery', 'easy']]
const LOCKED = ['Mon Upper · Tue quality + Lower · Wed easy · Thu light speed + light Lower · Fri easy · Sat LR + full body · Sun social/race', 'Last Lower Tue 12 Oct · tibialis position 1 in every Lower · run ≥6 h before Lower', 'Sleep HR > 67 = no hard running · pain ≥2/10 = durability event']
const SHOE_C = ['var(--c-long)', 'var(--c-quality)', 'var(--c-tt)', 'var(--green)', 'var(--c-social)', 'var(--c-rest)']
// collapsible groups with jump chips; open state is remembered (synced like other settings), only Connections opens by default
const GROUPS = [['vdot', 'VDOT & zones'], ['shoe', 'Shoes'], ['race', 'Race & body'], ['conn', 'Devices & connections'], ['athlete', 'Athlete & settings']]
const Group = ({ id, title, open, setOpen, children }) => <details className="pgroup" id={'g-' + id} open={!!open} onToggle={(e) => { if (e.currentTarget.open !== !!open) setOpen(id, e.currentTarget.open) }}><summary>{title}</summary><div className="gbody">{children}</div></details>
const km = (m) => (m == null ? '—' : Math.round(m / 100) / 10)

export default function Profile({ vdot, results, settings, setSettings }) {
  const T = today(), [theme, setTheme] = useStore('lumpad.theme', 'auto')
  const sync = useSyncStatus(), ss = useSyncStatus2(), G = useApi('/api/gear'), R = useApi(`/api/readiness?from=${addDays(T, -30)}&to=${T}`)
  const A = useApi(`/api/activities/merged?from=${addDays(T, -365)}&to=${T}`), L = useApi(`/api/laps?from=${addDays(T, -365)}&to=${T}`), Dv = useApi('/api/kv?key=lumpad.devices')
  const set = (patch) => setSettings({ ...settings, ...patch })
  const fit = R.data?.fitness, acts = A.data || [], gear = G.data || [], active = gear.filter((g) => !g.retired), retired = gear.filter((g) => g.retired)
  const p = paces(vdot.v), pt = paces(TARGET.vdotNeeded)
  const allLaps = Object.values(L.data || {}).flat(), hrmax = Math.max(0, ...allLaps.map((l) => l.max_hr || 0), ...acts.map((a) => a.max_hr || 0)) || null
  const rhrBase = mean((R.data?.health || []).map((h) => h.resting_hr)), toRace = diffDays(settings.raceDate, T)
  // VDOT history: baseline + every TT
  const vhist = [{ date: '2026-10-01', v: TARGET.baseline }, ...CHECKPOINTS.filter((c) => results[c.id]?.vdot != null).map((c) => ({ date: c.date, v: Math.round(results[c.id].vdot * 10) / 10 }))]
  // race equivalency: VDOT theoretical vs endurance-adjusted (Tanda 2013, marathon only) vs COROS
  const ti = trainingIndices(acts, T, 8), tanda = tandaMarathon(ti.K, ti.P, settings.bodyFatPct === '' ? null : +settings.bodyFatPct)
  const eq = [['5K', 5000, 'pred_5k_s'], ['10K', 10000, 'pred_10k_s'], ['Half', 21097.5, 'pred_hm_s'], ['FM', 42195, 'pred_m_s']].map(([l, d, k]) => ({ label: l, vdot: Math.round(raceTime(vdot.v, d) / 60), endur: l === 'FM' && tanda ? Math.round(tanda) : null, coros: fit?.[k] ? Math.round(fit[k] / 60) : null }))
  // PRs: best 1 km lap + whole activities near standard distances
  const best1k = allLaps.filter((l) => l.distance_m >= 990 && l.duration_s).reduce((b, l) => (!b || l.duration_s < b.duration_s ? l : b), null)
  const pr = prs(acts, best1k ? { time: Math.round(best1k.duration_s * (1000 / best1k.distance_m)), date: acts.find((a) => a.id === best1k.activity_id)?.date } : null)
  const shoeRows = active.map((g, i) => { const role = settings.shoeRoles?.[g.id] || '', life = +(settings.shoeLife?.[g.id] || SHOE_LIFE[role] || SHOE_LIFE['']), used = g.lifetime_m / 1000, f = used / life, st = shoeStats(acts, g.id, T)
    return { ...g, role, life, used, f, st, c: SHOE_C[i % SHOE_C.length] } })
  const exp = (what, fmt) => `/api/export?what=${what}&format=${fmt}`

  const [openG, setOpenG] = useStore('lumpad.profile.open', { conn: true }), setOpen = (id, v) => setOpenG((o) => ({ ...o, [id]: v }))
  const jump = (id) => { setOpen(id, true); setTimeout(() => { const el = document.getElementById('g-' + id); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.querySelector('summary')?.focus({ preventScroll: true }) }, 60) }
  return <Screen title="Profile" sub="Athlete engine, shoe garage, connections">
    <nav className="chipjump" aria-label="Jump to section">{GROUPS.map(([id, t]) => <button key={id} onClick={() => jump(id)}>{t}</button>)}</nav>
    <Group id="vdot" title="VDOT & zones" open={openG.vdot} setOpen={setOpen}>
    {/* 1. VDOT & thresholds */}
    <Card title="VDOT & thresholds" right={<Chip>{vdot.src.split(' ')[0]}</Chip>}>
      <div className="score-grid">
        <div><small>VDOT</small><b>{vdot.v.toFixed(1)}</b><em>target {TARGET.vdotNeeded}</em></div>
        <div><small>T-pace</small><b>{fmtPace(p.T)}</b><em>{fit?.threshold_pace_s_km ? `COROS ${fmtPace(fit.threshold_pace_s_km)}` : '/km'}</em></div>
        <div><small>LTHR</small><b>—</b><em>no source yet</em></div>
        <div><small>HR maks</small><b>{hrmax ?? '—'}</b><em>tertinggi tercatat</em></div>
        <div><small>RHR baseline</small><b>{rhrBase ? r1(rhrBase) : '—'}</b><em>30 days</em></div>
        <div><small>VO2max</small><b>{fit?.vo2max ?? '—'}</b><em>[COROS]</em></div>
      </div>
      <h3>Progres VDOT</h3>
      {vhist.length > 1 ? <BandLine data={vhist.map((h) => ({ date: h.date, v: h.v, need: null }))} keys={[{ key: 'v', color: 'var(--c-long)' }]} height={110} label={'VDOT progress: ' + vhist.map((h) => `${h.date} ${h.v}`).join(', ')} /> : <p className="muted">Baseline {TARGET.baseline} — the curve fills in after the first TT (CP1, 16 Jan).</p>}
    </Card>

    <Card title="Training zone matrix">
      <div className="scroll" tabIndex={0} role="region" aria-label="Table (scroll to see all columns)"><table className="zm"><thead><tr><th>Zone</th><th>Pace now</th><th>Target pace</th><th>HR (% max)</th></tr></thead><tbody>
        {[['E · Easy', `${fmtPace(p.E[1])}–${fmtPace(p.E[0])}`, `${fmtPace(pt.E[1])}–${fmtPace(pt.E[0])}`, [0.6, 0.79], 'var(--green)'], ['M · Marathon', fmtPace(p.M), fmtPace(pt.M), [0.8, 0.86], 'var(--c-long)'], ['T · Threshold', fmtPace(p.T), fmtPace(pt.T), [0.87, 0.92], 'var(--yellow)'], ['I · Interval', fmtPace(p.I), fmtPace(pt.I), [0.93, 1], 'var(--c-quality)'], ['R · Repetition', fmtPace(p.R), fmtPace(pt.R), null, 'var(--red)']]
          .map(([z, a, b, hr, c]) => <tr key={z}><td><i className="zc" style={{ background: c }} />{z}</td><td>{a}</td><td>{b}</td><td>{hr && hrmax ? `${Math.round(hr[0] * hrmax)}–${Math.round(hr[1] * hrmax)}` : hr ? `${hr[0] * 100}–${hr[1] * 100}%` : '—'}</td></tr>)}</tbody></table></div>
      <Evidence>Pace: Daniels–Gilbert [ALGORITHMIC]; target = VDOT {TARGET.vdotNeeded}. HR: Daniels-style %HRmax ranges × recorded max HR (an estimate, not a lab test).</Evidence>
    </Card>

    <Card title="Race prediction: speed vs endurance">
      <GroupedBars groups={eq} series={[{ key: 'vdot', color: 'var(--c-long)' }, { key: 'endur', color: 'var(--c-quality)' }, { key: 'coros', color: 'var(--c-rest)' }]} fmt={(v) => (v >= 60 ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : v + "'")} label={'Predicted minutes: ' + eq.map((e) => `${e.label} VDOT ${e.vdot}, endurance ${e.endur ?? '-'}, COROS ${e.coros ?? '-'}`).join('; ')} />
      <div className="legend"><span><i className="kdot" style={{ background: 'var(--c-long)' }} />Theoretical VDOT</span><span><i className="kdot" style={{ background: 'var(--c-quality)' }} />Endurance-adjusted (FM)</span><span><i className="kdot" style={{ background: 'var(--c-rest)' }} />COROS</span></div>
      {tanda && <p className={tanda * 60 > raceTime(vdot.v, 42195) + 300 ? 'banner' : 'muted'}>FM: VDOT {fmtTime(raceTime(vdot.v, 42195))} vs your training volume {fmtTime(tanda * 60)} → {tanda * 60 > raceTime(vdot.v, 42195) + 300 ? 'the limiter is endurance (volume), not speed.' : 'speed and endurance are balanced.'}</p>}
      <Evidence>Tanda & Knechtle 2013 (PMID 24379719; r = 0.81; valid 165–266 minutes): K = {ti.K ?? '—'} km/week, P = {ti.P ? fmtPace(ti.P) : '—'} /km (8 weeks, {ti.runs} runs){settings.bodyFatPct === '' ? '; no body fat — fill it in below for the full formula' : `; body fat ${settings.bodyFatPct}%`}. Marathon only; there is no comparable model for 5K–HM.</Evidence>
    </Card>

    <Card title="Personal records">
      <div className="prs">{[['1K', 1000], ['5K'], ['10K'], ['Half'], ['Marathon']].map(([k]) => <div key={k}><small>{k}</small><b>{pr[k] ? fmtTime(pr[k].time) : '—'}</b><small>{pr[k]?.date ? pr[k].date.slice(2) : 'none yet'}</small></div>)}
        {['400m', 'Mile', '15K', '10 mil', '20K'].map((k) => <div key={k}><small>{k}</small><b>—</b><small>needs per-second data</small></div>)}</div>
      <Evidence>From data that actually exists: 1K = fastest 1 km lap; 5K–FM = whole activity within ±2% of the distance. Other distances need per-second streams (not pulled yet).</Evidence>
    </Card>

    {/* 2. Shoe garage */}
    </Group>
    <Group id="shoe" title="Shoes" open={openG.shoe} setOpen={setOpen}>
    <Card title="Shoe mileage" right={<span className="muted">{active.length} active</span>}>
      {G.state === 'ok' && !gear.length && <p className="muted">Not pulled yet — shoes come from Strava.</p>}
      {shoeRows.map((g) => <div className="shoe" key={g.id}><div style={{ flex: 1, minWidth: 0 }}>
        <b>{g.name}</b><small>{ROLES.find((r) => r[0] === g.role)?.[1]} · {g.st.runs} runs logged{g.st.avgPace ? ` · avg ${fmtPace(g.st.avgPace)}/km` : ''}</small>
        <div className="life" role="img" aria-label={`${Math.round(g.used)} of ${g.life} km`}><i className={g.f > 0.9 ? 'hi' : g.f > 0.7 ? 'mid' : 'ok'} style={{ width: Math.min(100, g.f * 100) + '%' }} /></div>
        <div className="form" style={{ marginTop: 6 }}><label className="fld"><span className="muted">Role</span><select value={g.role} onChange={(e) => set({ shoeRoles: { ...settings.shoeRoles, [g.id]: e.target.value } })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="fld"><span className="muted">Life target (km)</span><input inputMode="numeric" type="number" value={settings.shoeLife?.[g.id] ?? ''} placeholder={String(SHOE_LIFE[g.role] || SHOE_LIFE[''])} onChange={(e) => set({ shoeLife: { ...settings.shoeLife, [g.id]: e.target.value } })} /></label></div></div>
        <div className="km">{Math.round(g.used)}<small style={{ display: 'block', fontWeight: 400 }}>/ {g.life} km</small></div></div>)}
      {retired.length > 0 && <details className="more"><summary>Retired ({retired.length})</summary>{retired.map((g) => <div className="shoe" key={g.id}><div><b>{g.name}</b></div><div className="km">{km(g.lifetime_m)} km</div></div>)}</details>}
      <Evidence>Green &lt; 70% · yellow 70–90% · red &gt; 90% of the life target. The life target is an editable convention: no validated shoe lifespan in km exists.</Evidence>
    </Card>
    <Card title="30 / 90-day rotation">
      <div className="row2">{[['30 days', 'km30'], ['90 days', 'km90']].map(([l, k]) => <div key={k}><h3>{l}</h3><Donut parts={shoeRows.filter((g) => g.st[k] > 0).map((g) => ({ k: g.name.split(' ').slice(1).join(' ') || g.name, v: g.st[k], c: g.c }))} label={`Km per shoe ${l}`} /></div>)}</div>
      <Evidence>Malisoux 2015: using more than one shoe in parallel = a protective factor (HR 0.61) in 264 recreational runners.</Evidence>
    </Card>
    <ShoeDegradation />
    <Card title="Default shoe rules">
      {RULES.map(([t, r]) => { const s = active.filter((g) => settings.shoeRoles?.[g.id] === r); return <div key={t} className="prow"><span>{t}</span><b>{s.length ? s.map((x) => x.name).join(', ') : '—'}</b><small>role: {ROLES.find((x) => x[0] === r)[1]}</small></div> })}
      <p className="muted">Home picks the shoe with a matching role that has gone unused the longest (encouraging rotation).</p>
    </Card>

    {/* 3. Race & personal settings */}
    </Group>
    <Group id="race" title="Race & body" open={openG.race} setOpen={setOpen}>
    <Card title="A-race date">
      <label className="fld"><span>JRF Full Marathon</span><input type="date" value={settings.raceDate} onChange={(e) => e.target.value && set({ raceDate: e.target.value })} /></label>
      <label className="sw"><input type="checkbox" checked={settings.raceConfirmed} onChange={(e) => set({ raceConfirmed: e.target.checked })} /><span>Date confirmed by the organiser</span></label>
      <p className="muted">{fmtLong(settings.raceDate)} · {toRace} days to go. {settings.raceDate !== '2027-10-24' && 'The plan and checkpoints are still built for 24 Oct.'}</p>
    </Card>
    <Card title="Body & sleep">
      <div className="form">
        <label className="fld"><span>Sleep need (hours)</span><input inputMode="decimal" type="number" step="0.25" value={(settings.sleepNeedMin || 480) / 60} onChange={(e) => e.target.value && set({ sleepNeedMin: Math.round(+e.target.value * 60) })} /><small>Walsh 2021: individual, not 7–9 h for everyone</small></label>
        <label className="fld"><span>Body weight (kg)</span><input inputMode="decimal" type="number" step="0.1" value={settings.bodyMassKg} onChange={(e) => set({ bodyMassKg: e.target.value })} /><small>for carb-loading</small></label>
        <label className="fld"><span>Body fat (%) — optional</span><input inputMode="decimal" type="number" step="0.5" value={settings.bodyFatPct} onChange={(e) => set({ bodyFatPct: e.target.value })} /><small>for the Tanda prediction</small></label>
      </div>
      <div className="banner">Weight data conflict: Strava 86.0 kg vs COROS/Omron 75.3 kg — default 75.3 kg until re-weighed.</div>
    </Card>

    {/* 4. Hardware & pipelines */}
    </Group>
    <Group id="conn" title="Devices & connections" open={openG.conn} setOpen={setOpen}>
    <Card title="Devices">
      {(Dv.data?.value?.devices || ['COROS APEX 4 42mm', 'COROS POD 2']).map((d) => <div key={d} className="apipill"><i className="dot2 on" /><span>{d}</span><small className="muted">battery: unavailable</small></div>)}
      <Evidence>{Dv.data?.found ? `From COROS, ${ago(Dv.data.value.at)}.` : 'From the first session; updated on every live sync.'} The COROS MCP does not report battery status.</Evidence>
    </Card>
    <CorosCard />
    <StravaCard />
    <CoachConfig />
    <Card title="Data pipeline">
      {[['COROS (direct)', 'see the card above', null], ['Strava', ss?.activities?.n ? `${ss.activities.n} activities · latest ${ss.activities.last}` : 'not yet', ss?.activities?.n ? 'on' : 'off'], ['Daily sync', ss?.lastRun ? `${wib(ss.lastRun.received_at)} WIB · ${ago(ss.lastRun.received_at)}` : 'none yet', ss?.lastRun ? (ss.lastRun.ok ? 'on' : 'warn') : 'off'], ['Apple Health / Health Connect', 'not connected', 'off'], ['Garmin Connect', 'not used', 'off']]
        .filter((x) => x[2]).map(([n, d, s]) => <div key={n} className="apipill"><i className={'dot2 ' + s} /><span>{n}</span><small className="muted">{d}</small></div>)}
      <h3>Data export</h3>
      <div className="row2"><a className="btn sm" href={exp('activities', 'csv')}>Activities CSV</a><a className="btn sm" href={exp('activities', 'json')}>Activities JSON</a><a className="btn sm" href={exp('health', 'csv')}>Health CSV</a><a className="btn sm" href={exp('health', 'json')}>Health JSON</a></div>
    </Card>
    <details className="card fold"><summary>Backup tools: Strava API, FIT import, literature</summary><Data /></details>

    </Group>
    <Group id="athlete" title="Athlete & settings" open={openG.athlete} setOpen={setOpen}>
    <Card title="Athlete"><div className="ath"><span className="avatar">R</span><div><b>Rihan</b><p className="muted">31 y · 178 cm · Bekasi · UESCA-certified</p></div></div></Card>
    <Card title="Locked rules"><ul className="rules">{LOCKED.map((x) => <li key={x}>{x}</li>)}</ul></Card>
    <Card title="Appearance"><div className="seg wide">{[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => <button key={k} aria-pressed={theme === k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{l}</button>)}</div></Card>
    <Card title="Glossary & abbreviations"><details className="more"><summary>{Object.keys(GLOSSARY).length} terms</summary><dl className="gloss">{Object.values(GLOSSARY).map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl></details></Card>
    <Card title="System"><dl className="kv"><div><dt>Sync</dt><dd>{{ ok: 'Saved on the server', saving: 'Saving…', offline: 'Offline (this browser only)' }[sync]}</dd></div><div><dt>Backup</dt><dd>Daily 03:15 · 30 days</dd></div><div><dt>Readiness model</dt><dd>docs/readiness-model.md</dd></div></dl></Card>
    </Group>
  </Screen>
}
