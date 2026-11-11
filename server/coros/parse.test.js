import test from 'node:test'
import assert from 'node:assert'
import { parseDailyHealth, parseSleepHrv, parseResting, parseSportRecords, parseLaps } from './parse.js'

// synthetic fixtures in the exact real format (numbers are made up)
const DAILY = `Daily Health Data — Last 3 days | Resting HR: 60 bpm | HRV Baseline: 42 ms
Note: sleep entries are dated by their wake-up day.

--- 20270105 ---
Steps: 1,234 | Calories: 37 kcal | Exercise: 0 min
Stress: Avg 30
Sleep Summary:
  Total: 6h 33min | Deep: 27 min | Light: 2h 58min | REM: 52 min | Awake: 2h 16min
  Sleep HR: Avg 64 bpm | Min 51 bpm | Max 95 bpm

--- 20270106 ---
Steps: 0 | Calories: 11 kcal | Exercise: 0 min
Stress: Avg 29
`
test('daily health: durations, HR, thousands separator, missing sleep block', () => {
  const r = parseDailyHealth(DAILY)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], { date: '2027-01-05', steps: 1234, stress_avg: 30, sleep_total_min: 393, sleep_deep_min: 27, sleep_light_min: 178, sleep_rem_min: 52, sleep_awake_min: 136, sleep_hr_avg: 64, sleep_hr_min: 51, sleep_hr_max: 95 })
  assert.equal(r[0].sleep_deep_min + r[0].sleep_light_min + r[0].sleep_rem_min + r[0].sleep_awake_min, r[0].sleep_total_min)
  assert.deepEqual(r[1], { date: '2027-01-06', steps: 0, stress_avg: 29 }) // no sleep data → no invented fields
})
const HRV = `Sleep HRV — 2027-01-05 to 2027-01-06
HRV Assessment — Last 2 days
========================
2027-01-06:
  HRV Avg: 81 ms — Normal
  Normal Range: 53 - 105 ms
  Baseline: 79 ms
2027-01-05:
  HRV Avg: 109 ms — Above normal
  Normal Range: 54 - 106 ms
  Baseline: 80 ms

Sleep HRV Time Series — Last 2 days
========================
2027-01-05:
  timestamp=1, timezone=28, hrv=999 ms, status=4, confidence=100000
`
test('sleep HRV: only the official assessment block, never the raw series', () => {
  const r = parseSleepHrv(HRV)
  assert.equal(r.length, 2); assert.equal(r[0].hrv_avg, 81); assert.equal(r[1].hrv_status, 'Above normal'); assert.equal(r[1].hrv_range_hi, 106); assert.ok(!r.some((x) => x.hrv_avg === 999))
})
test('resting HR', () => assert.deepEqual(parseResting('Resting Heart Rate\n2027-01-06: 61 bpm\n2027-01-05: 57 bpm'), [{ date: '2027-01-06', resting_hr: 61 }, { date: '2027-01-05', resting_hr: 57 }]))
const SPORT = `Sport Records — 2027-01-01 to 2027-01-06 (3 records)
========================

1. Outdoor Run — 2027-01-05
   Location: Test Run
   Start Coordinates: -6.0, 106.0
   Time Window: startTimestamp=1800000000 | endTimestamp=1800002693
   Duration: 44:53 | Distance: 6.06 km
   Average Pace: 7:24 /km | Avg HR: 167 bpm | Calories: 628 kcal
   LabelId: 111 | SportType: 100

2. Walk — 2027-01-04
   Location: Test Walk
   Time Window: startTimestamp=1799000000 | endTimestamp=1799008283
   Duration: 2:18:03 | Distance: 699 m
   Average Pace: 34:26 /km | Avg HR: 91 bpm | Calories: 613 kcal
   LabelId: 222 | SportType: 900

3. Strength — 2027-01-03
   Location: Upper body
   Time Window: startTimestamp=1798000000 | endTimestamp=1798001771
   Duration: 29:31 | Sets: 15
 | Avg HR: 95 bpm | Calories: 238 kcal
   LabelId: 333 | SportType: 402
`
test('sport records: km/m, h:mm:ss, strength without distance/pace', () => {
  const r = parseSportRecords(SPORT)
  assert.equal(r.length, 3)
  assert.deepEqual([r[0].distance_m, r[0].duration_s, r[0].avg_pace_s_km, r[0].sport, r[0].avg_hr], [6060, 2693, 444, 'Run', 167])
  assert.deepEqual([r[1].distance_m, r[1].duration_s, r[1].sport], [699, 8283, 'Walk'])
  assert.equal(r[2].sport, 'Strength'); assert.equal(r[2].distance_m, undefined); assert.equal(r[2].avg_pace_s_km, undefined); assert.equal(r[2].duration_s, 1771)
})
test('laps: centimetres → metres, picks the 1-km group, tolerates the anomaly message', () => {
  const j = { lapGroups: [{ type: 2, laps: [{ distance: 100000, time: 480.19, avgPace: 480.19, avgHr: 154, avgCadence: 165, avgPower: 166, groundTime: 311 }, { distance: 5886, time: 20.48, avgPace: 347.95, avgHr: 190, avgCadence: 173, avgPower: 210, groundTime: 0 }] }, { type: -1, laps: [{ avgCadence: 165, avgPower: 177 }] }] }
  const r = parseLaps(JSON.stringify(j))
  assert.equal(r.laps[0].distance_m, 1000); assert.equal(r.laps[1].distance_m, 58.86); assert.equal(r.laps[1].gct_ms, undefined); assert.equal(r.power, 177)
  assert.equal(parseLaps('Tool call anomalies detected. High risk of session context pollution'), null)
})

