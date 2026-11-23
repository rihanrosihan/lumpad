import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { openPlanDb } from './db.js'
import { importPlan, createVersion, activate, sessionFromDay } from './store.js'
import { resolveBenchmarks, buildZoneSet } from './benchmarks.js'
import { resolveSteps, resolveDay } from './resolve.js'
import { runZoneWatch, activeZones, applyHysteresis } from './zonewatch.js'
import { describe as zdescribe, estimate } from '../../src/lib/zones.js'
import { addDays } from '../../src/lib/dates.js'

const PLAN = JSON.parse(fs.readFileSync(new URL('../../src/data/plan.json', import.meta.url), 'utf8'))
const today = '2026-11-23', fit = (n, v) => Array.from({ length: n }, (_, i) => ({ date: addDays(today, -i), threshold_pace_s_km: v }))
const flat = (st) => st.flatMap((s) => (s.steps ? s.steps : [s]))

test('AC-P2-2: resolved HR/pace for every step of every plan day equals zones.js describe() for the same benchmarks', () => {
  for (const settings of [{}, { tpace: 370, lthr: 170 }, { tpace: 340, hrEnds: [130, 148, 158, 168, 176] }]) {
    const r = resolveBenchmarks({ today, settings, fitness: fit(5, 355) }), zs = { ...buildZoneSet(r).body, version: 1 }
    for (const d of PLAN) {
      if (!d.steps) continue
      const a = flat(resolveSteps(d.steps, zs)), b = flat(zdescribe(d.steps, zs.cfg))
      assert.equal(a.length, b.length)
      a.forEach((x, i) => { assert.deepEqual(x.hr, b[i].hr, `${d.date} hr`); assert.deepEqual(x.pace, b[i].pace, `${d.date} pace`) })
      assert.deepEqual(resolveDay(d, zs).resolved.est, estimate(d.steps, zs.cfg))
    }
  }
})
test('explicit pace on a step (time trial, race) is kept, not replaced by the zone pace', () => {
  const zs = { ...buildZoneSet(resolveBenchmarks({ today })).body }
  const r = resolveSteps([{ t: 'tt', m: 5000, z: 5, pace: [340, 350] }], zs)[0]; assert.deepEqual(r.pace, [340, 350])
})
test('AC-P2-1: a sustained COROS threshold change makes ONE new zone set and a render trigger, never a plan version', () => {
  const db = openPlanDb(':memory:'); importPlan(db, PLAN); const versions = () => db.prepare('SELECT count(*) n FROM plan_version').get().n, v0 = versions()
  let r = runZoneWatch({ db, today, fitness: fit(5, 355) }); assert.equal(r.new_zone_set, true)
  r = runZoneWatch({ db, today, fitness: fit(5, 355) }); assert.equal(r.new_zone_set, false); assert.equal(r.triggers.length, 0)
  r = runZoneWatch({ db, today, fitness: fit(5, 352) }); assert.equal(r.new_zone_set, false) // 3 s/km: inside the 6 s hysteresis, kept
  assert.equal(activeZones(db).benchmarks.find((b) => b.metric === 'tpace_s').value, 355)
  r = runZoneWatch({ db, today, fitness: fit(2, 340) }); assert.equal(r.new_zone_set, false) // only 2 days: not trusted
  r = runZoneWatch({ db, today, fitness: fit(5, 347) }); assert.equal(r.new_zone_set, true); assert.deepEqual(r.triggers, [{ type: 'benchmark', route: 'render' }])
  assert.equal(db.prepare('SELECT count(*) n FROM zone_set WHERE active=1').get().n, 1); assert.equal(db.prepare("SELECT count(*) n FROM plan_trigger WHERE type='benchmark' AND route='render'").get().n, 2)
  assert.equal(versions(), v0) // no plan version created
  assert.equal(activeZones(db).zone_set.pace[3][0] < 356, true)
})
test('AC-P2-3: a TT that moves VDOT by >= 1.0 raises a held macro trigger; a smaller one does not', () => {
  const db = openPlanDb(':memory:'); importPlan(db, PLAN)
  let r = runZoneWatch({ db, today, results: { 1: { vdot: 32.4 } }, fitness: fit(5, 355) }); assert.equal(r.triggers.some((t) => t.route === 'macro'), false)
  r = runZoneWatch({ db, today, results: { 1: { vdot: 32.8 } }, fitness: fit(5, 355) }); assert.deepEqual(r.triggers.filter((t) => t.route === 'macro'), [{ type: 'goal_change', route: 'macro', why: 'dVDOT' }])
  assert.equal(db.prepare("SELECT status FROM plan_trigger WHERE route='macro'").get().status, 'new') // held, not handled (P4)
  r = runZoneWatch({ db, today, results: { 1: { vdot: 32.8 } }, fitness: fit(5, 355) }); assert.equal(r.triggers.length, 0) // idempotent
})
test('kill gate raises a macro trigger', () => {
  const db = openPlanDb(':memory:'); importPlan(db, PLAN)
  const results = { 4: { vdot: 30 }, 6: { vdot: 30 } } // CP4 and CP6: two consecutive red TTs from CP4
  const r = runZoneWatch({ db, today, results, fitness: fit(5, 355) }); assert.ok(r.triggers.some((t) => t.why === 'kill_gate'), JSON.stringify(r.triggers))
})
test('planning VDOT comes from the active version zone set when it has one', () => {
  const db = openPlanDb(':memory:'); importPlan(db, PLAN); runZoneWatch({ db, today, fitness: fit(5, 355) }) // zone_set 1 (vdot 31.7)
  const v = createVersion(db, { kind: 'micro', parentId: 1, zoneSetVersion: 1, sessions: [sessionFromDay({ ...PLAN[10], label: 'p' }, 'patched')], inputs: { x: 1 } }); activate(db, v.id, { today: '2026-11-23' })
  const r = runZoneWatch({ db, today, results: { 1: { vdot: 32.6 } }, fitness: fit(5, 355) }); assert.equal(r.triggers.some((t) => t.route === 'macro'), false) // 0.9 above 31.7
})
test('AC-P2-4: an athlete override wins, is labelled "override", and a removed override falls back to COROS', () => {
  const db = openPlanDb(':memory:'); runZoneWatch({ db, today, settings: { tpace: 370, lthr: 170 }, fitness: fit(5, 355) })
  const z = activeZones(db), t = z.benchmarks.find((b) => b.metric === 'tpace_s'); assert.equal(t.value, 370); assert.equal(t.label, 'override')
  assert.equal(z.benchmarks.find((b) => b.metric === 'hrmax').label, 'default')
  const r = runZoneWatch({ db, today, settings: {}, fitness: fit(5, 355) }); assert.equal(r.new_zone_set, true)
  const t2 = activeZones(db).benchmarks.find((b) => b.metric === 'tpace_s'); assert.equal(t2.value, 355); assert.equal(t2.label, 'measured')
})
test('lost COROS data (fewer than 3 days) keeps the stored measured threshold instead of reverting to the seed', () => {
  const db = openPlanDb(':memory:'); runZoneWatch({ db, today, fitness: fit(5, 355) })
  const r = runZoneWatch({ db, today: addDays(today, 3), fitness: [] }); assert.equal(r.new_zone_set, false); assert.equal(activeZones(db).benchmarks.find((b) => b.metric === 'tpace_s').value, 355)
})
test('hysteresis never holds an override or a first value', () => {
  const db = openPlanDb(':memory:'), res = resolveBenchmarks({ today, fitness: fit(5, 355) }); assert.equal(applyHysteresis(db, res).benchmarks.tpace_s.value, 355)
})
