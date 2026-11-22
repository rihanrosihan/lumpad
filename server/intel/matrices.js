// The four correlation matrices of the blueprint (§6), computed straight from the FIT-session table (MEASURED, observational, within-athlete).
// They are descriptive comparisons; the statistically tested version of the same questions lives in corr.js (lagged edges with FDR).
//   1) gym → stride: runs 24 / 48 / 72 h after lower-body gym vs fresh legs (plus any-gym vs fresh, Z2 discipline, indoor vs outdoor)
//   2) shoe degradation: EF residual vs shoe km — computed in the twin (twin.shoes), shown by the Shoe card
//   3) threshold adaptation: threshold minutes per week in a 4-week block vs aerobic speed (pace at HR ≈ 150) in the 4 weeks after
//   4) race fade predictors: 8 weeks before each HM/FM (long runs ≥ 21 km, elevation, threshold minutes, weekly km) vs the late-race fade
import { idb } from './db.js'
import { db as app } from '../store.js'
import { ATHLETE, Z2_CEILING } from '../../src/lib/athlete.js'
import PLAN from '../../src/data/plan.json' with { type: 'json' }

const PLAN_BY = Object.fromEntries(PLAN.map((d) => [d.date, d]))
const avg = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const r = (x, d) => (x == null ? null : +x.toFixed(d))
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0)

// pure: late-race fade from the per-km array (pace = elapsed per km, so walking counts)
export function raceFade(km, distKm) {
  const fm = distKm > 30, [e0, e1, l0, l1] = fm ? [1, 20, 30, 42] : [1, 10, 15, 21]
  const part = (a, b) => km.filter((k) => k.km >= a && k.km <= b)
  const E = part(e0, e1), L = part(l0, l1); if (E.length < 3 || L.length < 3) return null
  const pe = avg(E.map((k) => k.pace)), pl = avg(L.map((k) => k.pace)), ge = avg(E.map((k) => k.gct)), gl = avg(L.map((k) => k.gct))
  return { early: `km ${e0}–${e1}`, late: `km ${l0}–${Math.min(l1, km.length)}`, pace_early_s: r(pe, 0), pace_late_s: r(pl, 0), pace_fade_pct: pe && pl ? r(((pl - pe) / pe) * 100, 1) : null,
    gct_fade_ms: ge != null && gl != null ? r(gl - ge, 0) : null, run_share_late: r(avg(L.map((k) => k.runShare)), 2) }
}

