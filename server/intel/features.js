// kv check-ins → daily_log, and one row per calendar day (daily_feat) that SQL window functions can lag over.
import { db as app } from '../store.js'
import { load } from '../db.js'
import { idb, tx } from './db.js'
import PLAN from '../../src/data/plan.json' with { type: 'json' }

const PLAN_BY = Object.fromEntries(PLAN.map((d) => [d.date, d]))
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const wibDate = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

export function strengthKind(name, date) {
  const t = `${name || ''} ${(PLAN_BY[date]?.tags || []).join(' ')}`.toLowerCase()
  const lower = /lower|leg|squat|deadlift|unilateral|kaki/.test(t), upper = /upper|push|pull|chest|bench|atas/.test(t) || /fb upper/.test(t)
  return { lower: lower ? 1 : 0, upper: upper ? 1 : 0 }
}
export function projectLog(kv = load('kv', {})) {
  let n = 0
  tx(idb, () => {
    for (const [k, e] of Object.entries(kv)) {
      const m = /^lumpad\.daily\.(\d{4}-\d{2}-\d{2})$/.exec(k); if (!m) continue
      const f = e.value || {}, fuel = kv['lumpad.fuel.' + m[1]]?.value
      const pain = f.painSites && Object.keys(f.painSites).length ? f.painSites : f.pain !== '' && f.pain != null ? { all: f.pain } : null
      idb.prepare('INSERT INTO daily_log (date, feel, pain, gi, strength, fuel, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET feel=excluded.feel, pain=excluded.pain, gi=excluded.gi, strength=excluded.strength, fuel=excluded.fuel, updated_at=excluded.updated_at')
        .run(m[1], Number.isFinite(f.energy) ? f.energy : null, pain ? JSON.stringify(pain) : null, null, null, null, e.updatedAt || new Date().toISOString()); n++
    }
    for (const [k, e] of Object.entries(kv)) { // post-long-run fuel cards are keyed by the run's date
      const m = /^lumpad\.fuel\.(\d{4}-\d{2}-\d{2})$/.exec(k); if (!m || !e.value || e.value.skipped) continue
      const v = e.value; idb.prepare('INSERT INTO daily_log (date, gi, fuel, updated_at) VALUES (?,?,?,?) ON CONFLICT(date) DO UPDATE SET gi=excluded.gi, fuel=excluded.fuel, updated_at=excluded.updated_at').run(m[1], Number.isFinite(v.gi) ? v.gi : null, JSON.stringify({ gels: v.gels ?? null, fluidsOk: v.fluidsOk ?? null }), e.updatedAt || new Date().toISOString())
    }
  })
  return n
}

export function buildDailyFeat({ from = '2025-01-01', to = wibDate() } = {}) {
  const acts = app.prepare("SELECT id, date, sport, name, duration_s, distance_m, training_load FROM activities WHERE source='coros' AND date BETWEEN ? AND ?").all(from, to)
  const health = Object.fromEntries(app.prepare('SELECT * FROM health_daily WHERE date BETWEEN ? AND ?').all(addDays(from, -60), to).map((h) => [h.date, h]))
  const sess = idb.prepare('SELECT date, metrics FROM fit_session WHERE date BETWEEN ? AND ?').all(from, to), wx = Object.fromEntries(idb.prepare('SELECT s.date d, MAX(w.wbgt) w FROM run_weather w JOIN fit_session s ON s.label_id=w.label_id WHERE w.indoor=0 GROUP BY s.date').all().map((r) => [r.d, r.w]))
  const log = Object.fromEntries(idb.prepare('SELECT * FROM daily_log').all().map((r) => [r.date, r]))
  const byDate = new Map(); for (const a of acts) (byDate.get(a.date) || byDate.set(a.date, []).get(a.date)).push(a)
  const thr = new Map(); for (const s of sess) { const z = JSON.parse(s.metrics).z_hr; if (z) thr.set(s.date, (thr.get(s.date) || 0) + (z.tempo_min || 0) + (z.above_lthr_min || 0)) }
  const hrvBase = (d) => { let sum = 0, n = 0; for (let i = 1; i <= 60; i++) { const h = health[addDays(d, -i)]; if (h?.hrv_avg != null) { sum += h.hrv_avg; n++ } } return n >= 14 ? sum / n : null }
  const upsert = idb.prepare(`INSERT INTO daily_feat (date, run_km, run_min, run_n, tl, run_tl, strength, strength_lower, strength_upper, strength_tl, thr_min, quality, double_day, sleep_min, sleep_hr, hrv, hrv_dev, rhr, wbgt, pain_max, feel, gi)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET run_km=excluded.run_km, run_min=excluded.run_min, run_n=excluded.run_n, tl=excluded.tl, run_tl=excluded.run_tl, strength=excluded.strength, strength_lower=excluded.strength_lower, strength_upper=excluded.strength_upper,
      strength_tl=excluded.strength_tl, thr_min=excluded.thr_min, quality=excluded.quality, double_day=excluded.double_day, sleep_min=excluded.sleep_min, sleep_hr=excluded.sleep_hr, hrv=excluded.hrv, hrv_dev=excluded.hrv_dev, rhr=excluded.rhr, wbgt=excluded.wbgt, pain_max=excluded.pain_max, feel=excluded.feel, gi=excluded.gi`)
  let n = 0
  tx(idb, () => {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const day = byDate.get(d) || [], runs = day.filter((a) => a.sport === 'Run'), str = day.filter((a) => ['Strength', 'WeightTraining'].includes(a.sport))
      const sk = str.map((a) => strengthKind(a.name, d)), h = health[d], l = log[d], base = hrvBase(d), tm = thr.get(d) || 0
      const pain = l?.pain ? Math.max(0, ...Object.values(JSON.parse(l.pain))) : null
      upsert.run(d, runs.reduce((s, a) => s + (a.distance_m || 0), 0) / 1000, runs.reduce((s, a) => s + (a.duration_s || 0), 0) / 60, runs.length, day.reduce((s, a) => s + (a.training_load || 0), 0), runs.reduce((s, a) => s + (a.training_load || 0), 0),
        str.length ? 1 : 0, sk.some((x) => x.lower) ? 1 : 0, sk.some((x) => x.upper) ? 1 : 0, str.reduce((s, a) => s + (a.training_load || 0), 0), tm, tm >= 10 ? 1 : 0, runs.length >= 2 && tm >= 10 ? 1 : 0,
        h?.sleep_total_min != null ? h.sleep_total_min - (h.sleep_awake_min || 0) : null, h?.sleep_hr_avg ?? null, h?.hrv_avg ?? null, h?.hrv_avg != null && base ? (h.hrv_avg - base) / base : null, h?.resting_hr ?? null, wx[d] ?? null, pain, l?.feel ?? null, l?.gi ?? null); n++
    }
  })
  return n
}
