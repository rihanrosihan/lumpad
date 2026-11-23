// Writes server/plan/vectors/replan.json: inputs (Go field names) + expected output of the JS port. The Go test replan_vectors_test.go reads the same file.
// Cases: the scenarios of decision_test.go, hand-picked edges (exact caps, ties avoided in text), and 60 seeded random weeks.
import fs from 'node:fs'
import { evaluateReplan, applyCaps } from '../server/plan/replan.js'
let s = 42; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const base = { AsOf: '2026-11-19', Prev4WeekAvgKm: 0, PlannedWeekKm: 0, Max30dLongRunKm: 0, NextWeekLongRunKm: 0, MissedLongRun: false, PainEventLast7d: false, GateActive: false, GateReason: '', RecentQualityTIZ: null, EasyRunsAboveZ214d: 0, DaysToARace: 0, PeakWeekKm: 0, Next72h: null }
const C = (name, o) => ({ name, input: { ...base, ...o } })
const cases = [
  C('go-test: gate + creep + low TIZ + taper', { AsOf: '2027-10-10', GateActive: true, GateReason: 'Sleep HR 71 > 67', RecentQualityTIZ: [62, 58], EasyRunsAboveZ214d: 3, DaysToARace: 14, PeakWeekKm: 70, PlannedWeekKm: 55, Next72h: [{ date: '2027-10-11', kind: 'quality', label: 'Tempo 10K', km: 12 }, { date: '2027-10-12', kind: 'easy', label: 'Easy 8K', km: 8 }] }),
  C('gate default reason, long + race downgraded, km cap 10', { GateActive: true, Next72h: [{ date: '2026-11-20', kind: 'long', label: 'Long', km: 30 }, { date: '2026-11-21', kind: 'race', label: 'R', km: 42.2, hr_max: 150 }, { date: '2026-11-22', kind: 'rest', label: '', km: 0 }] }),
  C('gate active but nothing hard in 72h', { GateActive: true, Next72h: [{ date: '2026-11-20', kind: 'easy', label: 'E', km: 5 }] }),
  C('weekly exactly at cap: no proposal', { Prev4WeekAvgKm: 40, PlannedWeekKm: 44 }),
  C('weekly just over cap (tolerance 0.05)', { Prev4WeekAvgKm: 40, PlannedWeekKm: 44.1 }),
  C('pain freeze', { Prev4WeekAvgKm: 30, PlannedWeekKm: 31, PainEventLast7d: true }),
  C('long run over 110% + missed long run', { Max30dLongRunKm: 20, NextWeekLongRunKm: 26, MissedLongRun: true }),
  C('long run within cap', { Max30dLongRunKm: 20, NextWeekLongRunKm: 22 }),
  C('TIZ one low session only', { RecentQualityTIZ: [90, 60] }),
  C('creep with no easy sessions in 72h', { EasyRunsAboveZ214d: 4, Next72h: [{ date: '2026-11-20', kind: 'quality', label: 'Q', km: 10 }] }),
  C('taper at 22 days: no rule', { DaysToARace: 22, PeakWeekKm: 80, PlannedWeekKm: 70 }),
  C('taper within window', { DaysToARace: 10, PeakWeekKm: 80, PlannedWeekKm: 48 }),
  ...Array.from({ length: 60 }, (_, i) => { const p4 = 15 + R() * 65, mlr = 10 + R() * 24; return C(`random ${i}`, { Prev4WeekAvgKm: Math.round(p4 * 10) / 10, PlannedWeekKm: Math.round(p4 * (0.6 + R()) * 10) / 10, Max30dLongRunKm: Math.round(mlr * 10) / 10, NextWeekLongRunKm: Math.round(mlr * (0.7 + R() * 0.8) * 10) / 10, MissedLongRun: R() < 0.5, PainEventLast7d: R() < 0.25, DaysToARace: R() < 0.3 ? 1 + Math.floor(R() * 25) : 0, PeakWeekKm: R() < 0.3 ? 60 + Math.floor(R() * 40) : 0 }) }),
]
for (const c of cases) { c.proposals = evaluateReplan(c.input); c.caps = applyCaps(c.input) }
fs.writeFileSync(new URL('../server/plan/vectors/replan.json', import.meta.url), JSON.stringify(cases, null, 1) + '\n'); console.log(cases.length, 'cases,', cases.reduce((a, c) => a + c.proposals.length, 0), 'proposals')
