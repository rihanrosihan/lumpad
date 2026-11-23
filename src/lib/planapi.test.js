import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { planApiEnabled, validPlan, readCache, choosePlan, refreshPlan, CACHE_KEY } from './planapi.js'
import * as C from './calendar.js'

const PLAN = JSON.parse(fs.readFileSync(new URL('../data/plan.json', import.meta.url), 'utf8'))
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m } }
const resp = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body })

test('default: path is off and calendar.js serves the bundled plan with unchanged derived values', () => {
  assert.equal(C.PLAN_ENABLED, false); assert.equal(C.PLAN_SOURCE, 'bundled'); assert.deepEqual(C.PLAN, PLAN)
  assert.equal(C.PLAN_START, PLAN[0].date); assert.equal(C.PLAN_END, PLAN.at(-1).date); assert.equal(C.PLAN_KM, Math.round(PLAN.reduce((a, d) => a + d.km, 0)))
  assert.equal(Object.keys(C.BY_DATE).length, PLAN.length); assert.equal(C.BY_DATE['2026-11-29'].kind, 'long')
  const weeks = new Set(PLAN.map((d) => d.week)); assert.equal(C.WEEKS.length, weeks.size)
  const w = C.WEEKS.find((x) => x.id === 'W-5'); assert.equal(w.km, 35.5); assert.equal(w.days.length, 7)
  assert.deepEqual(C.PLAN_MONTHS[0], { key: '2026-11', y: 2026, m: 10 }); assert.equal(C.PLAN_MONTHS.length, 14)
})
test('flag: env, device and URL switches; anything else is off', () => {
  assert.equal(planApiEnabled({}, mem(), ''), false)
  assert.equal(planApiEnabled({ VITE_PLAN_SOURCE: 'engine' }, null, ''), true)
  const s = mem(); s.setItem('lumpad.planApi', '1'); assert.equal(planApiEnabled({}, s, ''), true)
  assert.equal(planApiEnabled({}, null, '?plan=api'), true); assert.equal(planApiEnabled({}, null, '?plan=json'), false)
  assert.equal(planApiEnabled({}, { getItem() { throw new Error('blocked') } }, ''), false) // storage blocked (private window)
})
test('validation rejects malformed plans', () => {
  assert.equal(validPlan(PLAN), true); assert.equal(validPlan(null), false); assert.equal(validPlan(PLAN.slice(0, 5)), false)
  assert.equal(validPlan([...PLAN].reverse()), false); assert.equal(validPlan(PLAN.map((d, i) => (i === 40 ? { ...d, km: '8' } : d))), false)
  assert.equal(validPlan(PLAN.map((d, i) => (i === 40 ? { ...d, date: 'x' } : d))), false)
})
test('choosePlan: cache only when enabled and valid; corrupt cache falls back to bundled', () => {
  const s = mem(); assert.equal(choosePlan(PLAN, { enabled: true, storage: s }).source, 'bundled')
  s.setItem(CACHE_KEY, JSON.stringify({ saved_at: 'x', version: 3, days: PLAN.map((d) => ({ ...d, label: d.label + '!' })) }))
  assert.equal(choosePlan(PLAN, { enabled: false, storage: s }).source, 'bundled')
  const c = choosePlan(PLAN, { enabled: true, storage: s }); assert.equal(c.source, 'cache'); assert.equal(c.version, 3)
  s.setItem(CACHE_KEY, '{not json'); assert.equal(choosePlan(PLAN, { enabled: true, storage: s }).source, 'bundled')
  s.setItem(CACHE_KEY, JSON.stringify({ days: [{ date: '2026-01-01' }] })); assert.equal(readCache(s), null)
})
test('refreshPlan: skipped when off; stores a valid server plan once; offline or invalid answers keep the old copy', async () => {
  assert.deepEqual(await refreshPlan({ enabled: false, storage: mem(), fetchFn: resp({}) }), { skipped: true })
  const s = mem(), events = []
  const a = await refreshPlan({ enabled: true, storage: s, fetchFn: resp({ source: 'engine', version: 1, days: PLAN }), onChange: (i) => events.push(i) })
  assert.deepEqual(a, { ok: true, changed: true, version: 1 }); assert.deepEqual(events, [{ version: 1, first: true }]); assert.equal(readCache(s).days.length, PLAN.length)
  const b = await refreshPlan({ enabled: true, storage: s, fetchFn: resp({ source: 'engine', version: 1, days: PLAN }), onChange: (i) => events.push(i) }); assert.equal(b.changed, false); assert.equal(events.length, 1)
  const patched = PLAN.map((d, i) => (i === 3 ? { ...d, label: 'Patched' } : d)), c = await refreshPlan({ enabled: true, storage: s, fetchFn: resp({ version: 2, days: patched }), onChange: (i) => events.push(i) })
  assert.equal(c.changed, true); assert.equal(events.at(-1).version, 2); assert.equal(readCache(s).days[3].label, 'Patched')
  const before = s.getItem(CACHE_KEY)
  for (const f of [resp({}, false), resp({ days: [{ bad: 1 }] }), async () => { throw new Error('offline') }]) { const r = await refreshPlan({ enabled: true, storage: s, fetchFn: f }); assert.equal(r.ok, false); assert.equal(s.getItem(CACHE_KEY), before) }
})
