import { useState } from 'react'
import { today, diffDays, addDays, BY_DATE, WEEKS, fmtLong, fmtShort, KIND } from './lib/calendar.js'
import { Card, Chip, Evidence, Icon, SegmentedTabs, ProgressBar, StatusPill, ProvenanceBadge } from './ui.jsx'
import { useStore } from './store.js'
import { BarChart } from './charts.jsx'
import CourseMap from './CourseMap.jsx'
import JakimBenchmark from './JakimBenchmark.jsx'

const JRF_COPS = [
  { name: 'COP 1', km: 18.0, elapsed: '2h 10m', closes: '06:10', sub4: '05:42 (+28′)' },
  { name: 'COP 2', km: 28.0, elapsed: '3h 20m', closes: '07:20', sub4: '06:38 (+42′)' },
  { name: 'COP 3', km: 31.8, elapsed: '3h 45m', closes: '07:45', sub4: '07:00 (+45′)' },
  { name: 'COP 4 (Final)', km: 36.8, elapsed: '4h 20m', closes: '08:20', sub4: '07:28 (+52′)' },
  { name: 'FINISH (COT)', km: 42.195, elapsed: '5h 00m', closes: '09:00', sub4: '07:59 (+61′)' },
]

const HYDRO_STATIONS = ['2K', '5K', '7K', '10K', '12.5K', '15K', '17.5K', '20K', '22K', '24.5K', '26K', '28K', '30K', '32K', '34K', '36K', '37K', '39.5K', '40.5K']

const PACERS = [
  ['Sub 03:45 (Corral 1)', 'Bangun Allo · Kevin Loe · Rinto Sitorus', false],
  ['Sub 04:00 Chip (Corral 2)', 'Charles Salim · Danny Sutanto · Syaiful Amri', true],
  ['Sub 04:30 Chip (Corral 3)', 'M. Gilang Rizqullah · Laurentius Paskal · Ivan Avrianto', false],
  ['Sweeper (5:00 COT)', 'Rio Mayestika · Ahmad Fahrul · Zaiful Bahri', false],
]

const JRF_RULES = [
  'Opening 5 km: 10–15 s/km slower than MP + 0.7 km pre-start GI flush; stay in Corral 2 with Sub-4 pacers.',
  'Fueling: 45–60 g/hr CHO starting at min 45; use all 19 Le Minerale / HYDROPLUS stations.',
  'WBGT cooling: Douse head at every station; respect Orange/Red/Black flag tents at KM 20, 26, 30, 36, 40.5.',
  'Pain gate: Mechanical pain ≥ 2/10 = immediate stride shorten & conservative run-walk.',
]

// Canonical 2027 race catalog: registered races appear ONLY in Upcoming; unbooked appear ONLY in Plan
const RACES_2027 = [
  { id: 'jakim2027', date: '2027-06-13', name: 'Jakarta International Marathon 2027 (Jakim FM)', cls: 'CP9 · B-RACE', registered: true, dist: '42.195 km National', route: 'Northwest Monas → GBK Main Stadium', orderId: '1999-4455281747', bibName: 'IRFAN', kit: 'Jersey L · Finisher M', target: 'Sub-5:00 · 6:54/km (Healthy Finish)' },
  { id: 'mjm2027', date: '2027-06-20', dateSpan: 'Jun 19–20, 2027', name: 'Mandiri Jogja Marathon (MJM FM & B-MJM)', cls: 'PLAN · C-RACE', registered: false, desc: 'B-MJM 30′ jog (Sat) + MJM FM 42.2 km (Sun) · Yogyakarta family trip', note: 'Gated by Wed Jun 16 (D+3 post-Jakim)' },
  { id: 'jrf2027', date: '2027-10-24', dateSpan: 'Oct 24, 2027', name: 'myBCA JRF — HYDROPLUS Marathon', cls: 'PEAK A-RACE · WA LABEL', registered: false, arace: true, desc: 'Target Sub-4:00 (Corral 2 Pacers) · Official COT 5h 00m (09:00 WIB) · Sat HM ≤5K bib-jog', note: '04:00 Mass Start · Arrive 02:45 · Istora GBK' },
  { id: 'bormar2027', date: '2027-11-14', dateSpan: 'Nov 14, 2027', name: 'Borobudur FM (Bormar)', cls: 'PLAN · SYNC NEEDED', registered: false, desc: '42.195 km · Magelang · Falls D+21 post-JRF A-Race', note: 'Flagged for W45 recovery reconciliation in 06.4 v4.4' },
]

