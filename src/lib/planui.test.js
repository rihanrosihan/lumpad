import test from 'node:test'
import assert from 'node:assert'
import * as U from './planui.js'

test('weeklySeries: only weeks from the proposal start, old vs new', () => {
  const s = U.weeklySeries({ start: '2026-11-30', weeks_before: { '2026-11-23': 35.5, '2026-11-30': 60.5 }, weeks_after: { '2026-11-23': 35.5, '2026-11-30': 17.51, '2026-12-07': 17.5 } })
  assert.deepEqual(s, [{ monday: '2026-11-30', before: 60.5, after: 17.5 }, { monday: '2026-12-07', before: 0, after: 17.5 }]); assert.deepEqual(U.weeklySeries(null), [])
})
test('diffGroups: groups by week and sums the km change', () => {
  const g = U.diffGroups([{ date: '2026-12-02', before: { kind: 'easy', km: 8 }, after: { kind: 'rest', km: 0 } }, { date: '2026-12-01', before: { kind: 'easy', km: 5 }, after: { kind: 'easy', km: 4 } }, { date: '2026-12-08', before: null, after: { kind: 'easy', km: 5 } }])
  assert.deepEqual(g.map((x) => [x.monday, x.days.length, x.delta]), [['2026-11-30', 2, -9], ['2026-12-07', 1, 5]]); assert.equal(U.dayText({ kind: 'rest' }), 'Rest'); assert.equal(U.dayText({ kind: 'easy', label: 'Run', km: 5 }), 'Run · 5 km'); assert.equal(U.dayText(null), '—')
})
test('availability: API <-> form round trip, closed = 0, blank = open, validation messages', () => {
  const api = { rules: [{ dow: 1, windows: [], pref: { rest: true } }, { dow: 6, windows: [{ max_min: 150 }], pref: { long: true } }], exceptions: { '2026-12-15': [] } }
  const f = U.availabilityToForm(api); assert.equal(f.rows[0].dow, 1); assert.deepEqual(f.rows[0], { dow: 1, minutes: '0', pref: 'rest' }); assert.deepEqual(f.rows[5], { dow: 6, minutes: '150', pref: 'long' }); assert.deepEqual(f.rows[2], { dow: 3, minutes: '', pref: '' }); assert.deepEqual(f.exceptions, [{ date: '2026-12-15', minutes: '0' }])
  const out = U.availabilityToPayload(f); assert.deepEqual(out.errors, []); assert.deepEqual(out.payload.rules.find((r) => r.dow === 6), { dow: 6, windows: [{ max_min: 150 }], pref: { long: true } }); assert.deepEqual(out.payload.rules.find((r) => r.dow === 1).windows, []); assert.equal(out.payload.rules.length, 2); assert.deepEqual(out.payload.exceptions, { '2026-12-15': [] })
  const bad = U.availabilityToPayload({ rows: [{ dow: 1, minutes: '5', pref: '' }, { dow: 2, minutes: 'abc', pref: '' }], exceptions: [{ date: '', minutes: '30' }, { date: '2026-12-01', minutes: '' }] }); assert.equal(bad.errors.length, 4)
  assert.deepEqual(U.availabilityToPayload({ rows: [{ dow: 3, minutes: '', pref: 'quality' }], exceptions: [] }).payload.rules, [{ dow: 3, windows: [{ max_min: 600 }], pref: { quality: true } }])
})
test('goals: form <-> payload, target hours to seconds, parameters only when set', () => {
  const g = { id: 3, race_date: '2027-10-24', name: 'JRF Full', cls: 'A', distance_m: 42195, target_s: 14400, params: { peak_cap_km: 60, guard_baseline: 'build' }, status: 'active' }
  const f = U.goalToForm(g); assert.equal(f.target_h, '4'); assert.equal(f.distance_km, '42.2'); const o = U.goalToPayload(f); assert.deepEqual(o.errors, []); assert.equal(o.payload.target_s, 14400); assert.deepEqual(o.payload.params, { peak_cap_km: 60, guard_baseline: 'build' }); assert.equal(o.payload.id, 3)
  assert.equal(U.goalToPayload({ ...U.blankGoal(), race_date: '2027-12-12', name: 'X' }).payload.target_s, null)
  assert.equal(U.goalToPayload(U.blankGoal()).errors.length, 2); assert.equal(U.goalToPayload({ ...U.blankGoal(), race_date: '2027-12-12', name: 'X', target_h: '99' }).errors.length, 1)
  assert.equal(U.fmtTarget(14400), 'sub 4:00'); assert.equal(U.fmtTarget(null), 'finish'); assert.equal(U.fmtDist(42195), 'Marathon'); assert.equal(U.fmtDist(10000), '10 km')
  assert.equal(U.proposalKind({ loop: 'macro' }), 'Season plan'); assert.equal(U.proposalKind({ loop: 'micro', operators: ['downgrade'] }), 'downgrade')
})
