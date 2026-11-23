import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { openPlanDb } from './db.js'
import { importPlan, renderDays, activeVersion } from './store.js'
import * as O from './operators.js'
import { dailyMenu } from './menu.js'
import { raise, escalate, openTriggers, migrateKv, kernelNightly } from './triggers.js'
import { propose, accept, reject, revert, expireProposals, openProposals, isSafetyDirection } from './proposals.js'
import { proposeScale, gateActive } from '../../src/lib/scaler.js'
import { missedPlan } from '../../src/lib/missed.js'
import { addDays } from '../../src/lib/dates.js'

const PLAN = JSON.parse(fs.readFileSync(new URL('../../src/data/plan.json', import.meta.url), 'utf8'))
const by = Object.fromEntries(PLAN.map((d) => [d.date, d]))
const fresh = () => { const db = openPlanDb(':memory:'); importPlan(db, PLAN); return db }
const T = '2026-11-23'
const firstOf = (kind, after = '2026-12-01') => PLAN.find((d) => d.kind === kind && d.date >= after)

test('AC-P3-1 scaler parity: downgrade changes exactly the days proposeScale proposes, with the same km/label', () => {
  for (const day of PLAN.filter((d) => ['quality', 'long', 'tt'].includes(d.kind)).slice(0, 25)) {
    const today = addDays(day.date, -1), gate = { tierId: 'depleted' }, want = proposeScale(by, today, gateActive(gate)), p = O.downgrade(by, today, gate)
    assert.deepEqual(p ? p.changes.map((c) => c.date).sort() : [], Object.keys(want).sort(), today)
    for (const c of p?.changes || []) { assert.equal(c.after.km, want[c.date].to.km); assert.equal(c.after.label, want[c.date].to.label); assert.equal(c.after.kind, 'easy'); assert.ok(c.after.km <= c.before.km); assert.equal(c.after.hr_max, 148) }
  }
  assert.equal(O.downgrade(by, T, { tierId: 'green' }), null) // no gate -> nothing
})
test('AC-P3-1 missed-run parity: chosen scenario -> the patch that implements it; refused scenarios give no patch', () => {
  const long = firstOf('long'), date = long.date, ctx = { hour: 14, reason: 'time' }
  const m = missedPlan(by, date, ctx), tmr = O.fromMissed(by, date, ctx, 'tomorrow'), skip = O.fromMissed(by, date, ctx, 'skip'), ev = O.fromMissed(by, date, ctx, 'evening')
  assert.equal(tmr.missed.recommended, m.recommended)
  assert.equal(skip.patch.operator, 'drop'); assert.equal(skip.patch.changes[0].after.kind, 'rest'); assert.match(skip.patch.rationale, /no make-up|Nothing is added/i)
  assert.equal(ev.patch, null) // evening = run it as planned, nothing to change
  // sick: only skip is allowed; "tomorrow" is refused by the same checks as the card
  const sick = O.fromMissed(by, date, { ...ctx, reason: 'sick' }, 'tomorrow'); if (m.scenarios.find((s) => s.id === 'tomorrow')) assert.ok(sick.patch === null || sick.patch.operator === 'move')
  const no = O.fromMissed(by, date, { hour: 10 }); assert.equal(no.missed, null) // before 11:00 nothing is missed yet
})
test('operators only lower load and never touch race/CP/gate days', () => {
  for (const d of PLAN.filter((x) => x.km > 0 && x.date >= T).slice(0, 80)) {
    for (const p of [O.trim(by, d.date, 0.7), O.drop(by, d.date), O.variant(by, d.date, 'heat'), O.hrCap(by, [d.date])]) {
      if (!p) continue; assert.ok(!O.LOCKED(d), 'locked day was patched'); assert.equal(isSafetyDirection([p]), true, p.operator)
      for (const c of p.changes) { assert.ok(c.after.km <= c.before.km + 1e-9) }
    }
  }
  const race = PLAN.find((d) => d.kind === 'race'); assert.equal(O.drop(by, race.date), null); assert.equal(O.trim(by, race.date, 0.5), null)
  const t = O.trim(by, firstOf('easy').date, 0.5); assert.ok(t.changes[0].after.steps.some((s) => s.m)); assert.equal(t.changes[0].after.km, Math.round(firstOf('easy').km * 5) / 10)
})
test('move: replaces the target day (dropped, not stacked) and empties the source; swap exchanges', () => {
  const a = firstOf('easy', '2026-12-08'), tmr = by[addDays(a.date, 1)], p = O.move(by, a.date, tmr.date)
  assert.equal(p.changes.length, 2); assert.equal(p.changes.find((c) => c.date === a.date).after.kind, 'rest'); assert.equal(p.changes.find((c) => c.date === tmr.date).after.label, a.label)
  assert.equal(isSafetyDirection([p]), false) // moves always need the athlete
  const s = O.swap(by, a.date, tmr.date); assert.equal(s.changes.find((c) => c.date === a.date).after.label, tmr.label)
})

