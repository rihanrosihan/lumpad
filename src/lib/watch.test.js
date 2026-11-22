import test from 'node:test'
import assert from 'node:assert/strict'
import { watchList, painToday } from './watch.js'
const base = { readiness: { score: 81, gate: 'green', caps: [] }, recent_days: [{ sleep_hr: 63, hrv: 67, hrv_status: 'Normal', hrv_baseline: 73, sleep_min_asleep: 392 }],
  intensity: { easy_runs: 4, easy_runs_above_z2: 4, z2_ceiling: 148, low_share_pct: 12 }, aerobic: { hr_at_800: { value: 160.9, z: 3.6, n: 3 } }, baselines: { d30: { n: 1, hr_at_800: null } },
  load: { km_vs_4wk_avg_pct: -62, tsb: -14.2 }, durability: { longest_continuous_run_km: 10, fade_onset_km_median_90d: 6 }, injury: { sites: {} } }
test('the real 22 Nov twin: GO by the rules; easy-run HR is the alert; the race-contaminated HR@8:00 is NOT used (no steady run = unknown)', () => {
  const w = watchList(base, { checkin: { painSites: { knee: 0 } } })
  assert.equal(w.call.level, 'go')
  assert.equal(w.items[0].id, 'easy_hr')
  const h = w.items.find((i) => i.id === 'hr800'); assert.equal(h.value, null); assert.equal(h.status, 'watch')
  assert.equal(watchList({ ...base, baselines: { d30: { n: 4, hr_at_800: 155.2 } } }).items.find((i) => i.id === 'hr800').status, 'alert')
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

test('post-G3 twin: the steady-only aerobic marker and its own baseline are used', () => {
  const w = watchList({ ...base, aerobic: { hr_at_800: { value: 152.3, z: 1.3, n: 4, baseline: '143.9 ± 6.6 (steady runs 2026-04-07..2026-10-04, n=20)', steady_only: true } } })
  const h = w.items.find((i) => i.id === 'hr800'); assert.equal(h.value, 152.3); assert.equal(h.status, 'watch'); assert.match(h.ref, /143.9 ± 6.6/)
})

test('no steady runs: an empty marker (value 0 or null, n 0) is unknown, never "on track"', () => {
  const h = watchList({ ...base, aerobic: { hr_at_800: { value: 0, z: null, n: 0, baseline: '144.3 ± 6.8 (x, n=21)', steady_only: true } } }).items.find((i) => i.id === 'hr800')
  assert.equal(h.value, null); assert.equal(h.status, 'watch')
})

const ran = [{ name: 'Outdoor Run', sport_class: 'run', distance_m: 11200, training_load: 201 }]
test('already ran today: the run leads, form before → after, and the call is about the rest of today and tomorrow', () => {
  const w = watchList({ ...base, as_of: '2026-11-22', load: { km_vs_4wk_avg_pct: -62, tsb: -14.2, ctl: 76.1, atl: 106.4 } }, { today: ran, date: '2026-11-22', checkin: { painSites: { knee: 0 } } })
  assert.equal(w.items[0].id, 'today_run'); assert.equal(w.items[0].status, 'alert'); assert.match(w.items[0].ref, /form -14.2 → -30.3/)
  assert.equal(w.call.label, 'DONE'); assert.match(w.call.why, /Done today: 11.2 km, TL 201, form -14.2 → -30.3.*no hard session tomorrow/)
})
test('twin older than today: load after today is shown as not updated, never computed from stale numbers', () => {
  const w = watchList({ ...base, as_of: '2026-11-21', load: { tsb: -14.2, ctl: 76.1, atl: 106.4 } }, { today: ran, date: '2026-11-22' })
  assert.equal(w.items[0].status, 'watch'); assert.match(w.items[0].why, /not updated yet/)
})
test('no activity today: nothing added, call unchanged', () => assert.ok(!watchList(base, { today: [], date: '2026-11-22' }).items.some((i) => i.id === 'today_run')))
