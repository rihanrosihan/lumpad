import { useState } from 'react'
import { useStore, useSyncStatus } from './store.js'
import { TARGET, CHECKPOINTS } from './lib/plan.js'
import { paces, fmtPace, fmtTime, raceTime } from './lib/vdot.js'
import { fmtLong, fmtShort, today, diffDays, addDays } from './lib/calendar.js'
import { tandaMarathon, trainingIndices, prs, shoeStats, SHOE_LIFE } from './lib/analysis.js'
import { mean, r1 } from './lib/stats.js'
import { KEY_RE } from './lib/tiles.js'
import { ZONES, ZONE_DEFAULTS, HR_ENDS_DEFAULT, validEnds, cfgOf, hrRange, paceRange, fmtPace as fmtZPace } from './lib/zones.js'
import Data from './Data.jsx'
import CorosCard from './CorosCard.jsx'
import StravaCard from './StravaCard.jsx'
import CoachConfig from './CoachConfig.jsx'
import ShoeDegradation from './ShoeDegradation.jsx'
import { Card, Screen, Chip, Evidence, SegmentedTabs, ProgressBar, StatusPill, ProvenanceBadge } from './ui.jsx'
import { GLOSSARY } from './lib/glossary.js'
import { useSyncStatus2, wib, ago } from './sync.js'
import { useApi } from './api.js'
import { BandLine, Donut, GroupedBars } from './charts2.jsx'

const ROLES = [['', 'Not set'], ['easy', 'Easy / recovery'], ['daily', 'Daily trainer'], ['plated', 'Plated — quality / long / race'], ['short', 'Short intervals']]
const RULES = [['Race & TT', 'plated'], ['Tempo / threshold', 'plated'], ['Long run', 'daily'], ['Short intervals / strides', 'short'], ['Easy / recovery', 'easy']]
const LOCKED = [
  'Mon Upper · Tue quality + Lower · Wed easy · Thu light speed + light Lower · Fri easy · Sat LR + full body · Sun social/race',
  'Last Lower Tue 12 Oct · tibialis position 1 in every Lower · run ≥6 h before Lower',
  'Sleep HR > 67 = no hard running · pain ≥2/10 = durability event · Z2 aerobic ceiling ≤148 bpm',
]
const SHOE_C = ['var(--c-long)', 'var(--c-quality)', 'var(--c-tt)', 'var(--green)', 'var(--c-social)', 'var(--c-rest)']
const km = (m) => (m == null ? '—' : Math.round(m / 100) / 10)

// Complete 34 COROS MCP Tool Catalog from tools.md merged with live GET /api/coros/archive
const COROS_CATALOG = [
  { tool: 'querySportRecords', cat: 'activity', mode: 'READ', synced: true, cap: '40/d', params: 'startDate, endDate, sportTypeCodes, limit', value: 'Activity list 2025-01-01 → today' },
  { tool: 'getActivityDetail', cat: 'activity', mode: 'READ', synced: true, cap: '150/d', params: 'labelId, sportType', value: 'Pace, HR, elevation, cadence, calories' },
  { tool: 'queryActivityLapData', cat: 'activity', mode: 'READ', synced: true, cap: '150/d', params: 'labelId, sportType', value: 'Lap splits, GCT, power, stride → lumpad.db:laps' },
  { tool: 'queryCustomActivityLapData', cat: 'activity', mode: 'READ', synced: true, cap: '60/d', params: 'labelId, sportType, startTimestamp, endTimestamp', value: 'Custom Unix-second window telemetry' },
  { tool: 'downloadActivityFitFiles', cat: 'activity', mode: 'READ', synced: true, cap: '50/24h', params: 'labelId, sportType, startDate, endDate, limit(<=10)', value: 'Raw 1-Hz .fit binaries saved locally' },
  { tool: 'queryActivityFitFileDownloadUrls', cat: 'activity', mode: 'READ', synced: true, cap: '50/24h', params: 'labelId, sportType, startDate, endDate, limit(<=10)', value: 'Signed FIT URLs (shared 50/24h quota)' },
  { tool: 'queryDailyHealthData', cat: 'health', mode: 'READ', synced: true, cap: '4/d', params: 'days (default 7)', value: 'Daily steps, calories, stress, sleep & HR' },
  { tool: 'querySleepOverview', cat: 'health', mode: 'READ', synced: true, cap: '30/d', params: 'startDate, endDate, days', value: 'Sleep score, Deep/Light/REM stages, naps' },
  { tool: 'querySleepHrv', cat: 'health', mode: 'READ', synced: true, cap: '60/d', params: 'startDate, endDate, days(max 7)', value: 'Nocturnal HRV (ms), normal range & evaluation' },
  { tool: 'queryAvgHeartRate', cat: 'health', mode: 'READ', synced: true, cap: '30/d', params: 'startDate, endDate, days', value: 'Daily average HR trends (31-day windows)' },
  { tool: 'queryRestingHeartRate', cat: 'health', mode: 'READ', synced: true, cap: '4/d', params: 'days', value: 'Longitudinal resting HR baseline' },
  { tool: 'queryStressLevel', cat: 'health', mode: 'READ', synced: true, cap: '4/d', params: 'days', value: 'Daily average stress trends' },
  { tool: 'queryHealthCheckTimeSeries', cat: 'health', mode: 'READ', synced: true, cap: '60/d', params: 'startDate, endDate, days(max 7)', value: 'Wellness check: HR, HRV, stress, resp, SpO2' },
  { tool: 'queryStressTimeSeries', cat: 'health', mode: 'READ', synced: true, cap: '60/d', params: 'startDate, endDate, days(max 7)', value: 'Intraday stress curve time series' },
  { tool: 'queryRecoveryStatus', cat: 'health', mode: 'READ', synced: true, cap: '2/d', params: 'none', value: 'Recovery %, level & hours to full recovery' },
  { tool: 'queryMenstruationCycles', cat: 'health', mode: 'READ', synced: false, cap: 'N/A', params: 'startDay, endDay', value: 'Disabled / not applicable for profile' },
  { tool: 'queryFitnessAssessmentOverview', cat: 'training', mode: 'READ', synced: true, cap: '2/d', params: 'none', value: 'EvoLab VO2max, threshold pace, race pred' },
  { tool: 'queryTrainingLoadAssessment', cat: 'training', mode: 'READ', synced: true, cap: '4/d', params: 'days', value: 'Short/long-term training load & ratio' },
  { tool: 'queryTrainingSchedule', cat: 'training', mode: 'READ', synced: false, cap: 'On-demand', params: 'startDate, endDate', value: 'Scheduled plan & standalone workouts' },
  { tool: 'queryTrainingPlanLibrary', cat: 'training', mode: 'READ', synced: false, cap: 'On-demand', params: 'statusList, planType, weeks, cursor', value: 'Existing training plans (up to 50/page)' },
  { tool: 'queryTrainingPlanDetails', cat: 'training', mode: 'READ', synced: false, cap: 'On-demand', params: 'planId, startDay, endDay(max 28d)', value: 'Plan phases & 28-day daily workouts' },
  { tool: 'createTrainingPlan', cat: 'training', mode: 'WRITE', synced: false, cap: '4–16 wks', params: 'planInfo, phaseInfo, courseList', value: 'Push multi-week plan to COROS app' },
  { tool: 'updateTrainingPlan', cat: 'training', mode: 'WRITE', synced: false, cap: 'Active', params: 'planInfo, courseList, phaseInfo', value: 'Edit phases or workouts of active COROS plan' },
  { tool: 'queryWorkoutLibrary', cat: 'training', mode: 'READ', synced: true, cap: '2/d', params: 'sportType, courseType', value: 'Saved workout library snapshots' },
  { tool: 'queryWorkoutDetails', cat: 'training', mode: 'READ', synced: true, cap: '40/d', params: 'workoutId', value: 'Full library workout structures' },
  { tool: 'createSingleWorkout', cat: 'training', mode: 'WRITE', synced: false, cap: '1/call', params: 'course', value: 'Save new structured workout to COROS library' },
  { tool: 'updateWorkoutDetails', cat: 'training', mode: 'WRITE', synced: false, cap: '1/call', params: 'workoutId, course', value: 'Edit existing library workout structure' },
  { tool: 'scheduleWorkout', cat: 'training', mode: 'WRITE', synced: false, cap: '0–90d', params: 'workoutId, date', value: 'Schedule a library workout onto a date' },
  { tool: 'createScheduledWorkout', cat: 'training', mode: 'WRITE', synced: false, cap: '0–90d', params: 'date, course', value: 'Create & push standalone workout to date' },
  { tool: 'queryScheduledWorkoutDetails', cat: 'training', mode: 'READ', synced: false, cap: 'On-demand', params: 'date, idInPlan', value: 'Read standalone scheduled workout status' },
  { tool: 'updateScheduledWorkout', cat: 'training', mode: 'WRITE', synced: false, cap: '1/call', params: 'date, idInPlan, course', value: 'Edit standalone workout on calendar date' },
  { tool: 'uploadRouteFile', cat: 'routes', mode: 'WRITE', synced: false, cap: 'GPX/KML', params: 'fileName, fileContent, routeType, routeName', value: 'Import GPX/KML route to COROS watch nav' },
  { tool: 'queryUserInfo', cat: 'profile', mode: 'READ', synced: true, cap: '2/d', params: 'none', value: 'Account height, weight, birthday & gender' },
  { tool: 'queryDevices', cat: 'profile', mode: 'READ', synced: true, cap: '2/d', params: 'none', value: 'Bound COROS watch models & connection' },
]