export function matrices() {
  const runs = idb.prepare(`SELECT s.label_id, s.date, s.distance_m, s.elapsed_s, s.ef, s.drift_pahr, s.run_drift, s.gct_fade, s.stride_fade, s.run_hr, s.avg_hr, s.pace_hr150, s.gain_m, s.km, s.metrics,
    COALESCE(w.indoor, 0) AS indoor FROM fit_session s LEFT JOIN run_weather w ON w.label_id = s.label_id WHERE s.distance_m >= 3000 AND s.ef IS NOT NULL ORDER BY s.date`).all()
  if (!runs.length) return null
  const feat = Object.fromEntries(idb.prepare('SELECT date, run_km, strength, strength_lower, thr_min FROM daily_feat').all().map((d) => [d.date, d]))
  const gymDays = new Set(app.prepare("SELECT DISTINCT date FROM activities WHERE source != 'garmin' AND sport IN ('Strength','WeightTraining','Workout')").all().map((x) => x.date))
  const gct = (x) => JSON.parse(x.metrics || '{}').run_gct ?? null
  const grp = (rows, row) => ({ n: rows.length, ef: r(avg(rows.map((x) => x.ef)), 3), drift: r(avg(rows.map((x) => x.drift_pahr ?? x.run_drift)), 1), gct_fade: r(avg(rows.map((x) => x.gct_fade)), 1),
    gct_avg: r(avg(rows.map(gct)), 0), stride_fade: r(avg(rows.map((x) => x.stride_fade)), 3), ...row })

  // 1) gym → stride
  const long5 = runs.filter((x) => x.distance_m >= 5000)
  const afterGym = (d) => [1, 2, 3].some((n) => gymDays.has(addDays(d, -n)))
  // lower-body days are known from the session name / plan tags; until any are labelled, fall back to any gym session
  const lowerKnown = Object.values(feat).some((d) => d.strength_lower), key = lowerKnown ? 'strength_lower' : 'strength'
  const lowerLag = (d) => { for (const n of [1, 2, 3]) if (feat[addDays(d, -n)]?.[key]) return n; return null }
  const post = long5.filter((x) => afterGym(x.date)), fresh = long5.filter((x) => !afterGym(x.date))
  const gym_lag = [1, 2, 3].map((h) => grp(long5.filter((x) => lowerLag(x.date) === h), { hours: h * 24 })).concat([grp(long5.filter((x) => lowerLag(x.date) == null), { hours: null })]).filter((x) => x.n)
  const short = runs.filter((x) => x.distance_m <= 15000 && x.run_hr != null)
  const z2 = short.filter((x) => x.run_hr <= Z2_CEILING), creep = short.filter((x) => x.run_hr > Z2_CEILING)
  const mod = (rows, name) => ({ modality: name, n: rows.length, avg_km: r(avg(rows.map((x) => x.distance_m / 1000)), 1), ef: r(avg(rows.map((x) => x.ef)), 3), avg_hr: r(avg(rows.map((x) => x.avg_hr ?? x.run_hr)), 0) })

  // 3) threshold adaptation: 4-week blocks ending on Sundays, newest last
  const lastSun = (() => { const t = runs.at(-1).date, dow = new Date(t + 'T12:00:00Z').getUTCDay(); return addDays(t, -dow) })()
  const blocks = []
  for (let b = 8; b >= 1; b--) {
    const end = addDays(lastSun, -28 * (b - 1)), start = addDays(end, -27), days = Array.from({ length: 28 }, (_, i) => feat[addDays(start, i)]).filter(Boolean)
    const after = runs.filter((x) => x.date > end && x.date <= addDays(end, 28) && x.pace_hr150 != null), during = runs.filter((x) => x.date >= start && x.date <= end && x.pace_hr150 != null)
    if (!days.length) continue
    blocks.push({ from: start, to: end, thr_min_per_week: r(sum(days.map((d) => d.thr_min)) / 4, 0), km_per_week: r(sum(days.map((d) => d.run_km)) / 4, 1),
      pace_hr150_during_s: r(avg(during.map((x) => x.pace_hr150)), 0), pace_hr150_next4w_s: r(avg(after.map((x) => x.pace_hr150)), 0), n_next: after.length })
  }

  // 4) race fade predictors
  const raceDates = new Set(ATHLETE.races.map((x) => x.date))
  const isRace = (x) => PLAN_BY[x.date]?.kind === 'race' || raceDates.has(x.date)
  const race_fade = runs.filter((x) => x.distance_m >= 19000 && isRace(x)).map((x) => {
    const from = addDays(x.date, -56), pre = runs.filter((y) => y.date >= from && y.date < x.date), days = Array.from({ length: 56 }, (_, i) => feat[addDays(from, i)]).filter(Boolean)
    const known = ATHLETE.races.find((a) => a.date === x.date)
    return { date: x.date, name: known?.name || PLAN_BY[x.date]?.label || 'race', km: r(x.distance_m / 1000, 1), time_s: x.elapsed_s,
      pre8w: { long_runs_21k: pre.filter((y) => y.distance_m >= 21000).length, long_runs_16k: pre.filter((y) => y.distance_m >= 16000).length, gain_m: Math.round(sum(pre.map((y) => y.gain_m))),
        thr_min: Math.round(sum(days.map((d) => d.thr_min))), km_per_week: r(sum(days.map((d) => d.run_km)) / 8, 1) },
      fade: raceFade(JSON.parse(x.km || '[]'), x.distance_m / 1000) }
  })

  return {
    gym_to_stride: [grp(post, { grp: 'post_gym_72h' }), grp(fresh, { grp: 'fresh' })].filter((x) => x.n),
    gym_lag, gym_lag_basis: lowerKnown ? 'lower-body gym' : 'any gym session (lower-body days not labelled yet)',
    z2_discipline: [grp(z2, { zone: 'z2_disciplined', avg_hr: r(avg(z2.map((x) => x.run_hr)), 0) }), grp(creep, { zone: 'intensity_creep', avg_hr: r(avg(creep.map((x) => x.run_hr)), 0) })].filter((x) => x.n),
    z2_ceiling: Z2_CEILING,
    modalities: [mod(runs.filter((x) => !x.indoor), 'road_outdoor'), mod(runs.filter((x) => x.indoor), 'treadmill_indoor')].filter((x) => x.n),
    threshold_blocks: blocks, race_fade, sessions: runs.length,
  }
}
