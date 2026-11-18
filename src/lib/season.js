// The season plan, 23 Nov 2026 → 31 Dec 2027, rebuilt on COROS plan A (its weekly pattern, volume and exact workout structures),
// re-timed to the real races, with the checkpoints placed inside it. Pure (no JSON import) → runs under node --test and in tools/build_season.mjs.
import { addDays, diffDays, mondayOf } from './dates.js'
import { allByDate } from './corosplan.js'
import { fromCoros, easy, recovery, timeTrial, race } from './workouts.js'
import { estimate, stepKm } from './zones.js'
import { CHECKPOINTS } from './plan.js'
import { raceTime } from './vdot.js'

export const SEASON_START = '2026-11-23', SEASON_END = '2027-12-31', A_START = '2026-11-23'
// Real races (all Sundays). A = goal race, B = registered with a time target, C / D = for the experience, finish before the cut-offs.
export const RACES = [
  { date: '2027-06-13', name: 'Jakim FM', cls: 'B', target: 'sub 5:00', pace: [412, 415], watchPlan: [17400, 17520], reg: 'registered', route: 'jakim', note: 'CP9 · official sub-5:00 (2026: 6:53:03) · watch plan 4:50–4:52 = 6:52–6:55/km · registered · not a VDOT test' },
  { date: '2027-06-20', name: 'MJM FM', cls: 'D', target: null, reg: 'no-info', note: 'D-race · no time target: finish before the cut-offs (COP / COT) · only if G-MJM passed · no race info yet' },
  { date: '2027-10-24', name: 'JRF Full', cls: 'A', target: 'sub 4:00', pace: [336, 341], reg: 'not-open', note: 'CP19 · sub-4:00 (5:36–5:41/km) · first 5 km by HR cap · date confirmed, registration not open yet' },
  { date: '2027-11-14', name: 'Bormar FM', cls: 'C', target: null, reg: 'no-info', note: 'C-race · no time target: finish before the cut-offs (COP / COT) · 3 weeks after JRF · no race info yet' },
]
export const RACE_BY_DATE = Object.fromEntries(RACES.map((r) => [r.date, r]))
export const REG_LABEL = { registered: 'registered', 'not-open': 'registration not open', 'no-info': 'no info yet' }
export const raceGoal = (r) => (r.target ? `target ${r.target}` : 'no time target — finish before COP / COT')
export const RAMADAN = ['2027-02-01', '2027-03-14'] // pre-Ramadan week + Ramadan + Eid (as in the original plan)
const BASE = [['2026-11-23', '2027-01-24'], ['2027-06-28', '2027-08-01'], ['2027-11-22', '2027-12-31']]

export const weekNo = (d) => Math.floor(diffDays(mondayOf(d), '2027-01-04') / 7) + 1 // W1 = Mon 4 Jan 2027; pre-season W-5…W0
export const mondayOfWeek = (w) => addDays('2027-01-04', (w - 1) * 7)
// Which week of COROS plan A (1–20) each season week runs. 'MJM' / 'REC' = Lumpad weeks (between the June races / after a marathon).
export function weekSource(w) {
  if (w <= 11) return w + 6           // W-5…W11  = A1–A17: base and the first high-volume block (the original dates)
  if (w <= 23) return w - 3           // W12…W23  = A9–A20: the high-volume block again, taper, Jakim
  if (w === 24) return 'MJM'          // Jakim → MJM week
  if (w === 25 || w === 43 || w === 46) return 'REC' // the week after MJM, JRF and Bormar
  if (w <= 42) return w - 22          // W26…W42  = A4–A20: rebuild, high-volume block, taper, JRF
  if (w === 44) return 19             // A19: taper-type week before Bormar
  if (w === 45) return 20             // A20: race week, Bormar
  return w - 46                       // W47…W52  = A1–A6: next season's base
}
export const SEGMENTS = [
  { from: '2026-11-23', to: '2027-03-21', what: 'Base and first high-volume block · COROS plan A weeks 1–17 (peak 96 km)', weeks: 'W-5…W11' },
  { from: '2027-03-22', to: '2027-06-13', what: 'Jakim cycle · plan A weeks 9–20 (second 74–96 km block, taper), race week = Jakim', weeks: 'W12…W23' },
  { from: '2027-06-14', to: '2027-06-27', what: 'MJM week, then a recovery week (easy only)', weeks: 'W24…W25' },
  { from: '2027-06-28', to: '2027-10-24', what: 'JRF cycle · plan A weeks 4–20 (rebuild, 74–96 km block, taper), race week = JRF', weeks: 'W26…W42' },
  { from: '2027-10-25', to: '2027-11-21', what: 'Recovery week, plan A week 19, race week = Bormar, recovery week', weeks: 'W43…W46' },
  { from: '2027-11-22', to: '2027-12-31', what: 'Next base · plan A weeks 1–6', weeks: 'W47…W52' },
]

export function phaseOf(d) {
  if (d >= RAMADAN[0] && d <= RAMADAN[1]) return 'RAMADAN'
  const next = RACES.find((r) => r.date >= d), prev = [...RACES].reverse().find((r) => r.date < d)
  const n = next ? Math.floor(diffDays(next.date, mondayOf(d)) / 7) : null // weeks until the race week
  if (n === 0) return 'RACE WEEK'
  if (prev && diffDays(d, prev.date) <= 7) return 'RECOVERY'
  if (BASE.some(([a, b]) => d >= a && d <= b)) return 'BASE'
  if (n === 1) return 'TAPER'
  if (n >= 2 && n <= 5) return 'PEAK'
  return 'BUILD'
}

