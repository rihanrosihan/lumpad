// Outcome evaluation (P5, FR-AUD-4/5): 3-14 days after an applied change, did it help? Port of lumpadd/internal/decision/ledger.go EvaluateOutcome.
// A verdict is written as an 'evaluated' event (the adjustment row itself is append-only). A memory is only ever PROPOSED (candidate + HYPOTHESIS), never promoted.
import { addEvent, wibDate } from './store.js'
import { adherenceScore } from './stats.js'
import { addDays } from '../../src/lib/dates.js'

export function evaluateOutcome(expected, obs) {
  if (!obs.executed) return ['unknown', { executed: false }]
  const d = { executed: true }; let helped = 0, harmed = 0
  if (obs.painMax != null) { d.pain_max = obs.painMax; if (obs.painMax >= 2) harmed++; else if (obs.painMax === 0) helped++ }
  if (obs.compliance != null) { d.compliance_pct = obs.compliance; if (obs.compliance >= 75) helped++; else if (obs.compliance < 50) harmed++ }
  if (obs.hr800Delta != null) { d.hr800_delta = obs.hr800Delta; if (obs.hr800Delta <= 2) helped++; else if (obs.hr800Delta > 5) harmed++ }
  if (typeof expected?.easy_avg_hr_max === 'number' && obs.avgHR != null) { d.avg_hr = obs.avgHR; if (obs.avgHR <= expected.easy_avg_hr_max) helped++; else harmed++ }
  if (harmed > 0) return ['harmed', d]
  if (helped > 0) return ['helped', d]
  return [Object.keys(d).length <= 1 ? 'unknown' : 'neutral', d]
}
// observations for an adjustment from plain data: runs {date: [{km, paceSK, avgHR}]}, pain {date: maxPain}. executed = the scope has passed.
export function observe(adj, { runs = {}, pain = {}, today }) {
  const dates = (adj.diff || []).map((x) => x.date), last = dates.sort().at(-1), exec = !!last && last < today, o = { executed: exec }
  if (!exec) return o
  const pains = []; for (const d of dates) for (let k = 0; k <= 3; k++) { const p = pain[addDays(d, k)]; if (p != null) pains.push(p) }
  if (pains.length) o.painMax = Math.max(...pains)
  const comp = []; for (const x of adj.diff || []) { const want = x.after?.km ?? 0; if (!(want > 0)) continue; const r = (runs[x.date] || []).filter((q) => q.km >= 1).sort((a, b) => b.km - a.km)[0]; comp.push(r ? adherenceScore({ plannedKm: want }, { actualKm: r.km, tizPct: 100, paceSK: 0 }) : 0) }
  if (comp.length) o.compliance = Math.round(comp.reduce((a, b) => a + b, 0) / comp.length * 10) / 10
  const hr = (adj.diff || []).flatMap((x) => (runs[x.date] || []).filter((q) => q.avgHR && q.km >= 1).map((q) => q.avgHR)); if (hr.length) o.avgHR = Math.round(hr.reduce((a, b) => a + b, 0) / hr.length)
  return o
}
const lastEvent = (db, id) => db.prepare('SELECT event FROM plan_adjustment_event WHERE adjustment_id=? ORDER BY id DESC LIMIT 1').get(id)?.event
// loadObs(fromDate, toDate) -> { runs, pain } from the app databases (injected so this stays testable)
export function evaluateOutcomes(db, { today = wibDate(), loadObs, addMemory = null, env = process.env } = {}) {
  const rows = db.prepare("SELECT * FROM plan_adjustment WHERE loop != 'import' AND created_at <= ? AND created_at >= ?").all(addDays(today, -3) + 'T23:59:59Z', addDays(today, -14) + 'T00:00:00Z'), out = []
  for (const a of rows) {
    const ev = db.prepare("SELECT event FROM plan_adjustment_event WHERE adjustment_id=?").all(a.id).map((e) => e.event)
    if (!ev.includes('applied') || ev.includes('reverted') || ev.includes('evaluated')) continue
    const adj = { ...a, diff: JSON.parse(a.diff) }, from = adj.diff.map((x) => x.date).sort()[0] ?? a.scope_from, obs = observe(adj, { ...loadObs(from, addDays(today, 0)), today })
    if (!obs.executed) continue   // its dates have not passed: leave it open (revertible) and look again tomorrow
    const [verdict, detail] = evaluateOutcome(a.expected ? JSON.parse(a.expected) : {}, obs)
    addEvent(db, a.id, 'evaluated', 'system', { verdict, ...detail }); out.push({ id: a.id, verdict, ...detail })
    if (addMemory && env.PLAN_OUTCOME_MEMORY === '1' && (verdict === 'harmed' || verdict === 'helped')) addMemory(outcomeMemory(a, verdict, detail))
  }
  return out
}
// a CANDIDATE hypothesis only: promotion needs the athlete (memory rules); numbers come from the stored evaluation
export const outcomeMemory = (a, verdict, d) => ({ tier: 'episodic', kind: 'plan_outcome', title: `Plan change ${verdict}: ${JSON.parse(a.operators).join(' + ')} ${a.scope_from.slice(5)}`, evidence_tag: 'HYPOTHESIS', status: 'candidate', created_by: 'engine', source: 'plan-engine', source_ref: `adjustment:${a.id}`,
  body: `${a.rationale_det} Outcome after the change: ${verdict}${d.pain_max != null ? `, pain max ${d.pain_max}/10` : ''}${d.compliance_pct != null ? `, followed ${d.compliance_pct} %` : ''}${d.avg_hr != null ? `, average HR ${d.avg_hr}` : ''}. One observation, not a rule.` })
