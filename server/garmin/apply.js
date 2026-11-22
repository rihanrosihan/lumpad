// Stage 4: project staged Garmin data into lumpad.db — ADDITIVE ONLY (new nullable columns, new tables, new rows). Never updates existing data columns.
//  * matched sessions (190+5): the existing COROS row stays the app row (stable id, laps, gear, memories, graph nodes); Garmin attaches as
//    `activity_enrichment` and `activities.garmin_id/primary_source` (garmin before CANON_CUTOFF, coros from it)  — see blueprint section 12, "design change".
//  * Garmin-only sessions: new rows id 'garmin:<id>', source='garmin', era='garmin_hist'. All source='coros' readers ignore them by construction.
//  * health: new table health_daily_garmin + view health_merged (garmin first before the cutoff, coros first from it).
// Frozen-history fingerprint (before/after) proves existing rows are untouched.
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { openDb } from './db.js'
import { matchActivities, winnerFor, CANON_CUTOFF } from './link.js'

const SPORT = { running: 'Run', treadmill_running: 'Run', trail_running: 'Run', walking: 'Walk', hiking: 'Hike', strength_training: 'Strength', hiit: 'Strength', indoor_cardio: 'Workout', cycling: 'Ride', indoor_cycling: 'Ride',
  paddelball: 'Padel', soccer: 'Soccer', pilates: 'Pilates', lap_swimming: 'Swim', badminton: 'Badminton', softball: 'Softball', breathwork: 'Breathwork', assistance: 'Assistance' }
export const liveSport = (s) => SPORT[s] || (s ? s[0].toUpperCase() + s.slice(1) : 'Other')

const ADD = [['activities', 'era', 'TEXT'], ['activities', 'garmin_id', 'INTEGER'], ['activities', 'primary_source', 'TEXT']]
const DDL = `
CREATE TABLE IF NOT EXISTS activity_enrichment (activity_id TEXT PRIMARY KEY, garmin_id INTEGER NOT NULL, primary_source TEXT NOT NULL, linked_by TEXT,
  name TEXT, location TEXT, aerobic_te REAL, anaerobic_te REAL, te_label TEXT, training_load_garmin REAL, vo2max REAL, hr_zone_s TEXT, power_zone_s TEXT, feel REAL, rpe REAL,
  body_battery_diff REAL, sweat_ml REAL, stress_start REAL, stress_end REAL, stress_avg REAL, resp_avg REAL, temp_min_c REAL, temp_max_c REAL, gct_ms REAL, vo_cm REAL, stride_m REAL, vratio REAL, norm_power REAL,
  exercise_sets_json TEXT, split_summaries_json TEXT, fit_id TEXT, imported_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS health_daily_garmin (date TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'garmin',
  sleep_total_min REAL, sleep_deep_min REAL, sleep_light_min REAL, sleep_rem_min REAL, sleep_awake_min REAL, sleep_score REAL, sleep_awake_count REAL, sleep_hr_avg REAL, spo2_avg REAL, spo2_low REAL, sleep_resp_avg REAL, sleep_stress REAL,
  resting_hr REAL, hrv_value REAL, hrv_lo REAL, hrv_hi REAL, hrv_status TEXT, stress_avg REAL, stress_max REAL, steps REAL, kcal_active REAL, kcal_total REAL, intensity_min REAL,
  bb_high REAL, bb_low REAL, bb_charged REAL, bb_drained REAL, readiness_score REAL, readiness_level TEXT, readiness_feedback TEXT, acute_load REAL, chronic_load REAL, acwr REAL, weight_kg REAL, imported_at TEXT NOT NULL);
DROP VIEW IF EXISTS health_merged;
CREATE VIEW health_merged AS
  SELECT d.date,
    CASE WHEN d.date < '${CANON_CUTOFF}' THEN COALESCE(g.sleep_total_min, h.sleep_total_min) ELSE COALESCE(h.sleep_total_min, g.sleep_total_min) END AS sleep_total_min,
    CASE WHEN d.date < '${CANON_CUTOFF}' THEN COALESCE(g.sleep_deep_min, h.sleep_deep_min) ELSE COALESCE(h.sleep_deep_min, g.sleep_deep_min) END AS sleep_deep_min,
    CASE WHEN d.date < '${CANON_CUTOFF}' THEN COALESCE(g.sleep_rem_min, h.sleep_rem_min) ELSE COALESCE(h.sleep_rem_min, g.sleep_rem_min) END AS sleep_rem_min,
    CASE WHEN d.date < '${CANON_CUTOFF}' THEN COALESCE(g.resting_hr, h.resting_hr) ELSE COALESCE(h.resting_hr, g.resting_hr) END AS resting_hr,
    CASE WHEN d.date < '${CANON_CUTOFF}' THEN COALESCE(g.stress_avg, h.stress_avg) ELSE COALESCE(h.stress_avg, g.stress_avg) END AS stress_avg,
    CASE WHEN d.date < '${CANON_CUTOFF}' THEN COALESCE(g.steps, h.steps) ELSE COALESCE(h.steps, g.steps) END AS steps,
    CASE WHEN d.date < '${CANON_CUTOFF}' THEN COALESCE(g.hrv_value, h.hrv_avg) ELSE COALESCE(h.hrv_avg, g.hrv_value) END AS hrv,
    CASE WHEN g.date IS NOT NULL AND h.date IS NOT NULL THEN 'both' WHEN g.date IS NOT NULL THEN 'garmin' ELSE 'coros' END AS sources,
    CASE WHEN g.resting_hr IS NOT NULL AND h.resting_hr IS NOT NULL AND ABS(g.resting_hr - h.resting_hr) > 4 THEN 1 ELSE 0 END AS rhr_disagree,
    g.sleep_score AS garmin_sleep_score, g.readiness_score AS garmin_readiness, g.bb_high AS garmin_bb_high, g.bb_low AS garmin_bb_low, g.spo2_avg AS garmin_spo2
  FROM (SELECT date FROM health_daily UNION SELECT date FROM health_daily_garmin) d
  LEFT JOIN health_daily h ON h.date = d.date LEFT JOIN health_daily_garmin g ON g.date = d.date;`

