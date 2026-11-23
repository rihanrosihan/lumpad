import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { loadPlan, PLAN, PLAN_META } from './read.js'
import { openPlanDb } from './db.js'
import { importPlan } from './store.js'

const FILE = JSON.parse(fs.readFileSync(new URL('../../src/data/plan.json', import.meta.url), 'utf8'))

test('default source is json and identical to plan.json (no behaviour change for existing readers)', () => {
  assert.equal(PLAN_META.source, 'json'); assert.deepEqual(PLAN, FILE)
})
test('AC-P1-3: engine source serves exactly the same 404 days as the file', () => {
  const db = openPlanDb(':memory:'); importPlan(db, FILE)
  const r = loadPlan({ source: 'engine', db }); assert.equal(r.source, 'engine'); assert.equal(r.version, 1); assert.deepEqual(r.days, FILE)
  // every reader derives its by-date maps from this array, so equal arrays give equal twin/context/forecast input
  assert.deepEqual(Object.fromEntries(r.days.map((d) => [d.date, d])), Object.fromEntries(FILE.map((d) => [d.date, d])))
})
test('AC-P1-7: engine source falls back to plan.json when plan.db is empty or unreadable', () => {
  const empty = openPlanDb(':memory:'), a = loadPlan({ source: 'engine', db: empty }); assert.equal(a.source, 'json-fallback'); assert.deepEqual(a.days, FILE); assert.match(a.error, /no active plan version/)
  const b = loadPlan({ source: 'engine', db: { prepare() { throw new Error('disk I/O error') } } }); assert.equal(b.source, 'json-fallback'); assert.deepEqual(b.days, FILE)
})
