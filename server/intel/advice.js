// Advice → outcome ledger. The coach used to give advice and never learn whether it was followed or whether it helped. Every concrete recommendation is
// recorded with what it asked for (a distance, a heart-rate limit, a rest day) and, once the day has data, resolved against what the athlete actually did.
// Resolution is deterministic (COROS activities + FIT), conservative ('open' until evidence exists), and the athlete can always override it.
import crypto from 'node:crypto'
import { mdb, idb } from './db.js'
import { db as app } from '../store.js'
import { addMemory, audit } from './memory.js'

const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6 }
const now = () => new Date().toISOString()

// ---- reading the advice
// Machine-readable target from the answer's own `target` field, completed from the text when the model left something out.
export function inferTarget(action, asOf, given = {}) {
  const t = String(action || ''), low = t.toLowerCase(), out = { ...given }
  if (out.km == null) { const m = /(\d+(?:[.,]\d+)?)\s*km\b/i.exec(t); if (m) out.km = Number(m[1].replace(',', '.')) }
  if (out.hr_cap_bpm == null) {
    const m = /(?:under|below|at or below|no higher than|no more than|max(?:imum)?(?: of)?|cap(?:ped)?(?: at)?|≤|<=|<|di bawah|maksimal)\s*(\d{3})\b/i.exec(t) || /(?:heart rate|hr|detak jantung)[^.\d]{0,30}(\d{3})\b/i.exec(t)
    if (m && +m[1] >= 100 && +m[1] <= 220) out.hr_cap_bpm = +m[1]
  }
  if (!out.for_date) {
    if (/\b(tomorrow|besok)\b/.test(low)) out.for_date = addDays(asOf, 1)
    else if (/\b(today|tonight|hari ini|malam ini)\b/.test(low)) out.for_date = asOf
    else { const w = Object.keys(WEEKDAYS).find((k) => new RegExp('\\b' + k + '\\b').test(low)); if (w) { const cur = new Date(asOf + 'T12:00:00Z').getUTCDay(); out.for_date = addDays(asOf, ((WEEKDAYS[w] - cur + 7) % 7) || 7) } }
  }
  if (!out.kind) {
    if (/\b(rest day|rest|skip|no run|day off|do not run|don't run|libur|istirahat)\b/.test(low) && out.km == null) out.kind = 'rest'
    else if (out.km != null && /\b(run|jog|easy|long|lari)\b/.test(low)) out.kind = 'session'
    else if (out.hr_cap_bpm != null) out.kind = 'cap'
    else if (/\b(fuel|drink|fluid|eat|carb|gel|hydrat|minum|makan)\b/.test(low)) out.kind = 'fuel'
    else if (/\b(gym|strength|squat|leg|calf)\b/.test(low)) out.kind = 'strength'
    else if (/\b(week|volume|mileage|distance)\b/.test(low)) out.kind = 'volume'
    else out.kind = 'other'
  }
  return out
}

// store the recommendations of one successful run (idempotent per run)
export function recordAdvice(runId, parsed, { asOf = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) } = {}) {
  let n = 0
  ;(parsed?.recommendations || []).forEach((r, idx) => {
    if (!r?.action) return
    const t = inferTarget(r.action, asOf, r.target || {})
    const res = mdb.prepare('INSERT OR IGNORE INTO coach_advice (run_id, idx, created_at, for_date, kind, text, target, status) VALUES (?,?,?,?,?,?,?,?)')
      .run(runId, idx, now(), t.for_date || null, t.kind, String(r.action).slice(0, 400), JSON.stringify(t), t.for_date ? 'open' : 'unknown')
    n += Number(res.changes)
  })
  return n
}

// ---- reading what actually happened on a day
export function actualsOn(date) {
  const runs = app.prepare("SELECT id, distance_m, duration_s, avg_hr FROM activities WHERE source='coros' AND sport='Run' AND date=?").all(date)
  const km = runs.reduce((s, a) => s + (a.distance_m || 0), 0) / 1000
  const dur = runs.reduce((s, a) => s + (a.duration_s || 0), 0)
  const fit = idb.prepare('SELECT run_hr, distance_m FROM fit_session WHERE date=? AND run_hr IS NOT NULL').all(date)
  const hrFit = fit.length ? fit.reduce((s, f) => s + f.run_hr * (f.distance_m || 1), 0) / fit.reduce((s, f) => s + (f.distance_m || 1), 0) : null   // HR while actually running, when the FIT is in
  const hrAvg = runs.length && dur ? runs.reduce((s, a) => s + (a.avg_hr || 0) * (a.duration_s || 0), 0) / dur : null
  const pain = idb.prepare("SELECT pain FROM daily_log WHERE date IN (?, ?) AND pain IS NOT NULL").all(date, addDays(date, 1)).flatMap((l) => { try { return Object.values(JSON.parse(l.pain)) } catch { return [] } }).filter(Number.isFinite)
  return { runs: runs.length, km: Math.round(km * 10) / 10, avg_hr: hrFit != null ? Math.round(hrFit) : hrAvg ? Math.round(hrAvg) : null, hr_source: hrFit != null ? 'fit' : 'coros', pain_max_48h: pain.length ? Math.max(...pain) : null }
}

// ---- judging it (pure; the thresholds are the whole policy)
// session: distance within 80–125 % and (when a cap was given) average run HR within 3 bpm of it = followed; 50–160 % / within 10 bpm = partly; else not.
// rest: no run of 1 km or more = followed; under 3 km = partly. cap: judged on average HR only when a run happened (no run = not applicable).
export function judge(t, a) {
  const hrOk = (cap, hr) => (cap == null || hr == null ? 'na' : hr <= cap + 3 ? 'ok' : hr <= cap + 10 ? 'near' : 'over')
  if (t.kind === 'rest') return a.km < 1 ? 'followed' : a.km < 3 ? 'partly' : 'not_followed'
  if (t.kind === 'session' && t.km > 0) {
    if (!a.runs) return 'not_followed'
    const r = a.km / t.km, h = hrOk(t.hr_cap_bpm, a.avg_hr)
    if (r >= 0.8 && r <= 1.25 && h !== 'over' && h !== 'near') return 'followed'
    if (r >= 0.5 && r <= 1.6 && h !== 'over') return 'partly'
    return 'not_followed'
  }
  if (t.kind === 'cap' || (t.hr_cap_bpm != null && t.kind !== 'rest')) {
    if (!a.runs) return 'void'
    const h = hrOk(t.hr_cap_bpm, a.avg_hr); return h === 'ok' ? 'followed' : h === 'near' ? 'partly' : h === 'over' ? 'not_followed' : 'void'
  }
  return 'void'   // food, strength, volume and open-ended advice cannot be checked from run data; the athlete can mark them by hand
}

// resolve every non-manual advice whose day is today or recent; a day that is not over and has no run yet stays open
export function resolveAdvice(today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)) {
  const rows = mdb.prepare("SELECT * FROM coach_advice WHERE manual = 0 AND for_date IS NOT NULL AND for_date <= ? AND for_date >= ?").all(today, addDays(today, -4)), out = { resolved: 0, open: 0 }
  for (const r of rows) {
    const t = JSON.parse(r.target || '{}'), a = actualsOn(r.for_date), over = r.for_date < today
    if (!over && !a.runs && (t.kind === 'session' || t.kind === 'cap')) { out.open++; continue }      // the day is not over: no evidence yet
    if (!over && t.kind === 'rest' && !a.runs) { out.open++; continue }                                  // a rest day is only kept once it is over
    const status = judge(t, a), ev = JSON.stringify({ ...a, target_km: t.km ?? null, hr_cap: t.hr_cap_bpm ?? null })
    if (status !== r.status || ev !== r.evidence) { mdb.prepare('UPDATE coach_advice SET status=?, evidence=?, resolved_at=? WHERE id=?').run(status, ev, now(), r.id); out.resolved++ }
  }
  return out
}