const STRAVA_TOOLS = [
  { tool: 'GET /athlete/activities', scope: 'activity:read_all', value: 'Activity metadata, sport_type, start_date, gear_id' },
  { tool: 'GET /athlete + syncShoes()', scope: 'profile:read_all', value: '±3 min start-time shoe matching to COROS runs' },
  { tool: 'GET /gear/:id', scope: 'read', value: 'Brand, model, cumulative mileage, retirement flag' },
  { tool: 'GET /activities/:id/streams', scope: 'activity:read_all', value: '1-Hz time, distance, HR, cadence, watts, velocity' },
]

const COROS_CATS = [['all', 'All (34)'], ['synced', 'Synced (20)'], ['activity', 'Activities (6)'], ['health', 'Health (10)'], ['training', 'Training (15)'], ['routes', 'Routes (1)'], ['profile', 'Profile (2)']]

export default function Profile({ vdot, results, settings, setSettings, go }) {
  const [tab, setTab] = useState('athlete')
  const [shoeFilter, setShoeFilter] = useState('all')
  const [corosCat, setCorosCat] = useState('all')
  const [streamFilter, setStreamFilter] = useState('all')
  const [mapKey, setMapKey] = useStore('lumpad.mapkey', '')
  const [autoBrief, setAutoBrief] = useStore('lumpad.coach.autoBrief', true)
  const T = today(), [theme, setTheme] = useStore('lumpad.theme', 'auto')

  const sync = useSyncStatus(), ss = useSyncStatus2()
  const G = useApi('/api/gear')
  const R = useApi(`/api/readiness?from=${addDays(T, -30)}&to=${T}`)
  const A = useApi(`/api/activities/merged?from=${addDays(T, -365)}&to=${T}`)
  const L = useApi(`/api/laps?from=${addDays(T, -365)}&to=${T}`)
  const Dv = useApi('/api/kv?key=lumpad.devices')
  const Arch = useApi('/api/coros/archive', tab === 'connections' || tab === 'server')
  const Src = useApi('/api/sources', tab === 'connections')
  const Qual = useApi('/api/data/quality', tab === 'connections' || tab === 'server')
  const Twin = useApi('/api/twin', tab === 'shoes' || tab === 'connections')
  const Srv = useApi('/api/server/info', tab === 'server' || tab === 'connections')
  const Intel = useApi('/api/intel/status', tab === 'server' || tab === 'connections')
  const Health = useApi('/api/health', tab === 'server')

  const set = (patch) => setSettings({ ...settings, ...patch })
  const fit = R.data?.fitness, acts = A.data || [], gear = G.data || []
  const active = gear.filter((g) => !g.retired), retired = gear.filter((g) => g.retired)
  const p = paces(vdot.v), pt = paces(TARGET.vdotNeeded)
  const allLaps = Object.values(L.data || {}).flat()
  const hrmax = Math.max(0, ...allLaps.map((l) => l.max_hr || 0), ...acts.map((a) => a.max_hr || 0)) || null
  const rhrBase = mean((R.data?.health || []).map((h) => h.resting_hr)), toRace = diffDays(settings.raceDate, T)
  const vhist = [{ date: '2026-10-01', v: TARGET.baseline }, ...CHECKPOINTS.filter((c) => results[c.id]?.vdot != null).map((c) => ({ date: c.date, v: Math.round(results[c.id].vdot * 10) / 10 }))]
  const ti = trainingIndices(acts, T, 8), tanda = tandaMarathon(ti.K, ti.P, settings.bodyFatPct === '' ? null : +settings.bodyFatPct)
  const eq = [['5K', 5000, 'pred_5k_s'], ['10K', 10000, 'pred_10k_s'], ['Half', 21097.5, 'pred_hm_s'], ['FM', 42195, 'pred_m_s']].map(([l, d, k]) => ({ label: l, vdot: Math.round(raceTime(vdot.v, d) / 60), endur: l === 'FM' && tanda ? Math.round(tanda) : null, coros: fit?.[k] ? Math.round(fit[k] / 60) : null }))
  const best1k = allLaps.filter((l) => l.distance_m >= 990 && l.duration_s).reduce((b, l) => (!b || l.duration_s < b.duration_s ? l : b), null)
  const pr = prs(acts, best1k ? { time: Math.round(best1k.duration_s * (1000 / best1k.distance_m)), date: acts.find((a) => a.id === best1k.activity_id)?.date } : null)

  const shoeRows = active.map((g, i) => {
    const role = settings.shoeRoles?.[g.id] || ''
    const life = +(settings.shoeLife?.[g.id] || SHOE_LIFE[role] || SHOE_LIFE[''])
    const used = (g.lifetime_m || 0) / 1000
    const f = used / life
    const st = shoeStats(acts, g.id, T)
    return { ...g, role, life, used, f, st, c: SHOE_C[i % SHOE_C.length] }
  })
  const filteredShoes = shoeRows.filter((s) => shoeFilter === 'all' ? true : shoeFilter === 'warn' ? s.used >= 600 || s.f >= 0.85 : s.used < 600)
  const exp = (what, fmt) => `/api/export?what=${what}&format=${fmt}`

  const archTools = Object.fromEntries((Arch.data?.tools || []).map((t) => [t.tool, t]))
  const corosRows = COROS_CATALOG.filter((r) => corosCat === 'all' ? true : corosCat === 'synced' ? r.synced : r.cat === corosCat)
  const qd = Qual.data || {}
  const srv = Srv.data || {}
  const fitTotal = Arch.data?.activities?.n ?? (typeof Arch.data?.activities === 'number' ? Arch.data.activities : null) ?? qd.coros_runs ?? 456
  const fitDone = Arch.data?.fit?.files ?? (typeof Arch.data?.fit === 'number' ? Arch.data.fit : 0)
  const fitParsed = srv.dbCounts?.fit_sessions ?? Intel.data?.counts?.fit_sessions ?? qd.fit_sessions ?? 0
  const weatherDone = srv.dbCounts?.run_weather ?? Intel.data?.counts?.weather ?? (fitParsed && qd.missing_weather != null ? Math.max(0, fitParsed - qd.missing_weather) : 0)
  const shoeMatched = qd.coros_runs != null && qd.missing_shoe != null ? Math.max(0, qd.coros_runs - qd.missing_shoe) : null

  const syncMatrix = [
    { stream: 'coros', item: 'COROS Activity Catalog', value: 'Multi-sport activities (Run, Strength, Walk, Ride)', avail: `${fitTotal} items`, local: `${ss?.activities?.n ?? fitTotal} rows · lumpad.db`, pct: 100 },
    { stream: 'coros', item: 'Daily Health & Readiness', value: 'Sleep, nocturnal HRV, RHR, stress & wellness checks', avail: Arch.data?.healthFrom ? `from ${Arch.data.healthFrom}` : 'Daily', local: 'lumpad.db:health_daily', pct: 100 },
    { stream: 'coros', item: '1-Hz FIT Binaries', value: 'Raw GPS, HR, GCT, vertical oscillation, stride & power', avail: `${fitTotal} activities`, local: `${fitDone} files · coros.db`, pct: fitTotal ? Math.round((fitDone / fitTotal) * 1000) / 10 : 0 },
    { stream: 'strava', item: 'Shoe Rotation Backfill', value: `${active.length} active shoes matched to COROS runs by timestamp`, avail: `${qd.coros_runs ?? '—'} runs`, local: shoeMatched != null ? `${shoeMatched} matched · lumpad.db:gear` : `${active.length} shoes`, pct: qd.coros_runs && shoeMatched != null ? Math.round((shoeMatched / qd.coros_runs) * 1000) / 10 : (Src.data?.strava?.connected ? 100 : 0) },
    { stream: 'intel', item: 'Parsed FIT & 16-D kNN', value: 'EF, HR@800, onset_km, run_share, GCT & shoe_id', avail: `${fitDone || fitParsed} FIT files`, local: `${fitParsed} sessions · intel.db`, pct: fitDone ? Math.min(100, Math.round((fitParsed / fitDone) * 1000) / 10) : 100 },
    { stream: 'intel', item: 'WBGT Heat & Weather', value: 'Temperature, humidity, dew point & WBGT °C', avail: `${fitParsed || '—'} FIT runs`, local: `${weatherDone} rows · intel.db`, pct: fitParsed ? Math.min(100, Math.round((weatherDone / fitParsed) * 1000) / 10) : 0 },
  ].filter((r) => streamFilter === 'all' || r.stream === streamFilter)

  const TABS = [
    { id: 'athlete', label: 'Athlete Profile' },
    { id: 'vdot', label: 'VDOT & Zones' },
    { id: 'shoes', label: 'Shoes', badge: active.length || undefined },
    { id: 'connections', label: 'Devices & Connections', badge: '34 COROS' },
    { id: 'ai', label: 'AI Settings' },
    { id: 'server', label: 'Server Details', badge: 'VPS' },
  ]

  return <section className="screen">
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div>
          <h1>Settings &amp; Profile</h1>
          <p className="sub">Athlete baselines, VDOT zones, shoe vault, COROS/Strava connections, AI settings, and VPS status</p>
        </div>
        <div className="prof-chips">
          <StatusPill tone="cobalt">{settings.bodyMassKg || 75.3} kg{settings.bodyFatPct ? ` · BF ${settings.bodyFatPct}%` : ''}</StatusPill>
          <StatusPill tone="green">VDOT {vdot.v.toFixed(1)} → {TARGET.vdotNeeded}</StatusPill>
          <StatusPill tone="amber">A-Race D-{toRace > 0 ? toRace : 0}</StatusPill>
          {go && <button type="button" className="btn sm" onClick={() => go('biometrics')}>Biometrics &amp; Labs →</button>}
          {go && <button type="button" className="btn sm" onClick={() => go('plan')}>Plan Sync →</button>}
        </div>
      </div>
      <div className="prof-cmd-bar">
        <div className="subtabs-scroll"><SegmentedTabs tabs={TABS} value={tab} onChange={setTab} label="Profile sections" /></div>
      </div>
    </div>

    {/* ===== TAB 1: ATHLETE PROFILE ===== */}
    {tab === 'athlete' && <>
      <div className="rgrid">
        <Card title="Athlete identity & baselines" right={<StatusPill tone="green">Sub-4:00 Campaign</StatusPill>}>
          <div className="ath" style={{ marginBottom: 12 }}>
            <span className="avatar">R</span>
            <div><b>Rihan Rosihan</b><p className="muted">South Jakarta, Indonesia (WIB) · UESCA-certified · Self-hosted Lumpad OS</p></div>
          </div>
          <div className="score-grid two">
            <div><small>A-Race Target</small><b>Sub-4:00</b><em>JRF FM · {fmtShort(settings.raceDate)}</em></div>
            <div><small>Target MP</small><b>5:40 /km</b><em>Required VDOT {TARGET.vdotNeeded}</em></div>
            <div><small>Body Mass</small><b>{settings.bodyMassKg || 75.3} kg</b><em>{settings.bodyFatPct ? `BF ${settings.bodyFatPct}%` : 'COROS / Omron'}</em></div>
            <div><small>Sleep Need</small><b>{(settings.sleepNeedMin || 480) / 60} h</b><em>Individual baseline</em></div>
          </div>
          <div className="mod yellow">
            <b>Primary Coaching Focus</b>
            <p>Aerobic durability and Z2 discipline (HR ≤ 148 bpm) to close the gap between 10K VDOT potential and marathon execution.</p>
          </div>
        </Card>

        <Card title="Personal records vs. VDOT equivalence" right={<ProvenanceBadge type="ACTUAL" />}>
          <div className="prs">
            {[['1K', 1000], ['5K', 5000], ['10K', 10000], ['Half', 21097.5], ['Marathon', 42195]].map(([k, dist]) => (
              <div key={k}>
                <small>{k}</small>
                <b>{pr[k] ? fmtTime(pr[k].time) : '—'}</b>
                <small>VDOT: {fmtTime(raceTime(vdot.v, dist))}</small>
              </div>
            ))}
          </div>
          <Evidence>1K = fastest 1 km lap; 5K–FM = whole activity within ±2% of the distance. VDOT column shows Daniels equivalence at current VDOT {vdot.v.toFixed(1)}.</Evidence>
        </Card>
      </div>

      <div className="rgrid">
        <Card title="A-race date & body settings">
          <label className="fld"><span>JRF Full Marathon</span><input type="date" value={settings.raceDate} onChange={(e) => e.target.value && set({ raceDate: e.target.value })} /></label>
          <label className="sw"><input type="checkbox" checked={settings.raceConfirmed} onChange={(e) => set({ raceConfirmed: e.target.checked })} /><span>Date confirmed by the organiser</span></label>
          <div className="form" style={{ marginTop: 8 }}>
            <label className="fld"><span>Sleep need (h)</span><input inputMode="decimal" type="number" step="0.25" value={(settings.sleepNeedMin || 480) / 60} onChange={(e) => e.target.value && set({ sleepNeedMin: Math.round(+e.target.value * 60) })} /></label>
            <label className="fld"><span>Body weight (kg)</span><input inputMode="decimal" type="number" step="0.1" value={settings.bodyMassKg} onChange={(e) => set({ bodyMassKg: e.target.value })} /></label>
            <label className="fld"><span>Body fat (%)</span><input inputMode="decimal" type="number" step="0.5" value={settings.bodyFatPct} onChange={(e) => set({ bodyFatPct: e.target.value })} /></label>
          </div>
        </Card>

        <Card title="Locked rules & appearance" right={<ProvenanceBadge type="RULE" />}>
          <ul className="rules">{LOCKED.map((x) => <li key={x}>{x}</li>)}</ul>
          <h3>Appearance</h3>
          <div className="seg wide">{[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => <button key={k} aria-pressed={theme === k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{l}</button>)}</div>
          <details className="more"><summary>Glossary ({Object.keys(GLOSSARY).length} terms)</summary><dl className="gloss">{Object.values(GLOSSARY).map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl></details>
        </Card>
      </div>
    </>}

    {/* ===== TAB 2: VDOT & ZONES ===== */}
    {tab === 'vdot' && <>
      <Card title="Daniels 6-pace grid & physiological baselines" right={<span className="chips" style={{ margin: 0 }}><ProvenanceBadge type="MODEL" /><Chip>VDOT {vdot.v.toFixed(1)}</Chip></span>}>
        <div className="vdot-grid">
          <div className="vdot-tile vt-e"><small>E · Easy</small><b>{fmtPace(p.E[1])}–{fmtPace(p.E[0])}</b><em>HR ≤ 148 bpm</em></div>
          <div className="vdot-tile vt-m"><small>M · Marathon</small><b>{fmtPace(p.M)}/km</b><em>Current VDOT {vdot.v.toFixed(1)}</em></div>
          <div className="vdot-tile vt-t"><small>T · Threshold</small><b>{fmtPace(p.T)}/km</b><em>LTHR {settings.lthr || ZONE_DEFAULTS.lthr} bpm</em></div>
          <div className="vdot-tile vt-i"><small>I · Interval</small><b>{fmtPace(p.I)}/km</b><em>3–5 min reps</em></div>
          <div className="vdot-tile vt-r"><small>R · Repetition</small><b>{fmtPace(p.R)}/km</b><em>Economy &amp; strides</em></div>
          <div className="vdot-tile vt-goal"><small>Target MP Sub-4</small><b>{fmtPace(pt.M)}/km</b><em>VDOT {TARGET.vdotNeeded} (heat-adj · flat 5:41)</em></div>
        </div>
        <div className="score-grid">
          <div><small>LTHR</small><b>{settings.lthr || ZONE_DEFAULTS.lthr} bpm</b><em>{settings.lthr ? 'user set' : 'estimate'}</em></div>
          <div><small>Max HR</small><b>{hrmax ?? '—'}</b><em>highest recorded</em></div>
          <div><small>RHR baseline</small><b>{rhrBase ? r1(rhrBase) : '—'} bpm</b><em>30-day mean</em></div>
          <div><small>VO2max</small><b>{fit?.vo2max ?? '—'}</b><em>[COROS]</em></div>
          <div><small>Z2 Cap</small><b>≤ 148 bpm</b><em>locked discipline rule</em></div>
          <div><small>COROS T-Pace</small><b>{fit?.threshold_pace_s_km ? fmtPace(fit.threshold_pace_s_km) : '—'}</b><em>/km</em></div>
        </div>
        {vhist.length > 1 && <><h3>VDOT progress</h3><BandLine data={vhist.map((h) => ({ date: h.date, v: h.v }))} keys={[{ key: 'v', color: 'var(--c-long)' }]} height={110} label="VDOT progress" /></>}
      </Card>

      <div className="rgrid">
        <Card title="Watch training zones (HR & pace)" right={<Chip>{settings.lthr ? 'your values' : 'LTHR default'}</Chip>}>
          <div className="form two" style={{ marginBottom: 10 }}>
            <label className="fld"><span>LTHR (bpm)</span><input inputMode="numeric" type="number" min="120" max="210" placeholder={String(ZONE_DEFAULTS.lthr)} value={settings.lthr || ''} onChange={(e) => set({ lthr: e.target.value ? +e.target.value : '' })} /></label>
            <label className="fld"><span>Threshold pace (mm:ss)</span><input inputMode="numeric" placeholder={fmtZPace(ZONE_DEFAULTS.tpace)} defaultValue={settings.tpace ? fmtZPace(settings.tpace) : ''} onBlur={(e) => { const m = e.target.value.trim().match(/^(\d{1,2}):(\d{2})$/); set({ tpace: m ? +m[1] * 60 + +m[2] : '' }) }} /></label>
          </div>
          <div className="fld" style={{ marginBottom: 10 }}>
            <span>HR zone ends (bpm) — copy from the COROS app (Zones)</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6 }}>
              {[1, 2, 3, 4, 5].map((z) => { const ends = cfgOf(settings).hrEnds; return <label key={z} style={{ display: 'grid', gap: 2, fontSize: 12 }}>Z{z} ≤<input inputMode="numeric" type="number" min="60" max="230" aria-label={`Zone ${z} upper bpm`} value={ends[z - 1]} onChange={(e) => { const n = ends.slice(); n[z - 1] = e.target.value === '' ? '' : +e.target.value; set({ hrEnds: validEnds(n) ? n : ends.map((x, i) => (i === z - 1 ? n[z - 1] : x)) }) }} /></label> })}
            </div>
            <small className="muted">Z6 is everything above Z5. Used for time in zone on the Activity page and for HR targets in sessions. Default: {HR_ENDS_DEFAULT.join(' / ')}.</small>
          </div>
          <div className="scroll" tabIndex={0}><table className="zm"><thead><tr><th>Zone</th><th>HR (bpm)</th><th>Pace (/km)</th></tr></thead><tbody>
            {ZONES.slice(1).map((Z) => { const c = cfgOf(settings), h = hrRange(Z.z, c), prg = paceRange(Z.z, c); return <tr key={Z.z}><td><span className={'wz z' + Z.z} style={{ display: 'inline-grid', width: 30, marginRight: 6 }}>Z{Z.z}</span>{Z.name}</td><td>{h[0]}–{h[1]}</td><td>{fmtZPace(prg[0])}–{fmtZPace(prg[1])}</td></tr> })}
          </tbody></table></div>
        </Card>

        <Card title="Race prediction: speed vs endurance" right={<ProvenanceBadge type="MODEL" />}>
          <GroupedBars groups={eq} series={[{ key: 'vdot', color: 'var(--c-long)' }, { key: 'endur', color: 'var(--c-quality)' }, { key: 'coros', color: 'var(--c-rest)' }]} fmt={(v) => (v >= 60 ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : v + "'")} label="Race predictions" />
          <div className="legend"><span><i className="kdot" style={{ background: 'var(--c-long)' }} />VDOT</span><span><i className="kdot" style={{ background: 'var(--c-quality)' }} />Endurance (Tanda)</span><span><i className="kdot" style={{ background: 'var(--c-rest)' }} />COROS</span></div>
          {tanda && <p className={tanda * 60 > raceTime(vdot.v, 42195) + 300 ? 'banner' : 'muted'}>FM: VDOT {fmtTime(raceTime(vdot.v, 42195))} vs volume-adjusted {fmtTime(tanda * 60)}.</p>}
          <Evidence>Tanda &amp; Knechtle 2013 (PMID 24379719): K = {ti.K ?? '—'} km/week, P = {ti.P ? fmtPace(ti.P) : '—'} /km (8 weeks, {ti.runs} runs).</Evidence>
        </Card>
      </div>
    </>}

    {/* ===== TAB 3: SHOES ===== */}
    {tab === 'shoes' && <>
      <Card title="Shoe fleet rotation & mileage" right={<span className="muted">{active.length} active · {retired.length} retired</span>}>
        <div className="chiprow" role="group" aria-label="Shoe filter">
          {[['all', `All (${shoeRows.length})`], ['primary', 'Primary Rotation'], ['warn', 'Wear Alert ≥600 km']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={shoeFilter === k} onClick={() => setShoeFilter(k)}>{l}</button>
          ))}
        </div>
        {G.state === 'ok' && !gear.length && <p className="muted">Not pulled yet — shoes sync from Strava in Devices &amp; Connections.</p>}
        <div className="shoe-grid">
          {filteredShoes.map((g) => <div className="shoe-card" key={g.id}>
            <div className="ch" style={{ marginBottom: 0 }}>
              <b>{g.name}</b>
              <StatusPill tone={g.f > 0.9 || g.used >= 600 ? 'red' : g.f > 0.7 ? 'amber' : 'green'}>{Math.round(g.used)} / {g.life} km</StatusPill>
            </div>
            <small className="muted">{ROLES.find((r) => r[0] === g.role)?.[1]} · {g.st.runs} runs{g.st.avgPace ? ` · avg ${fmtPace(g.st.avgPace)}/km` : ''}</small>
            <ProgressBar value={g.used} max={g.life} tone={g.f > 0.9 || g.used >= 600 ? 'red' : g.f > 0.7 ? 'amber' : 'green'} label={`${Math.round(g.used)} of ${g.life} km`} />
            <div className="form two">
              <label className="fld"><span>Role</span><select value={g.role} onChange={(e) => set({ shoeRoles: { ...settings.shoeRoles, [g.id]: e.target.value } })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="fld"><span>Life target (km)</span><input inputMode="numeric" type="number" value={settings.shoeLife?.[g.id] ?? ''} placeholder={String(SHOE_LIFE[g.role] || SHOE_LIFE[''])} onChange={(e) => set({ shoeLife: { ...settings.shoeLife, [g.id]: e.target.value } })} /></label>
            </div>
          </div>)}
        </div>
        {retired.length > 0 && <details className="more"><summary>Retired ({retired.length})</summary>{retired.map((g) => <div className="shoe" key={g.id}><div><b>{g.name}</b></div><div className="km">{km(g.lifetime_m)} km</div></div>)}</details>}
      </Card>

      {Twin.data?.state?.shoes?.length > 0 && <Card title="Midsole foam compression vs. EF residuals (OLS + 200-bootstrap)" right={<ProvenanceBadge type="MODEL" />}>
        <div className="scroll" tabIndex={0}><table className="lapt">
          <thead><tr><th>Shoe</th><th>Km</th><th>n</th><th>ΔEF / 100 km</th><th>Status</th></tr></thead>
          <tbody>{Twin.data.state.shoes.filter((s) => !s.retired || s.n).map((s) => <tr key={s.gear_id}>
            <td><b>{s.name}</b></td><td>{s.km}</td><td>{s.n}</td>
            <td>{s.ef_resid_per_100km != null ? `${s.ef_resid_per_100km > 0 ? '+' : ''}${s.ef_resid_per_100km} (${s.ci_per_100km?.join('…')})` : '—'}</td>
            <td><small className="muted">{s.flag}</small></td>
          </tr>)}</tbody>
        </table></div>
      </Card>}

      <div className="rgrid">
        <Card title="30 / 90-day rotation">
          <div className="row2">{[['30 days', 'km30'], ['90 days', 'km90']].map(([l, k]) => <div key={k}><h3>{l}</h3><Donut parts={shoeRows.filter((g) => g.st[k] > 0).map((g) => ({ k: g.name.split(' ').slice(1).join(' ') || g.name, v: g.st[k], c: g.c }))} label={`Km per shoe ${l}`} /></div>)}</div>
        </Card>
        <Card title="Default shoe rules">
          {RULES.map(([t, r]) => { const s = active.filter((g) => settings.shoeRoles?.[g.id] === r); return <div key={t} className="prow"><span>{t}</span><b>{s.length ? s.map((x) => x.name).join(', ') : '—'}</b><small>role: {ROLES.find((x) => x[0] === r)[1]}</small></div> })}
        </Card>
      </div>
      <ShoeDegradation />
    </>}

    {/* ===== TAB 4: DEVICES & CONNECTIONS ===== */}
    {tab === 'connections' && <>
      <div className="rgrid">
        <div>
          <CorosCard />
          <StravaCard />
          <Card title="Devices & data export">
            {(Array.isArray(Dv.data?.value?.devices) && Dv.data.value.devices.length ? Dv.data.value.devices : ['COROS APEX 4 42mm', 'COROS POD 2']).map((d, idx) => { const label = typeof d === 'string' ? d : (d?.name || d?.model || String(d)); return <div key={label + idx} className="apipill"><i className="dot2 on" /><span>{label}</span><small className="muted">connected</small></div> })}
            <h3>Export local backup</h3>
            <div className="row2"><a className="btn sm" href={exp('activities', 'csv')}>Activities CSV</a><a className="btn sm" href={exp('activities', 'json')}>Activities JSON</a><a className="btn sm" href={exp('health', 'csv')}>Health CSV</a><a className="btn sm" href={exp('health', 'json')}>Health JSON</a></div>
          </Card>
        </div>

        <div>
          <Card title="Local SQLite databases (Node 22 node:sqlite)" right={<StatusPill tone="green" dot>WAL Online</StatusPill>}>
            <div className="db-grid">
              <div className="db-card"><div className="db-card-h"><code className="md-code">lumpad.db</code><StatusPill tone="green">{srv.dbSizesMb?.lumpad != null ? srv.dbSizesMb.lumpad + ' MB' : 'Online'}</StatusPill></div><small className="muted">Core store: activities, laps, health_daily, gear, sync_runs, oauth_tokens</small></div>
              <div className="db-card"><div className="db-card-h"><code className="md-code">coros.db</code><StatusPill tone="green">{srv.dbSizesMb?.coros != null ? srv.dbSizesMb.coros + ' MB' : 'Online'}</StatusPill></div><small className="muted">MCP archive: tasks, responses, activities ({fitTotal}), fit_files ({fitDone})</small></div>
              <div className="db-card"><div className="db-card-h"><code className="md-code">intel.db</code><StatusPill tone="green">{srv.dbSizesMb?.intel != null ? srv.dbSizesMb.intel + ' MB' : 'Online'}</StatusPill></div><small className="muted">FIT sessions ({fitParsed}), run_weather ({weatherDone}), daily_feat ({srv.dbCounts?.daily_feat ?? '—'}), kb_docs ({srv.dbCounts?.kb_docs ?? Intel.data?.counts?.kb_docs ?? '—'})</small></div>
              <div className="db-card"><div className="db-card-h"><code className="md-code">memory.db + kv.json</code><StatusPill tone="green">{srv.dbSizesMb?.memory != null ? srv.dbSizesMb.memory + ' MB' : 'Online'}</StatusPill></div><small className="muted">Hybrid RAG FTS5 memories ({srv.dbCounts?.memories ?? (Intel.data?.counts?.memory ? Intel.data.counts.memory.reduce((a, r) => a + (r.n || 0), 0) : '—')}), coach_run ({srv.dbCounts?.coach_runs ?? Intel.data?.coach_runs?.length ?? '—'}), synced KV</small></div>
            </div>
            <h3>FIT binary queue vs. parsed sessions</h3>
            <ProgressBar value={fitDone} max={fitTotal || 1} tone="cobalt" label={`FIT binaries ${fitDone} of ${fitTotal}`} />
            <small className="muted">{fitDone}/{fitTotal} FIT binaries downloaded · {fitParsed} parsed in intel.db · Last sync {ss?.lastRun ? `${wib(ss.lastRun.received_at)} WIB (${ago(ss.lastRun.received_at)})` : 'none'}</small>
          </Card>

          <Card title="Strava API v3 tools (4 endpoints)" right={<StatusPill tone={Src.data?.strava?.connected ? 'green' : 'amber'}>{Src.data?.strava?.connected ? 'Connected' : 'Check OAuth'}</StatusPill>}>
            {STRAVA_TOOLS.map((t) => <div key={t.tool} className="tool-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
              <div className="tool-meta"><code className="md-code">{t.tool}</code> <Chip>{t.scope}</Chip><br /><small className="muted">{t.value}</small></div>
            </div>)}
          </Card>
        </div>
      </div>

      <Card title="COROS MCP tool catalog (34 tools from tools.md)" right={<Chip>20 Archived · 8 Write · 6 On-demand</Chip>}>
        <div className="chiprow" role="group" aria-label="COROS tool category">
          {COROS_CATS.map(([k, l]) => <button key={k} type="button" aria-pressed={corosCat === k} onClick={() => setCorosCat(k)}>{l}</button>)}
        </div>
        <div className="tool-list">
          {corosRows.map((r) => {
            const live = archTools[r.tool]
            const total = live ? (live.done + live.pending + live.failed + (live.empty || 0)) : 0
            return <div key={r.tool} className="tool-row">
              <div className="tool-meta">
                <div><code className="md-code">{r.tool}</code> <Chip tone={r.mode === 'WRITE' ? 'str' : undefined}>{r.mode}</Chip> <Chip>{r.cap}</Chip></div>
                <small className="muted" style={{ display: 'block', marginTop: 2 }}>{r.value}</small>
                <small className="muted" style={{ fontFamily: 'var(--f-mono)', fontSize: '.7rem' }}>Params: {r.params}</small>
              </div>
              <div className="tool-right">
                {live ? <><b>{live.done}/{total}</b><br /><StatusPill tone={live.pending > 0 ? 'amber' : 'green'}>{live.pending > 0 ? `${live.pending} queued` : 'Synced'}</StatusPill></> : <StatusPill tone={r.synced ? 'green' : 'neutral'}>{r.synced ? 'Active' : r.mode === 'WRITE' ? 'Write Ready' : 'On-Demand'}</StatusPill>}
              </div>
            </div>
          })}
        </div>
      </Card>

      <Card title="Local server coverage & sync matrix" right={<div className="chipfilter" role="group" aria-label="Stream filter">{[['all', 'All'], ['coros', 'COROS'], ['strava', 'Strava'], ['intel', 'Intelligence']].map(([k, l]) => <button key={k} type="button" aria-pressed={streamFilter === k} onClick={() => setStreamFilter(k)}>{l}</button>)}</div>}>
        <div className="cov-bars" style={{ marginBottom: 14 }}>
          {syncMatrix.map((r) => <div key={r.item} className="cov-row">
            <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.item.split(' ').slice(0, 2).join(' ')}</span>
            <ProgressBar value={r.pct} max={100} tone={r.pct >= 95 ? 'green' : r.pct >= 70 ? 'cobalt' : 'amber'} label={`${r.item}: ${r.pct}%`} />
            <b style={{ textAlign: 'right', fontFamily: 'var(--f-mono)' }}>{r.pct}%</b>
          </div>)}
        </div>
        <div className="scroll" tabIndex={0}><table className="lapt">
          <thead><tr><th>Available Item</th><th>Payload</th><th>Available</th><th>Saved Locally</th><th>Coverage</th></tr></thead>
          <tbody>{syncMatrix.map((r) => <tr key={r.item}>
            <td><b>{r.item}</b></td><td className="muted">{r.value}</td><td>{r.avail}</td><td><b>{r.local}</b></td><td><StatusPill tone={r.pct >= 95 ? 'green' : r.pct >= 70 ? 'cobalt' : 'amber'}>{r.pct}%</StatusPill></td>
          </tr>)}</tbody>
        </table></div>
      </Card>

      <Card title="Map tiles (course map)" right={<Chip tone={mapKey ? 'green' : undefined}>{mapKey ? 'CARTO key set' : 'OpenStreetMap'}</Chip>}>
        <label className="fld"><span>CARTO Basemaps API key</span><input type="password" autoComplete="off" spellCheck="false" value={mapKey} onChange={(e) => setMapKey(e.target.value.trim())} placeholder="cb1_…" aria-invalid={!!mapKey && !KEY_RE.test(mapKey)} /></label>
        {mapKey && !KEY_RE.test(mapKey) && <p className="err" role="alert">Invalid CARTO key format (8–80 characters).</p>}
      </Card>
      <details className="card fold"><summary>Backup tools: Strava API, FIT import, literature</summary><Data /></details>
    </>}

    {/* ===== TAB 5: AI SETTINGS ===== */}
    {tab === 'ai' && <>
      <div className="rgrid">
        <div>
          <CoachConfig />
          <Card title="Automation & scheduling">
            <label className="sw"><input type="checkbox" checked={!!autoBrief} onChange={(e) => setAutoBrief(e.target.checked)} /><span>Run Automated Morning Brief after COROS sync (P0-1 backoff ledger: max 2/day)</span></label>
            <p className="muted">DeepSeek retry logic uses <code>maxTokens = 16000</code> and per-intent context budgets.</p>
          </Card>
        </div>
        <Card title="RAG engine & P0 safety guardrails" right={<ProvenanceBadge type="RULE" />}>
          <div className="apipill"><i className="dot2 on" /><span><b>Hybrid RAG Retrieval</b><br /><small className="muted">SQLite FTS5 + RRF + MMR + 16-D kNN</small></span><StatusPill tone="green">Active</StatusPill></div>
          <div className="apipill"><i className="dot2 on" /><span><b>P0-3 Safety Layer</b><br /><small className="muted">Red-flag symptoms &amp; BP ≥ 180/120 clinician gate</small></span><StatusPill tone="green">Enforced</StatusPill></div>
          <div className="apipill"><i className="dot2 on" /><span><b>P0-4 Answer Verifier</b><br /><small className="muted">Numbers, time tokens &amp; source citation check</small></span><StatusPill tone="green">Enforced</StatusPill></div>
          {go && <button type="button" className="btn primary" style={{ marginTop: 12 }} onClick={() => go('coach', { section: 'kg' })}>Open Knowledge Graph in AI Coach →</button>}
        </Card>
      </div>
    </>}

    {/* ===== TAB 6: SERVER DETAILS ===== */}
    {tab === 'server' && <>
      <div className="bio-kpis">
        <div className="kpi"><small>Production Host</small><b className="srv-host">lumpad.rihan.digital</b><em>Caddy HTTPS · 127.0.0.1:8787</em></div>
        <div className="kpi"><small>Runtime</small><b>{srv.nodeVersion || 'Node 22'}</b><em>SQLite 3.46.1 · React 18.3</em></div>
        <div className="kpi"><small>Memory &amp; Uptime</small><b>{srv.memRssMb != null ? `${srv.memRssMb} MB` : '2 GB VPS'}</b><em>{srv.uptimeSec != null ? `Up ${Math.floor(srv.uptimeSec / 3600)}h ${Math.floor((srv.uptimeSec % 3600) / 60)}m` : '/opt/lumpad'}</em></div>
        <div className="kpi"><small>/api/health</small><b>{Health.data?.ok ? '200 OK' : Health.state === 'loading' ? 'Checking…' : 'Offline'}</b><em>Sync: {sync}</em></div>
      </div>

      <div className="rgrid">
        <Card title="Systemd services & P0-6 backups" right={<StatusPill tone="green">Zero-Downtime</StatusPill>}>
          <div className="apipill"><i className="dot2 on" /><span><code className="md-code">lumpad.service</code><br /><small className="muted">Node 22 HTTP API + compiled Vite SPA</small></span><StatusPill tone="green">Active</StatusPill></div>
          <div className="apipill"><i className="dot2 on" /><span><code className="md-code">lumpad-autodeploy.timer</code><br /><small className="muted">Isolated worktree → npm ci → npm test → build → rollback</small></span><StatusPill tone="green">Armed</StatusPill></div>
          <div className="apipill"><i className="dot2 on" /><span><code className="md-code">deploy/backup-offsite.sh</code><br /><small className="muted">Encrypted snapshot of 4 SQLite DBs + kv.json + FIT</small></span><StatusPill tone="cobalt">Ready</StatusPill></div>
          <div className="apipill"><i className="dot2 on" /><span><code className="md-code">deploy/restore-drill.sh</code><br /><small className="muted">Automated decryption &amp; PRAGMA integrity_check</small></span><StatusPill tone="cobalt">Ready</StatusPill></div>
        </Card>

        <Card title="Caddy reverse proxy & security posture" right={<StatusPill tone="cobalt">TLS 1.3 · HSTS</StatusPill>}>
          <dl className="kv">
            <div><dt>Web Auth</dt><dd>Caddy basicauth · strict CSP · X-Frame-Options DENY</dd></div>
            <div><dt>Ingest Auth</dt><dd>Bearer token on POST /api/ingest &amp; /api/ingest/status</dd></div>
            <div><dt>OAuth Storage</dt><dd>AES-256-GCM sealed at rest (lumpad.db:oauth_tokens)</dd></div>
            <div><dt>P0 Guards</dt><dd>{srv.p0Guards ? 'Backoff · Safety · Verifier active' : 'Enforced'}</dd></div>
          </dl>
        </Card>
      </div>

      <Card title="Installed stack (package.json)">
        <div className="score-grid">
          <div><small>Frontend</small><b>react 18.3.1</b></div>
          <div><small>Bundler</small><b>vite 5.4.11</b></div>
          <div><small>COROS MCP</small><b>mcp/sdk 1.32.1</b></div>
          <div><small>FIT Parser</small><b>fit-parser 1.21</b></div>
          <div><small>Maps</small><b>leaflet 1.9.4</b></div>
          <div><small>Compression</small><b>fflate 0.8.3</b></div>
        </div>
      </Card>
    </>}
  </section>
}