const has = (db, t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c)
const cols = (db, t, drop = []) => db.prepare(`PRAGMA table_info(${t})`).all().map((x) => x.name).filter((n) => !drop.includes(n))

// Frozen-history fingerprint: rows that existed before this import, without volatile/new columns (pulled_at + the 3 new ones).
export function fingerprint(live, upTo = '2026-11-01') {
  const out = {}, H = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)
  const ac = cols(live, 'activities', ['pulled_at', 'era', 'garmin_id', 'primary_source']).join(',')
  const a = live.prepare(`SELECT ${ac} FROM activities WHERE date < ? AND id NOT LIKE 'garmin:%' ORDER BY id`).all(upTo); out.activities = { n: a.length, h: H(a) }
  const lc = cols(live, 'laps').join(','), l = live.prepare(`SELECT ${lc} FROM laps WHERE activity_id IN (SELECT id FROM activities WHERE date < ? AND id NOT LIKE 'garmin:%') ORDER BY activity_id, idx`).all(upTo); out.laps = { n: l.length, h: H(l) }
  const hc = cols(live, 'health_daily', ['pulled_at']).join(','), h = live.prepare(`SELECT ${hc} FROM health_daily WHERE date < ? ORDER BY date`).all(upTo); out.health_daily = { n: h.length, h: H(h) }
  const fc = cols(live, 'fitness_daily', ['pulled_at']).join(','), f = live.prepare(`SELECT ${fc} FROM fitness_daily WHERE date < ? ORDER BY date`).all(upTo); out.fitness_daily = { n: f.length, h: H(f) }
  const gc = cols(live, 'gear', ['pulled_at', 'distance_m']).join(','), g = live.prepare(`SELECT ${gc} FROM gear ORDER BY id`).all(); out.gear = { n: g.length, h: H(g) }
  return out
}

export function plan({ gdb = openDb(), live }) {
  const g = gdb.prepare('SELECT * FROM g_activity').all()
  const l = live.prepare("SELECT id, start_ts*1000 AS start_ms, sport, distance_m, duration_s, date, source FROM activities WHERE start_ts IS NOT NULL AND id NOT LIKE 'garmin:%'").all()
  const M = matchActivities(g.map((a) => ({ ...a })), l), byId = new Map(g.map((a) => [a.activity_id, a]))
  return { g, byId, M }
}

