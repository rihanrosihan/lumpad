import test from 'node:test'
import assert from 'node:assert'
process.env.LUMPAD_DB = ':memory:'
process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-test-data-'))
process.env.INGEST_TOKEN = 'x'.repeat(40)
const { applyIngest, checkToken, syncStatus, coverage, healthRange, activitiesRange, lapsOf } = await import('./ingest.js')
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
test('out-of-range pace is dropped, not a rejection (walks / zero-distance laps)', () => {
  const out = applyIngest({ activities: [{ source: 'coros', source_id: 'p1', date: '2026-11-10', distance_m: 0, duration_s: 60, avg_pace_s_km: 99999, laps: [{ distance_m: 0, duration_s: 30, avg_pace_s_km: 0 }, { distance_m: 1000, duration_s: 400, avg_pace_s_km: 400 }] }] })
  assert.equal(out.rejected.length, 0); assert.equal(out.counts.laps, 2)
  assert.equal(lapsOf('coros:p1')[0].avg_pace_s_km, null); assert.equal(lapsOf('coros:p1')[1].avg_pace_s_km, 400)
})

test('coverage reports per-month counts, lap coverage and health gaps (no health values)', () => {
  const c = coverage()
  assert.ok(Array.isArray(c.byMonth) && c.byMonth.every((m) => /^\d{4}-\d{2}$/.test(m.month) && m.n >= m.withLaps))
  assert.ok(c.health.days >= 2 && Array.isArray(c.health.gaps))
  assert.equal(JSON.stringify(c).includes('hrv_avg'), false)
})
