// Stage 7: `twin_history` (intel.db): weekly Garmin-era snapshots, schema 'twin_hist/1'. NOT the live twin: buildTwin depends on live module state, the 2026 plan/race projection and the Node/Go shadow
// comparison, so it is left untouched. Same pure library functions as the live twin (pmc, acwr, monotony, hrv/rhr/sleep states), same naming for the shared fields, strictly point-in-time
// (every snapshot only reads rows dated <= as_of; the aerobic z-score baseline is the trailing window ending 28 days earlier — no look-ahead).
// Load is Garmin-scale (activityTrainingLoad): internally consistent, NOT comparable with COROS load. Idempotent (inputs_hash); rebuildable.
import crypto from 'node:crypto'
import { openDb } from './db.js'
import { openIntel } from './fitsession.js'
import { openLive } from './apply.js'
import { CANON_CUTOFF } from './link.js'
import { dailyLoadSeries, pmc, acwrRolling, monotonyStrain, distanceProgression, ctlRamp } from '../../src/lib/load.js'
import { hrvState, rhrState } from '../../src/lib/hrv.js'
import { sleepState } from '../../src/lib/sleep.js'

export const SCHEMA = 'twin_hist/1'
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const r = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d)
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const sd = (v) => { if (v.length < 2) return null; const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) }
const steady = (s) => s.run_share >= 0.9 && s.distance_m >= 3000 && s.distance_m <= 15000

// pure. inputs: { loads:[{date,load}], health:[health_daily-shaped], runs:[{date,distance_m}], sess:[fit_session rows], vo2:[{date,vo2max}], pred:[{date,t5k_s,...}], weights:[{date,weight_kg}] }
export function snapshot(I, T) {
  const from = addDays(T, -120), loads = I.loads.filter((l) => l.date >= from && l.date <= T), series = dailyLoadSeries(loads, from, T), P = pmc(series), cur = P.at(-1) || null
  const health = I.health.filter((h) => h.date <= T), acts = I.runs.filter((a) => a.date <= T && a.date >= from).map((a) => ({ ...a, sport_class: 'run' }))
  const S = I.sess.filter((s) => s.date <= T), win = (a, b) => S.filter((s) => s.date > addDays(T, -a) && s.date <= addDays(T, -b) && steady(s))
  const pick = (L, k) => L.map((s) => s[k]).filter((x) => x != null && Number.isFinite(x)), gaps = []
  const cur28 = win(28, 0), prev28 = win(56, 28), base = pick(S.filter((s) => s.date > addDays(T, -120) && s.date <= addDays(T, -28) && steady(s)), 'hr800')
  const hrNow = pick(cur28, 'hr800'), bm = base.length >= 5 ? mean(base) : null, bs = base.length >= 5 ? sd(base) : null
  const m = (s) => { try { return JSON.parse(s.metrics || '{}') } catch { return {} } }
  const one = (d) => { const L = S.filter((s) => s.date > addDays(T, -d) && steady(s)); return { n: L.length, ef: r(mean(pick(L, 'ef')), 3), hr_at_800: r(mean(pick(L, 'hr800'))), pace_at_hr150_s: r(mean(pick(L, 'pace_hr150')), 0),
    cadence_spm: r(mean(L.map((s) => m(s).run_cad).filter(Number.isFinite))), gct_ms: r(mean(L.map((s) => m(s).run_gct).filter(Number.isFinite)), 0), stride_m: r(mean(L.map((s) => m(s).run_step).filter(Number.isFinite)), 3) } }
  const d30 = one(30), d90 = one(90), hrv = hrvState(health, T), rhr = rhrState(health, T), sleep = sleepState(health, T), mono = monotonyStrain(series), prog = distanceProgression(acts, T)
  const wk = acts.filter((a) => a.date > addDays(T, -28)), longest = Math.max(0, ...acts.filter((a) => a.date > addDays(T, -30)).map((a) => (a.distance_m || 0) / 1000))
  const latest = (arr, k) => arr.filter((x) => x.date <= T).at(-1)?.[k] ?? null, pred = I.pred.filter((p) => p.date <= T).at(-1) || {}
  if (!cur28.length) gaps.push('no steady runs with FIT metrics in the last 28 days'); if (!hrv.enough) gaps.push('HRV baseline not available yet (Garmin HRV status starts 2025-09)')
  if (bm == null) gaps.push('aerobic baseline needs >=5 steady runs in the window ending 28 days earlier')
  return { schema: SCHEMA, era: 'garmin_hist', as_of: T, scale_note: 'Garmin-scale load and race predictions; not comparable with COROS values', gaps,
    load: { ctl: cur?.ctl ?? null, atl: cur?.atl ?? null, tsb: cur?.tsb ?? null, acwr_uncoupled: acwrRolling(series), acwr_ewma: cur?.acwr ?? null, monotony: mono?.monotony ?? null, ramp_7d: ctlRamp(P), km_vs_prev_week_pct: prog?.pct ?? null,
      weekly_km_4w: r(wk.reduce((s, a) => s + (a.distance_m || 0) / 1000, 0) / 4), longest_run_km_30d: r(longest), runs_28d: wk.length },
    recovery: { hrv, rhr, sleep: { ...sleep, series: undefined }, stress_7d: r(mean(pick(health.filter((h) => h.date > addDays(T, -7)), 'stress_avg'))), garmin_readiness: latest(I.health.map((h) => ({ date: h.date, readiness_score: h.readiness_score })).filter((x) => x.readiness_score != null), 'readiness_score') },
    aerobic: { hr_at_800: { value: hrNow.length ? r(mean(hrNow)) : null, n: hrNow.length, z: hrNow.length && bs ? r((mean(hrNow) - bm) / bs) : null, prev_28d: prev28.length ? r(mean(pick(prev28, 'hr800'))) : null, baseline: bm == null ? null : `${r(bm)} ± ${r(bs)} (n=${base.length}, trailing)` },
      ef_easy_28d: { value: r(mean(pick(cur28, 'ef')), 3), n: cur28.length }, pace_at_hr150: { value: r(mean(pick(cur28, 'pace_hr150')), 0), n: pick(cur28, 'pace_hr150').length } },
    baselines: { d30, d90, delta_30_vs_90: Object.fromEntries(['ef', 'hr_at_800', 'pace_at_hr150_s'].map((k) => [k, d30[k] != null && d90[k] != null ? r(d30[k] - d90[k], k === 'ef' ? 3 : 1) : null])) },
    profile: { vo2max_garmin: latest(I.vo2, 'vo2max'), weight_kg: latest(I.weights, 'weight_kg'), rhr_7d: r(mean(pick(health.filter((h) => h.date > addDays(T, -7)), 'resting_hr')), 0),
      race_pred_garmin_s: { '5k': pred.t5k_s ?? null, '10k': pred.t10k_s ?? null, half: pred.thalf_s ?? null, marathon: pred.tmar_s ?? null } } }
}

