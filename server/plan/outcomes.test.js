import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { openPlanDb } from './db.js'
import { importPlan, renderDays } from './store.js'
import { evaluateOutcome, observe, evaluateOutcomes, outcomeMemory, digest } from './outcomes.js'
import { runShadow, shadowReport } from './shadow.js'
import * as O from './operators.js'
import { propose, accept } from './proposals.js'
import { addDays } from '../../src/lib/dates.js'

const PLAN = JSON.parse(fs.readFileSync(new URL('../../src/data/plan.json', import.meta.url), 'utf8')), by = Object.fromEntries(PLAN.map((d) => [d.date, d]))
const fresh = () => { const db = openPlanDb(':memory:'); importPlan(db, PLAN); return db }
const NOW = new Date().toISOString().slice(0, 10), q = PLAN.find((d) => d.kind === 'quality' && d.date >= addDays(NOW, 3))   // adjustments are created 'now', so the session sits 3+ days ahead and is evaluated the day after it

test('evaluateOutcome matches ledger.go: harm beats help, thresholds, unknown vs neutral', () => {
  assert.deepEqual(evaluateOutcome({}, { executed: false }), ['unknown', { executed: false }])
  assert.equal(evaluateOutcome({}, { executed: true, painMax: 0 })[0], 'helped'); assert.equal(evaluateOutcome({}, { executed: true, painMax: 3 })[0], 'harmed')
  assert.equal(evaluateOutcome({}, { executed: true, painMax: 3, compliance: 90 })[0], 'harmed')   // any harm wins
  assert.equal(evaluateOutcome({}, { executed: true, compliance: 60 })[0], 'neutral'); assert.equal(evaluateOutcome({}, { executed: true, compliance: 40 })[0], 'harmed'); assert.equal(evaluateOutcome({}, { executed: true, compliance: 80 })[0], 'helped')
  assert.equal(evaluateOutcome({}, { executed: true, hr800Delta: 1 })[0], 'helped'); assert.equal(evaluateOutcome({}, { executed: true, hr800Delta: 6 })[0], 'harmed'); assert.equal(evaluateOutcome({}, { executed: true })[0], 'unknown')
  assert.equal(evaluateOutcome({ easy_avg_hr_max: 148 }, { executed: true, avgHR: 140 })[0], 'helped'); assert.equal(evaluateOutcome({ easy_avg_hr_max: 148 }, { executed: true, avgHR: 155 })[0], 'harmed'); assert.equal(evaluateOutcome({ easy_avg_hr_max: 148 }, { executed: true, painMax: 1, avgHR: 140 })[1].avg_hr, 140)
})
test('observe: not executed until the scope has passed; pain up to 3 days after; compliance against the NEW plan', () => {
  const adj = { diff: [{ date: '2026-12-10', after: { km: 6 } }] }
  assert.deepEqual(observe(adj, { today: '2026-12-10' }), { executed: false })
  const o = observe(adj, { today: '2026-12-20', runs: { '2026-12-10': [{ km: 6, avgHR: 138 }] }, pain: { '2026-12-12': 0, '2026-12-13': 2, '2026-12-14': 5 } })
  assert.equal(o.executed, true); assert.equal(o.painMax, 2); assert.equal(o.avgHR, 138); assert.ok(o.compliance >= 79)   // the day-14 pain is outside the 3-day window
  assert.equal(observe({ diff: [{ date: '2026-12-10', after: { km: 6 } }] }, { today: '2026-12-20', runs: {} }).compliance, 0)   // planned, not run
})
test('evaluateOutcomes: only applied, not reverted, 3-14 days old, once; memory only proposed as a hypothesis candidate and only when enabled', { skip: !q && 'needs a planned quality session 3+ days ahead (the plan ends 2027-12-31)' }, () => {
  const db = fresh(), t0 = q.date; let r = propose(db, { patches: [O.trim(by, q.date, 0.7)], today: addDays(q.date, -1), inputs: {} }); accept(db, r.adjustment, { today: addDays(q.date, -1) })
  const mem = []
  const today = addDays(q.date, 1), loadObs = () => ({ runs: { [q.date]: [{ km: 8, avgHR: 140 }] }, pain: { [q.date]: 0 } })
  const first = evaluateOutcomes(db, { today, loadObs, addMemory: (m) => mem.push(m), env: {} }); assert.equal(first.length, 1); assert.equal(first[0].verdict, 'helped'); assert.equal(mem.length, 0)   // memory off
  assert.deepEqual(evaluateOutcomes(db, { today, loadObs }), [])   // once
  assert.equal(db.prepare("SELECT event FROM plan_adjustment_event WHERE adjustment_id=? ORDER BY id DESC LIMIT 1").get(r.adjustment).event, 'evaluated')
  const db2 = fresh(); const r2 = propose(db2, { patches: [O.trim(by, q.date, 0.7)], today: addDays(q.date, -1), inputs: {} }); accept(db2, r2.adjustment, { today: addDays(q.date, -1) })
  evaluateOutcomes(db2, { today, loadObs: () => ({ runs: {}, pain: { [q.date]: 3 } }), addMemory: (m) => mem.push(m), env: { PLAN_OUTCOME_MEMORY: '1' } })
  assert.equal(mem.length, 1); assert.equal(mem[0].evidence_tag, 'HYPOTHESIS'); assert.equal(mem[0].status, 'candidate'); assert.match(mem[0].title, /harmed/); assert.match(mem[0].body, /One observation, not a rule/)
  const db3 = fresh(); const r3 = propose(db3, { patches: [O.trim(by, q.date, 0.7)], today: addDays(q.date, -1), inputs: {} }); // never accepted -> not evaluated
  assert.deepEqual(evaluateOutcomes(db3, { today, loadObs }), [])
  const d = digest(db, addDays(NOW, -1), addDays(NOW, 1)); assert.equal(d.changes, 1); assert.equal(d.verdicts.helped, 1); assert.equal(d.applied, 1)
  assert.ok(outcomeMemory({ id: 1, operators: '["trim"]', scope_from: '2026-12-10', rationale_det: 'x' }, 'helped', { compliance_pct: 90 }).body.includes('followed 90 %'))
})
test('shadow: logs a would-propose proposal on a gate day, never applies, one per day, kernel drift trigger, report lines up with what was run', { skip: !q && 'needs a planned quality session 3+ days ahead' }, () => {
  const db = fresh(), today = q.date, twin = { readiness: { tier: 'depleted', caps: [] }, load: { weekly_km_4w: 15.9, longest_run_km_30d: 36.9, km_vs_4wk_avg_pct: 5 } }, before = renderDays(db)
  const a = runShadow(db, { today, twinState: twin }); assert.ok(a.gate.proposed, JSON.stringify(a.gate)); assert.ok(a.kernel.violations > 0)
  assert.deepEqual(renderDays(db), before)   // nothing applied
  const b = runShadow(db, { today, twinState: twin }); assert.equal(b.gate.duplicate, true); assert.equal(db.prepare("SELECT COUNT(*) n FROM plan_adjustment WHERE inputs LIKE '%shadow%'").get().n, 1)
  const rep = shadowReport(db, { [q.date]: [{ km: 13, avgHR: 165 }] }); assert.equal(rep.proposals, 1); assert.equal(rep.applied, 0); assert.equal(rep.list[0].days[0].planned.kind, 'quality'); assert.equal(rep.list[0].days[0].proposed.kind, 'easy'); assert.equal(rep.list[0].days[0].ran[0].km, 13); assert.ok(rep.kernel_drift_days >= 1)
  const clear = runShadow(fresh(), { today, twinState: { ...twin, readiness: { tier: 'prime', caps: [] } } }); assert.equal(clear.gate, null)   // no gate -> nothing to propose
  assert.equal(runShadow(fresh(), { today, twinState: null }).gate, null)   // no twin yet: no gate, no crash
})