export function apply({ gdb = openDb(), live, dry = true, now = new Date().toISOString() }) {
  const before = fingerprint(live), { byId, M } = plan({ gdb, live }), rep = { dry, cutoff: CANON_CUTOFF, matched: M.pairs.length, garmin_only: M.garminOnly.length, before }
  if (dry) return rep
  live.exec('BEGIN IMMEDIATE')
  try {
    for (const [t, c, ty] of ADD) if (!has(live, t, c)) live.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ty}`)
    live.exec(DDL)
    const enr = live.prepare(`INSERT INTO activity_enrichment (activity_id, garmin_id, primary_source, linked_by, name, location, aerobic_te, anaerobic_te, te_label, training_load_garmin, vo2max, hr_zone_s, power_zone_s, feel, rpe, body_battery_diff, sweat_ml,
      stress_start, stress_end, stress_avg, resp_avg, temp_min_c, temp_max_c, gct_ms, vo_cm, stride_m, vratio, norm_power, exercise_sets_json, split_summaries_json, fit_id, imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(activity_id) DO UPDATE SET garmin_id=excluded.garmin_id, primary_source=excluded.primary_source, linked_by=excluded.linked_by, imported_at=excluded.imported_at`)
    const E = (id, a, ps, by) => enr.run(id, a.activity_id, ps, by, a.name, a.location, a.aerobic_te, a.anaerobic_te, a.te_label, a.training_load, a.vo2max, a.hr_zone_s, a.power_zone_s, a.feel, a.rpe, a.body_battery_diff, a.sweat_ml,
      a.stress_start, a.stress_end, a.stress_avg, a.resp_avg, a.temp_min_c, a.temp_max_c, a.gct_ms, a.vo_cm, a.stride_m, a.vratio, a.norm_power, a.exercise_sets_json, a.split_summaries_json, a.fit_id, now)
    const mark = live.prepare('UPDATE activities SET garmin_id=?, primary_source=? WHERE id=? AND garmin_id IS NULL')
    for (const p of M.pairs) { const a = byId.get(p.g), ps = winnerFor(a.date_local) === 'garmin' ? 'garmin' : 'coros'; mark.run(a.activity_id, ps, p.l); E(p.l, a, ps, p.d <= 5 ? 'exact-start' : 'time+dist') }
    const ins = live.prepare(`INSERT OR IGNORE INTO activities (id, source, source_id, date, start_ts, sport, name, distance_m, duration_s, avg_hr, avg_pace_s_km, cadence, power, elevation_m, calories, temp_c, location, pulled_at, max_hr, era, garmin_id, primary_source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const a of M.garminOnly) {
      const id = 'garmin:' + a.activity_id, dist = a.distance_m > 0 ? a.distance_m : null, pace = dist && a.duration_s ? Math.round((a.duration_s / dist) * 1000 * 10) / 10 : null
      const temp = a.temp_min_c != null && a.temp_max_c != null ? (a.temp_min_c + a.temp_max_c) / 2 : null
      ins.run(id, 'garmin', String(a.activity_id), a.date_local, Math.round(a.start_ms / 1000), liveSport(a.sport), a.name, dist, a.duration_s, a.avg_hr, pace, a.cadence_spm, a.avg_power, a.elev_gain_m, a.calories, temp, a.location, now, a.max_hr, 'garmin_hist', a.activity_id, 'garmin')
      E(id, a, 'garmin', 'garmin-only')
    }
    // daily health
    const hd = live.prepare(`INSERT INTO health_daily_garmin (date, sleep_total_min, sleep_deep_min, sleep_light_min, sleep_rem_min, sleep_awake_min, sleep_score, sleep_awake_count, sleep_hr_avg, spo2_avg, spo2_low, sleep_resp_avg, sleep_stress,
      resting_hr, hrv_value, hrv_lo, hrv_hi, hrv_status, stress_avg, stress_max, steps, kcal_active, kcal_total, intensity_min, bb_high, bb_low, bb_charged, bb_drained, readiness_score, readiness_level, readiness_feedback, acute_load, chronic_load, acwr, weight_kg, imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET imported_at=excluded.imported_at`)
    const days = gdb.prepare(`SELECT date FROM g_uds_day UNION SELECT date FROM g_sleep UNION SELECT date FROM g_readiness UNION SELECT date FROM g_health_status UNION SELECT date FROM g_acwr`).all().map((r) => r.date).filter(Boolean).sort()
    const q = (s) => gdb.prepare(s), U = q('SELECT * FROM g_uds_day WHERE date=?'), S = q('SELECT * FROM g_sleep WHERE date=?'), R = q("SELECT * FROM g_readiness WHERE date=? ORDER BY (context='AFTER_WAKEUP_RESET') DESC, ts DESC LIMIT 1"),
      HS = q('SELECT metric,value,lo,hi,status FROM g_health_status WHERE date=?'), A = q('SELECT * FROM g_acwr WHERE date=? ORDER BY ts DESC LIMIT 1'), W = q('SELECT weight_kg FROM g_weight WHERE ts<=? ORDER BY ts DESC LIMIT 1')
    const m = (x) => (x == null ? null : Math.round((x / 60) * 10) / 10)
    for (const d of days) {
      if (d > '2026-02-01') continue
      const u = U.get(d) || {}, s = S.get(d) || {}, r = R.get(d) || {}, hs = Object.fromEntries(HS.all(d).map((x) => [x.metric, x])), a = A.get(d) || {}, w = W.get(d + 'Z')
      const hrv = hs.HRV || {}, rhr = u.rhr ?? hs.HR?.value ?? null
      hd.run(d, m(s.total_s), m(s.deep_s), m(s.light_s), m(s.rem_s), m(s.awake_s), s.score ?? null, s.awake_count ?? null, s.hr_avg ?? null, s.spo2_avg ?? hs.SPO2?.value ?? null, s.spo2_low ?? null, s.resp_avg ?? null, s.avg_stress ?? null,
        rhr, hrv.value ?? null, hrv.lo || null, hrv.hi || null, hrv.status ?? null, u.stress_avg ?? null, u.stress_max ?? null, u.steps ?? null, u.kcal_active ?? null, u.kcal_total ?? null, (u.mod_min || 0) + 2 * (u.vig_min || 0) || null,
        u.bb_high ?? null, u.bb_low ?? null, u.bb_charged ?? null, u.bb_drained ?? null, r.score ?? null, r.level ?? null, r.feedback_short ?? null, a.acute ?? null, a.chronic ?? null, a.ratio ?? null, w?.weight_kg ?? null, now)
    }
    const after = fingerprint(live)
    for (const k of Object.keys(before)) if (before[k].h !== after[k].h || before[k].n !== after[k].n) throw new Error(`fingerprint changed for ${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(after[k])}`)
    live.exec('COMMIT'); rep.after = after
  } catch (e) { live.exec('ROLLBACK'); throw e }
  rep.counts = Object.fromEntries(['activities', 'activity_enrichment', 'health_daily_garmin'].map((t) => [t, live.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])); rep.counts.activities_garmin = live.prepare("SELECT COUNT(*) n FROM activities WHERE source='garmin'").get().n
  return rep
}
export const openLive = (file = path.join(process.env.DATA_DIR || 'server/data', 'lumpad.db')) => { const d = new DatabaseSync(file); d.exec('PRAGMA busy_timeout = 15000'); return d }

