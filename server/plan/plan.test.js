import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { openPlanDb } from './db.js'
import { importPlan, renderDays, createVersion, activate, activeVersion, sessionFromDay } from './store.js'
import { TEMPLATES, expand, fromCoros, seedCatalog, bindDose } from './catalog.js'
import { validate, repair, weekReport, weekTotals } from './kernel.js'
import { resolveBenchmarks, buildZoneSet, persist } from './benchmarks.js'
import { addDays } from '../../src/lib/dates.js'

const PLAN = JSON.parse(fs.readFileSync(new URL('../../src/data/plan.json', import.meta.url), 'utf8'))

test('AC-P0-1/2: migrations are idempotent and version 1 renders exactly plan.json', () => {
  const db = openPlanDb(':memory:'); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1)
  const r = importPlan(db, PLAN); assert.equal(r.created, true)
  assert.deepEqual(renderDays(db), PLAN)
  assert.equal(importPlan(db, PLAN).created, false) // idempotent
  assert.equal(db.prepare("SELECT count(*) n FROM plan_version WHERE status='active'").get().n, 1)
  const adj = db.prepare('SELECT * FROM plan_adjustment').all(); assert.equal(adj.length, 1); assert.equal(adj[0].loop, 'import')
})

test('AC-P0-3: audit and session rows are append-only', () => {
  const db = openPlanDb(':memory:'); importPlan(db, PLAN)
  assert.throws(() => db.exec('UPDATE plan_adjustment SET rationale_det=1'), /append-only/)
  assert.throws(() => db.exec('DELETE FROM plan_adjustment'), /append-only/)
  assert.throws(() => db.exec("UPDATE plan_session SET kind='rest'"), /immutable/)
  assert.throws(() => db.exec('DELETE FROM plan_session'), /immutable/)
})

test('FR-PLN-4/5/6: atomic activation, optimistic parent, no past-day change, no duplicate version', () => {
  const db = openPlanDb(':memory:'); importPlan(db, PLAN)
  const v1 = activeVersion(db), day = PLAN.find((d) => d.date === '2026-12-01')
  const mk = (label) => ({ ...sessionFromDay({ ...day, label, kind: 'easy' }, 'patched') })
  const a = createVersion(db, { kind: 'micro', parentId: v1.id, sessions: [mk('X')], inputs: { t: 1 } }), b = createVersion(db, { kind: 'micro', parentId: v1.id, sessions: [mk('X')], inputs: { t: 1 } })
  assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(a.id, b.id)
  assert.throws(() => activate(db, a.id, { expectedParent: 999, today: '2026-11-23' }), /expected_parent/)
  const r = activate(db, a.id, { expectedParent: v1.id, today: '2026-11-23', loop: 'micro', operators: ['downgrade'] })
  assert.equal(r.changed_days, 1); assert.equal(activeVersion(db).id, a.id)
  assert.equal(db.prepare("SELECT status FROM plan_version WHERE id=?").get(v1.id).status, 'superseded')
  assert.equal(renderDays(db, { from: '2026-12-01', to: '2026-12-01' })[0].label, 'X'); assert.equal(renderDays(db).length, PLAN.length)
  const past = createVersion(db, { kind: 'micro', parentId: a.id, sessions: [sessionFromDay({ ...PLAN[0], label: 'Y' }, 'patched')], inputs: { t: 2 } })
  assert.throws(() => activate(db, past.id, { today: '2026-12-10' }), /past day/)
  assert.equal(activeVersion(db).id, a.id) // failed activation left no half state
  assert.equal(db.prepare("SELECT status FROM plan_version WHERE id=?").get(past.id).status, 'proposed')
})

test('AC-P0-4: every template reproduces workouts.js (all COROS codes, 3-32 km in 0.5 steps)', () => {
  const codes = TEMPLATES.filter((t) => t.id.startsWith('coros.')).map((t) => t.id.slice(6))
  for (const code of codes) for (let km = 3; km <= 32; km += 0.5) {
    const want = fromCoros(code, km).steps, got = expand('coros.' + code, code === 'P10546' ? {} : { km })
    assert.deepEqual(got, want, `${code} ${km} km`)
  }
  assert.deepEqual(expand('lumpad.recovery', { km: 5 }), [{ t: 'run', m: 5000, z: 1 }])
  assert.equal(bindDose('coros.P10547', 13).n, 3)
  const db = openPlanDb(':memory:'); assert.equal(seedCatalog(db), TEMPLATES.length); assert.equal(seedCatalog(db), 0)
})

test('AC-P0-5: kernel report on version 1 (plan-only mode matches an independent count)', () => {
  const rep = weekReport(PLAN, {})
  // independent: weeks i>=4 whose km > 1.1 x mean of the previous four planned weeks
  const w = [...weekTotals(PLAN)].sort().map(([, v]) => v); let n = 0
  for (let i = 4; i < w.length; i++) if (w[i] > (w.slice(i - 4, i).reduce((a, b) => a + b, 0) / 4) * 1.1 + 0.05) n++
  assert.equal(rep.over, n); assert.equal(rep.judged, w.length - 4)
  assert.ok(validate(PLAN, {}).some((v) => v.rule === 'R-LOAD-10'))
  const seeded = weekReport(PLAN, { seed: true, weekly4w: 15.9 }); assert.ok(seeded.over > rep.over) // current actuals make the first weeks worse, not better
  assert.ok(seeded.rows[0].cap < 20) // W-5 (35.5 km) vs 15.9 actual
})

