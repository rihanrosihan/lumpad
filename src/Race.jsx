import { raceTime, fmtTime } from './lib/vdot.js'
import { PLAN, BY_DATE, today, diffDays, addDays, fmtLong, fmtShort, KIND } from './lib/calendar.js'
import { RACE_BY_DATE, REG_LABEL } from './lib/season.js'
import { Card, Chip, Evidence } from './ui.jsx'
import { useApi } from './api.js'
import { WEEKS } from './lib/calendar.js'
import { BarChart } from './charts.jsx'
import { mean } from './lib/stats.js'
import { useState } from 'react'
import { simulate, fmtHMS, heatPenalty } from './lib/pacing.js'
import { useStore } from './store.js'
import { Icon } from './ui.jsx'

const RATE = 0.74 // best observed VDOT/month (n=2) — hypothesis, shown as such
const FM = 42195, RATIO = 0.95 // FM time = time for VDOT (ratio × fitness), as in the project plan; checked: 38.2 → 4:08:41 (doc 4:08:32)
const fm = (v) => fmtTime(raceTime(v * RATIO, FM))
const months = (a, b) => Math.max(0, diffDays(a, b) / 30.44)
const RULES = [
  'Meal buffer ≥ 90 minutes before the start; 0.7 km GI flush before every race.',
  'CHO 30–60 g/h from minute 45 (ramp 40 → 50 → 60 g/h, locked at CP16).',
  'Hold the first 5 km by HR cap — not by pace.',
  'Race pace 5:41/km is used only after CP14 and CP16 are clean; before that, pace comes from the latest benchmark slot.',
  'Pain ≥ 2/10 during the race = durability event: short strides, run-walk, finish-first right then.',
  'Last Lower on Tue 12 Oct (12 days before the FM). Race week: Tue 2×1 km @MP · Thu CP18 gate · Fri light physio · Sat Half = bib jog ≤5 km or DNS.',
]

// JRF course facts (organiser). COPs are the 2026 edition: same route in 2027, cut-off times may change.
const JRF = { place: 'Gelora Bung Karno Sports Complex, Jakarta', gun: '04:00', cutoffMin: 300, half: '2027-10-23',
  cops: [['COP 1', 18, '06:10'], ['COP 2', 28, '07:20'], ['COP 3', 31.8, '07:45'], ['COP 4', 36.8, '08:20'], ['Finish', 42.195, '09:00']] }
const tod = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5) // minutes since midnight
const clock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}.${String(Math.round(m % 60)).padStart(2, '0')}`
const pace = (secPerKm) => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`
function Cutoffs() {
  const runs = [['sub-4:00', 341], ['fallback 4:30', 4.5 * 3600 / 42.195]] // s/km, even pace
  const rows = JRF.cops.map(([name, km, close]) => {
    const allowed = tod(close) - tod(JRF.gun), need = (allowed * 60) / km
    return { name, km, close, need, at: runs.map(([, p]) => tod(JRF.gun) + (p * km) / 60), margin: runs.map(([, p]) => allowed - (p * km) / 60) }
  })
  const tight = rows.reduce((a, r) => (r.need < a.need ? r : a))
  return <Card title="Cut-off (COP)" right={<Chip tone="yellow">2026 COP basis</Chip>}>
    <div className="scroll" tabIndex={0} role="region" aria-label="Table (scroll to see all columns)"><table className="zm">
      <thead><tr><th>Point</th><th>KM</th><th>Closes</th><th>Max pace</th><th>Arrive @sub-4</th><th>Arrive @4:30</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.km}</td><td>{r.close.replace(':', '.')}</td><td>{pace(r.need)}/km</td>
        {r.at.map((t, i) => <td key={i}>{clock(t)} <small className="muted">(+{Math.round(r.margin[i])}′)</small></td>)}</tr>)}</tbody>
    </table></div>
    <p className="muted">Slowest average pace that still clears every point: <b>{pace(tight.need)}/km</b> (tightest at {tight.name}). Finish cut-off {JRF.cutoffMin / 60} hours after the gun ({JRF.gun.replace(':', '.')} → 09.00 WIB); finishing later = DNF with no medal/jersey.</p>
    <p className="banner" role="note">COPs are measured by clock time (time of day), not chip time. If you cross the start line a few minutes after the gun, the margin (+minutes) in the table shrinks by that much. The runners' gate closes exactly at {JRF.gun.replace(':', '.')} WIB — late = DNS.</p>
    <Evidence>[calc] Max average pace = (closing time − {JRF.gun.replace(':', '.')}) ÷ km. Arrival time = constant average pace (sub-4 5:41/km; 4:30 ≈ {pace(runs[1][1])}/km). COPs are from the 2026 edition; the 2027 route is the same but COP times may change — update when the organiser publishes.</Evidence>
  </Card>
}

