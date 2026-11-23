import test from 'node:test'
import assert from 'node:assert'
import { missedPlan } from './missed.js'
import { addDays } from './dates.js'

// Mon 2026-12-07 … Sun 2026-12-13
const mk = (rows) => Object.fromEntries(rows.map(([date, kind, km, label = kind, tags = []]) => [date, { date, kind, km, label, tags }]))
const plan = mk([['2026-12-07', 'easy', 10], ['2026-12-08', 'rest', 0], ['2026-12-09', 'easy', 8], ['2026-12-10', 'quality', 13], ['2026-12-11', 'easy', 8], ['2026-12-12', 'easy', 6.5], ['2026-12-13', 'long', 16], ['2026-12-14', 'easy', 5]])
const by = (r, id) => r.scenarios.find((s) => s.id === id)

test('not shown before the afternoon, on rest days, or on race days', () => {
  assert.equal(missedPlan(plan, '2026-12-09', { hour: 10 }), null)
  assert.equal(missedPlan(plan, '2026-12-08', { hour: 16 }), null)
  assert.equal(missedPlan({ d: 1, '2026-12-09': { date: '2026-12-09', kind: 'race', km: 10 } }, '2026-12-09', { hour: 16 }), null)
})
test('easy run before a hard day: evening is fine, moving it would replace the key session so it is refused', () => {
  const r = missedPlan(plan, '2026-12-09', { hour: 16 })
  assert.equal(by(r, 'evening').verdict, 'ok'); assert.equal(r.recommended, 'evening')
  assert.equal(by(r, 'tomorrow').verdict, 'no')
  assert.equal(by(r, 'skip').verdict, 'ok')
})
test('hard session at 18:30: evening is only an easy version; tomorrow easy day is OK but drops it', () => {
  const r = missedPlan(plan, '2026-12-10', { hour: 18, load: { tsb: -5, acwr: 1.0 } })
  const ev = by(r, 'evening'); assert.equal(ev.verdict, 'caution'); assert.match(ev.do, /Easy-effort version, 7\.8 km/)
  const tm = by(r, 'tomorrow'); assert.equal(tm.verdict, 'caution') // gap to Sunday long run is 2 days but lower-body/rest checks warn only
  assert.equal(tm.weekKm, 61.5 - 8) // tomorrow's easy 8 km is dropped, never stacked
})
test('hard session the day before another hard day is refused for both evening-stack and tomorrow', () => {
  const p2 = mk([['2026-12-12', 'quality', 10], ['2026-12-13', 'long', 16], ['2026-12-14', 'easy', 5]])
  const r = missedPlan(p2, '2026-12-12', { hour: 15 })
  assert.equal(by(r, 'evening').verdict, 'no'); assert.equal(by(r, 'tomorrow').verdict, 'no'); assert.equal(r.recommended, 'skip')
})
test('sick or pain >= 2 recommends rest only; late hour closes the evening', () => {
  const r = missedPlan(plan, '2026-12-09', { hour: 16, pain: 3 })
  assert.equal(r.recommended, 'skip'); assert.equal(by(r, 'evening').verdict, 'no'); assert.equal(by(r, 'tomorrow').verdict, 'no'); assert.ok(r.note)
  assert.equal(by(missedPlan(plan, '2026-12-11', { hour: 20 }), 'evening').verdict, 'no')
})
test('sunday move spills into next week and is flagged; tired prefers tomorrow over a hard evening', () => {
  const s = missedPlan(plan, '2026-12-13', { hour: 15 })
  assert.ok(by(s, 'tomorrow').checks.some((c) => /next week/.test(c.text) && !c.ok))
  const t = missedPlan(plan, '2026-12-10', { hour: 15, reason: 'tired' })
  assert.notEqual(t.recommended, 'evening')
})
test('chose evening but 20:00 passed with no run: evening closes, fallback is tomorrow if allowed, else skip', () => {
  const easy = missedPlan(plan, '2026-12-11', { hour: 20, chose: 'evening' }) // tomorrow easy, day after long
  assert.ok(easy.eveningFailed); assert.equal(by(easy, 'evening').verdict, 'no'); assert.match(easy.note, /Tonight is closed/)
  assert.notEqual(easy.recommended, 'evening')
  const blocked = missedPlan(plan, '2026-12-09', { hour: 20, chose: 'evening' }) // tomorrow is the hard session
  assert.equal(blocked.recommended, 'skip')
  assert.equal(missedPlan(plan, '2026-12-11', { hour: 19, chose: 'evening' }).eveningFailed, false)
})
