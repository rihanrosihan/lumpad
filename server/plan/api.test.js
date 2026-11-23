import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
process.env.PLAN_DB = ':memory:'
const { planDb } = await import('./db.js'), { importPlan, renderDays } = await import('./store.js'), { handlers } = await import('./api.js')
const PLAN = JSON.parse(fs.readFileSync(new URL('../../src/data/plan.json', import.meta.url), 'utf8'))
const db = planDb(); importPlan(db, PLAN)
const twin = (over = {}) => ({ state: { readiness: { tier: 'depleted', caps: [] }, load: { km_vs_4wk_avg_pct: 5, tsb: -10, acwr_uncoupled: 1, weekly_km_4w: 15.9, longest_run_km_30d: 36.9 }, ...over } })
const H = handlers({ latestTwin: () => twin() }), q = (o) => new URLSearchParams(o)
const code = async (fn) => { try { await fn(); return 200 } catch (e) { return e.status || 500 } }
const wib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const addD = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const hardDay = PLAN.find((d) => d.kind === 'quality' && d.date >= addD(wib(), 2))

test('every write handler refuses an unauthenticated caller (401) and stores nothing', async () => {
  const before = db.prepare('SELECT (SELECT count(*) FROM plan_trigger)+(SELECT count(*) FROM plan_goal)+(SELECT count(*) FROM plan_adjustment) n').get().n
  for (const [name, body] of [['accept', { adjustment_id: 1 }], ['reject', { adjustment_id: 1 }], ['revert', { adjustment_id: 1 }], ['missed', { date: wib() }], ['menuChoose', { date: wib(), option: 'B' }], ['feedback', { date: wib() }], ['goal', {}], ['seedGoals', {}], ['setAvailability', { rules: [] }], ['macro', {}], ['why', { adjustment_id: 1 }]]) assert.equal(await code(() => H[name](body, null)), 401, name)
  assert.equal(db.prepare('SELECT (SELECT count(*) FROM plan_trigger)+(SELECT count(*) FROM plan_goal)+(SELECT count(*) FROM plan_adjustment) n').get().n, before)
})
test('reads work without a user and validate their input', async () => {
  assert.deepEqual(H.proposals(), { proposals: [], triggers: [] }); assert.ok(Array.isArray(H.audit(q({}))))
  assert.equal(await code(() => H.menu(q({ date: 'bad' }))), 400)
  const m = H.menu(q({ date: hardDay.date })); assert.equal(m.options[0].id, 'A'); assert.ok(m.options.some((o) => o.id === 'B'))   // gate tier 'depleted' -> a safer option exists
})
test('menu choose: A changes nothing; B is applied in one call (the tap is the approval) and audited; repeating is harmless', async () => {
  assert.equal(await code(() => H.menuChoose({ date: hardDay.date, option: 'X' }, 'rihan')), 400); assert.equal(await code(() => H.menuChoose({ date: 'x', option: 'B' }, 'rihan')), 400)
  assert.deepEqual(H.menuChoose({ date: hardDay.date, option: 'A' }, 'rihan'), { ok: true, chosen: 'A', changed: false })
  const r = H.menuChoose({ date: hardDay.date, option: 'B' }, 'rihan'); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.changed, true)
  const day = renderDays(db, { from: hardDay.date, to: hardDay.date })[0]; assert.equal(day.kind, 'easy'); assert.ok(day.km <= hardDay.km)
  assert.deepEqual(db.prepare('SELECT event, by FROM plan_adjustment_event WHERE adjustment_id=? ORDER BY id').all(r.adjustment).map((e) => `${e.event}:${e.by}`), ['proposed:engine', 'applied:athlete'])
  assert.equal(db.prepare("SELECT type, source FROM plan_trigger WHERE type='manual'").get().source, 'athlete')
  // the day is now an easy run: option B is a different, still safer option (HR cap). Applying it layers a second change on the same day
  const r2 = H.menuChoose({ date: hardDay.date, option: 'B' }, 'rihan'); assert.equal(r2.changed, true); assert.ok(renderDays(db, { from: hardDay.date, to: hardDay.date })[0].hr_max <= 148)
  assert.equal(await code(() => H.revert({ adjustment_id: r.adjustment }, 'rihan')), 409)   // a later change touches the same day: undo the latest one first
  assert.equal(H.revert({ adjustment_id: r2.adjustment }, 'rihan').reverted, r2.adjustment)
  const u = H.revert({ adjustment_id: r.adjustment }, 'rihan'); assert.equal(u.reverted, r.adjustment); assert.equal(renderDays(db, { from: hardDay.date, to: hardDay.date })[0].kind, hardDay.kind)
  assert.deepEqual(renderDays(db), PLAN)   // everything undone: the plan is version 1 again
})
test('menu respects the red-flag input and has no options when nothing is planned', () => {
  assert.equal(H.menu(q({ date: hardDay.date, redflag: '1' })).blocked, true); assert.equal(H.menu(q({ date: PLAN.find((d) => d.kind === 'rest' && d.date > wib()).date })).options.length, 0)
})
test('goal and availability handlers validate; seed once; trigger a rebuild; macro proposal needs goals and is never applied by the handler', async () => {
  assert.equal(await code(() => H.macro({}, 'rihan')) , 200)   // returns {ok:false, reason: no goals}
  assert.equal((await H.macro({}, 'rihan')).ok, false); assert.match((await H.macro({}, 'rihan')).reason, /no goals/)
  assert.equal(H.seedGoals({}, 'rihan').seeded, 4); assert.equal(H.seedGoals({}, 'rihan').seeded, 0); assert.equal(H.goals().goals.length, 4)
  assert.equal(await code(() => H.goal({ race_date: '2027-10-24', name: 'dup', cls: 'A', distance_m: 42195 }, 'rihan')), 400)
  assert.ok(H.goal({ race_date: '2027-12-12', name: 'Test 10K', cls: 'C', distance_m: 10000 }, 'rihan').id)
  assert.equal(await code(() => H.setAvailability({ rules: [{ dow: 9, windows: [] }] }, 'rihan')), 400); assert.equal(H.setAvailability({ rules: [{ dow: 1, windows: [], pref: { rest: true } }] }, 'rihan').triggers.length, 1); assert.equal(H.availability().rules.length, 1)
  const before = renderDays(db), m = await H.macro({ guard_baseline: 'build' }, 'rihan'); assert.equal(m.ok, true, JSON.stringify(m).slice(0, 200)); assert.deepEqual(renderDays(db), before)   // a proposal, not a change
  assert.equal(H.proposals().proposals.length, 1); assert.equal(H.proposals().proposals[0].loop, 'macro')
  const ok = H.accept({ adjustment_id: m.adjustment }, 'rihan'); assert.ok(ok.changed_days > 0); assert.notDeepEqual(renderDays(db), before)
  assert.equal(await code(() => H.accept({ adjustment_id: m.adjustment }, 'rihan')), 409)
  assert.ok(H.audit(q({ limit: '5' })).length >= 2)
})
test('feedback validation and the too-hard trigger', async () => {
  assert.equal(await code(() => H.feedback({ date: wib(), rpe: 11 }, 'rihan')), 400); assert.equal(await code(() => H.feedback({ date: wib(), verdict: 'meh' }, 'rihan')), 400); assert.equal(await code(() => H.feedback({ date: 'x' }, 'rihan')), 400)
  const r = H.feedback({ date: wib(), rpe: 8, verdict: 'too_hard', text: 'x'.repeat(900) }, 'rihan'); assert.ok(r.id); assert.equal(db.prepare('SELECT length(text) n FROM session_feedback WHERE id=?').get(r.id).n, 500)
  assert.equal(db.prepare("SELECT route FROM plan_trigger WHERE type='coach_feedback'").get().route, 'micro')
})