const PRESETS = [['Even 5:41, cool day', { run: 341, walk: 600, runM: 60, walkS: 0, wbgt: 10 }], ['Run-walk 4:1, warm', { run: 320, walk: 600, runM: 4, walkS: 60, wbgt: 22 }], ['Hot day, even', { run: 341, walk: 600, runM: 60, walkS: 0, wbgt: 29 }]]
// Thermal (WBGT) and run-walk what-if simulator for the A-race. A calculator, not a prediction: the heat penalty is a rough interpolation of Ely 2007.
function PacingSim() {
  const [v, setV] = useState(PRESETS[0][1]), s = simulate({ runPace: v.run, walkPace: v.walk, runS: v.runM * 60, walkS: v.walkS, wbgt: v.wbgt, gunMin: tod(JRF.gun), cops: JRF.cops })
  const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`
  const set = (k) => (e) => setV({ ...v, [k]: +e.target.value })
  const Slider = ({ k, label, min, max, step = 1, show }) => <label className="fld"><span>{label}: <b>{show(v[k])}</b></span><input type="range" min={min} max={max} step={step} value={v[k]} onChange={set(k)} aria-label={label} /></label>
  return <Card title="Pacing simulator · heat & run-walk" right={<Chip>MODEL</Chip>}>
    <div className="chiprow" role="group" aria-label="Presets">{PRESETS.map(([n, p]) => <button key={n} aria-pressed={JSON.stringify(v) === JSON.stringify(p)} onClick={() => setV(p)}>{n}</button>)}</div>
    <Slider k="wbgt" label="Race-day WBGT (°C)" min={0} max={34} show={(x) => `${x} °C (+${(heatPenalty(x) * 100).toFixed(1)}% slower)`} />
    <Slider k="run" label="Running pace (/km)" min={290} max={420} show={(x) => mmss(x)} />
    <Slider k="runM" label="Run segment (minutes, 60 = continuous)" min={1} max={60} show={(x) => (x >= 60 ? 'continuous' : x + ' min')} />
    {v.runM < 60 && <><Slider k="walkS" label="Walk segment (seconds)" min={0} max={180} step={5} show={(x) => x + ' s'} /><Slider k="walk" label="Walking pace (/km)" min={480} max={900} step={10} show={(x) => mmss(x)} /></>}
    {s && <>
      <div className="score-grid two" role="group" aria-label="Simulation result"><div><small>Finish time</small><b>{fmtHMS(s.finish)}</b><em>{s.vsGoalS <= 0 ? `${Math.abs(Math.round(s.vsGoalS / 60))} min under 4:00` : `${Math.round(s.vsGoalS / 60)} min over 4:00`}</em></div><div><small>Average pace</small><b>{mmss(s.pace)}</b><em>/km incl. heat{v.runM < 60 && v.walkS ? ' and walking' : ''}</em></div></div>
      <div className="scroll" tabIndex={0} role="region" aria-label="Simulated COP margins (scroll)"><table className="zm"><thead><tr><th>Point</th><th>KM</th><th>Closes</th><th>Arrive</th><th>Margin</th></tr></thead>
        <tbody>{s.points.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.km}</td><td>{p.closes.replace(':', '.')}</td><td>{clock(p.arrivesMin)}</td><td className={p.marginMin < 0 ? 'cmp-bad' : p.marginMin < 15 ? '' : 'cmp-good'}>{p.marginMin >= 0 ? '+' : ''}{p.marginMin}′</td></tr>)}</tbody></table></div>
      <p className={s.allClear ? 'muted' : 'banner'}>{s.allClear ? 'Clears every cut-off in this scenario.' : 'This scenario misses at least one cut-off.'}</p></>}
    <Evidence>[MODEL] Heat penalty = 0.25% per °C WBGT above 8 °C (cap 8%), a rough interpolation of the Ely 2007 range (PMID 17473775: ~+4.5% for slower runners between 5 and 25 °C). Run-walk pace = cycle time ÷ cycle distance. Walking breaks and heat are what-ifs, not validated predictions for you. COPs are the 2026 edition.</Evidence>
  </Card>
}

// Confirmed registrations, keyed by race date. Lives in the synced store (server KV), not in the repo: holds order IDs etc.
function Registration({ date, r, setBib, go }) {
  const T = today()
  return <Card title={r.event} right={<Chip tone="green">registered ✓</Chip>}>
    <p className="muted">{fmtLong(date)} · {diffDays(date, T) > 0 ? diffDays(date, T) + ' days away' : 'past'}{r.eventDates ? ` · event ${r.eventDates}` : ''}</p>
    <dl className="kv">
      <div><dt>Distance</dt><dd>{r.distance}{r.category ? ` · ${r.category}` : ''}</dd></div>
      {r.start && <div><dt>Route</dt><dd>{r.start} → {r.finish}</dd></div>}
      <div><dt>Name on BIB</dt><dd>{r.nameOnBib || '—'}</dd></div>
      <div><dt>Jersey</dt><dd>{r.jersey || '—'}</dd></div>
      <div><dt>Order ID</dt><dd>{r.orderId || '—'}</dd></div>
    </dl>
    <label className="fld"><span>BIB number</span><input inputMode="numeric" placeholder="not issued yet" value={r.bib || ''} onChange={(e) => setBib(e.target.value.slice(0, 12))} /></label>
    {r.plan && <p className="muted">{r.plan}</p>}
    <button className="btn sm full" onClick={() => go('calendar', date)}>View in calendar</button>
  </Card>
}

const C_RULES = ['Not a VDOT test — pace and HR cap come from easy running, not from race VDOT.', 'Pain ≥ 2/10 = durability event: stop or walk, do not push through.', 'After the race: 7 easy days; first quality session only if Sleep HR ≤ 67 and HRV is normal.']
function CRace({ date, label, regs, go }) {
  const meta = RACE_BY_DATE[date], T = today(), x = BY_DATE[date], reg = regs?.[date], lead = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)).map((d) => BY_DATE[d]).filter(Boolean)
  const gate = date === '2027-06-20' ? "G-MJM (Wed 16 Jun): 20′ jog, pain 0/10, Sleep HR ≤ 67, HRV not Reduced. MJM is only run if this gate passes." : null
  return <>
    <Card className="sess k-race">
      <div className="sess-top"><Chip kind="race">{meta?.cls || 'C'}-race</Chip>{reg || meta?.reg === 'registered' ? <Chip tone="green">registered ✓</Chip> : <Chip tone="yellow">{REG_LABEL[meta?.reg] || 'not registered'}</Chip>}</div>
      <h2 className="sess-title">{label}</h2>
      <p className="muted">{fmtLong(date)}</p>
      <div className="bigkm"><b>{Math.max(0, diffDays(date, T))}</b><span>days to go</span></div>
      {meta && <p><b>{meta.target ? `Target ${meta.target}` : 'No time target'}</b>{meta.target ? '' : ' — finish before the cut-offs (COP / COT).'}{meta.reg === 'no-info' ? ' No race information yet, so the cut-off times are unknown: check the organiser site once the details are published.' : ''}</p>}
      <ul className="rules">{C_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      {gate && <p className="banner" role="note">{gate}</p>}
      <button className="btn sm full" onClick={() => go('calendar', date)}>Open the race-day Day Plan</button>
    </Card>
    <Card title="The week before the race">
      {lead.map((d) => <button key={d.date} className="rowbtn" onClick={() => go('calendar', d.date)}><span className={`kdot k-${d.kind}`} /><span><b>{d.label || KIND[d.kind].label}</b><small>{fmtLong(d.date)}{d.km ? ` · ${d.km} km` : ''}</small></span><Icon n="chev" size={18} /></button>)}
    </Card>
  </>
}

export default function Race({ vdot, results, settings, go }) {
  const [selDate, setSelDate] = useState(null)
  const [regs, setRegs] = useStore('lumpad.registrations', {})
  const T = today(), race = settings.raceDate, left = diffDays(race, T)
  const lastTT = Object.entries(results).filter(([, r]) => r?.vdot != null).map(([id, r]) => ({ id: +id, v: r.vdot, date: PLAN.find((d) => d.tags.includes('CP' + id))?.date })).filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  const anchor = lastTT ? { v: lastTT.v, date: lastTT.date, src: `CP${lastTT.id}` } : { v: 33.0, date: '2027-03-23', src: 'CP3 line (no TT yet)' }
  const best = anchor.v + RATE * months(race, anchor.date), req = 39.9
  const gap = raceTime(best * RATIO, FM) - 14400
  const races = PLAN.filter((d) => d.kind === 'race').map((d) => d.date)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays('2027-10-18', i)).map((d) => BY_DATE[d]).filter(Boolean)
  const W = useApi(`/api/activities/merged?from=${addDays(T, -60)}&to=${T}`), wx = (W.data || []).filter((a) => a.sport_class === 'run' && a.temp_c != null)
  const peak = Math.max(...WEEKS.map((w) => w.km)), taper = WEEKS.filter((w) => ['W38', 'W39', 'W40', 'W41', 'W42'].includes(w.id)).map((w) => ({ date: w.id, value: Math.round((w.km / peak) * 100), tick: w.id }))
  const kg = +settings.bodyMassKg || 75.3
  const hub = PLAN.filter((d) => d.kind === 'race' && /FM|Full/.test(d.label || '')).map((d) => ({ date: d.date, label: d.label.replace(/ · .*/, ''), a: d.date === '2027-10-24' })).sort((a, b) => a.date.localeCompare(b.date))
  const nearest = (hub.find((r) => r.date >= T) || hub.at(-1)).date, cur = selDate || nearest, isA = cur === '2027-10-24', curRace = hub.find((r) => r.date === cur)
  return <>
    <div className="racebar" role="group" aria-label="Choose a race (nearest first)">{hub.map((r) => <button key={r.date} aria-pressed={cur === r.date} onClick={() => setSelDate(r.date)}><b>{r.label}</b><small>{fmtShort(r.date)} · D-{Math.max(0, diffDays(r.date, T))}{` · ${RACE_BY_DATE[r.date]?.cls || 'C'}-race`}</small></button>)}</div>
    {!isA && <CRace date={cur} label={curRace.label} regs={regs} go={go} />}
    {isA && <>
    <Card className="sess k-race">
      <div className="sess-top"><Chip kind="race">A-race</Chip>{settings.raceConfirmed ? <Chip tone="green">date confirmed</Chip> : <Chip tone="yellow">date not official</Chip>}{regs?.['2027-10-24'] ? <Chip tone="green">registered ✓</Chip> : <Chip tone="yellow">registration not open</Chip>}</div>
      <h2 className="sess-title">JRF Full Marathon</h2>
      <p className="muted">{fmtLong(race)} · start {JRF.gun.replace(':', '.')} WIB · {JRF.place}</p>
      <div className="bigkm"><b>{left > 0 ? left : 0}</b><span>days to go</span></div>
      <dl className="pace"><div><dt>Target</dt><dd>sub-4:00 · 5:41 /km</dd></div><div><dt>Fallback (kill gate)</dt><dd>4:15 · 4:30 · finish-first</dd></div></dl>
      <p className="muted">Half marathon: {fmtLong(JRF.half)} (the day before) — in the plan it is only a bib jog ≤5 km or a DNS.</p>
      {race !== '2027-10-24' && <p className="banner" role="note">The race date was changed from the plan (24 Oct). The calendar and checkpoints still follow 24 Oct — rebuild the plan if the date really moves.</p>}
      <p className="src">Change the date in Profile › Race.</p>
    </Card>

    <Cutoffs />
    <PacingSim />

    <Card title="Marathon time projection" right={<Chip>HYPOTHESIS n=2</Chip>}>
      <dl className="kv">
        <div><dt>Required path</dt><dd>VDOT {req} → {fm(req)}</dd></div>
        <div><dt>Best-observed-rate path (0.74/mo)</dt><dd>VDOT {best.toFixed(1)} → {fm(best)}</dd></div>
        <div><dt>If you raced today</dt><dd>VDOT {vdot.v.toFixed(1)} → {fm(vdot.v)}</dd></div>
      </dl>
      <p className={gap > 0 ? 'banner' : 'muted'}>{gap > 0 ? `On the best-observed-rate path you finish ±${Math.round(gap / 60)} minutes over 4:00 — the target needs ±1.4× the rate ever observed. The app does not guarantee sub-4.` : 'On the best-observed-rate path, sub-4:00 is reached.'}</p>
      <Evidence>[calc] Starting point: {anchor.src} ({anchor.v.toFixed(1)}). Time = time for VDOT × 0.95 (realisation ratio, per the plan). The observed FM ratio of 0.59 (Jakim 2026, confounded) [HYPOTHESIS n=1] is not used here.</Evidence>
    </Card>

    <Card title="Taper (from the plan)" right={<span className="muted">% of peak week ({peak} km)</span>}>
      <BarChart data={taper} label={'Volume taper: ' + taper.map((t) => `${t.date} ${t.value}%`).join(', ')} />
      <p className="muted">{taper.map((t) => `${t.date} ${t.value}%`).join(' · ')}. Race-pace strides stay (Tue 2×1 km @MP in W42).</p>
    </Card>
    <Card title="Carb-loading 36–48 hours">
      <div className="score-grid"><div><small>Body weight</small><b>{kg}</b><em>kg (Profile)</em></div><div><small>Target / day</small><b>{Math.round(kg * 10)}–{Math.round(kg * 12)}</b><em>g carbs</em></div><div><small>When</small><b>Fri–Sat</b><em>22–23 Oct</em></div></div>
      <Evidence>ACSM / AND / DC 2016 (Thomas, Erdman & Burke; PMID 26891166): 10–12 g/kg/24 h for 36–48 h before an event &gt; 90 min. Snack &lt; 90 min before the start = low-fibre (project rule).</Evidence>
    </Card>
    <Card title="Heat & humidity">
      <p>Your morning runs in the last 60 days: <b>{wx.length ? `${Math.round(mean(wx.map((a) => a.temp_c)))}°C · RH ${Math.round(mean(wx.map((a) => a.humidity ?? NaN).filter((x) => !Number.isNaN(x))) || 0)}%` : 'weather not pulled yet'}</b>{wx.length ? ` (${wx.length} runs with weather data)` : ''}</p>
      <Evidence>Ely 2007 (PMID 17473775): marathon time slows as WBGT rises from 5 to 25 °C, more for slower runners (top runners: +1.7% → +4.5%). Jakarta conditions are probably above the study range — no extrapolated correction factor is applied. Your own heat tax has not been measured yet (open item 8): log temperature/RH at every CP.</Evidence>
    </Card>
    <Card title="Race week (W42)">
      {weekDays.map((d) => <button key={d.date} className="rowbtn" onClick={() => go('calendar', d.date)}><span className={`kdot k-${d.kind}`} /><span><b>{d.label || KIND[d.kind].label}</b><small>{fmtLong(d.date)}</small></span><b>{d.km ? d.km + ' km' : ''}</b></button>)}
      <button className="btn sm full" onClick={() => go('calendar', { view: 'cp', id: 18 })}>CP18 gate (Thu 21 Oct)</button>
    </Card>

    </>}

    {Object.entries(regs || {}).filter(([d]) => d !== race).sort(([a], [b]) => a.localeCompare(b)).map(([d, r]) => <Registration key={d} date={d} r={r} go={go} setBib={(bib) => setRegs((x) => ({ ...x, [d]: { ...x[d], bib } }))} />)}

    <Card title="Other 2027 races">
      {races.filter((d) => d !== '2027-10-24').map((d) => { const x = BY_DATE[d], reg = regs?.[d]; return <button key={d} className="rowbtn" onClick={() => go('calendar', d)}><span className="kdot k-race" /><span><b>{x.label}</b><small>{fmtLong(d)} · {diffDays(d, T) > 0 ? diffDays(d, T) + ' days away' : 'past'}</small></span>{reg || RACE_BY_DATE[d]?.reg === 'registered' ? <Chip tone="green">registered</Chip> : (x.km >= 21 ? <Chip tone="yellow">{REG_LABEL[RACE_BY_DATE[d]?.reg] || 'not registered'}</Chip> : null)}</button> })}
      <p className="muted">Jakim 13 Jun = B-race, target sub-5:00, registered. MJM 20 Jun (D) and Bormar 14 Nov (C) have no time target — finish before the cut-offs (COP / COT); no race info yet. None of them is a VDOT test. MJM is only run if the G-MJM gate (Wed 16 Jun: 20&apos; jog, pain 0/10, Sleep HR ≤67, HRV not Reduced) passes.</p>
    </Card>

    {isA && <Card title="Race-day rules"><ul className="rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ul></Card>}
  </>
}
