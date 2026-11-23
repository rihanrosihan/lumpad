import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { evaluateReplan, applyCaps, RULE_MAP } from './replan.js'

const base = { AsOf: '2026-11-19', Prev4WeekAvgKm: 0, PlannedWeekKm: 0, Max30dLongRunKm: 0, NextWeekLongRunKm: 0, MissedLongRun: false, PainEventLast7d: false, GateActive: false, GateReason: '', RecentQualityTIZ: null, EasyRunsAboveZ214d: 0, DaysToARace: 0, PeakWeekKm: 0, Next72h: null }
const r1 = (x) => Math.round(x * 10) / 10

test('port of decision_test.go: gate + creep + low TIZ + taper all fire', () => {
  const ids = new Set(evaluateReplan({ ...base, AsOf: '2027-10-10', GateActive: true, GateReason: 'Sleep HR 71 > 67', RecentQualityTIZ: [62, 58], EasyRunsAboveZ214d: 3, DaysToARace: 14, PeakWeekKm: 70, PlannedWeekKm: 55,
    Next72h: [{ date: '2027-10-11', kind: 'quality', label: 'Tempo 10K', km: 12 }, { date: '2027-10-12', kind: 'easy', label: 'Easy 8K', km: 8 }] }).map((p) => p.rule_id))
  for (const w of ['gate_72h_downgrade', 'quality_low_compliance_stepdown', 'z2_intensity_creep', 'taper_volume_window']) assert.ok(ids.has(w), w)
})
test('port of decision_test.go: 500 random weeks never exceed +10 %, the pain freeze or the 110 % long-run cap', () => {
  let s = 42; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let i = 0; i < 500; i++) {
    const p4 = 15 + R() * 65, planned = p4 * (0.6 + R()), mlr = 10 + R() * 24, next = mlr * (0.7 + R() * 0.8), pain = R() < 0.25
    const inp = { ...base, Prev4WeekAvgKm: p4, PlannedWeekKm: planned, Max30dLongRunKm: mlr, NextWeekLongRunKm: next, MissedLongRun: R() < 0.5, PainEventLast7d: pain }
    const [w, l] = applyCaps(inp)
    assert.ok(w <= (pain ? r1(p4) : r1(p4 * 1.1)) + 0.1, `week ${i}`); assert.ok(l <= r1(mlr * 1.1) + 0.1, `long ${i}`)
  }
})
test('behaviour details that the Go code defines', () => {
  const [g] = evaluateReplan({ ...base, GateActive: true, Next72h: [{ date: 'd1', kind: 'long', label: 'L', km: 30 }, { date: 'd2', kind: 'easy', label: 'E', km: 5 }] })
  assert.equal(g.changes.length, 1); assert.equal(g.changes[0].to.km, 10); assert.equal(g.changes[0].to.hr_max, 148); assert.match(g.reason, /validated physiological\/pain gate active/)
  assert.equal(evaluateReplan({ ...base, Prev4WeekAvgKm: 40, PlannedWeekKm: 44 }).length, 0) // exactly at the cap
  assert.equal(evaluateReplan({ ...base, Prev4WeekAvgKm: 30, PlannedWeekKm: 31, PainEventLast7d: true })[0].rule_id, 'pain_progression_freeze')
  assert.equal(evaluateReplan({ ...base, RecentQualityTIZ: [90, 60] }).length, 0)
  assert.equal(evaluateReplan({ ...base, DaysToARace: 22, PeakWeekKm: 80, PlannedWeekKm: 70 }).length, 0)
})
test('every Go rule id maps to a kernel id', () => {
  const all = new Set(['gate_72h_downgrade', 'weekly_progression_cap', 'pain_progression_freeze', 'long_run_110_cap', 'quality_low_compliance_stepdown', 'z2_intensity_creep', 'taper_volume_window'])
  assert.deepEqual(new Set(Object.keys(RULE_MAP)), all)
})
test('committed parity vectors equal the port (regenerate with tools/gen_replan_vectors.mjs)', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('./vectors/replan.json', import.meta.url), 'utf8'))
  assert.ok(cases.length >= 70)
  for (const c of cases) { assert.deepEqual(JSON.parse(JSON.stringify(evaluateReplan(c.input))), c.proposals, c.name); assert.deepEqual(applyCaps(c.input), c.caps, c.name) }
  const rules = new Set(cases.flatMap((c) => c.proposals.map((p) => p.rule_id))); assert.equal(rules.size, 7, 'vectors must exercise all 7 rule ids')
})