// Laps for Garmin-only runs (the 134 inserted rows have none): per-km rows computed from the FIT stream (fit_session_hist.km), same shape as COROS laps.
// Additive (INSERT OR IGNORE on the PK), guarded by the same frozen-history fingerprint; idempotent.
export function lapRows(act, kmJson) {
  const km = typeof kmJson === 'string' ? JSON.parse(kmJson) : kmJson; if (!Array.isArray(km) || !km.length) return []
  const n = km.length, total = act.distance_m || null, rnd = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d)
  return km.map((k, i) => ({ idx: k.km ?? i + 1, distance_m: i < n - 1 ? 1000 : total ? Math.max(0, rnd(total - (n - 1) * 1000, 0)) : rnd((k.sec / k.pace) * 1000, 0), duration_s: k.sec, avg_pace_s_km: k.pace, avg_hr: k.hr ?? null, cadence: k.cad ?? null, power: k.power ?? null,
    gct_ms: k.gct ?? null, max_hr: null, stride_m: k.step ?? null, vo_cm: null, vratio_pct: k.vr ?? null }))
}
export function projectLaps({ live, idb, dry = true }) {
  const before = fingerprint(live), acts = live.prepare("SELECT id, distance_m, garmin_id FROM activities WHERE source='garmin' AND sport='Run'").all()
  const km = idb.prepare('SELECT km FROM fit_session_hist WHERE garmin_id=?'), have = live.prepare('SELECT COUNT(*) n FROM laps WHERE activity_id=?')
  const todo = acts.map((a) => ({ a, rows: lapRows(a, km.get(a.garmin_id)?.km), has: have.get(a.id).n })).filter((x) => x.rows.length && !x.has)
  const rep = { dry, garmin_runs: acts.length, with_laps_to_add: todo.length, laps_to_add: todo.reduce((s, x) => s + x.rows.length, 0) }
  if (dry) return rep
  live.exec('BEGIN IMMEDIATE')
  try {
    const ins = live.prepare('INSERT OR IGNORE INTO laps (activity_id, idx, distance_m, duration_s, avg_pace_s_km, avg_hr, cadence, power, gct_ms, max_hr, stride_m, vo_cm, vratio_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    for (const { a, rows } of todo) for (const l of rows) ins.run(a.id, l.idx, l.distance_m, l.duration_s, l.avg_pace_s_km, l.avg_hr, l.cadence, l.power, l.gct_ms, l.max_hr, l.stride_m, l.vo_cm, l.vratio_pct)
    const after = fingerprint(live); for (const k of Object.keys(before)) if (before[k].h !== after[k].h) throw new Error('fingerprint changed for ' + k)
    live.exec('COMMIT'); rep.after = after
  } catch (e) { live.exec('ROLLBACK'); throw e }
  rep.laps_total = live.prepare("SELECT COUNT(*) n FROM laps WHERE activity_id LIKE 'garmin:%'").get().n
  return rep
}
