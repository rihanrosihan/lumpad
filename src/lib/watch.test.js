import test from 'node:test'
import assert from 'node:assert/strict'
import { watchList, painToday } from './watch.js'
const base = { readiness: { score: 81, gate: 'green', caps: [] }, recent_days: [{ sleep_hr: 63, hrv: 67, hrv_status: 'Normal', hrv_baseline: 73, sleep_min_asleep: 392 }],
  intensity: { easy_runs: 4, easy_runs_above_z2: 4, z2_ceiling: 148, low_share_pct: 12 }, aerobic: { hr_at_800: { value: 160.9, z: 3.6, n: 3, baseline: '143.1 ± 5.0 (Jan–Sep 2026, n=26)' } },
  load: { km_vs_4wk_avg_pct: -62, tsb: -14.2 }, durability: { longest_continuous_run_km: 10, fade_onset_km_median_90d: 6 }, injury: { sites: {} } }
test('the real 22 Nov twin: GO by the rules, but easy-run HR and HR@8:00 are the top alerts', () => {
  const w = watchList(base, { checkin: { painSites: { knee: 0 } } })
  assert.equal(w.call.level, 'go')
  assert.deepEqual(w.items.slice(0, 2).map((i) => i.id).sort(), ['easy_hr', 'hr800'])
  assert.equal(w.items.find((i) => i.id === 'durability').status, 'info')
})
test('sleep HR above 67 makes it EASY ONLY with the rule as the reason', () => {
  const w = watchList({ ...base, recent_days: [{ ...base.recent_days[0], sleep_hr: 68 }] })
  assert.equal(w.call.level, 'easy'); assert.match(w.call.why, /Sleep HR 68/)
})
test('reduced HRV, pain >= 2, red readiness each downgrade; pain >= 4 means REST', () => {
  assert.equal(watchList({ ...base, recent_days: [{ ...base.recent_days[0], hrv_status: 'Reduced' }] }).call.level, 'easy')
  assert.equal(watchList(base, { checkin: { painSites: { achilles: 2 } } }).call.level, 'easy')
  assert.equal(watchList({ ...base, readiness: { score: 30, gate: 'red', caps: [] } }).call.level, 'easy')
  assert.equal(watchList(base, { checkin: { pain: 5 } }).call.level, 'rest')
})
test('load guard: above +10 % is an alert (rule), not a change of the call', () => {
  const w = watchList({ ...base, load: { km_vs_4wk_avg_pct: 14, tsb: -5 } })
  assert.equal(w.items.find((i) => i.id === 'km_guard').status, 'alert'); assert.equal(w.call.level, 'go')
})
test('no check-in: pain is flagged as missing; no twin: nothing', () => {
  assert.equal(watchList(base).items.find((i) => i.id === 'pain').ref, 'no check-in')
  assert.deepEqual(watchList(null), { call: null, items: [] })
  assert.equal(painToday({ pain: '' }), null); assert.equal(painToday({ painSites: { a: 1, b: 3 } }), 3)
})
