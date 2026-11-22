// Stage 5b: the historical baseline layer (everything isolated from the live twin/coach by construction):
//   intel.db  daily_feat_hist   one row per day 2024-09-01 .. day before CANON_CUTOFF (Garmin-primary: activities + health)
//   intel.db  history_month     monthly aggregates (also the source of the memory roll-ups)
//   intel.db  athlete_baseline  CLOSED intervals under distinct names 'garmin:hr800' / 'garmin:ef' (the twin only reads name='hr800')
//   memory.db semantic roll-ups per month + one episode per long run, status='archived' (retrieval defaults to status='active'), created_by='garmin-import'
// Idempotent: tables are rebuilt, baselines upserted on (name, valid_from), memory rows keyed by (source='garmin', source_ref) and updated in place.
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { openDb } from './db.js'
import { openIntel } from './fitsession.js'
import { CANON_CUTOFF } from './link.js'

const dataDir = () => process.env.DATA_DIR || path.resolve('server/data')
const RUNS = new Set(['running', 'treadmill_running', 'trail_running'])
const mean = (v) => { v = v.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const sd = (v) => { v = v.filter((x) => x != null && Number.isFinite(x)); if (v.length < 2) return null; const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) }
const r = (x, n = 1) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n)
const mmss = (s) => (s == null ? null : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const hms = (s) => (s == null ? null : `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}` }
const dayRange = (a, b) => { const out = []; for (let d = new Date(a + 'T00:00:00Z'); d.toISOString().slice(0, 10) < b; d = new Date(d.getTime() + 864e5)) out.push(d.toISOString().slice(0, 10)); return out }

export function buildTables(idb) {
  idb.exec(`CREATE TABLE IF NOT EXISTS daily_feat_hist (date TEXT PRIMARY KEY, run_km REAL, run_min REAL, run_n INTEGER, walk_min REAL, strength_n INTEGER, other_n INTEGER, tl_garmin REAL, sleep_min REAL, sleep_score REAL, rhr REAL, hrv REAL,
    stress_avg REAL, bb_high REAL, bb_low REAL, readiness REAL, steps REAL, weight_kg REAL, acute_load REAL, chronic_load REAL, acwr REAL, era TEXT NOT NULL DEFAULT 'garmin_hist');
  CREATE TABLE IF NOT EXISTS history_month (month TEXT PRIMARY KEY, run_n INTEGER, run_km REAL, run_min REAL, long_run_km REAL, walk_n INTEGER, strength_n INTEGER, other_n INTEGER, ef_mean REAL, ef_n INTEGER, hr800_mean REAL, pace_hr150_mean REAL,
    sleep_h REAL, sleep_score REAL, rhr REAL, hrv REAL, stress REAL, readiness REAL, bb_high REAL, weight_kg REAL, vo2max REAL, pred_5k_s REAL, pred_10k_s REAL, pred_hm_s REAL, pred_m_s REAL, acwr REAL, health_days INTEGER, era TEXT NOT NULL DEFAULT 'garmin_hist');`)
}

export function build({ gdb = openDb(), idb = openIntel() } = {}) {
  buildTables(idb)
  const acts = gdb.prepare('SELECT * FROM g_activity WHERE date_local < ? ORDER BY start_ms').all(CANON_CUTOFF)
  const uds = new Map(gdb.prepare('SELECT * FROM g_uds_day').all().map((x) => [x.date, x])), slp = new Map(gdb.prepare('SELECT * FROM g_sleep').all().map((x) => [x.date, x]))
  const rdy = new Map(gdb.prepare("SELECT date, score FROM g_readiness WHERE context='AFTER_WAKEUP_RESET' OR context IS NULL ORDER BY ts").all().map((x) => [x.date, x.score]))
  const hrv = new Map(gdb.prepare("SELECT date, value FROM g_health_status WHERE metric='HRV' AND value > 0").all().map((x) => [x.date, x.value]))
  const acw = new Map(gdb.prepare('SELECT * FROM g_acwr ORDER BY ts').all().map((x) => [x.date, x])), wt = gdb.prepare('SELECT ts, weight_kg FROM g_weight ORDER BY ts').all()
  const byDay = new Map(); for (const a of acts) (byDay.get(a.date_local) || byDay.set(a.date_local, []).get(a.date_local)).push(a)
  const days = dayRange('2024-09-01', CANON_CUTOFF), put = idb.prepare(`INSERT OR REPLACE INTO daily_feat_hist (date, run_km, run_min, run_n, walk_min, strength_n, other_n, tl_garmin, sleep_min, sleep_score, rhr, hrv, stress_avg, bb_high, bb_low, readiness, steps, weight_kg, acute_load, chronic_load, acwr)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  idb.exec('BEGIN')
  try {
    for (const d of days) {
      const A = byDay.get(d) || [], run = A.filter((a) => RUNS.has(a.sport)), u = uds.get(d) || {}, s = slp.get(d) || {}, w = wt.filter((x) => x.ts.slice(0, 10) <= d).at(-1), ac = acw.get(d) || {}
      put.run(d, r((run.reduce((t, a) => t + (a.distance_m || 0), 0)) / 1000, 2), r(run.reduce((t, a) => t + (a.duration_s || 0), 0) / 60), run.length, r(A.filter((a) => a.sport === 'walking').reduce((t, a) => t + (a.duration_s || 0), 0) / 60),
        A.filter((a) => /strength|hiit/.test(a.sport)).length, A.filter((a) => !RUNS.has(a.sport) && !/walking|strength|hiit/.test(a.sport)).length, r(A.reduce((t, a) => t + (a.training_load || 0), 0)) || null,
        s.total_s ? r(s.total_s / 60) : null, s.score ?? null, u.rhr ?? null, hrv.get(d) ?? null, u.stress_avg ?? null, u.bb_high ?? null, u.bb_low ?? null, rdy.get(d) ?? null, u.steps ?? null, w?.weight_kg ?? null, ac.acute ?? null, ac.chronic ?? null, ac.ratio ?? null)
    }
    idb.exec('DELETE FROM history_month')
    const months = [...new Set(days.map((d) => d.slice(0, 7)))], H = idb.prepare('SELECT * FROM daily_feat_hist WHERE date LIKE ?'), F = idb.prepare('SELECT * FROM fit_session_hist WHERE date LIKE ? AND sport LIKE ?')
    const mput = idb.prepare(`INSERT INTO history_month (month, run_n, run_km, run_min, long_run_km, walk_n, strength_n, other_n, ef_mean, ef_n, hr800_mean, pace_hr150_mean, sleep_h, sleep_score, rhr, hrv, stress, readiness, bb_high, weight_kg, vo2max, pred_5k_s, pred_10k_s, pred_hm_s, pred_m_s, acwr, health_days) VALUES (${Array(27).fill('?').join(',')})`)
    const bput = idb.prepare('INSERT INTO athlete_baseline (name, valid_from, valid_to, value, sd, n, source) VALUES (?,?,?,?,?,?,?) ON CONFLICT(name, valid_from) DO UPDATE SET valid_to=excluded.valid_to, value=excluded.value, sd=excluded.sd, n=excluded.n, source=excluded.source')
    for (const m of months) {
      const D = H.all(m + '%'), MA = acts.filter((a) => a.date_local.startsWith(m)), runs = MA.filter((a) => RUNS.has(a.sport)), fs = F.all(m + '%', 'running').filter((f) => f.run_share >= 0.9 && f.distance_m >= 3000 && f.distance_m <= 15000 && f.ef != null)
      const mx = gdb.prepare("SELECT vo2max FROM g_maxmet WHERE date LIKE ? AND sport='RUNNING' ORDER BY date DESC LIMIT 1").get(m + '%'), rp = gdb.prepare('SELECT * FROM g_race_pred WHERE date LIKE ? ORDER BY date DESC, ts DESC LIMIT 1').get(m + '%')
      const ef = fs.map((f) => f.ef), hr = fs.map((f) => f.hr800).filter((x) => x != null), ph = fs.map((f) => f.pace_hr150).filter((x) => x != null)
      mput.run(m, runs.length, r(runs.reduce((t, a) => t + (a.distance_m || 0), 0) / 1000), r(runs.reduce((t, a) => t + (a.duration_s || 0), 0) / 60), r(Math.max(0, ...runs.map((a) => (a.distance_m || 0) / 1000))), MA.filter((a) => a.sport === 'walking').length,
        MA.filter((a) => /strength|hiit/.test(a.sport)).length, MA.filter((a) => !RUNS.has(a.sport) && !/walking|strength|hiit/.test(a.sport)).length, r(mean(ef), 3), ef.length, r(mean(hr)), r(mean(ph)),
        r(mean(D.map((x) => x.sleep_min)) / 60, 2), r(mean(D.map((x) => x.sleep_score))), r(mean(D.map((x) => x.rhr))), r(mean(D.map((x) => x.hrv))), r(mean(D.map((x) => x.stress_avg))), r(mean(D.map((x) => x.readiness))), r(mean(D.map((x) => x.bb_high))),
        r(D.filter((x) => x.weight_kg != null).at(-1)?.weight_kg), mx?.vo2max ?? null, rp?.t5k_s ?? null, rp?.t10k_s ?? null, rp?.thalf_s ?? null, rp?.tmar_s ?? null, r(mean(D.map((x) => x.acwr)), 2), D.filter((x) => x.sleep_min != null || x.rhr != null).length)
      const from = m + '-01', to = nextMonth(m) + '-01'
      if (hr.length >= 3) bput.run('garmin:hr800', from, to, r(mean(hr)), r(sd(hr)), hr.length, 'garmin_hist steady runs ' + m)
      if (ef.length >= 3) bput.run('garmin:ef', from, to, r(mean(ef), 3), r(sd(ef), 3), ef.length, 'garmin_hist steady runs ' + m)
    }
    idb.exec('COMMIT')
  } catch (e) { idb.exec('ROLLBACK'); throw e }
  return { daily_feat_hist: idb.prepare('SELECT COUNT(*) n FROM daily_feat_hist').get().n, history_month: idb.prepare('SELECT COUNT(*) n FROM history_month').get().n, baselines: idb.prepare("SELECT COUNT(*) n FROM athlete_baseline WHERE source LIKE 'garmin_hist%'").get().n }
}

export function monthText(h) {
  const p = [`Garmin history ${h.month}: ${h.run_n} runs, ${h.run_km ?? 0} km${h.long_run_km ? ` (longest ${h.long_run_km} km)` : ''}; ${h.strength_n} strength, ${h.walk_n} walks, ${h.other_n} other.`]
  if (h.ef_n) p.push(`Steady runs (n=${h.ef_n}): EF ${h.ef_mean}${h.hr800_mean ? `, HR at 8:00/km ${h.hr800_mean}` : ''}${h.pace_hr150_mean ? `, pace at HR150 ${mmss(h.pace_hr150_mean)}/km` : ''}.`)
  const hp = []; if (h.sleep_h) hp.push(`sleep ${h.sleep_h} h${h.sleep_score ? ` (score ${h.sleep_score})` : ''}`); if (h.rhr) hp.push(`RHR ${h.rhr}`); if (h.hrv) hp.push(`HRV ${h.hrv}`); if (h.stress) hp.push(`stress ${h.stress}`)
  if (h.bb_high) hp.push(`Body Battery high ${h.bb_high}`); if (h.readiness) hp.push(`readiness ${h.readiness}`); if (hp.length) p.push(`Health (${h.health_days} days with data): ${hp.join(', ')}.`)
  const pr = [h.pred_5k_s && `5K ${mmss(h.pred_5k_s)}`, h.pred_10k_s && `10K ${mmss(h.pred_10k_s)}`, h.pred_hm_s && `HM ${hms(h.pred_hm_s)}`, h.pred_m_s && `M ${hms(h.pred_m_s)}`].filter(Boolean)
  if (pr.length) p.push(`Garmin race predictor at month end: ${pr.join(', ')}${h.vo2max ? `; Garmin VO2max ${h.vo2max}` : ''}.`)
  p.push('Source: Garmin archive (primary source before 2026). Readiness, stress, Body Battery, load and race predictions are Garmin-scale metrics, not comparable with COROS values.')
  return p.join('\n')
}

// memory writes: (source='garmin', source_ref) is the identity; text changes update in place (FTS trigger follows); everything archived + never locked
export async function writeMemory({ idb = openIntel(), mdb = new DatabaseSync(path.join(dataDir(), 'memory.db')) } = {}) {
  mdb.exec('PRAGMA busy_timeout = 15000'); const now = new Date().toISOString(), c = { created: 0, updated: 0, same: 0 }
  const sel = mdb.prepare("SELECT id, body, title FROM memory WHERE source='garmin' AND source_ref=?")
  const ins = mdb.prepare(`INSERT INTO memory (tier, kind, title, body, payload, evidence_tag, n, confidence, status, locked, supersedes, valid_from, valid_to, source, source_ref, created_by, hash, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'archived', 0, NULL, ?, ?, 'garmin', ?, 'garmin-import', ?, ?, ?)`), audit = mdb.prepare('INSERT INTO memory_audit (at, run_id, action, memory_id, detail) VALUES (?,?,?,?,?)')
  const crypto = await import('node:crypto'), sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
  const upsert = (m) => {
    const ex = sel.get(m.ref)
    if (!ex) { const id = Number(ins.run(m.tier, m.kind, m.title, m.body, m.payload ? JSON.stringify(m.payload) : null, 'MEASURED', 1, null, m.from, m.to, m.ref, sha(`${m.tier}|${m.kind}|${m.title}|${m.body}`), now, now).lastInsertRowid); audit.run(now, null, 'garmin_import', id, JSON.stringify({ ref: m.ref })); c.created++ }
    else if (ex.body !== m.body || ex.title !== m.title) { mdb.prepare('UPDATE memory SET title=?, body=?, hash=?, updated_at=? WHERE id=?').run(m.title, m.body, sha(`${m.tier}|${m.kind}|${m.title}|${m.body}`), now, ex.id); audit.run(now, null, 'garmin_import_update', ex.id, JSON.stringify({ ref: m.ref })); c.updated++ }
    else c.same++
  }
  mdb.exec('BEGIN')
  try {
    for (const h of idb.prepare('SELECT * FROM history_month ORDER BY month').all()) upsert({ tier: 'semantic', kind: 'garmin_month', title: `Garmin history ${h.month}`, body: monthText(h), ref: 'garmin:' + h.month, from: h.month + '-01', to: nextMonth(h.month) + '-01', payload: { month: h.month } })
    for (const f of idb.prepare("SELECT * FROM fit_session_hist WHERE sport='running' AND distance_m >= 15000 AND dup_of IS NULL ORDER BY date").all()) {
      const m = JSON.parse(f.metrics || '{}'), pace = f.run_pace, body = `[EPISODE long run ${f.date} · Garmin archive]\n${r(f.distance_m / 1000, 2)} km in ${hms(f.elapsed_s)} · run pace ${mmss(pace)}/km @ HR ${r(f.run_hr, 0)} · EF ${r(f.ef, 3)}${f.drift_pahr != null ? ` · pace/HR drift ${r(f.drift_pahr, 3)}` : ''}${f.gain_m != null ? ` · +${r(f.gain_m, 0)} m` : ''}\nHistorical session (Garmin-primary era); zones and metrics computed with the current athlete thresholds.`
      upsert({ tier: 'episodic', kind: 'session', title: `Run ${f.date} ${r(f.distance_m / 1000, 1)} km`, body, ref: f.label_id, from: f.date, to: null, payload: { label_id: f.label_id } })
    }
    mdb.exec('COMMIT')
  } catch (e) { mdb.exec('ROLLBACK'); throw e }
  return c
}
