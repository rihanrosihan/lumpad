// Readiness metrics. Source of every number is stated in the UI:
//   [COROS]  load_short (acute), load_long (chronic), load_ratio (ACWR), recovery %, sleep score, HRV status — read as published
//   [calc]   fitness/fatigue/form/ramp are the CTL/ATL/TSB idea applied to COROS's long/short-term load (not TrainingPeaks TSS)
import { addDays, diffDays } from './dates.js'

export const ACWR_ZONES = [ // Gabbett 2016 (BJSM, PMID 26758673) used 0.8–1.3 "sweet spot", >1.5 "danger zone"; a prior, not a gate
  { id: 'under', max: 0.8, label: 'Below usual load' }, { id: 'sweet', max: 1.3, label: 'Sweet spot' },
  { id: 'caution', max: 1.5, label: 'Caution' }, { id: 'high', max: Infinity, label: 'High' },
]
export const acwrZone = (r) => (r == null ? null : ACWR_ZONES.find((z) => r <= z.max || z.max === Infinity))
const mean = (a) => { const v = a.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
export const round = (x, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d)
const byDate = (rows) => Object.fromEntries(rows.map((r) => [r.date, r]))

// fitness = long-term load, fatigue = short-term load, form = fitness − fatigue, ramp = fitness now − fitness 7 days ago
export function fitnessSeries(health) {
  const m = byDate(health)
  return health.filter((r) => r.load_long != null && r.load_short != null).map((r) => {
    const prev = m[addDays(r.date, -7)]
    return { date: r.date, fitness: r.load_long, fatigue: r.load_short, form: r.load_long - r.load_short, ramp: prev?.load_long != null ? r.load_long - prev.load_long : null, acwr: r.load_ratio ?? null, comment: r.load_comment || null }
  })
}
export function latestOn(rows, date, key) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].date <= date && rows[i][key] != null) return rows[i]; return null }

export function sleepSummary(health, date) {
  const d = health.find((r) => r.date === date), last7 = health.filter((r) => r.date <= date && r.date > addDays(date, -7))
  if (!d || d.sleep_total_min == null) return null
  return { score: d.sleep_score ?? null, total_min: d.sleep_total_min, deep_pct: pct(d.sleep_deep_min, d.sleep_total_min), rem_pct: pct(d.sleep_rem_min, d.sleep_total_min), light_pct: pct(d.sleep_light_min, d.sleep_total_min), awake_min: d.sleep_awake_min ?? null, awake_count: d.sleep_awake_count ?? null,
    hr_avg: d.sleep_hr_avg ?? null, avg7_total: round(mean(last7.map((r) => r.sleep_total_min))), avg7_score: round(mean(last7.map((r) => r.sleep_score))) }
}
const pct = (a, t) => (a != null && t ? Math.round((a / t) * 100) : null)

export function hrvSummary(health, date) {
  const d = health.find((r) => r.date === date); if (!d || d.hrv_avg == null) return null
  const last7 = health.filter((r) => r.date <= date && r.date > addDays(date, -7) && r.hrv_avg != null), avg7 = mean(last7.map((r) => r.hrv_avg))
  return { avg: d.hrv_avg, status: d.hrv_status, lo: d.hrv_range_lo, hi: d.hrv_range_hi, baseline: d.hrv_baseline, avg7: round(avg7), vs_baseline_pct: d.hrv_baseline ? round(((avg7 - d.hrv_baseline) / d.hrv_baseline) * 100) : null }
}
export function restingSummary(health, date) {
  const d = health.find((r) => r.date === date); if (!d || d.resting_hr == null) return null
  const prev = health.filter((r) => r.date < date && r.date >= addDays(date, -14) && r.resting_hr != null), a = mean(prev.map((r) => r.resting_hr))
  return { value: d.resting_hr, avg14: round(a, 1), delta: a != null ? round(d.resting_hr - a, 1) : null }
}
// daily training load (COROS per-activity Training Load summed per day), zero-filled
export function dailyLoads(loads, to, days) { const m = byDate(loads); return Array.from({ length: days }, (_, i) => { const d = addDays(to, i - days + 1); return { date: d, load: m[d]?.load ?? 0 } }) }

// ---- volume ramp (weekly run km), the plan's biggest risk: ~1.7× the 2026 average
export const weekStart = (date) => { const d = new Date(date + 'T12:00:00Z'); return addDays(date, -((d.getUTCDay() + 6) % 7)) }
export function weeklyKm(acts) {
  const w = {}; for (const a of acts) if (a.sport_class === 'run' && a.distance_m) { const k = weekStart(a.date); w[k] = (w[k] || 0) + a.distance_m / 1000 }
  return w
}
export function volumeRamp(acts, date) {
  const w = weeklyKm(acts), cur = weekStart(date), prev = Array.from({ length: 4 }, (_, i) => w[addDays(cur, -7 * (i + 1))] || 0)
  const avg4 = mean(prev), thisWeek = w[cur] || 0
  return { this_week_km: round(thisWeek, 1), last_week_km: round(prev[0], 1), avg4_km: round(avg4, 1), vs_avg4_pct: avg4 ? round(((thisWeek - avg4) / avg4) * 100) : null, week_over_week_pct: prev[0] ? round(((thisWeek - prev[0]) / prev[0]) * 100) : null }
}
// rule from the project: a long run may be at most 110 % of the longest run in the previous 30 days
export function longRunRule(acts, date, plannedKm) {
  const runs = acts.filter((a) => a.sport_class === 'run' && a.date < date && a.date >= addDays(date, -30) && a.distance_m), longest = Math.max(0, ...runs.map((a) => a.distance_m / 1000))
  return { longest30_km: round(longest, 1), max_allowed_km: round(longest * 1.1, 1), planned_km: plannedKm ?? null, ok: plannedKm == null || longest === 0 ? null : plannedKm <= longest * 1.1 + 0.05 }
}
