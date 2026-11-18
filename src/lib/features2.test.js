import test from 'node:test'
import assert from 'node:assert/strict'
import { gateActive, proposeScale, effectiveDay } from './scaler.js'
import { heatPenalty, runWalkPace, simulate, fmtHMS } from './pacing.js'
import { lagged, scan, strongest, pearson } from './xcorr.js'
import { shoeEfFit, linreg } from './shoefit.js'

const plan = { '2027-03-23': { date: '2027-03-23', kind: 'tt', label: '5K Time Trial', km: 8, tags: ['CP3'] }, '2027-03-24': { date: '2027-03-24', kind: 'easy', label: 'Easy', km: 6, tags: [] },
  '2027-03-25': { date: '2027-03-25', kind: 'speed', label: 'Easy + strides', km: 8, tags: [] }, '2027-03-26': { date: '2027-03-26', kind: 'quality', label: 'Tempo', km: 10, tags: [] }, '2027-03-27': { date: '2027-03-27', kind: 'long', label: 'Long', km: 20, tags: [] } }
test('gate: tier, caps and distance spike each activate it', () => {
  assert.equal(gateActive({ tierId: 'optimal' }).active, false)
  assert.equal(gateActive({ tierId: 'compromised' }).active, true)
  assert.equal(gateActive({ tierId: 'optimal', caps: 1 }).active, true)
  assert.deepEqual(gateActive({ tierId: 'optimal', progPct: 258 }).reasons, ['Weekly distance +258% (> 30%)'])
})
test('proposeScale touches only hard, non-checkpoint days within 72 h and caps easy km at 6', () => {
  const p = proposeScale(plan, '2027-03-24', { active: true })
  assert.deepEqual(Object.keys(p), ['2027-03-25', '2027-03-26'])   // 03-24 is easy, 03-27 is outside 72 h
  assert.ok(p['2027-03-26'].to.km <= 6 && p['2027-03-26'].to.kind === 'easy')
  assert.deepEqual(proposeScale(plan, '2027-03-23', { active: true }), proposeScale(plan, '2027-03-23', { active: true }))
  assert.equal(Object.keys(proposeScale(plan, '2027-03-23', { active: true })).includes('2027-03-23'), false) // CP3 time trial is never auto-scaled
  assert.deepEqual(proposeScale(plan, '2027-03-24', { active: false }), {})
})
test('effectiveDay applies only to current/future days', () => {
  const ov = proposeScale(plan, '2027-03-24', { active: true })['2027-03-25']
  assert.equal(effectiveDay(plan['2027-03-25'], ov, '2027-03-24').kind, 'easy')
  assert.equal(effectiveDay(plan['2027-03-25'], ov, '2027-03-26').kind, 'speed')
})
test('heat penalty and run-walk pace', () => {
  assert.equal(heatPenalty(5), 0); assert.ok(Math.abs(heatPenalty(25) - 0.0425) < 1e-9); assert.equal(heatPenalty(60), 0.08)
  assert.equal(runWalkPace({ runPace: 341, runS: 600 }), 341)
  const p = runWalkPace({ runPace: 330, walkPace: 600, runS: 240, walkS: 60 }); assert.ok(p > 330 && p < 600)
  assert.equal(runWalkPace({ runPace: 330, runS: 240, walkS: 60 }), null)
})
test('simulate: continuous 5:41 finishes ≈ 3:59:48 with no heat and clears the 2026 COPs', () => {
  const cops = [['COP 1', 18, '06:10'], ['COP 2', 28, '07:20'], ['COP 3', 31.8, '07:45'], ['COP 4', 36.8, '08:20'], ['Finish', 42.195, '09:00']]
  const s = simulate({ runPace: 341, runS: 3600, wbgt: 0, cops }); assert.equal(fmtHMS(s.finish), '3:59:48'); assert.equal(s.allClear, true)
  const hot = simulate({ runPace: 341, runS: 3600, wbgt: 28, cops }); assert.ok(hot.finish > s.finish)
  const slow = simulate({ runPace: 460, runS: 3600, wbgt: 0, cops }); assert.equal(slow.allClear, false)
})
test('xcorr: recovers a planted lag and refuses tiny samples', () => {
  const x = {}, y = {}; for (let i = 0; i < 60; i++) { const d = new Date(Date.parse('2026-01-01') + i * 864e5).toISOString().slice(0, 10); x[d] = Math.sin(i / 3) }
  for (const d of Object.keys(x)) { const t = new Date(Date.parse(d) + 3 * 864e5).toISOString().slice(0, 10); y[t] = -x[d] }
  const rows = scan(x, y, 1, 7); assert.equal(strongest(rows).lag, 3); assert.ok(strongest(rows).r < -0.99)
  assert.equal(lagged({ '2026-01-01': 1 }, { '2026-01-02': 2 }, 1).r, null)
  assert.equal(pearson([1, 2], [1, 2]), null)
})
test('shoeEfFit: needs enough runs, detects a clear downward trend', () => {
  const runs = Array.from({ length: 12 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, gear_id: 'a', distance_m: 10000, ef: 1.2 - i * 0.01 + (i % 2 ? 0.002 : -0.002) }))
  const f = shoeEfFit(runs); assert.ok(f.a.slopePer100 < 0); assert.equal(f.a.flag, 'EF falls with mileage (hint)')
  assert.match(shoeEfFit(runs.slice(0, 4)).a.flag, /needs/)
  assert.equal(linreg([1, 1, 1], [1, 2, 3]), null)
})