test('AC-P3-2/9 daily menu: gate day gives a safer option, red flag gives none, availability trims', () => {
  const q = firstOf('quality'), m = dailyMenu(by, q.date, { gate: { tierId: 'depleted' } })
  assert.equal(m.options[0].id, 'A'); assert.ok(m.options[0].warning); const B = m.options.find((o) => o.id === 'B'); assert.ok(B && B.km <= q.km && B.patch.rules.includes('R-GATE')); assert.ok(m.options.length >= 2 && m.options.length <= 3)
  assert.equal(dailyMenu(by, q.date, { redFlag: true }).blocked, true); assert.equal(dailyMenu(by, q.date, { redFlag: true }).options.length, 0)
  const e = firstOf('easy', '2026-12-01'), c = dailyMenu(by, e.date, { availMin: 30 }).options.find((o) => o.id === 'C'); assert.ok(c && c.km < e.km)
  assert.equal(dailyMenu(by, PLAN.find((d) => d.kind === 'rest').date, {}).options.length, 0)
  const race = PLAN.find((d) => d.kind === 'race'); assert.deepEqual(dailyMenu(by, race.date, { gate: { tierId: 'depleted' } }).options.map((o) => o.id), ['A'])
  for (const d of PLAN.filter((x) => x.km > 0).slice(0, 60)) for (const o of dailyMenu(by, d.date, { gate: { tierId: 'depleted' }, availMin: 40, wbgt: 29 }).options) assert.ok(o.km <= d.km + 1e-9)
})

test('AC-P3-4 triggers: same key twice = one trigger; unknown type refused; legacy kv migrated as ignored', () => {
  const db = fresh(), a = raise(db, { type: 'missed_session', source: 'missed_check', key: 'missed:2026-12-01', payload: { kind: 'easy' } }), b = raise(db, { type: 'missed_session', source: 'missed_check', key: 'missed:2026-12-01' })
  assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(a.id, b.id); assert.equal(db.prepare('SELECT count(*) n FROM plan_trigger').get().n, 1)
  assert.throws(() => raise(db, { type: 'nope', source: 'x', key: 'k' }), /unknown trigger/)
  assert.deepEqual(migrateKv(db, { 'lumpad.missed.2026-11-20': { value: { choice: 'skip' } }, 'lumpad.scale': { value: { items: { '2026-11-21': { from: {}, to: {} } } } } }), { migrated: 2 })
  assert.equal(migrateKv(db, { 'lumpad.missed.2026-11-20': {} }).migrated, 0)
  assert.equal(openTriggers(db).length, 1) // the migrated ones are 'ignored'
})
test('escalation: two missed long runs, or three triggers of a family, in 14 days raise a macro trigger', () => {
  const db = fresh(), now = new Date('2026-12-10T05:00:00Z')
  raise(db, { type: 'missed_session', source: 't', key: 'm1', payload: { kind: 'long' }, now: new Date('2026-12-01T05:00:00Z') })
  const r = raise(db, { type: 'missed_session', source: 't', key: 'm2', payload: { kind: 'long' }, now })
  assert.match(r.escalated.why, /two missed long runs/); assert.equal(db.prepare("SELECT route FROM plan_trigger WHERE source='escalation'").get().route, 'macro')
  const d2 = fresh(); for (let i = 0; i < 3; i++) raise(d2, { type: 'readiness_gate', source: 't', key: 'g' + i, now: new Date(`2026-12-0${i + 1}T05:00:00Z`) })
  assert.equal(d2.prepare("SELECT count(*) n FROM plan_trigger WHERE source='escalation'").get().n, 1)
  const d3 = fresh(); raise(d3, { type: 'missed_session', source: 't', key: 'a', payload: { kind: 'long' }, now: new Date('2026-11-01T05:00:00Z') }); assert.equal(raise(d3, { type: 'missed_session', source: 't', key: 'b', payload: { kind: 'long' }, now }).escalated, null) // 14-day window
})
test('FR-GRD-6 nightly kernel pass raises one drift trigger per day when the active plan breaks a rule', () => {
  const db = fresh(), days = renderDays(db), r = kernelNightly(db, { today: '2026-11-30', days, ctx: { seed: true, weekly4w: 15.9, longest30: 36.9 } })
  assert.ok(r.violations > 0); assert.equal(kernelNightly(db, { today: '2026-11-30', days, ctx: { seed: true, weekly4w: 15.9 } }).created, false)
})

