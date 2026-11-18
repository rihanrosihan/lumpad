// Load model (docs/readiness-model.md §3). Daily load = COROS Training Load per day.
import { addDays, diffDays } from './dates.js'
import { mean, sd, r1 } from './stats.js'

export function dailyLoadSeries(loads, from, to) { const m = Object.fromEntries(loads.map((l) => [l.date, l.load])); const n = diffDays(to, from) + 1; return Array.from({ length: Math.max(0, n) }, (_, i) => { const d = addDays(from, i); return { date: d, load: m[d] || 0 } }) }

// Banister/Coggan EWMA as in the spec: CTL τ=42, ATL τ=7; TSB_t = CTL_{t-1} − ATL_{t-1}; seeded with the mean of the first 14 days
export function pmc(series, seedDays = 14) {
  if (!series.length) return []
  const seed = mean(series.slice(0, seedDays).map((d) => d.load)) || 0
  let ctl = seed, atl = seed
  return series.map((d) => { const tsb = ctl - atl; ctl += (d.load - ctl) / 42; atl += (d.load - atl) / 7
    return { date: d.date, load: d.load, ctl: r1(ctl), atl: r1(atl), tsb: r1(tsb), acwr: ctl > 0 ? r1(atl / ctl, 2) : null, tsbPct: ctl > 0 ? r1((tsb / ctl) * 100, 0) : null } })
}
// Uncoupled rolling ACWR: acute = mean of last 7 days; chronic = mean of days 8–35 (does not include the acute week)
export function acwrRolling(series, idx = series.length - 1) {
  if (idx < 34) return null
  const a = mean(series.slice(idx - 6, idx + 1).map((d) => d.load)), c = mean(series.slice(idx - 34, idx - 6).map((d) => d.load))
  return c > 0 ? r1(a / c, 2) : null
}
export function monotonyStrain(series) { // Foster 1998, last 7 days
  const w = series.slice(-7).map((d) => d.load); if (w.length < 7) return null
  const m = mean(w), s = sd(w), total = w.reduce((a, b) => a + b, 0)
  if (!s) return { monotony: null, strain: null, weekLoad: total }
  return { monotony: r1(m / s, 2), strain: Math.round(total * (m / s)), weekLoad: total }
}
export const FORM_ZONES = [ // relative to CTL — scale-free version of the spec's TSS bands [convention, scaled]
  { id: 'overload', max: -30, label: 'Overload' }, { id: 'productive', max: -10, label: 'Productive' }, { id: 'grey', max: 5, label: 'Neutral' },
  { id: 'fresh', max: 25, label: 'Fresh / peak' }, { id: 'transition', max: Infinity, label: 'Transition / detraining' },
]
export const formZone = (pct) => (pct == null ? null : FORM_ZONES.find((z) => pct <= z.max))
export const ctlRamp = (p) => (p.length > 7 ? r1(p.at(-1).ctl - p.at(-8).ctl) : null)
// Project the EWMA forward with planned daily loads
export function project(last, planned) { let ctl = last.ctl, atl = last.atl; return planned.map((d) => { const tsb = ctl - atl; ctl += (d.load - ctl) / 42; atl += (d.load - atl) / 7; return { date: d.date, load: d.load, ctl: r1(ctl), atl: r1(atl), tsb: r1(tsb) } }) }

// Weekly running-distance progression, last 7 days vs the 7 before (Nielsen 2014 thresholds 10 % / 30 %)
export function distanceProgression(acts, date) {
  const km = (a, b) => acts.filter((x) => x.sport_class === 'run' && x.date > a && x.date <= b).reduce((s, x) => s + (x.distance_m || 0) / 1000, 0)
  const cur = km(addDays(date, -7), date), prev = km(addDays(date, -14), addDays(date, -7))
  return { cur: r1(cur), prev: r1(prev), pct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null }
}
export const progressionBand = (pct) => (pct == null ? null : pct < 10 ? 'safe' : pct <= 30 ? 'caution' : 'alert')
