// Trigger router (P3): dedupe, route, escalate micro -> macro, legacy kv migration, nightly kernel check.
import { validate } from './kernel.js'
import { addDays } from '../../src/lib/dates.js'

export const ROUTES = { readiness_gate: 'micro', pain: 'micro', missed_session: 'micro', availability_conflict: 'micro', weather_aqi: 'micro', adherence_drift: 'micro', coach_feedback: 'micro', manual: 'micro',
  benchmark: 'render', goal_change: 'macro', availability_pattern: 'macro', injury_block: 'macro' }
const iso = (d) => d.toISOString()
const insert = (db, at, type, source, key, payload, route, status = 'new', note = null) => db.prepare('INSERT OR IGNORE INTO plan_trigger (at, type, source, dedupe_key, payload, route, status, note) VALUES (?,?,?,?,?,?,?,?)').run(at, type, source, key, JSON.stringify(payload), route, status, note)

// raise a trigger once per dedupe key; escalates to a macro trigger on repeated micro triggers (FR-TRG-2/3/4)
export function raise(db, { type, source, key, payload = {}, now = new Date() }) {
  const route = ROUTES[type]; if (!route) throw Object.assign(new Error('unknown trigger type ' + type), { status: 400 })
  const r = insert(db, iso(now), type, source, key, payload, route), created = Number(r.changes) === 1
  const row = db.prepare('SELECT id, status FROM plan_trigger WHERE dedupe_key=?').get(key), out = { id: row.id, created, route, status: row.status, escalated: null }
  if (created && route === 'micro') out.escalated = escalate(db, type, now)
  return out
}
// (a) two missed long runs within 14 days (missed.js already calls this "a plan review")  (b) three micro triggers of one family within 14 days
export function escalate(db, type, now = new Date()) {
  const since = iso(new Date(now.getTime() - 14 * 864e5)), rows = db.prepare("SELECT id, payload FROM plan_trigger WHERE type=? AND at>=? AND route='micro' ORDER BY id").all(type, since)
  let why = null
  if (type === 'missed_session' && rows.filter((r) => JSON.parse(r.payload).kind === 'long').length >= 2) why = 'two missed long runs in 14 days'
  else if (rows.length >= 3) why = `${rows.length} ${type} triggers in 14 days`
  if (!why) return null
  const key = `esc:${type}:${rows.at(-1).id}`
  return Number(insert(db, iso(now), 'goal_change', 'escalation', key, { reason: 'escalation', family: type, why, from: rows.map((r) => r.id) }, 'macro').changes) ? { why } : null
}
export const openTriggers = (db) => db.prepare("SELECT * FROM plan_trigger WHERE status='new' ORDER BY id").all()
export const markHandled = (db, id, status = 'handled', note = null) => db.prepare('UPDATE plan_trigger SET status=?, handled_at=?, note=? WHERE id=?').run(status, new Date().toISOString(), note, id)

// FR-GRD-6: nightly kernel pass over the next 28 days of the active plan; violations caused by new data raise a drift trigger
export function kernelNightly(db, { today, days, ctx = {}, now = new Date() }) {
  const win = days.filter((d) => d.date >= today && d.date <= addDays(today, 28)), v = validate(win, ctx).filter((x) => x.severity !== 'info')
  if (!v.length) return { violations: 0 }
  const r = raise(db, { type: 'adherence_drift', source: 'kernel', key: `kernel:${today}`, payload: { rules: [...new Set(v.map((x) => x.rule))], count: v.length, first: v[0] }, now })
  return { violations: v.length, trigger: r.id, created: r.created }
}
// existing kv keys -> historic triggers (status ignored, so they are visible in the audit but never acted on). The keys themselves are not deleted.
export function migrateKv(db, kv) {
  let n = 0
  for (const [k, v] of Object.entries(kv || {})) {
    const m = /^lumpad\.missed\.(\d{4}-\d{2}-\d{2})$/.exec(k)
    if (m) n += Number(insert(db, v?.updated_at || `${m[1]}T12:00:00.000Z`, 'missed_session', 'legacy-kv', `legacy:missed:${m[1]}`, { date: m[1], ...(v?.value ?? v) }, 'micro', 'ignored', 'migrated from kv').changes)
  }
  const sc = kv?.['lumpad.scale']?.value?.items || kv?.['lumpad.scale']?.items || {}
  for (const [date, it] of Object.entries(sc)) n += Number(insert(db, `${date}T00:00:00.000Z`, 'readiness_gate', 'legacy-kv', `legacy:scale:${date}`, { date, ...it }, 'micro', 'ignored', 'migrated from kv').changes)
  return { migrated: n }
}