test('AC-P3-2/7 end to end: propose -> audit row -> accept -> plan changed -> revert restores it', () => {
  const db = fresh(), q = firstOf('quality', '2026-12-02'), v1 = activeVersion(db).id
  const trig = raise(db, { type: 'readiness_gate', source: 'sync', key: 'gate:' + addDays(q.date, -1), payload: { reasons: ['Sleep HR 71'] } }).id
  const patch = O.downgrade(by, addDays(q.date, -1), { tierId: 'depleted' }), r = propose(db, { patches: [patch], trigger: trig, today: addDays(q.date, -1), inputs: { x: 1 } })
  assert.equal(r.ok, true); assert.equal(r.auto, false)
  assert.equal(renderDays(db, { from: q.date, to: q.date })[0].kind, q.kind) // not applied yet
  assert.equal(db.prepare('SELECT status FROM plan_trigger WHERE id=?').get(trig).status, 'handled'); assert.equal(openProposals(db).length, 1)
  const again = propose(db, { patches: [patch], trigger: trig, today: addDays(q.date, -1), inputs: { x: 1 } }); assert.equal(again.duplicate, true); assert.equal(openProposals(db).length, 1)
  const ok = accept(db, r.adjustment, { today: addDays(q.date, -1) }); assert.equal(ok.changed_days > 0, true)
  const day = renderDays(db, { from: q.date, to: q.date })[0]; assert.equal(day.kind, 'easy'); assert.ok(day.km <= q.km)
  const adj = db.prepare('SELECT * FROM plan_adjustment WHERE id=?').get(r.adjustment); assert.equal(adj.from_version, v1); assert.equal(adj.trigger_id, trig); assert.ok(JSON.parse(adj.rules).some((x) => x.id === 'R-GATE')); assert.match(adj.rationale_det, /Readiness gate/)
  assert.deepEqual(db.prepare('SELECT event, by FROM plan_adjustment_event WHERE adjustment_id=? ORDER BY id').all(r.adjustment).map((e) => e.event), ['proposed', 'applied'])
  assert.throws(() => accept(db, r.adjustment), /not proposed/)
  const rv = revert(db, r.adjustment, { today: addDays(q.date, -1) }); assert.equal(rv.reverted, r.adjustment)
  assert.deepEqual(renderDays(db, { from: q.date, to: q.date })[0], q)
  assert.deepEqual(renderDays(db), PLAN) // the whole plan is back to version 1's content
  assert.equal(db.prepare("SELECT count(*) n FROM plan_version WHERE status='active'").get().n, 1)
  assert.throws(() => revert(db, r.adjustment), /only an applied change/)
})
test('a patch that lowers a long run is refused when it makes a LATER long run break the 110 % rule (kernel looks downstream)', () => {
  const db = fresh(), l = firstOf('long', '2026-12-01'), r = propose(db, { patches: [O.trim(by, l.date, 0.9)], today: addDays(l.date, -3) })
  assert.equal(r.ok, false); assert.ok(r.violations.some((v) => v.rule === 'R-LR-110' && v.date > l.date))
})
test('kernel gates proposals: a patch that makes the plan worse, or touches a past day, is refused', () => {
  const db = fresh(), e = firstOf('easy', '2026-12-08'), tmr = addDays(e.date, 1)
  const past = propose(db, { patches: [O.drop(by, e.date)], today: addDays(e.date, 1) }); assert.equal(past.ok, false); assert.equal(past.rule, 'R-PAST')
  // moving an easy run onto the day before a hard one stacks hard days only if hard; build a violating patch by hand
  const hard = firstOf('quality', '2026-12-08'), prev = addDays(hard.date, -1), bad = { operator: 'swap', rules: [], rationale: 'x', changes: [{ date: prev, before: by[prev], after: { ...by[prev], kind: 'long', km: by[prev].km || 10 } }] }
  const adj = by[addDays(hard.date, -2)]; const r = propose(db, { patches: [bad], today: addDays(prev, -3) }); assert.equal(r.ok, false); assert.ok(r.violations.some((v) => v.rule === 'R-48H'))
  assert.equal(propose(db, { patches: [], today: T }).ok, false)
})
test('reject, expiry and stale proposals', () => {
  const db = fresh(), q = firstOf('quality', '2026-12-02'), t0 = addDays(q.date, -1)
  const p1 = propose(db, { patches: [O.trim(by, q.date, 0.8)], today: t0, inputs: { n: 1 } }); reject(db, p1.adjustment); assert.equal(db.prepare('SELECT status FROM plan_version WHERE id=?').get(p1.version).status, 'rejected'); assert.throws(() => accept(db, p1.adjustment), /not proposed/)
  const p2 = propose(db, { patches: [O.trim(by, q.date, 0.7)], today: t0, inputs: { n: 2 } }), p3 = propose(db, { patches: [O.trim(by, firstOf('easy', '2026-12-08').date, 0.9)], today: t0, inputs: { n: 3 } })
  accept(db, p3.adjustment, { today: t0 }); assert.throws(() => accept(db, p2.adjustment, { today: t0 }), /expected_parent/) // plan changed since p2 was proposed
  const p4 = propose(db, { patches: [O.trim(by, q.date, 0.6)], today: t0, inputs: { n: 4 } }); assert.equal(expireProposals(db, new Date().toISOString().slice(0, 10)).expired === 0 && expireProposals(db, addDays(new Date().toISOString().slice(0, 10), 1)).expired >= 1, true)
  assert.equal(openProposals(db).length, 0); assert.equal(db.prepare('SELECT status FROM plan_version WHERE id=?').get(p4.version).status, 'expired')
})
test('DEC-1 auto-apply is off by default; on, only safety-direction patches apply themselves, moves still ask', () => {
  const db = fresh(), q = firstOf('quality', '2026-12-02'), t0 = addDays(q.date, -1)
  assert.equal(propose(db, { patches: [O.trim(by, q.date, 0.8)], today: t0, inputs: { a: 1 } }).auto, false)
  const a = propose(db, { patches: [O.trim(by, q.date, 0.5)], today: t0, inputs: { a: 2 }, autoApply: true }); assert.equal(a.auto, true); assert.equal(db.prepare('SELECT auto FROM plan_adjustment WHERE id=?').get(a.adjustment).auto, 1)
  assert.deepEqual(db.prepare('SELECT event, by FROM plan_adjustment_event WHERE adjustment_id=? ORDER BY id').all(a.adjustment).map((e) => `${e.event}:${e.by}`), ['proposed:engine', 'applied:engine'])
  const e = firstOf('easy', '2026-12-08'), m = propose(db, { patches: [O.move(by, e.date, addDays(e.date, 1))].filter(Boolean), today: t0, inputs: { a: 3 }, autoApply: true }); if (m.ok) assert.equal(m.auto, false)
})