// Validated 2024–2026 Race History Ledger (20 counted + 3 non-race context)
const RACE_HISTORY = [
  { date: '2026-11-15', year: '2026', name: 'Borobudur FM (Bank Jateng Borobudur Marathon)', dist: '36.92K watch', result: '5:30:35 moving', status: 'DNF (Black Flag)', isDnf: true, isContext: false, source: 'COROS + Strava', notes: 'Extreme heat black flag; cleared COP3 (+4.2m est.), medal + jersey · Adizero SL2' },
  { date: '2026-10-25', year: '2026', name: 'JRF FM 2026', dist: '9.16K watch', result: '1:03:34 (DNF km 9.16)', status: 'DNF', isDnf: true, isContext: false, source: 'COROS + Strava', notes: 'Disciplined stop on 2/10 pain gate · Avg HR 166 · Adizero SL2' },
  { date: '2026-10-24', year: '2026', name: 'JRF HM 2026', dist: '21.59K watch', result: '3:06:45 elapsed', status: 'Finish', isDnf: false, isContext: false, source: 'COROS + Strava', notes: 'Post-thigh rehab run-walk · Avg HR 159 · Clifton 10' },
  { date: '2026-09-13', year: '2026', name: 'MILO ACTIV Indonesia Race 10K', dist: '10K', result: '1:01:21 elapsed', status: 'Finish', isDnf: false, isContext: false, source: 'Strava + COROS', notes: '28–30°C · Avg HR 170.7 / 220W · Endorphin Speed 4' },
  { date: '2026-07-26', year: '2026', name: 'Head & Shoulders Super Cool Run 10K', dist: '10K', result: 'Net 1:00:55', status: 'Finish · 10K PB', isDnf: false, isContext: false, source: 'Official + Strava', notes: 'Official 10K PB (VDOT 31.7) · 195/868 overall' },
  { date: '2026-06-14', year: '2026', name: 'Jakim FM (BTN Jakarta International Marathon)', dist: '42.195K', result: 'Net 6:53:03', status: 'Finish · 1st FM', isDnf: false, isContext: false, source: 'Official + COROS FIT', notes: 'First FM · Plantar onset km 6–7 (mechanical ceiling)' },
  { date: '2026-05-24', year: '2026', name: 'Starbucks 5K', dist: '5.68K', result: '59:07 official', status: 'Finish', isDnf: false, isContext: false, source: 'Official + Strava', notes: 'Fun run with wife, walk breaks' },
  { date: '2025-12-07', year: '2025', name: 'Milo Active Race 10K', dist: '10K', result: '1:12:44', status: 'Finish', isDnf: false, isContext: false, source: 'Official + Strava', notes: 'Avg HR 174 · −17:01 vs Milo 2024 (+6.0 VDOT gain)' },
  { date: '2025-11-16', year: '2025', name: 'Century Run', dist: '4.3K', result: '26:16', status: 'Finish', isDnf: false, isContext: false, source: 'Strava', notes: 'Late watch start at gun' },
  { date: '2025-10-25', year: '2025', name: 'JRF HM (Wondr Jakarta Running Festival)', dist: '21.65K', result: 'Net 3:05:30', status: 'Finish', isDnf: false, isContext: false, source: 'Official + Strava', notes: 'GI/diarrhea onset ~km 11 after 37:10 10K split' },
  { date: '2025-09-21', year: '2025', name: 'Guardian Run 10K', dist: '10K', result: '1:53:50', status: 'Finish', isDnf: false, isContext: false, source: 'Strava + COROS', notes: 'Deliberate easy pace · Avg HR 126' },
  { date: '2025-08-24', year: '2025', name: 'Total Combat Run', dist: '7K', result: '53:34', status: 'Finish', isDnf: false, isContext: false, source: 'COROS', notes: 'Avg HR 161 · Pace 7:41/km' },
  { date: '2025-08-17', year: '2025', name: 'Sentul Ultra 17K', dist: '10.95K', result: 'DNF (fell)', status: 'DNF', isDnf: true, isContext: false, source: 'Strava', notes: 'Fell at km 8.36; injury-limited exit' },
  { date: '2025-08-10', year: '2025', name: 'Made in Indonesia Run', dist: '5K', result: '49:34', status: 'Finish', isDnf: false, isContext: false, source: 'Strava', notes: 'Fun run with wife' },
  { date: '2025-08-03', year: '2025', name: 'UI Trail Run', dist: '6.15K', result: '1:07:54 official', status: 'Finish', isDnf: false, isContext: false, source: 'Official', notes: '139/501 overall' },
  { date: '2025-06-15', year: '2025', name: 'LPS Monas HM', dist: '21.5K', result: '3:11:57', status: 'Finish · 1st HM', isDnf: false, isContext: false, source: 'Strava', notes: 'First HM · Nausea onset ~km 9 in tropical heat' },
  { date: '2025-05-25', year: '2025', name: 'Bogor City Trail Run', dist: '11.5K', result: '2:56:10', status: 'Finish', isDnf: false, isContext: false, source: 'Strava', notes: 'Trail course · +330 m elevation gain' },
  { date: '2025-03-09', year: '2025', name: 'Run to Iftar', dist: '5K', result: '45:25', status: 'Finish', isDnf: false, isContext: false, source: 'Strava', notes: 'Ramadan 2025 at TMII' },
  { date: '2025-01-12', year: '2025', name: 'Soekarno Run', dist: '10K', result: '1:21:05', status: 'Finish', isDnf: false, isContext: false, source: 'Strava', notes: 'Clean road 10K · −8:40 vs Milo 2024' },
  { date: '2024-12-08', year: '2024', name: 'Milo ACTIV 2024', dist: '10.13K', result: '1:29:45', status: 'Finish · 1st Race', isDnf: false, isContext: false, source: 'COROS FIT + Strava', notes: 'First-ever race · VDOT ~20.1 baseline zero-point' },
  { date: '2026-11-15', year: '2026', name: 'Guardian Run 5K (2026)', dist: '5K', result: 'Did Not Enter', status: 'Not Counted', isDnf: false, isContext: true, source: 'Athlete Log', notes: 'Conflicted with Borobudur FM 2026' },
  { date: '2026-11-08', year: '2026', name: 'PLN Electric Run 5K', dist: '5K', result: 'DNS', status: 'DNS', isDnf: false, isContext: true, source: 'Athlete Log', notes: 'Did not start (4.0 km walk only)' },
  { date: '2026-08-30', year: '2026', name: 'Urbana Qualifier HM', dist: '21.33K', result: '2:46:52', status: 'Qualifier TT', isDnf: false, isContext: true, source: 'Strava + COROS', notes: 'GPS time-trial qualifier for Borobudur FM (not counted as race)' },
]