// weekly line for the review (FR-OBS-2)
export function digest(db, from, to) {
  const rows = db.prepare("SELECT a.id, a.loop, a.operators, a.auto, (SELECT event FROM plan_adjustment_event WHERE adjustment_id=a.id ORDER BY id DESC LIMIT 1) last FROM plan_adjustment a WHERE a.loop != 'import' AND substr(a.created_at,1,10) BETWEEN ? AND ?").all(from, to)
  const verdicts = db.prepare("SELECT json_extract(detail,'$.verdict') v, COUNT(*) n FROM plan_adjustment_event e JOIN plan_adjustment a ON a.id=e.adjustment_id WHERE e.event='evaluated' AND substr(a.created_at,1,10) BETWEEN ? AND ? GROUP BY v").all(from, to)
  const by = (k) => rows.filter((r) => r.last === k).length
  return { from, to, changes: rows.length, applied: by('applied') + by('evaluated'), rejected: by('rejected'), expired: by('expired'), reverted: by('reverted'), auto: rows.filter((r) => r.auto).length, verdicts: Object.fromEntries(verdicts.map((x) => [x.v, x.n])), stats: db.prepare('SELECT template_id, n, adherence, pain48h_rate FROM template_stats ORDER BY n DESC LIMIT 8').all() }
}

// runs and pain from the app databases for a date range (read-only)
export function loadObservations(appDb, intelDb, from, to) {
  const runs = {}, pain = {}
  try { for (const a of appDb.prepare("SELECT date, distance_m, avg_hr, avg_pace_s_km FROM activities WHERE sport='Run' AND date>=? AND date<=?").all(from, to)) (runs[a.date] ||= []).push({ km: (a.distance_m || 0) / 1000, avgHR: a.avg_hr, paceSK: a.avg_pace_s_km }) } catch {}
  try { for (const l of intelDb.prepare('SELECT date, pain FROM daily_log WHERE pain IS NOT NULL AND date>=? AND date<=?').all(from, to)) { const v = Object.values(JSON.parse(l.pain)).map(Number); pain[l.date] = v.length ? Math.max(...v) : 0 } } catch {}
  return { runs, pain }
}