export function setStatus(id, status, by = 'athlete') {
  if (!['followed', 'partly', 'not_followed', 'void', 'open'].includes(status)) throw Object.assign(new Error('bad status'), { status: 400 })
  const r = mdb.prepare('SELECT id FROM coach_advice WHERE id=?').get(id); if (!r) throw Object.assign(new Error('advice not found'), { status: 404 })
  mdb.prepare('UPDATE coach_advice SET status=?, manual=?, resolved_at=? WHERE id=?').run(status, status === 'open' ? 0 : 1, now(), id); audit('advice:' + status, null, { id, by })
  return mdb.prepare('SELECT * FROM coach_advice WHERE id=?').get(id)
}

// ---- reading the ledger
const DONE = ['followed', 'partly', 'not_followed']
export function adviceSummary({ days = 30, today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) } = {}) {
  const since = addDays(today, -days), rows = mdb.prepare('SELECT * FROM coach_advice WHERE for_date IS NOT NULL AND for_date >= ? ORDER BY for_date DESC, id DESC').all(since)
  const by = {}; for (const r of rows) if (DONE.includes(r.status)) { const b = (by[r.kind] ||= { n: 0, followed: 0, partly: 0, not_followed: 0 }); b.n++; b[r.status]++ }
  const recent = rows.filter((r) => DONE.includes(r.status)).slice(0, 6).map((r) => ({ date: r.for_date, kind: r.kind, advice: r.text.slice(0, 110), status: r.status, actual: JSON.parse(r.evidence || '{}') }))
  return { days, resolved: Object.values(by).reduce((s, b) => s + b.n, 0), open: rows.filter((r) => r.status === 'open').length, by_kind: by, recent }
}
export const listAdvice = ({ days = 30 } = {}) => mdb.prepare('SELECT * FROM coach_advice WHERE (for_date IS NULL OR for_date >= ?) ORDER BY COALESCE(for_date, created_at) DESC, id DESC LIMIT 200')
  .all(addDays(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), -days)).map((r) => ({ ...r, target: JSON.parse(r.target || '{}'), evidence: JSON.parse(r.evidence || '{}') }))

