// The season plan = COROS workouts (volume + detailed structure) re-timed so that every cycle ends on a real race.
// Pure (no JSON import) so it runs under node --test and in tools/build_season.mjs.
import { addDays, diffDays, mondayOf } from './dates.js'
import { allByDate, labelOf, TYPE_KIND, fmtHM } from './corosplan.js'

export const SEASON_START = '2026-11-23', SEASON_END = '2027-12-31'
// Real races (all Sundays). A = goal race (sub 4:00), B = registered, target sub 5:00, C / D = for the experience, finish before the cut-offs.
export const RACES = [
  { date: '2027-06-13', name: 'Jakim FM', cls: 'B', target: 'sub 5:00', reg: 'registered', note: 'CP9 · target sub-5:00 (7:06/km) · registered · not a VDOT test' },
  { date: '2027-06-20', name: 'MJM FM', cls: 'D', target: null, reg: 'no-info', note: 'D-race · no time target: finish before the cut-offs (COP / COT) · only if G-MJM passed · no race info yet' },
  { date: '2027-10-24', name: 'JRF Full', cls: 'A', target: 'sub 4:00', reg: 'not-open', note: 'CP19 · sub-4:00 attempt · date confirmed, registration not open yet' },
  { date: '2027-11-14', name: 'Bormar FM', cls: 'C', target: null, reg: 'no-info', note: 'C-race · no time target: finish before the cut-offs (COP / COT) · 3 weeks after JRF · no race info yet' },
]
export const RACE_BY_DATE = Object.fromEntries(RACES.map((r) => [r.date, r]))
export const REG_LABEL = { registered: 'registered', 'not-open': 'registration not open', 'no-info': 'no info yet' }
// Goal / status of a race: "sub 4:00" or "finish before COP/COT"
export const raceGoal = (r) => (r.target ? `target ${r.target}` : 'no time target — finish before COP / COT')
export const RAMADAN = ['2027-02-01', '2027-03-14'] // pre-Ramadan week + Ramadan + Eid (as in the original plan)
const BASE = [['2026-11-23', '2027-01-24'], ['2027-06-28', '2027-08-01'], ['2027-11-22', '2027-12-31']]

// Each segment takes whole weeks (Mon–Sun) of a COROS plan and lays them on the calendar from `from` to `to`.
// `src` = the date of the COROS schedule that lands on `from` (so weekdays are kept). recover = first week after a marathon.
export const SEGMENTS = [
  { id: 'S1', from: '2026-11-23', to: '2027-03-21', src: '2026-11-23', plan: 'A', what: 'Base and build · plan A weeks 1–17 exactly as scheduled' },
  { id: 'S2', from: '2027-03-22', to: '2027-06-13', src: '2027-01-18', plan: 'A', what: 'Jakim cycle · plan A weeks 9–20 (the high-volume block again, then its taper), moved 9 weeks later so its race day is Jakim' },
  { id: 'S3', from: '2027-06-14', to: '2027-06-20', src: null, plan: 'Lumpad', what: 'Jakim → MJM week · original Lumpad days (gate jog, shakeouts)' },
  { id: 'S4', from: '2027-06-21', to: '2027-08-01', src: '2027-09-27', plan: 'D', recover: true, what: 'Recovery then rebuild · plan D weeks 1–6, moved 14 weeks earlier' },
  { id: 'S5', from: '2027-08-02', to: '2027-10-24', src: '2027-01-18', plan: 'A', what: 'JRF cycle · plan A weeks 9–20, moved 28 weeks later so its race day is JRF' },
  { id: 'S6', from: '2027-10-25', to: '2027-11-14', src: '2027-11-29', plan: 'D', recover: true, what: 'JRF recovery then Bormar · plan D last 3 weeks, moved 5 weeks earlier' },
  { id: 'S7', from: '2027-11-15', to: '2027-11-21', src: null, plan: 'Lumpad', what: 'Post-Bormar recovery week · easy runs only' },
  { id: 'S8', from: '2027-11-22', to: '2027-12-31', src: '2026-11-23', plan: 'A', what: 'Next base · plan A weeks 1–6 again (a year on)' },
]
export const segmentOf = (d) => SEGMENTS.find((s) => d >= s.from && d <= s.to)
export const weekNo = (d) => Math.floor(diffDays(mondayOf(d), '2027-01-04') / 7) + 1 // W1 = Mon 4 Jan 2027 (as in the original plan); pre-season weeks are W-5…W0

