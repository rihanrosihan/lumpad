import test from 'node:test'
import assert from 'node:assert'
import { acwrZone, fitnessSeries, sleepSummary, hrvSummary, restingSummary, dailyLoads, weeklyKm, volumeRamp, longRunRule, weekStart } from './metrics.js'

const H = (date, o) => ({ date, ...o })
test('ACWR zones follow the 0.8 / 1.3 / 1.5 cut-offs', () => {
  assert.deepEqual([0.58, 0.8, 0.81, 1.3, 1.31, 1.5, 1.51].map((r) => acwrZone(r).id), ['under', 'under', 'sweet', 'sweet', 'caution', 'caution', 'high']); assert.equal(acwrZone(null), null)
})
test('fitness/fatigue/form/ramp: form = long − short; ramp = fitness change over 7 days (null when no row 7 days back)', () => {
  const h = [H('2027-01-01', { load_long: 60, load_short: 50 }), H('2027-01-08', { load_long: 66, load_short: 80, load_ratio: 1.21, load_comment: 'Maintaining' }), H('2027-01-09', { load_long: 67, load_short: 30 })]
  const s = fitnessSeries(h)
  assert.deepEqual([s[0].form, s[0].ramp], [10, null]); assert.deepEqual([s[1].form, s[1].ramp, s[1].acwr], [-14, 6, 1.21]); assert.equal(s[2].ramp, null)
})
test('sleep, HRV and resting HR summaries with 7/14-day references', () => {
  const h = Array.from({ length: 8 }, (_, i) => H(`2027-01-0${i + 1}`, { sleep_total_min: 400 + i * 10, sleep_deep_min: 80, sleep_rem_min: 100, sleep_light_min: 200, sleep_awake_min: 20, sleep_score: 70 + i, hrv_avg: 80 + i, hrv_status: 'Normal', hrv_baseline: 80, hrv_range_lo: 55, hrv_range_hi: 105, resting_hr: 55 + i }))
  const s = sleepSummary(h, '2027-01-08'); assert.equal(s.total_min, 470); assert.equal(s.deep_pct, 17); assert.equal(s.avg7_total, 440); assert.equal(s.score, 77)
  const v = hrvSummary(h, '2027-01-08'); assert.equal(v.avg, 87); assert.equal(v.avg7, 84); assert.equal(v.vs_baseline_pct, 5)
  const r = restingSummary(h, '2027-01-08'); assert.deepEqual([r.value, r.avg14, r.delta], [62, 58, 4]); assert.equal(sleepSummary(h, '2027-02-01'), null)
})
test('daily load zero-fills days without activities', () => {
  const d = dailyLoads([{ date: '2027-01-08', load: 158 }], '2027-01-09', 3); assert.deepEqual(d.map((x) => x.load), [0, 158, 0]); assert.equal(d[0].date, '2027-01-07')
})
test('weekly km (runs only, Monday weeks), volume ramp vs 4-week average, long-run 110 % rule', () => {
  assert.equal(weekStart('2027-01-10'), '2027-01-04') // Sunday belongs to the week starting Monday
  const run = (date, km) => ({ sport_class: 'run', date, distance_m: km * 1000 }), acts = [run('2026-12-15', 20), run('2026-12-22', 20), run('2026-12-29', 20), run('2027-01-05', 20), run('2027-01-12', 30), { sport_class: 'walk', date: '2027-01-12', distance_m: 9000 }]
  assert.equal(weeklyKm(acts)['2027-01-11'], 30)
  const v = volumeRamp(acts, '2027-01-14'); assert.deepEqual([v.this_week_km, v.avg4_km, v.vs_avg4_pct, v.week_over_week_pct], [30, 20, 50, 50])
  assert.deepEqual(longRunRule(acts, '2027-01-16', 22), { longest30_km: 30, max_allowed_km: 33, planned_km: 22, ok: true })
  assert.equal(longRunRule(acts, '2027-01-16', 34).ok, false)
})