export const schedule = () => { const out = []; for (let d = '2024-09-29'; d < CANON_CUTOFF; d = addDays(d, 7)) out.push(d); const last = addDays(CANON_CUTOFF, -1); if (out.at(-1) !== last) out.push(last); return out }

export function build({ gdb = openDb(), idb = openIntel(), live = openLive() } = {}) {
  idb.exec('CREATE TABLE IF NOT EXISTS twin_history (as_of TEXT PRIMARY KEY, schema TEXT NOT NULL, inputs_hash TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL)')
  const health = live.prepare('SELECT * FROM health_daily_garmin ORDER BY date').all().map((h) => ({ date: h.date, hrv_avg: h.hrv_value, hrv_status: h.hrv_status, resting_hr: h.resting_hr, sleep_total_min: h.sleep_total_min, sleep_awake_min: 0, sleep_deep_min: h.sleep_deep_min, sleep_light_min: h.sleep_light_min, sleep_rem_min: h.sleep_rem_min,
    sleep_score: h.sleep_score, sleep_hr_avg: h.sleep_hr_avg, stress_avg: h.stress_avg, readiness_score: h.readiness_score })) // Garmin "total" is already asleep time (deep+light+rem): awake is not subtracted again
  const I = { health, loads: idb.prepare('SELECT date, tl_garmin AS load FROM daily_feat_hist').all().map((x) => ({ date: x.date, load: x.load || 0 })),
    runs: gdb.prepare("SELECT date_local AS date, distance_m FROM g_activity WHERE sport IN ('running','treadmill_running','trail_running') AND date_local < ?").all(CANON_CUTOFF),
    sess: idb.prepare("SELECT date, run_share, distance_m, ef, hr800, pace_hr150, metrics FROM fit_session_hist WHERE sport='running'").all(), vo2: gdb.prepare("SELECT date, vo2max FROM g_maxmet WHERE sport='RUNNING' ORDER BY date").all(),
    pred: gdb.prepare('SELECT date, t5k_s, t10k_s, thalf_s, tmar_s FROM g_race_pred ORDER BY date, ts').all(), weights: gdb.prepare('SELECT substr(ts,1,10) AS date, weight_kg FROM g_weight ORDER BY ts').all() }
  const put = idb.prepare('INSERT INTO twin_history (as_of, schema, inputs_hash, created_at, state) VALUES (?,?,?,?,?) ON CONFLICT(as_of) DO UPDATE SET schema=excluded.schema, inputs_hash=excluded.inputs_hash, created_at=excluded.created_at, state=excluded.state')
  const have = idb.prepare('SELECT inputs_hash FROM twin_history WHERE as_of=?'), c = { written: 0, same: 0 }; idb.exec('BEGIN')
  try {
    for (const T of schedule()) {
      const st = snapshot(I, T), text = JSON.stringify(st), h = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
      if (have.get(T)?.inputs_hash === h) { c.same++; continue }
      put.run(T, SCHEMA, h, new Date().toISOString(), text); c.written++
    }
    idb.exec('COMMIT')
  } catch (e) { idb.exec('ROLLBACK'); throw e }
  return { ...c, total: idb.prepare('SELECT COUNT(*) n FROM twin_history').get().n }
}
