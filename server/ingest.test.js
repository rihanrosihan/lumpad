import test from 'node:test'
import assert from 'node:assert'
process.env.LUMPAD_DB = ':memory:'
process.env.DATA_DIR = '/tmp/lumpad-test-data'
process.env.INGEST_TOKEN = 'x'.repeat(40)
const { applyIngest, checkToken, syncStatus, healthRange, activitiesRange, lapsOf } = await import('./ingest.js')
const req = (auth, ip = '1.1.1.1') => ({ headers: { authorization: auth, 'x-forwarded-for': ip }, socket: {} })

test('health upsert is idempotent and never overwrites with null', () => {
  applyIngest({ health: [{ date: '2026-11-11', sleep_hr_avg: 64, sleep_hr_min: 41, hrv_avg: 81, hrv_status: 'Normal' }] })
  applyIngest({ health: [{ date: '2026-11-11', resting_hr: 61, sleep_hr_avg: null }] })
  const r = healthRange('2026-11-11', '2026-11-11')
  assert.equal(r.length, 1); assert.equal(r[0].sleep_hr_avg, 64); assert.equal(r[0].resting_hr, 61); assert.equal(r[0].hrv_status, 'Normal')
})
test('invalid records are rejected individually, valid ones kept', () => {
  const out = applyIngest({ health: [{ date: '2026-11-12', sleep_hr_avg: 9999 }, { date: '2026-11-13', sleep_hr_avg: 60 }, { date: 'nope' }] })
  assert.equal(out.counts.health, 1); assert.equal(out.rejected.length, 2)
  assert.equal(healthRange('2026-11-12', '2026-11-13').length, 1)
})
test('activities + laps: re-ingest replaces laps, merges fields, keeps sources separate', () => {
  const a = { source: 'coros', source_id: '123', date: '2026-11-10', distance_m: 6060, duration_s: 2693, laps: [{ distance_m: 1000, duration_s: 440 }, { distance_m: 1000, duration_s: 445 }] }
  applyIngest({ activities: [a, { source: 'strava', source_id: '9', date: '2026-11-10', distance_m: 6058, temp_c: 27 }] })
  applyIngest({ activities: [{ ...a, laps: [{ distance_m: 1000, duration_s: 450 }] }] })
  assert.equal(activitiesRange('2026-11-10', '2026-11-10').length, 2)
  assert.equal(lapsOf('coros:123').length, 1)
})
test('unknown sources / bad ids rejected; unknown fields ignored', () => {
  const out = applyIngest({ activities: [{ source: 'x', source_id: '1', date: '2026-11-10' }, { source: 'coros', source_id: 'a b', date: '2026-11-10' }], health: [{ date: '2026-11-14', evil: 'DROP TABLE', sleep_hr_avg: 61 }] })
  assert.equal(out.rejected.length, 2); assert.equal(out.counts.health, 1)
})
test('oversize batch refused', () => assert.throws(() => applyIngest({ health: Array.from({ length: 801 }, () => ({ date: '2026-11-11' })) }), /too many/))
test('token: accepts right, rejects wrong, throttles after 10 failures', () => {
  checkToken(req('Bearer ' + 'x'.repeat(40)))
  for (let i = 0; i < 10; i++) assert.throws(() => checkToken(req('Bearer nope', '2.2.2.2')), /unauthorized/)
  assert.throws(() => checkToken(req('Bearer nope', '2.2.2.2')), /too many/)
})
test('status reports last run and coverage', () => { const s = syncStatus(); assert.ok(s.lastRun); assert.ok(s.healthDays >= 2) })
