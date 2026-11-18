// Multi-context correlation matrices for the Coach page, straight from the FIT-session table (MEASURED, observational, within-athlete):
// 1) runs after a gym session vs fresh legs, 2) Z2 discipline vs intensity creep, 3) indoor vs outdoor.
import { idb } from './db.js'
import { db as app } from '../store.js'

const avg = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const r = (x, d) => (x == null ? null : +x.toFixed(d))
const daysBefore = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10)

export function matrices() {
  const runs = idb.prepare(`SELECT s.label_id, s.date, s.distance_m, s.ef, s.drift_pahr, s.gct_fade, s.stride_fade, s.run_hr, s.avg_hr, COALESCE(w.indoor, 0) AS indoor
    FROM fit_session s LEFT JOIN run_weather w ON w.label_id = s.label_id WHERE s.distance_m >= 3000 AND s.ef IS NOT NULL`).all()
  if (!runs.length) return null
  const gym = new Set(app.prepare("SELECT DISTINCT date FROM activities WHERE sport IN ('Strength','WeightTraining','Workout')").all().map((x) => x.date))
  const afterGym = (d) => [0, 1, 2, 3].some((n) => gym.has(daysBefore(d, n)) && n > 0) // a gym session 1-3 days before (24-72 h)
  const grp = (rows, row) => ({ n: rows.length, ef: r(avg(rows.map((x) => x.ef)), 3), drift: r(avg(rows.map((x) => x.drift_pahr)), 1), gct_fade: r(avg(rows.map((x) => x.gct_fade)), 1), ...row })
  const long5 = runs.filter((x) => x.distance_m >= 5000)
  const post = long5.filter((x) => afterGym(x.date)), fresh = long5.filter((x) => !afterGym(x.date))
  const short = runs.filter((x) => x.distance_m <= 15000 && x.run_hr != null)
  const z2 = short.filter((x) => x.run_hr <= 148), creep = short.filter((x) => x.run_hr > 148)
  const mod = (rows, name) => ({ modality: name, n: rows.length, avg_km: r(avg(rows.map((x) => x.distance_m / 1000)), 1), ef: r(avg(rows.map((x) => x.ef)), 3), avg_hr: r(avg(rows.map((x) => x.avg_hr ?? x.run_hr)), 0) })
  return {
    gym_to_stride: [grp(post, { grp: 'post_gym_72h', stride_fade: r(avg(post.map((x) => x.stride_fade)), 3) }), grp(fresh, { grp: 'fresh', stride_fade: r(avg(fresh.map((x) => x.stride_fade)), 3) })].filter((x) => x.n),
    z2_discipline: [grp(z2, { zone: 'z2_disciplined', avg_hr: r(avg(z2.map((x) => x.run_hr)), 0) }), grp(creep, { zone: 'intensity_creep', avg_hr: r(avg(creep.map((x) => x.run_hr)), 0) })].filter((x) => x.n),
    modalities: [mod(runs.filter((x) => !x.indoor), 'road_outdoor'), mod(runs.filter((x) => x.indoor), 'treadmill_indoor')].filter((x) => x.n),
    sessions: runs.length,
  }
}
