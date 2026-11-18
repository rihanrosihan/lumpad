// HRV / RHR (docs/readiness-model.md §4): ln(HRV), 60-day baseline ± 0.5 SD (SWC), 7-day rolling mean as the decision line.
import { addDays } from './dates.js'
import { mean, sd, r1 } from './stats.js'

const rowsBefore = (health, date, days, key) => health.filter((r) => r.date < date && r.date >= addDays(date, -days) && r[key] != null)
export function hrvSeries(health, to, days = 60) {
  const out = []
  for (const r of health.filter((x) => x.date <= to && x.date > addDays(to, -days) && x.hrv_avg != null)) {
    const base = rowsBefore(health, r.date, 60, 'hrv_avg').map((x) => Math.log(x.hrv_avg)), m = mean(base), s = sd(base)
    const last7 = health.filter((x) => x.date <= r.date && x.date > addDays(r.date, -7) && x.hrv_avg != null).map((x) => Math.log(x.hrv_avg))
    out.push({ date: r.date, hrv: r.hrv_avg, ln: Math.log(r.hrv_avg), roll7: last7.length >= 3 ? Math.exp(mean(last7)) : null,
      lo: m != null && s != null && base.length >= 14 ? Math.exp(m - 0.5 * s) : null, hi: m != null && s != null && base.length >= 14 ? Math.exp(m + 0.5 * s) : null, n: base.length })
  }
  return out
}
export function hrvState(health, date) {
  const base = rowsBefore(health, date, 60, 'hrv_avg').map((x) => Math.log(x.hrv_avg)), m = mean(base), s = sd(base)
  const last7 = health.filter((x) => x.date <= date && x.date > addDays(date, -7) && x.hrv_avg != null).map((x) => Math.log(x.hrv_avg))
  const today = health.find((x) => x.date === date)?.hrv_avg ?? null
  if (base.length < 14 || !s || last7.length < 3) return { today, enough: false, n: base.length }
  const cv = (arr) => (arr.length >= 3 ? (sd(arr) / mean(arr)) * 100 : null)
  // personal CV distribution: CV of each trailing 7-day window in the baseline
  const cvs = []; for (let i = 6; i < base.length; i++) cvs.push(cv(base.slice(i - 6, i + 1)))
  const z7 = (mean(last7) - m) / s, zToday = today != null ? (Math.log(today) - m) / s : null, cv7 = cv(last7)
  return { enough: true, today, zToday: r1(zToday, 2), roll7: r1(Math.exp(mean(last7))), z7: r1(z7, 2), cv7: r1(cv7, 2), cvMean: r1(mean(cvs), 2), cvSd: r1(sd(cvs), 2),
    lo: r1(Math.exp(m - 0.5 * s)), hi: r1(Math.exp(m + 0.5 * s)), n: base.length,
    flagDay: zToday != null && zToday < -1, flagTrend: z7 < -0.5, flagCv: cvs.length >= 7 && cv7 > mean(cvs) + sd(cvs) && z7 < 0 }
}
export function rhrState(health, date) {
  const base = rowsBefore(health, date, 30, 'resting_hr').map((x) => x.resting_hr), v = health.find((x) => x.date === date)?.resting_hr ?? null
  if (v == null || base.length < 7) return { value: v, enough: false }
  const m = mean(base), s = sd(base)
  return { enough: true, value: v, base: r1(m), dev: r1(v - m), z: s ? r1((v - m) / s, 2) : null, spike: v - m >= 5 }
}
// 7-day autonomic quadrant: x = RHR z (30 d), y = HRV z (60 d, ln)
export function quadrant(health, date) {
  const pts = []
  for (let i = 6; i >= 0; i--) { const d = addDays(date, -i), h = hrvState(health, d), r = rhrState(health, d); if (h.enough && h.zToday != null && r.enough && r.z != null) pts.push({ date: d, x: r.z, y: h.zToday }) }
  return pts
}
export const quadrantLabel = (x, y) => (y >= 0 && x <= 0 ? ['green', 'Parasympathetic dominant · ready'] : y < 0 && x > 0 ? ['red', 'Sympathetic stress / illness / overload'] : y < 0 && x <= 0 ? ['purple', 'HRV suppressed + low RHR (saturation / chronic fatigue pattern)'] : ['yellow', 'Active adaptation / mild dehydration'])
