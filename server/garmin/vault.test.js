import test from 'node:test'
import assert from 'node:assert/strict'
import { datasetName, records, recKey } from './names.js'
import { fitMeta } from './fitmeta.js'
import { decide } from './vault.js'

test('dataset names drop dates, ids and the account prefix', () => {
  assert.equal(datasetName('DI_CONNECT/DI-Connect-Metrics/TrainingHistory_20240901_20241210_125622335.json'), 'Metrics/TrainingHistory')
  assert.equal(datasetName('DI_CONNECT/DI-Connect-Wellness/2024-06-13_2024-09-21_125622335_sleepData.json'), 'Wellness/sleepData')
  assert.equal(datasetName('DI_CONNECT/DI-Connect-Aggregator/UDSFile_2024-06-12_2024-09-20.json'), 'Aggregator/UDSFile')
  assert.equal(datasetName('DI_CONNECT/DI-Connect-Fitness/x.y@mail.com_301_summarizedActivities.json'), 'Fitness/summarizedActivities')
  assert.equal(datasetName('DI_CONNECT/DI-Connect-Wellness/BloodPressureFile_2025-01-01_2026-01-01.json'), 'Wellness/BloodPressureFile')
})
test('wrapper unwrapping', () => {
  assert.equal(records([{ summarizedActivitiesExport: [{ a: 1 }, { a: 2 }] }]).length, 2)
  assert.equal(records({ workoutList: [{}] }).length, 1)
  assert.equal(records([{ x: 1 }, { x: 2 }]).length, 2)
})
test('record keys: natural when known, hash otherwise, stubs never collide with data', () => {
  assert.equal(recKey('Fitness/summarizedActivities', { activityId: 5, startTimeGmt: 1768087305000 }, '{}').key, '5')
  assert.equal(recKey('Wellness/sleepData', { calendarDate: '2025-04-20', x: 1 }, '{"a":1}').key, '2025-04-20')
  assert.match(recKey('Wellness/sleepData', { retro: false }, '{"retro":false}').key, /^stub:/)
  assert.equal(recKey('Metrics/AcuteTrainingLoad', { calendarDate: 1742428800000, timestamp: 7 }, '{}').day, '2025-03-20')
  assert.match(recKey('Aggregator/HydrationLogFile', { calendarDate: '2025-04-13' }, '{"z":1}').key, /^h:/)
})
test('decisions: only DI_CONNECT is ingested', () => {
  assert.equal(decide('customer_data/customer.json').decision, 'exclude')
  assert.equal(decide('FLY_GARMIN/userLogs.csv').decision, 'exclude')
  assert.equal(decide('DI_CONNECT/DI-Connect-User/a.png').decision, 'exclude')
  assert.equal(decide('DI_CONNECT/DI-Connect-Fitness/a.json').decision, 'ingest')
})
test('fitMeta reads file_id from a synthetic FIT', () => {
  const b = Buffer.alloc(14 + 6 + 3 * 3 + 1 + 4 + 2 + 2 + 2)
  b[0] = 14; b.write('.FIT', 8, 'latin1')
  let o = 14; b[o++] = 0x40; b[o++] = 0; b[o++] = 0; b.writeUInt16LE(0, o); o += 2; b[o++] = 3
  b[o++] = 0; b[o++] = 1; b[o++] = 0; b[o++] = 1; b[o++] = 2; b[o++] = 0x84; b[o++] = 4; b[o++] = 4; b[o++] = 0x86
  b[o++] = 0; b[o++] = 4; b.writeUInt16LE(1, o); o += 2; b.writeUInt32LE(1000, o)
  const m = fitMeta(b); assert.equal(m.type, 4); assert.equal(m.manufacturer, 1); assert.equal(m.time_created_ms, Date.UTC(1989, 11, 31) + 1e6)
})