// seeded random plans
const rng = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const KINDS = ['easy', 'easy', 'easy', 'quality', 'long', 'rest', 'tt', 'race']
function randomPlan(R, weeks = 12) {
  const days = []; let t = '2026-11-23'
  for (let i = 0; i < weeks * 7; i++, t = addDays(t, 1)) { const kind = KINDS[Math.floor(R() * KINDS.length)], km = kind === 'rest' ? 0 : Math.round((3 + R() * 25) * 10) / 10; days.push({ date: t, kind, km, label: kind === 'race' ? 'R' : '', tags: [] }) }
  return days
}
test('AC-P0-6: property - repair never raises load or changes a race; leaves only block items (500 random plans)', () => {
  const R = rng(7); let blocked = 0
  for (let i = 0; i < 500; i++) {
    const days = randomPlan(R, 10), ctx = { seed: true, weekly4w: 5 + R() * 40, longest30: 5 + R() * 30 }, { days: fixed, blocks } = repair(days, ctx), by = Object.fromEntries(days.map((d) => [d.date, d])), fx = Object.fromEntries(fixed.map((d) => [d.date, d]))
    for (const f of fixed) { const o = by[f.date]; assert.ok(f.km <= o.km + 1e-9, 'km raised'); if (o.kind === 'race') { assert.equal(f.km, o.km); assert.equal(f.kind, 'race') } }
    const blockedWeeks = new Set(blocks.map((b) => b.date)); blocked += blocks.length
    for (const v of validate(fixed, ctx)) {
      if (v.rule === 'R-LOAD-10') assert.ok(blockedWeeks.has(v.date), `unrepaired load week ${v.date}`)
      else if (v.rule === 'R-48H') assert.ok(fx[addDays(v.date, 1)].kind === 'race' || fx[addDays(v.date, 1)].kind === 'tt' && /CP\d/.test(fx[addDays(v.date, 1)].label), 'only a locked day may remain in a 48 h clash')
      else if (v.rule === 'R-LR-110') assert.ok(fx[v.date].kind === 'race', 'a long run above the cap survived')
    }
  }
  assert.ok(blocked >= 0)
})
test('kernel: load cap repair converges on a simple plan', () => {
  const days = []; for (let i = 0; i < 42; i++) days.push({ date: addDays('2026-11-23', i), kind: i % 7 === 5 ? 'long' : i % 7 === 0 ? 'rest' : 'easy', km: i < 28 ? (i % 7 === 0 ? 0 : 5) : 12, label: '' })
  const ctx = { seed: true, weekly4w: 25, longest30: 10 }, before = validate(days, ctx), { days: fixed, blocks } = repair(days, ctx)
  assert.ok(before.some((v) => v.rule === 'R-LOAD-10')); assert.equal(blocks.length, 0)
  assert.equal(validate(fixed, ctx).filter((v) => v.rule === 'R-LOAD-10').length, 0)
})
test('kernel: R-PAST blocks changes to days before today', () => {
  const base = [{ date: '2026-11-22', kind: 'easy', km: 5, label: '' }], cand = [{ date: '2026-11-22', kind: 'rest', km: 0, label: '' }]
  assert.equal(validate(cand, { today: '2026-11-23', base })[0].rule, 'R-PAST')
})

test('AC-P0-8: benchmark precedence, hysteresis input, zone set is hashed and persisted once', () => {
  const today = '2026-11-23', fit = (n, v) => Array.from({ length: n }, (_, i) => ({ date: addDays(today, -i), threshold_pace_s_km: v }))
  assert.equal(resolveBenchmarks({ today, fitness: fit(2, 355) }).benchmarks.tpace_s.source, 'seed:athlete.js') // < 3 days: not trusted
  const r = resolveBenchmarks({ today, fitness: fit(5, 355) }); assert.equal(r.benchmarks.tpace_s.value, 355); assert.equal(r.benchmarks.tpace_s.source, 'coros:fitness_daily')
  assert.equal(resolveBenchmarks({ today, settings: { tpace: 350 }, fitness: fit(5, 355) }).benchmarks.tpace_s.source, 'override')
  assert.equal(resolveBenchmarks({ today, results: { 1: { vdot: 32.4 } } }).benchmarks.vdot.source, 'tt:CP1')
  assert.equal(r.benchmarks.vdot.value, 31.7); assert.equal(r.benchmarks.lthr.value, 168)
  const z = buildZoneSet(r); assert.equal(z.body.hr.length, 6); assert.equal(buildZoneSet(r).hash, z.hash)
  const db = openPlanDb(':memory:'), a = persist(db, r, { today }), b = persist(db, r, { today })
  assert.equal(a.new_zone_set, true); assert.equal(b.new_zone_set, false); assert.equal(db.prepare('SELECT count(*) n FROM zone_set WHERE active=1').get().n, 1)
  const c = persist(db, resolveBenchmarks({ today, fitness: fit(5, 349) }), { today }); assert.equal(c.new_zone_set, true); assert.deepEqual(c.changed_benchmarks.includes('tpace_s'), true)
  assert.equal(db.prepare('SELECT count(*) n FROM plan_version').get().n, 0) // a zone-set change never creates a plan version
})