// Phase from the real race dates, following the COROS template: race week, 1 taper week, peak (weeks 2–5 before), build before that;
// a week of recovery after every race; BASE after the season start / after the June recovery / in the next season.
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

const HAND = { 1: ['rest', 0, ''], 2: ['rest', 0, ''], 3: ['easy', 5, 'Easy run'], 4: ['rest', 0, ''], 5: ['easy', 6, 'Easy run'], 6: ['easy', 5, 'Easy run'], 0: ['easy', 8, 'Easy run'] }
const lifeEvent = (o) => (o?.special && o.label ? o.label : null)

// rows: classified COROS rows (src of the segments). orig: the original Lumpad 2027 days (races, checkpoints, personal events).
export function buildSeason(rows, orig) {
  const by = allByDate(rows), O = Object.fromEntries(orig.map((d) => [d.date, d])), out = []
  for (let t = SEASON_START; t <= SEASON_END; t = addDays(t, 1)) {
    const seg = segmentOf(t), base = { date: t, week: 'W' + weekNo(t), phase: phaseOf(t), event: lifeEvent(O[t]), tags: [] }
    let d
    const raceDay = RACES.find((r) => r.date === t)
    if (raceDay) { const o = O[t]; d = { ...base, km: 42.2, label: raceDay.cls === 'A' ? o.label : `${raceDay.name} · ${raceDay.cls}-race`, kind: 'race', tags: [...(o?.tags || [])], note: raceDay.note, src: 'lumpad' } }
    else if (t === '2027-10-23') { const o = O[t]; d = { ...base, km: o.km, label: o.label, kind: o.kind, tags: [...o.tags], note: o.note, src: 'lumpad' } }
    else if (seg.id === 'S3') { const o = O[t]; d = { ...base, km: o.km, label: o.label, kind: o.kind, tags: [...o.tags], note: o.note, src: 'lumpad' } }
    else if (seg.id === 'S7') { const [kind, km, label] = HAND[new Date(t + 'T12:00:00Z').getUTCDay()]; d = { ...base, km, label, kind, note: kind === 'rest' ? 'REST DAY' : 'Post-marathon recovery', src: 'lumpad' } }
    else {
      const s = addDays(seg.src, diffDays(t, seg.from)), list = by[s] || [], run = list.find((r) => r.km), gym = list.some((r) => r.type === 'strength'), free = list.find((r) => r.type === 'free')
      const tags = gym ? ['Strength'] : []
      if (run) { const r = run.type === 'race' ? { ...run, type: 'easy', hard: false } : run; d = { ...base, tags, km: r.km, label: labelOf(r) + ' · COROS', kind: TYPE_KIND[r.type], note: `COROS · ${fmtHM(r.sec)}${r.tl ? ' · ' + r.tl + ' TL' : ''}`, src: 'coros', from: s } }
      else if (free) d = { ...base, tags, km: 0, label: 'Free run · COROS', kind: 'easy', note: 'COROS free-mode run — no distance target', src: 'coros', from: s }
      else if (gym) d = { ...base, tags, km: 0, label: 'Strength / cross-training · COROS', kind: 'gym', note: `COROS · ${fmtHM(list.find((r) => r.type === 'strength').sec)}`, src: 'coros', from: s }
      else d = { ...base, km: 0, label: '', kind: 'rest', note: 'REST DAY', src: 'coros', from: s }
      // first week after a marathon: two rest days, then short easy runs only
      if (seg.recover && diffDays(t, seg.from) < 7) {
        const i = diffDays(t, seg.from)
        if (i < 2) d = { ...base, km: 0, label: '', kind: 'rest', tags: [], note: 'REST DAY · after the marathon', src: 'lumpad' }
        else if (d.km > 0) d = { ...d, km: Math.min(d.km, 8), kind: 'easy', label: 'Easy run · recovery week', note: 'COROS week capped for recovery (≤ 8 km, no quality or long run)' }
      }
    }
    for (const tg of O[t]?.tags || []) if (/^CP\d+$/.test(tg) && !d.tags.includes(tg)) d.tags = [...d.tags, tg]
    out.push(d)
  }
  return out
}
