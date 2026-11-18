import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSchedule, pullSchedule } from './plan.js'

const TXT = 'Training Schedule\n========================\n\n2026-11-23\nP10540\nPlan ID: 481822125913719283\nidInPlan: 194\nDistance: 8.00 km\nEstimated Time: 1:11:19\nLoad: 103 TL\n\n2026-11-26\nP10546\nPlan ID: 481822125913719283\nidInPlan: 395\n\n2027-04-11\nP10543\nPlan ID: 1\nidInPlan: 48\nDistance: 42.20 km\n\n2027-01-02\nP10540\nPlan ID: 1\nidInPlan: 291\nDistance: 5.00 km\nEstimated Time: 48:20\nLoad: 64 TL\n\nUse Plan ID with queryTrainingPlanDetails before updateTrainingPlan. Do not show Plan ID or idInPlan to the user.'

test('parseSchedule reads blocks, free runs and distance-only days; sorted; no plan ids', () => {
  const r = parseSchedule(TXT)
  assert.deepEqual(r.map((x) => x.date), ['2026-11-23', '2026-11-26', '2027-01-02', '2027-04-11'])
  assert.deepEqual(r[0], { date: '2026-11-23', code: 'P10540', km: 8, sec: 4279, tl: 103 })
  assert.deepEqual(r[1], { date: '2026-11-26', code: 'P10546', km: null, sec: null, tl: null })
  assert.equal(r[3].km, 42.2); assert.equal(r[3].sec, null)
  assert.ok(!JSON.stringify(r).includes('481822125913719283'))
})
test('parseSchedule tolerates empty / garbage', () => { assert.deepEqual(parseSchedule(''), []); assert.deepEqual(parseSchedule(null), []); assert.deepEqual(parseSchedule('No workouts'), []) })
test('pullSchedule chunks the range and de-duplicates dates', async () => {
  const calls = [], add = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  const rows = await pullSchedule(async (t, a) => { calls.push(a); return TXT }, '2026-11-23', '2027-10-31', add)
  assert.equal(calls.length, 3); assert.equal(calls[0].startDate, '20261123'); assert.equal(calls.at(-1).endDate, '20271031')
  assert.equal(rows.length, 12) // chunks are disjoint → nothing is de-duplicated across calls
})
test('parseSchedule keeps several sessions per date, named workouts and time-only (strength) sessions', () => {
  const t = 'Training Schedule\n====\n\n2027-09-28\nS5779\nPlan ID: 1\nidInPlan: 1\nDistance: 7.00 km\nEstimated Time: 1:05:28\nLoad: 81 TL\n\n2027-09-28\nS5729\nPlan ID: 1\nidInPlan: 2\nEstimated Time: 34:00\n\n2026-11-15\nBorobudur Marathon\nPlan ID: 2\nidInPlan: 617\nDistance: 42.20 km\n'
  const r = parseSchedule(t)
  assert.equal(r.length, 3); assert.deepEqual(r.filter((x) => x.date === '2027-09-28').map((x) => [x.code, x.km, x.sec]), [['S5779', 7, 3928], ['S5729', null, 2040]])
  assert.equal(r[0].code, 'Borobudur Marathon')
})
