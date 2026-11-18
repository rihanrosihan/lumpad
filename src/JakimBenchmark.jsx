import { useMemo } from 'react'
import LOG26 from './data/races/jakim2026.json'
import { makeLog } from './lib/racelog.js'
import { benchmark, OFFICIAL_2026, GOAL_OFFICIAL, WATCH_PLAN, PLAN_MID } from './lib/benchmark.js'
import { hms, mss, FM } from './lib/courseplan.js'
import { cfgOf, hrRange } from './lib/zones.js'
import { Card, Chip } from './ui.jsx'

const sgn = (s) => (s > 0 ? '−' : '+') + hms(Math.abs(s)) // time saved (positive) shown as −h:mm:ss
const min = (s) => Math.round(s / 60)

// Jakim 2026 → 2027. compact = headline and tiles only (Races page, race-day Day Plan); full = the whole section on the Course page.
export default function JakimBenchmark({ settings, planSec = PLAN_MID, compact = false, onOpen = null }) {
  const L = useMemo(() => makeLog(LOG26), []), B = useMemo(() => benchmark(L, planSec), [L, planSec]), cfg = cfgOf(settings), z3 = hrRange(3, cfg)[1], z2 = hrRange(2, cfg)[1]
  const maxSaved = Math.max(...B.five.map((x) => x.saved), 1)
  return <Card title="2026 benchmark → 2027 target" right={<Chip tone="yellow">cut {hms(B.cut)}</Chip>} className="bench">
    <div className="bench-hd"><div><small>Jakim 2026 · official</small><b>{hms(OFFICIAL_2026)}</b><em>{mss(B.pace26)}/km · watch {hms(L.total)} · {LOG26.gpsKm.toFixed(1)} km on GPS</em></div><span aria-hidden="true">→</span>
      <div><small>Jakim 2027 · goal</small><b>sub-5:00</b><em>official under {hms(GOAL_OFFICIAL + 1)}; plan the watch for {hms(WATCH_PLAN[0])}–{hms(WATCH_PLAN[1])}</em></div></div>
    <div className="wmeta wk4"><div><small>Time to cut</small><b>{hms(B.cut)}</b><em>{Math.round((B.cut / OFFICIAL_2026) * 100)}% of 2026</em></div><div><small>Pace needed</small><b>{mss(B.pace27)}</b><em>/km (2026: {mss(B.pace26)})</em></div><div><small>Safety margin</small><b>{min(B.buffer)}</b><em>min under 5:00</em></div><div><small>Marathon VDOT</small><b>{B.vdot27.toFixed(1)}</b><em>2026: {B.vdot26.toFixed(1)}</em></div></div>
    {compact ? <>
      <p className="muted">Plan the watch for {hms(planSec)} ({mss(B.pace27)}/km): that is {min(B.cut)} minutes faster than 2026 and leaves {min(B.buffer)} minutes of margin for the start queue, aid stations and GPS reading long. Half-way target {hms(B.marks[2].t27)} against {hms(B.marks[2].t26)} in 2026.</p>
      {onOpen && <button className="btn sm full" onClick={onOpen}>Open the full benchmark: where the {Math.round(B.cut / 3600 * 10) / 10} hours come from, kilometre by kilometre</button>}
    </> : <>
      <h3>Where the time comes from</h3>
      <div className="bbars" role="img" aria-label="Minutes to save in each 5 km block against the plan">{B.five.map((x) => <div key={x.a}><i style={{ height: (x.saved / maxSaved) * 100 + '%' }} /><b>{min(x.saved)}′</b><small>{x.a}–{x.b < 42 ? x.b : '42.2'}</small></div>)}</div>
      <p className="muted">Minutes you need to take out of each 5 km block ({hms(planSec)} plan against your 2026 watch time). The first 10 km needs {min(B.five[0].saved + B.five[1].saved)} minutes; the last {min(B.five.slice(5).reduce((a, x) => a + x.saved, 0))} minutes sit after 25 km.</p>
      <div className="scroll" tabIndex={0} role="region" aria-label="Where the saving comes from"><table className="zm"><thead><tr><th>2026 kilometres</th><th>km</th><th>Time to save</th></tr></thead><tbody>{B.cls.map((c) => <tr key={c.id}><td>{c.label}</td><td>{c.km.toFixed(1)}</td><td><b>{min(c.saved)} min</b></td></tr>)}</tbody></table></div>
      <p className="muted">Every 2026 kilometre is compared with the plan pace ({mss(B.pace27)}/km). The walking and stopping kilometres are the biggest block: running them at plan pace is where most of the {Math.round(B.cut / 3600 * 10) / 10} hours is.</p>
      <h3>Benchmarks on the way</h3>
      <div className="scroll" tabIndex={0} role="region" aria-label="Clock times, 2026 against the plan"><table className="zm"><thead><tr><th>km</th><th>2026</th><th>2027 plan</th><th>Gap</th></tr></thead><tbody>{B.marks.map((m) => <tr key={m.k}><td><b>{m.k === FM ? '42.2' : m.k === 21.0975 ? 'Half' : m.k}</b></td><td>{hms(m.t26)}</td><td>{hms(m.t27)}</td><td>−{hms(m.diff)}</td></tr>)}</tbody></table></div>
      <ul className="rules">
        <li><b>Fitness vs endurance:</b> a {hms(planSec)} marathon equals VDOT {B.vdot27.toFixed(1)}, which is {Math.round((B.vdot27 / 31.7) * 100)}% of your baseline VDOT 31.7. In 2026 you realised {Math.round((B.vdot26 / 31.7) * 100)}% of it ({B.vdot26.toFixed(1)}). The gap is mostly durability (holding pace for the whole distance), not speed.</li>
        <li><b>Heart rate:</b> the first 10 km of 2026 averaged {Math.round(L.avgHr(0, 10))} bpm, {Math.round((L.avgHr(0, 10) / cfg.lthr) * 100)}% of LTHR {cfg.lthr}. Zone 2 tops out at {z2} bpm and zone 3 at {z3} bpm.</li>
        <li><b>Official against watch:</b> 2026 official {hms(OFFICIAL_2026)} against {hms(L.total)} on the watch ({Math.round(Math.abs(L.total - OFFICIAL_2026))} s apart) with {LOG26.gpsKm.toFixed(1)} km on the GPS, so a watch plan of {hms(WATCH_PLAN[0])}–{hms(WATCH_PLAN[1])} keeps the official time under 5:00 even with a long GPS track.</li>
      </ul>
    </>}
  </Card>
}