const ARC_10K = [
  { label: "Dec '24", min: 89.75, vdot: 20.1 },
  { label: "Jan '25", min: 81.08, vdot: 22.4 },
  { label: "Dec '25", min: 72.73, vdot: 25.8 },
  { label: "Jul '26 PB", min: 60.92, vdot: 31.7 },
  { label: "Sep '26", min: 61.35, vdot: 31.4 },
]

function wbgtFlag(w) {
  if (w < 22.3) return ['wf-green', 'GREEN — LOW RISK (<22.3°C)']
  if (w < 25.7) return ['wf-yellow', 'YELLOW — MODERATE (22.3–25.7°C)']
  if (w < 27.9) return ['wf-orange', 'ORANGE — HIGH RISK (25.7–27.9°C)']
  if (w < 32.3) return ['wf-red', 'RED — VERY HIGH (27.9–32.3°C)']
  return ['wf-black', 'BLACK — EXTREME (≥32.3°C · RACE STOPPED)']
}

function Arc10kChart() {
  const W = 520, H = 160, pad = { l: 38, r: 38, t: 18, b: 30 }
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const xs = (i) => pad.l + (i / (ARC_10K.length - 1)) * iw
  const yMin = (m) => pad.t + ((95 - m) / (95 - 55)) * ih
  const yVdot = (v) => pad.t + ((36 - v) / (36 - 18)) * ih
  const pMin = ARC_10K.map((d, i) => `${xs(i).toFixed(1)},${yMin(d.min).toFixed(1)}`).join(' ')
  const pVdot = ARC_10K.map((d, i) => `${xs(i).toFixed(1)},${yVdot(d.vdot).toFixed(1)}`).join(' ')
  return <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="10K finish time and implied VDOT progression">
    {[60, 75, 90].map((m) => <g key={m}><line x1={pad.l} x2={W - pad.r} y1={yMin(m)} y2={yMin(m)} className="gl" /><text x={4} y={yMin(m) + 4} className="gt">{m}m</text></g>)}
    {[20, 28, 34].map((v) => <text key={v} x={W - pad.r + 6} y={yVdot(v) + 4} className="gt" fill="var(--green)">{v}</text>)}
    <polyline fill="none" stroke="var(--cobalt)" strokeWidth="2.5" points={pMin} />
    <polyline fill="none" stroke="var(--green)" strokeWidth="2.2" strokeDasharray="5 4" points={pVdot} />
    {ARC_10K.map((d, i) => <g key={d.label}>
      <circle cx={xs(i)} cy={yMin(d.min)} r="4" fill="var(--cobalt)" />
      <circle cx={xs(i)} cy={yVdot(d.vdot)} r="3.5" fill="var(--green)" />
      <text x={xs(i)} y={H - 8} textAnchor="middle" className="gt tiny">{d.label.replace(' ', ' ')}</text>
    </g>)}
  </svg>
}