import { parseTrainingLoad, parseRecovery, parseSleepOverview, parseActivityDetail, parseFitness } from './parse.js'
test('training load: short/long-term load and ratio per day', () => {
  const r = parseTrainingLoad('Training Load Assessment\n========\n\n2027-01-11\nComment: Resuming\nShort-Term Load: 36\nLong-Term Load: 62\nLoad Ratio: 0.58\n\n2027-01-10\nComment: Performance\nShort-Term Load: 56\nLong-Term Load: 73\nLoad Ratio: 0.76')
  assert.deepEqual(r[0], { date: '2027-01-11', load_comment: 'Resuming', load_short: 36, load_long: 62, load_ratio: 0.58 }); assert.equal(r.length, 2)
})
test('recovery, sleep score, activity detail, fitness overview', () => {
  assert.deepEqual(parseRecovery('Recovery: 87%\nLevel: Fresh\nEstimated Full Recovery: 0h'), { recovery_pct: 87, recovery_level: 'Fresh' })
  assert.deepEqual(parseSleepOverview('Sleep Overview\n\n2027-01-09\nSleep Score: 38\nAwake Count (>5 min): 1\n\n2027-01-10\nSleep Score: 84\nAwake Count (>5 min): 0'), [{ date: '2027-01-09', sleep_score: 38, sleep_awake_count: 1 }, { date: '2027-01-10', sleep_score: 84, sleep_awake_count: 0 }])
  assert.deepEqual(parseActivityDetail('Workout Time: 44:53\nTraining Load: 158\nAerobic TE: 3.6\nAnaerobic TE: 1.8\nTraining Focus: Tempo\nPerformance: Below Average'), { training_load: 158, aerobic_te: 3.6, anaerobic_te: 1.8, training_focus: 'Tempo', performance: 'Below Average' })
  assert.deepEqual(parseFitness('VO2max: 47\nRunning Level: 66\nThreshold Pace: 5:56 /km\n5 km Prediction: 28:40\n10 km Prediction: 1:00:33\nHalf Marathon Prediction: 2:17:13\nMarathon Prediction: 4:53:04'),
    { vo2max: 47, running_level: 66, threshold_pace_s_km: 356, pred_5k_s: 1720, pred_10k_s: 3633, pred_hm_s: 8233, pred_m_s: 17584 })
})
