// Sleep (docs/readiness-model.md §4). COROS "Total" includes awake time → asleep = total − awake.
import { addDays } from './dates.js'
import { r1 } from './stats.js'
export const asleepMin = (r) => (r?.sleep_total_min == null ? null : r.sleep_total_min - (r.sleep_awake_min || 0))
export function sleepState(health, date, needMin = 480) {
  const d = health.find((r) => r.date === date), a = asleepMin(d)
  const series = Array.from({ length: 14 }, (_, i) => { const day = addDays(date, i - 13), x = asleepMin(health.find((r) => r.date === day)); return { date: day, asleep: x, delta: x == null ? null : x - needMin } })
  let cum = 0; for (const s of series) { if (s.delta != null) cum += s.delta; s.cum = cum }
  const debt = Math.max(0, -cum)
  if (a == null) return { enough: false, series, debt_min: debt }
  const pct = (m) => (m != null && d.sleep_total_min ? Math.round((m / d.sleep_total_min) * 100) : null)
  return { enough: true, asleep_min: a, in_bed_min: d.sleep_total_min, eff: r1((a / d.sleep_total_min) * 100, 0), need_min: needMin, vs_need_min: a - needMin,
    deep: pct(d.sleep_deep_min), rem: pct(d.sleep_rem_min), light: pct(d.sleep_light_min), awake: pct(d.sleep_awake_min), score: d.sleep_score ?? null, hr_avg: d.sleep_hr_avg ?? null,
    series, debt_min: debt, nights: series.filter((s) => s.delta != null).length }
}