export default function Race({ settings, go }) {
  const T = today()
  const [tab, setTab] = useState('upcoming')
  const [planSub, setPlanSub] = useState('sim')
  const [histFilter, setHistFilter] = useState('all')
  const [bib, setBib] = useStore('lumpad.race.jakim2027.bib', '')
  const [bibDraft, setBibDraft] = useState('')
  const [bibSaved, setBibSaved] = useState(false)

  // Interactive JRF Pacing & WBGT Simulator state (COT = 300 min / 5h 00m)
  const [wbgt, setWbgt] = useState(26.0)
  const [hrCap, setHrCap] = useState(154)
  const [weight, setWeight] = useState(+settings.bodyMassKg || 71.8)
  const [rwPen, setRwPen] = useState(0)

  const upcoming = RACES_2027.filter((r) => r.registered)
  const planned = RACES_2027.filter((r) => !r.registered)

  // Simulator math (grounded in guide §3.2)
  const heatPenMin = Math.max(0, (wbgt - 25.0) * 2.4)
  const hrPenMin = hrCap > 158 ? (hrCap - 158) * 1.8 : hrCap < 148 ? (148 - hrCap) * 0.6 : 0
  const wtDeltaMin = (weight - 71.8) * 1.9
  const totalMin = Math.round(238.5 + heatPenMin + hrPenMin + wtDeltaMin + rwPen)
  const simH = Math.floor(totalMin / 60), simM = totalMin % 60
  const paceSec = Math.round((totalMin * 60) / 42.195)
  const simPace = `${Math.floor(paceSec / 60)}:${String(paceSec % 60).padStart(2, '0')}`
  const simRunShare = Math.max(48, Math.min(98, Math.round(96 - heatPenMin * 1.2 - (hrCap > 160 ? 18 : 0) - rwPen * 0.6)))
  const choG = Math.round(55 + (wbgt > 27 ? 8 : 0))
  const gels = Math.ceil((choG * (totalMin / 60)) / 25)
  const copBuf = 300 - totalMin // 5h 00m official COT
  const [flagCls, flagText] = wbgtFlag(wbgt)

  const kg = +settings.bodyMassKg || 75.3
  const peak = Math.max(...WEEKS.map((w) => w.km))
  const taper = WEEKS.filter((w) => ['W40', 'W41', 'W42'].includes(w.id)).map((w) => ({ date: w.id, value: Math.round((w.km / peak) * 100), tick: w.id }))
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays('2027-10-18', i)).map((d) => BY_DATE[d]).filter(Boolean)

  const histRows = RACE_HISTORY.filter((r) => {
    if (histFilter === 'all') return !r.isContext
    if (histFilter === 'dnf') return r.isDnf
    if (histFilter === 'context') return r.isContext
    return !r.isContext && r.year === histFilter
  })

  const TABS = [
    { id: 'upcoming', label: 'Upcoming', badge: upcoming.length, tone: 'green' },
    { id: 'plan', label: 'Plan', badge: planned.length, tone: 'red' },
    { id: 'history', label: 'History', badge: 20 },
  ]

  return <>
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div>
          <h1>Races</h1>
          <p className="sub">Confirmed registrations, unbooked 2027 roadmap, and validated 2024–2026 race ledger</p>
        </div>
        <div className="prof-chips">
          <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} label="Race categories" />
          <button type="button" className="hb v" onClick={() => go('route')}>Official course →</button>
        </div>
      </div>
    </div>

    {/* ===== TAB 1: UPCOMING (REGISTERED ONLY) ===== */}
    {tab === 'upcoming' && upcoming.map((r) => {
      const daysLeft = Math.max(0, diffDays(r.date, T))
      const wksLeft = (daysLeft / 7).toFixed(1)
      return <div key={r.id}>
        <Card className="race-hero-up">
          <div className="race-hero-top">
            <div>
              <div className="chips" style={{ marginTop: 0 }}>
                <StatusPill tone="green">REGISTERED</StatusPill>
                <Chip>{r.cls}</Chip>
                <Chip>{fmtLong(r.date)}</Chip>
              </div>
              <h2 className="sess-title" style={{ color: '#fff', marginTop: 8 }}>{r.name}</h2>
              <p className="muted">{r.dist} · {r.route}</p>
            </div>
            <div className="race-cd-box">
              <div><small>COUNTDOWN</small><b>D-{daysLeft}</b></div>
              <div><small>STRATEGY</small><b style={{ fontSize: '1.05rem', color: '#fcd34d' }}>Sub-5:00 · 6:54/km</b><small>B-Race · Healthy Finish</small></div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.76rem', marginBottom: 4 }}>
            <span>Build Cycle Progress (Nov 2026 → Jun 13, 2027)</span>
            <b style={{ fontFamily: 'var(--f-mono)', color: '#6ee7b7' }}>{wksLeft} weeks remaining</b>
          </div>
          <ProgressBar value={Math.max(5, Math.min(100, Math.round(((210 - daysLeft) / 210) * 100)))} max={100} tone="green" label="Build progress to Jakim FM" />

          <div className="reg-strip">
            <div className="reg-box">
              <small>Order &amp; Kit</small>
              <b style={{ display: 'block', fontFamily: 'var(--f-mono)', margin: '3px 0' }}>{r.orderId}</b>
              <span>BIB Name: <b>{r.bibName}</b> · {r.kit}</span>
            </div>
            <div className="reg-box">
              <small>BIB Number (Race Pack Collection)</small>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input type="text" placeholder="Enter BIB at RPC" value={bibDraft || bib} onChange={(e) => { setBibDraft(e.target.value.slice(0, 16)); setBibSaved(false) }} aria-label="Jakim BIB number" />
                <button type="button" className="btn sm reg-save" style={{ width: 'auto', flex: 'none' }} onClick={() => { setBib((bibDraft || bib).trim()); setBibSaved(true) }}>{bibSaved ? 'Saved ✓' : 'Save'}</button>
              </div>
            </div>
            <div className="reg-box warn">
              <b style={{ color: '#fcd34d', display: 'block', marginBottom: 4 }}>D+3 Post-Jakim Gate (Wed, Jun 16)</b>
              <span>Plantar protection at km 6–7. Any pain ≥ 1/10, Sleep HR &gt; +5 bpm, or Reduced HRV auto-converts MJM (Jun 20) to DNS.</span>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn sm" onClick={() => go('calendar', r.date)}>Open race-day Day Plan →</button>
          </div>
        </Card>

        <JakimBenchmark settings={settings} compact onOpen={() => go('route')} />
        <CourseMap routeId="jakim" pace={null} goal="healthy finish" go={go} />
      </div>
    })}

    {/* ===== TAB 2: PLAN (UNBOOKED 2027 ROADMAP ONLY — JAKIM EXCLUDED) ===== */}
    {tab === 'plan' && <>
      <Card title="2027 planned races (unbooked roadmap)" right={<Chip>Optional: NY Run 20.3K (Jan 1)</Chip>}>
        <p className="muted" style={{ marginBottom: 10 }}>Registered races (Jakim FM) live exclusively in <b>Upcoming</b>. Below are your 3 planned targets on the 2027 roadmap.</p>
        <div className="plan-cards3">
          {planned.map((r) => <div key={r.id} className={`pcard ${r.arace ? 'arace' : ''}`}>
            <div className="ch" style={{ marginBottom: 0 }}>
              <StatusPill tone={r.arace ? 'red' : 'amber'}>{r.cls}</StatusPill>
              <b style={{ fontFamily: 'var(--f-mono)', fontSize: '.78rem' }}>{r.dateSpan} · D-{Math.max(0, diffDays(r.date, T))}</b>
            </div>
            <h3 style={{ margin: '4px 0 2px', fontSize: '.98rem' }}>{r.name}</h3>
            <p className="muted" style={{ fontSize: '.8rem' }}>{r.desc}</p>
            <small className="muted" style={{ marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line)' }}>{r.note}</small>
          </div>)}
        </div>
      </Card>

      <Card title="JRF Official Race Guide & A-Race Blueprint" right={<span className="chips" style={{ margin: 0 }}><ProvenanceBadge type="MODEL" /><Chip tone="red">5h 00m COT</Chip></span>}>
        <div className="chiprow" role="tablist" aria-label="JRF blueprint sections">
          {[['sim', 'Pacing & WBGT Sim'], ['cop', 'Cut-offs & WBGT Flags'], ['logistics', 'Logistics, MRT & Pacers'], ['week', 'Taper, Week & Rules']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={planSub === k} aria-pressed={planSub === k} onClick={() => setPlanSub(k)}>{l}</button>
          ))}
        </div>

        {planSub === 'sim' && <>
          <div className="ch" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className={`wbgt-flag ${flagCls}`}>{flagText}</span>
            <StatusPill tone={totalMin < 240 ? 'green' : copBuf >= 0 ? 'amber' : 'red'}>Simulated: {simH}:{String(simM).padStart(2, '0')}:20 ({totalMin < 240 ? 'Sub-4 ✓' : copBuf >= 0 ? 'Inside 5h COT' : 'Over 5h COT'})</StatusPill>
          </div>
          <div className="form" style={{ marginTop: 10 }}>
            <label className="fld"><span>Forecast WBGT: <b>{wbgt.toFixed(1)}°C</b></span><input type="range" min={21} max={33} step={0.5} value={wbgt} onChange={(e) => setWbgt(+e.target.value)} /><small>&lt;22.3 Green · ≥32.3 Black Flag Stop</small></label>
            <label className="fld"><span>Km 0–10 HR Cap: <b>{hrCap} bpm</b></span><input type="range" min={142} max={172} step={1} value={hrCap} onChange={(e) => setHrCap(+e.target.value)} /><small>144 Best EF → 168 Overcooked</small></label>
            <label className="fld"><span>Race Weight: <b>{weight.toFixed(1)} kg</b></span><input type="range" min={68} max={77} step={0.5} value={weight} onChange={(e) => setWeight(+e.target.value)} /><small>71.8 kg Lean vs 76.7 kg Scan</small></label>
            <label className="fld"><span>Run : Walk Strategy</span><select value={rwPen} onChange={(e) => setRwPen(+e.target.value)}>
              <option value={0}>Continuous + 20s Water Walk</option>
              <option value={8}>9 min Run : 1 min Walk</option>
              <option value={18}>6 min Run : 1 min Walk</option>
              <option value={32}>4 min Run : 1 min Walk (Heat)</option>
            </select></label>
          </div>
          <div className="score-grid" style={{ marginTop: 12 }}>
            <div><small>Projected Finish</small><b>{simH}:{String(simM).padStart(2, '0')}:20</b></div>
            <div><small>Net Pace</small><b>{simPace} /km</b></div>
            <div><small>Run Share</small><b>{simRunShare}%</b></div>
            <div><small>CHO Fueling</small><b>{choG} g/hr</b><em>{gels} gels</em></div>
            <div><small>5h COT Cushion</small><b className={copBuf >= 20 ? 'cmp-good' : copBuf < 0 ? 'cmp-bad' : ''}>{copBuf >= 0 ? `+${copBuf} min` : `${copBuf} min`}</b><em>300 min COT</em></div>
          </div>
          <h3>19 Official Hydration Stations (Le Minerale + HYDROPLUS + STRIVE gels)</h3>
          <div className="hydro-strip">{HYDRO_STATIONS.map((s) => <span key={s}>{s}</span>)}</div>
        </>}

        {planSub === 'cop' && <div className="rgrid">
          <div>
            <h3>Official Marathon Cut-off Points (04:00 WIB Start · 5h 00m COT)</h3>
            <div className="scroll" tabIndex={0}><table className="zm">
              <thead><tr><th>Point</th><th>KM</th><th>Elapsed</th><th>Closes</th><th>ETA @Sub-4</th></tr></thead>
              <tbody>{JRF_COPS.map((c) => <tr key={c.name}><td><b>{c.name}</b></td><td>{c.km}</td><td>{c.elapsed}</td><td>{c.closes} WIB</td><td className="cmp-good">{c.sub4}</td></tr>)}</tbody>
            </table></div>
          </div>
          <div>
            <h3>WBGT Flag Protocol (Tents: KM 20, 26, 30, 36, 40.5)</h3>
            <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
              <span className="wbgt-flag wf-green">GREEN · Low Risk (&lt; 22.3°C)</span>
              <span className="wbgt-flag wf-yellow">YELLOW · Moderate (22.3 – &lt;25.7°C)</span>
              <span className="wbgt-flag wf-orange">ORANGE · High Risk (25.7 – &lt;27.9°C)</span>
              <span className="wbgt-flag wf-red">RED · Very High (27.9 – &lt;32.3°C)</span>
              <span className="wbgt-flag wf-black">BLACK · Race Stopped (≥ 32.3°C)</span>
            </div>
            <p className="muted"><b>Black Flag Rule:</b> Before Final COP (KM 36.8) → bus evacuation; after Final COP → shortest route to finish; all affected runners remain entitled to finisher medals.</p>
            <div className="mod red"><b>Siloam Medical Support (Sunday)</b><p>19 Medical Stations · 17 Ambulances · 11 Mobile Units · 608 Personnel · Hotline <b>+62 813-1428-0796</b></p></div>
          </div>
        </div>}

        {planSub === 'logistics' && <div className="rgrid">
          <div>
            <h3>RPC &amp; Race Morning</h3>
            <ul className="rules">
              <li><b>RPC:</b> Istora Senayan GBK (Thu–Fri 10:00–21:00, Sat 09:00–19:00 10K/FM only; Area 1 = 10K/FM). Mandatory in-person pickup for HM &amp; FM. <b>NO BIB. NO WRISTBAND. NO START.</b></li>
              <li><b>Arrival:</b> 02:45 WIB (gate closes strictly at 04:00 WIB; late = DNS). Runners&apos; Entrance: Plaza Parkir Timur GBK; Bag Drop: Istora GBK (300 m).</li>
              <li><b>Free MRT Jakarta (JRF App QR):</b> Starts 03:00 WIB (Blok M 03:00 → Istora 03:07 · Lebak Bulus 03:00 → 03:19 · Bundaran HI 03:01 → 03:10).</li>
              <li><b>GBK Gates:</b> Use Entrance 5 or 6 (~750 m). <b>Entrance 7 CLOSED</b>. Grab/Taxi drop-off: Entrance 5. Road closures 02:30–09:15.</li>
            </ul>
          </div>
          <div>
            <h3>Official HYDROPLUS Marathon Pacers</h3>
            <dl className="kv">{PACERS.map(([tier, names, hi]) => <div key={tier} style={hi ? { background: 'color-mix(in srgb, var(--cobalt) 12%, transparent)', padding: '8px 10px', borderRadius: 10 } : undefined}><dt><b>{tier}</b></dt><dd>{names}</dd></div>)}</dl>
            <p className="muted" style={{ marginTop: 8 }}><b>JRF App &amp; Photos:</b> JRF Pass + Free MRT QR · Fotoyu <code>JRF2026</code> (Rp168,000 package).</p>
          </div>
        </div>}

        {planSub === 'week' && <div className="rgrid">
          <div>
            <h3>3-Week Taper (W40–W42) &amp; Carb-Loading</h3>
            <BarChart data={taper} label="Taper volume percent" />
            <div className="score-grid two" style={{ marginTop: 8 }}>
              <div><small>CHO Load (Fri–Sat)</small><b>{Math.round(kg * 10)}–{Math.round(kg * 12)} g/d</b><em>10–12 g/kg</em></div>
              <div><small>Body Mass</small><b>{kg} kg</b><em>Profile setting</em></div>
            </div>
            <h3>Race-Day Non-Negotiables</h3>
            <ul className="rules">{JRF_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
          <div>
            <h3>Race Week Schedule (W42 · Oct 18–24, 2027)</h3>
            {weekDays.map((d) => <button key={d.date} className="rowbtn" onClick={() => go('calendar', d.date)}><span className={`kdot k-${d.kind}`} /><span><b>{d.label || KIND[d.kind].label}</b><small>{fmtLong(d.date)}</small></span><b>{d.km ? d.km + ' km' : ''}</b></button>)}
            <button type="button" className="btn sm full" onClick={() => go('calendar', { view: 'cp', id: 18 })}>CP18 Go/No-Go Gate (Thu 21 Oct) →</button>
          </div>
        </div>}
      </Card>
    </>}

    {/* ===== TAB 3: HISTORY (2024–2026 VALIDATED LEDGER) ===== */}
    {tab === 'history' && <>
      <div className="bio-kpis">
        <div className="kpi"><small>Validated Races</small><b>20</b><em>17 Finishes · 3 DNFs (2024–2026)</em></div>
        <div className="kpi"><small>10K Official PB</small><b>1:00:55</b><em>−32.1% since Dec 2024</em></div>
        <div className="kpi"><small>Half Marathon</small><b>3:05:30</b><em>JRF HM &apos;25 · Urbana TT 2:46:52</em></div>
        <div className="kpi"><small>Full Marathon</small><b>6:53:03</b><em>Jakim &apos;26 · 2 DNFs</em></div>
      </div>

      <div className="rgrid">
        <Card title="10K finish time & implied VDOT arc" right={<ProvenanceBadge type="ACTUAL" />}>
          <Arc10kChart />
          <div className="legend"><span><i className="ll" style={{ borderColor: 'var(--cobalt)' }} />10K time (min)</span><span><i className="ll" style={{ borderColor: 'var(--green)', borderTopStyle: 'dashed' }} />Implied VDOT</span></div>
        </Card>
        <Card title="Root-cause lessons">
          <ul className="rules">
            <li><b>JRF HM &apos;25:</b> GI/diarrhea ~km 11 after 37:10 10K split (not fitness collapse).</li>
            <li><b>Jakim FM &apos;26:</b> Mechanical plantar onset km 6–7 (HR fell with pace).</li>
            <li><b>JRF FM &apos;26 (DNF 9.2K):</b> Disciplined stop on 2/10 pain gate.</li>
            <li><b>Borobudur FM &apos;26:</b> Extreme-heat black flag; cleared COP3 (+4.2m est., medal + jersey).</li>
          </ul>
        </Card>
      </div>

      <Card title="Validated race archive (2024–2026)">
        <div className="chiprow" role="group" aria-label="Race history filter">
          {[['all', 'All (20)'], ['2026', '2026 (7)'], ['2025', '2025 (12)'], ['2024', '2024 (1)'], ['dnf', 'DNF (3)'], ['context', 'Non-Race / DNS (3)']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={histFilter === k} onClick={() => setHistFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="scroll" tabIndex={0}><table className="lapt">
          <thead><tr><th>Date</th><th>Event</th><th>Dist</th><th>Result</th><th>Status</th><th>Context</th></tr></thead>
          <tbody>{histRows.map((r) => <tr key={r.date + r.name}>
            <td>{r.date}</td><td><b>{r.name}</b></td><td>{r.dist}</td><td><b>{r.result}</b></td>
            <td><StatusPill tone={r.isDnf ? 'red' : r.isContext ? 'amber' : r.status.includes('PB') ? 'cobalt' : 'green'}>{r.status}</StatusPill></td>
            <td className="muted"><small>{r.source} · {r.notes}</small></td>
          </tr>)}</tbody>
        </table></div>
      </Card>
    </>}
  </>
}