const NOTE = { easy: 'Conversational: hold the HR zone, let pace float in heat.', long: 'Fuel from 45 min (30–60 g/h), drink to thirst, sodium in heat.',
  quality: 'Hold the zone evenly; recoveries stay in zone 2.', tt: 'All-out but even; log the time on the Checkpoints page.', race: '' }
const REC_WEEK = [null, null, recovery(5), null, easy(6.5), easy(6.5), easy(10)] // Mon…Sun
const ttPace = (line, dist) => Math.round(raceTime(line - 0.5, dist) / (dist / 1000)) // green line

// rows: classified COROS snapshot rows. orig: the original Lumpad 2027 days (MJM week, personal events).
export function buildSeason(rows, orig) {
  const by = allByDate(rows), O = Object.fromEntries(orig.map((d) => [d.date, d])), CP = Object.fromEntries(CHECKPOINTS.map((c) => [c.date, c])), out = []
  for (let t = SEASON_START; t <= SEASON_END; t = addDays(t, 1)) {
    const w = weekNo(t), i = diffDays(t, mondayOfWeek(w)), src = weekSource(w), o = O[t]
    const base = { date: t, week: 'W' + w, phase: phaseOf(t), event: o?.special && o.label ? o.label : null, tags: [] }
    let d, wk = null, from = null, coros = null
    if (src === 'MJM') {
      if (o.kind === 'race' && o.km >= 40) wk = null
      else if (/G-MJM/.test(o.label)) wk = { kind: 'easy', name: 'G-MJM gate jog 20′', steps: [{ t: 'run', m: 3000, z: 1, note: '≈20 min · gate: pain 0/10, Sleep HR ≤ 67, HRV not Reduced' }] }
      else if (o.kind === 'gym' || o.kind === 'rest') d = { ...base, km: 0, label: o.kind === 'gym' ? 'Strength · upper body (light)' : '', kind: o.kind, note: o.note, src: 'lumpad' }
      else if (/Shakeout/.test(o.label)) wk = { ...easy(3, 'Shakeout'), steps: [{ t: 'run', m: 3000, z: 1, note: 'include 4 × 20 s relaxed strides' }] }
      else wk = recovery(o.km || 5)
    } else if (src === 'REC') { const r = REC_WEEK[i]; if (r) wk = r }
    else {
      from = addDays(A_START, (src - 1) * 7 + i); const list = by[from] || []
      coros = list.find((r) => r.km) || list.find((r) => r.type === 'free') || null
      if (coros) wk = fromCoros(coros.code, coros.km || 0)
    }
    // races, checkpoints
    const R = RACE_BY_DATE[t], cp = CP[t]
    if (R) { wk = race(R.pace, R.cls === 'A' ? 'first 5 km by HR cap (≤ zone 2), then goal pace' : R.pace ? 'even pace; walk the aid stations if needed' : 'run-walk allowed; stay ahead of the cut-offs', R.pace ? 3 : 2); coros = null }
    else if (cp && (cp.kind === 'tt' || cp.kind === 'ratio')) { const dist = /HM/.test(cp.name) ? 21100 : /10K/.test(cp.name) ? 10000 : 5000; wk = timeTrial(dist, cp.line ? ttPace(cp.line, dist) : undefined); coros = null }
    if (!d) {
      if (wk) {
        const est = estimate(wk.steps), km = wk.steps.some((s) => s.t === 'free') ? 0 : stepKm(wk.steps)
        const label = R ? (R.cls === 'A' ? 'JRF Full · A-RACE' : `${R.name} · ${R.cls}-race`) : t === '2027-10-23' ? 'Pre-race shakeout' : wk.name
        d = { ...base, km, label, kind: R ? 'race' : wk.kind, note: R ? R.note : cp ? `${cp.name} · ${cp.note}` : t === '2027-10-23' ? '≤ 3 km easy, then stop — the full marathon is tomorrow (the JRF half is not run)' : /G-MJM/.test(wk.name) ? 'Gate for MJM, not a race: pain 0/10, Sleep HR ≤ 67, HRV not Reduced. Fail = MJM is skipped.' : NOTE[wk.kind] || '',
          src: coros ? 'coros' : 'lumpad', steps: wk.steps, sec: coros?.sec ?? est.sec, tl: coros?.tl ?? est.tl }
        if (coros) Object.assign(d, { from, code: coros.code })
      } else if (src === 'MJM' && o.kind === 'race') d = { ...base, km: 42.2, label: 'MJM FM · D-race', kind: 'race', note: RACE_BY_DATE['2027-06-20'].note, src: 'lumpad' }
      else d = { ...base, km: 0, label: cp?.kind === 'gate' ? cp.name : '', kind: 'rest', note: cp?.kind === 'gate' ? `${cp.note} · rest day` : 'REST DAY', src: from ? 'coros' : 'lumpad', ...(from ? { from } : {}) }
    }
    if (cp) d.tags = [...d.tags, 'CP' + cp.id]
    out.push(d)
  }
  return out
}