// ---- the loop closes: a stable pattern becomes a MEMORY CANDIDATE (the athlete approves it like any other), and goes away when the pattern does
const KIND_WORDS = { session: 'session distance and effort instructions', cap: 'heart-rate limits on easy runs' }
export function adherenceMemory(today) {
  const s = adviceSummary({ days: 45, today }), made = []
  for (const kind of Object.keys(KIND_WORDS)) {
    const b = s.by_kind[kind], ref = 'adherence:' + kind, ex = mdb.prepare("SELECT id, status FROM memory WHERE source='ledger' AND source_ref=?").get(ref)
    const gap = b && b.n >= 4 ? (b.not_followed + 0.5 * b.partly) / b.n : 0
    if (gap >= 0.6) {
      const title = `Athlete often does not keep to the coach's ${KIND_WORDS[kind]}`
      const body = `Over the last 45 days the coach gave ${b.n} checkable instructions about ${KIND_WORDS[kind]}: ${b.followed} were followed, ${b.partly} partly and ${b.not_followed} not. When the same instruction keeps being missed, repeating it does not work: change the target (a lower pace, run-walk, a shorter distance) or ask why.`
      if (ex) { mdb.prepare("UPDATE memory SET title=?, body=?, hash=?, status=CASE WHEN status='archived' THEN 'candidate' ELSE status END, updated_at=? WHERE id=?").run(title, body, crypto.createHash('sha256').update(`semantic|finding|${title}|${body}`).digest('hex'), now(), ex.id); made.push(ex.id) }
      else made.push(addMemory({ tier: 'semantic', kind: 'finding', title, body, evidence_tag: 'MEASURED', status: 'candidate', source: 'ledger', source_ref: ref, created_by: 'system' }).id)
    } else if (ex && ex.status !== 'archived' && gap < 0.4) mdb.prepare("UPDATE memory SET status='archived', valid_to=?, updated_at=? WHERE id=?").run(now(), now(), ex.id)
  }
  return made
}