import { activityRow, udsRow, sleepRow } from './stage.js'
test('activityRow normalises units (cm, ms, m/s÷10) — values from a verified run', () => {
  const r = activityRow({ activityId: 21507286173, activityType: 'running', startTimeGmt: 1768087305000, startTimeLocal: 1768112505000, duration: 5580396.97, distance: 1026898.05, avgSpeed: 0.184, elevationGain: 2900,
    avgDoubleCadence: 127.4, avgStrideLength: 84.27, hrTimeInZone_2: 567411, hrTimeInZone_3: 1948344 })
  assert.equal(r.distance_m.toFixed(1), '10269.0'); assert.equal(r.duration_s.toFixed(0), '5580'); assert.equal(r.avg_speed_ms, 1.84)
  assert.equal(r.elev_gain_m, 29); assert.equal(r.stride_m, 0.8427); assert.equal(r.date_local, '2026-01-11'); assert.deepEqual(JSON.parse(r.hr_zone_s).slice(2, 4), [567, 1948])
})
test('sleep rows without stage data keep the window; uds picks TOTAL stress and body battery stats', () => {
  const s = sleepRow({ calendarDate: '2025-09-29', sleepStartTimestampGMT: 'a', sleepEndTimestampGMT: 'b', sleepWindowConfirmationType: 'MANUALLY_CONFIRMED' })
  assert.equal(s.total_s, null); assert.equal(s.confirmation, 'MANUALLY_CONFIRMED')
  const u = udsRow({ calendarDate: '2026-02-01', allDayStress: { aggregatorList: [{ type: 'TOTAL', averageStressLevel: 40 }] }, bodyBattery: { bodyBatteryStatList: [{ bodyBatteryStatType: 'HIGHEST', statsValue: 82 }] } })
  assert.equal(u.stress_avg, 40); assert.equal(u.bb_high, 82)
})

import { matchActivities, winnerFor } from './link.js'
test('linker: nearest one-to-one, exact-start cross-label match, cutoff decides the winner', () => {
  const g = [{ activity_id: 1, start_ms: 1e12, sport: 'running', distance_m: 5000, duration_s: 1800 }, { activity_id: 2, start_ms: 2e12, sport: 'indoor_cardio', distance_m: null, duration_s: 1200 }, { activity_id: 3, start_ms: 3e12, sport: 'walking', distance_m: 2000, duration_s: 900 }]
  const l = [{ id: 'c1', start_ms: 1e12 + 60e3, sport: 'Run', distance_m: 5003, duration_s: 1800 }, { id: 'c2', start_ms: 2e12, sport: 'Strength', distance_m: null, duration_s: 1200 }, { id: 'c3', start_ms: 3e12, sport: 'Run', distance_m: 2000, duration_s: 900 }]
  const m = matchActivities(g, l); assert.deepEqual(m.pairs.map((p) => p.g + '>' + p.l).sort(), ['1>c1', '2>c2'])
  assert.equal(m.garminOnly[0].activity_id, 3); assert.equal(m.liveOnly[0].id, 'c3')
  assert.equal(winnerFor('2025-12-31'), 'garmin'); assert.equal(winnerFor('2026-01-01'), 'live')
})

import { monthText } from './history.js'
test('monthText: deterministic template, flags Garmin-scale metrics, omits missing parts', () => {
  const t = monthText({ month: '2025-03', run_n: 5, run_km: 19.8, long_run_km: 5.6, strength_n: 1, walk_n: 2, other_n: 0, ef_n: 0, health_days: 0 })
  assert.match(t, /^Garmin history 2025-03: 5 runs, 19.8 km \(longest 5.6 km\)/); assert.doesNotMatch(t, /Steady runs|Health \(/); assert.match(t, /not comparable with COROS/)
  assert.equal(monthText({ month: '2025-03', run_n: 5, run_km: 19.8, strength_n: 1, walk_n: 2, other_n: 0, ef_n: 0, health_days: 0 }), monthText({ month: '2025-03', run_n: 5, run_km: 19.8, strength_n: 1, walk_n: 2, other_n: 0, ef_n: 0, health_days: 0 }))
})
