// Template statistics (P5, FR-KG-1): how this athlete actually responds to each template. Derived nightly, rebuildable, never read at request time by the LLM path.
//   adherence : port of lumpadd/internal/decision/adherence.go ComputeAdherence (distance 45 % / time in zone 35 % / pace 20 %)
//   pain48h   : share of executions followed by pain >= 2 within 48 h (daily_log)
//   skip_rate : planned sessions with no run that day
import { addDays } from '../../src/lib/dates.js'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export function adherenceScore(p, a) {
  if (!(p.plannedKm > 0)) return a.actualKm > 0 ? 70 : 100
  if (!(a.actualKm > 0)) return 0
  const dist = clamp(100 * (1 - Math.abs(a.actualKm / p.plannedKm - 1) / 0.5), 0, 100), tiz = clamp(a.tizPct ?? 0, 0, 100)
  let pace = 100; if (p.targetPaceSK > 0 && a.paceSK > 0) pace = clamp(100 * (1 - Math.abs((a.paceSK - p.targetPaceSK) / p.targetPaceSK * 100) / 15), 0, 100)
  return Math.round((0.45 * dist + 0.35 * tiz + 0.2 * pace) * 10) / 10
}
// share of run time in the HR zones the template's main steps use (z6.hr_s = seconds per zone, index 0..6, as stored by the FIT pipeline)
export function tizOf(steps, z6) {
  const zs = [...new Set((steps || []).flatMap((s) => (s.rep ? s.steps : [s])).filter((s) => s.z && s.m && s.t !== 'wu' && s.t !== 'cd').map((s) => s.z))]
  const tot = (z6 || []).reduce((a, b) => a + b, 0); if (!zs.length || !tot) return null
  return Math.round(100 * zs.reduce((a, z) => a + (z6[z] || 0), 0) / tot * 10) / 10
}
// sessions: [{ date, template_id, km, steps }] (past planned run days); runs: {date: [{km, paceSK, z6, hrDrift}]}; pain: {date: maxPain}; rpe: {date: n}
export function computeTemplateStats({ sessions, runs = {}, pain = {}, rpe = {}, today }) {
  const acc = {}
  for (const s of sessions) {
    if (!s.template_id || !(s.km > 0) || s.date >= today) continue
    const r = (runs[s.date] || []).filter((x) => x.km >= 1).sort((a, b) => b.km - a.km)[0], a = (acc[s.template_id] ||= { n: 0, skipped: 0, adh: [], tiz: [], drift: [], rpe: [], pain: 0, painN: 0, last: null, lastKm: null })
    if (!r) { a.skipped++; continue }
    a.n++; const tiz = tizOf(s.steps, r.z6); a.adh.push(adherenceScore({ plannedKm: s.km }, { actualKm: r.km, tizPct: tiz ?? 0, paceSK: r.paceSK })); if (tiz != null) a.tiz.push(tiz); if (r.hrDrift != null) a.drift.push(r.hrDrift); if (rpe[s.date] != null) a.rpe.push(rpe[s.date])
    const p2 = [s.date, addDays(s.date, 1), addDays(s.date, 2)].map((d) => pain[d]).filter((x) => x != null); if (p2.length) { a.painN++; if (Math.max(...p2) >= 2) a.pain++ }
    if (!a.last || s.date > a.last) { a.last = s.date; a.lastKm = r.km }
  }
  const mean = (v) => (v.length ? Math.round(v.reduce((x, y) => x + y, 0) / v.length * 10) / 10 : null)
  return Object.entries(acc).map(([template_id, a]) => ({ template_id, n: a.n, adherence: mean(a.adh), tiz: mean(a.tiz), hr_drift: mean(a.drift), rpe: mean(a.rpe), pain48h_rate: a.painN ? Math.round(a.pain / a.painN * 100) / 100 : null, skip_rate: a.n + a.skipped ? Math.round(a.skipped / (a.n + a.skipped) * 100) / 100 : null, last_done: a.last, last_km: a.lastKm }))
}
export function saveTemplateStats(db, rows, now = new Date().toISOString()) {
  const ins = db.prepare('INSERT OR REPLACE INTO template_stats (template_id, n, adherence, tiz, hr_drift, rpe, pain48h_rate, skip_rate, last_done, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  for (const r of rows) ins.run(r.template_id, r.n, r.adherence, r.tiz, r.hr_drift, r.rpe, r.pain48h_rate, r.skip_rate, r.last_done, now)
  return rows.length
}
export const loadStats = (db) => Object.fromEntries(db.prepare('SELECT * FROM template_stats').all().map((r) => [r.template_id, { ...r, last_km: null }]))

// the loader: past planned days of the active plan (template from the session row, or the COROS course code of imported days) + the app's runs + FIT zones + pain log
export function refreshTemplateStats(planDb, { appDb, intelDb, today }) {
  const days = planDb.prepare("SELECT a.date, s.template_id, s.steps, s.dose, s.legacy FROM plan_active_day a JOIN plan_session s ON s.id=a.session_id WHERE a.slot=0 AND a.date < ?").all(today)
    .map((r) => { const lg = r.legacy ? JSON.parse(r.legacy) : null; return { date: r.date, template_id: r.template_id || (lg?.code ? 'coros.' + lg.code : null), km: JSON.parse(r.dose || '{}').km ?? lg?.km ?? 0, steps: JSON.parse(r.steps || '[]') } })
  const from = days[0]?.date ?? today, runs = {}, pain = {}
  for (const a of appDb.prepare("SELECT id, date, distance_m, avg_pace_s_km FROM activities WHERE sport='Run' AND date>=? AND date<?").all(from, today)) {
    let z6 = null, drift = null; try { const f = intelDb.prepare('SELECT metrics, run_drift FROM fit_session WHERE activity_id=? OR label_id=?').get(String(a.id), String(a.id).replace(/^coros:/, '')); if (f) { z6 = JSON.parse(f.metrics).z6?.hr_s ?? null; drift = f.run_drift ?? null } } catch {}
    ;(runs[a.date] ||= []).push({ km: (a.distance_m || 0) / 1000, paceSK: a.avg_pace_s_km, z6, hrDrift: drift }) }
  try { for (const l of intelDb.prepare('SELECT date, pain FROM daily_log WHERE pain IS NOT NULL AND date>=?').all(from)) { const v = Object.values(JSON.parse(l.pain)); pain[l.date] = v.length ? Math.max(...v.map(Number)) : 0 } } catch {}
  const rows = computeTemplateStats({ sessions: days, runs, pain, today }); return { rows, saved: saveTemplateStats(planDb, rows) }
}
