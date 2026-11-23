// Proposals (P3): patches -> kernel check -> proposed version + audit row; accept / reject / revert / expire. Nothing here runs on its own.
import { renderDays, createVersion, activate, activeVersion, recordAdjustment, addEvent, sessionFromDay, wibDate } from './store.js'
import { validate, weekTotals } from './kernel.js'
import { markHandled } from './triggers.js'
import { tx } from './db.js'

const J = (x) => JSON.stringify(x ?? null), P = (s) => (s == null ? null : JSON.parse(s))
const byDate = (days) => Object.fromEntries(days.map((d) => [d.date, d]))
const rank = { rest: 0, easy: 1, social: 1, quality: 2, tt: 3, long: 2, race: 4 }
// a change lowers or keeps load: km not higher, intensity rank not higher; moves are not "safe" (they need the athlete)
export const isSafetyDirection = (patches) => patches.every((p) => p.operator !== 'move' && p.operator !== 'swap' && p.operator !== 'insert_recovery' && p.changes.every((c) => (c.after.km ?? 0) <= (c.before.km ?? 0) + 1e-9 && (rank[c.after.kind] ?? 9) <= (rank[c.before.kind] ?? 9)))
const weeks = (days) => Object.fromEntries([...weekTotals(days)])
const key = (v) => `${v.rule}|${v.date}`

export function propose(db, { patches, trigger = null, today = wibDate(), kctx = {}, inputs = {}, loop = 'micro', autoApply = process.env.PLAN_AUTOAPPLY === '1' } = {}) {
  patches = (patches || []).filter(Boolean); if (!patches.length) return { ok: false, reason: 'no change to propose' }
  const cur = activeVersion(db); if (!cur) return { ok: false, reason: 'no active plan version' }
  const base = renderDays(db), merged = byDate(base), changes = new Map()
  for (const p of patches) for (const c of p.changes) { if (c.date < today) return { ok: false, reason: `change touches a past day (${c.date})`, rule: 'R-PAST' }; changes.set(c.date, c); merged[c.date] = c.after }
  const after = Object.values(merged).sort((a, b) => a.date.localeCompare(b.date)), before = validate(base, kctx), seen = new Set(before.map(key))
  const introduced = validate(after, { ...kctx, today, base }).filter((v) => !seen.has(key(v)))   // the patch may not make the plan worse
  if (introduced.length) return { ok: false, reason: 'the kernel rejects this change', violations: introduced }
  const sessions = [...changes.values()].map((c) => sessionFromDay(c.after, 'patched')), wb = weeks(base), wa = weeks(after)
  const v = createVersion(db, { kind: 'micro', parentId: cur.id, baseMacroId: cur.id, status: 'proposed', sessions, inputs: { trigger, ops: patches.map((p) => [p.operator, p.changes.map((c) => c.date)]) }, summary: { weeks_before: wb, weeks_after: wa } })
  if (!v.created) { const adj = db.prepare('SELECT id FROM plan_adjustment WHERE to_version=?').get(v.id); return { ok: true, duplicate: true, version: v.id, adjustment: adj?.id ?? null } }
  const auto = autoApply && isSafetyDirection(patches), ops = patches.map((p) => p.operator)
  const diff = [...changes.values()].map((c) => ({ date: c.date, before: { kind: c.before.kind, label: c.before.label, km: c.before.km }, after: { kind: c.after.kind, label: c.after.label, km: c.after.km } }))
  const adj = recordAdjustment(db, { trigger, from: cur.id, to: v.id, loop, scope: [[...changes.keys()].sort()[0], [...changes.keys()].sort().at(-1)], operators: ops, diff, rules: [...new Set(patches.flatMap((p) => p.rules))].map((id) => ({ id, status: 'pass' })), inputs, rationale: patches.map((p) => p.rationale).join(' '), auto, expected: { weeks_km_after: wa } })
  addEvent(db, adj, 'proposed', 'engine')
  if (trigger) markHandled(db, trigger)
  if (auto) return { ok: true, auto: true, ...accept(db, adj, { today, by: 'engine' }), adjustment: adj, version: v.id }
  return { ok: true, version: v.id, adjustment: adj, auto: false, diff }
}
const adjRow = (db, id) => { const a = db.prepare('SELECT * FROM plan_adjustment WHERE id=?').get(id); if (!a) throw Object.assign(new Error('adjustment not found'), { status: 404 }); return a }
const status = (db, adjId) => db.prepare('SELECT event FROM plan_adjustment_event WHERE adjustment_id=? ORDER BY id DESC LIMIT 1').get(adjId)?.event
export function accept(db, adjustmentId, { today = wibDate(), by = 'athlete' } = {}) {
  const a = adjRow(db, adjustmentId)
  if (status(db, adjustmentId) !== 'proposed') throw Object.assign(new Error(`adjustment is ${status(db, adjustmentId)}, not proposed`), { status: 409 })
  return activate(db, a.to_version, { adjustmentId, expectedParent: a.from_version, today, by })   // 409 when the plan changed since the proposal
}
export function reject(db, adjustmentId, { by = 'athlete' } = {}) {
  adjRow(db, adjustmentId); if (status(db, adjustmentId) !== 'proposed') throw Object.assign(new Error('adjustment is not proposed'), { status: 409 })
  tx(db, () => { db.prepare("UPDATE plan_version SET status='rejected' WHERE id=(SELECT to_version FROM plan_adjustment WHERE id=?) AND status='proposed'").run(adjustmentId); addEvent(db, adjustmentId, 'rejected', by) })
  return { adjustment: adjustmentId, status: 'rejected' }
}
// proposals expire at the end of their first day (anti-thrash)
export function expireProposals(db, today = wibDate()) {
  const open = db.prepare(`SELECT a.id FROM plan_adjustment a WHERE (SELECT event FROM plan_adjustment_event WHERE adjustment_id=a.id ORDER BY id DESC LIMIT 1)='proposed' AND substr(a.created_at,1,10) < ?`).all(today)
  for (const { id } of open) tx(db, () => { db.prepare("UPDATE plan_version SET status='expired' WHERE id=(SELECT to_version FROM plan_adjustment WHERE id=?) AND status='proposed'").run(id); addEvent(db, id, 'expired', 'system') })
  return { expired: open.length }
}
export const openProposals = (db) => db.prepare(`SELECT a.id, a.created_at, a.loop, a.operators, a.diff, a.rules, a.rationale_det, a.auto, a.to_version, v.summary FROM plan_adjustment a JOIN plan_version v ON v.id=a.to_version
  WHERE (SELECT event FROM plan_adjustment_event WHERE adjustment_id=a.id ORDER BY id DESC LIMIT 1)='proposed' ORDER BY a.id`).all().map((r) => ({ ...r, operators: P(r.operators), diff: P(r.diff), rules: P(r.rules), summary: P(r.summary) }))

// revert = a new 'revert' version that restores what each touched day was before this adjustment (FR-PLN-7). Refused when a later change touches one of those days.
export function revert(db, adjustmentId, { today = wibDate(), by = 'athlete' } = {}) {
  const a = adjRow(db, adjustmentId), last = status(db, adjustmentId)
  if (!['applied'].includes(last)) throw Object.assign(new Error(`adjustment is ${last}, only an applied change can be reverted`), { status: 409 })
  const rows = db.prepare('SELECT * FROM plan_session WHERE version_id=?').all(a.to_version), sessions = []
  for (const r of rows) {
    // refuse only when the day no longer holds what this adjustment produced (content hash, not version id: undoing a later change restores the same content)
    const act = db.prepare('SELECT s.hash FROM plan_active_day a JOIN plan_session s ON s.id=a.session_id WHERE a.date=? AND a.slot=?').get(r.date, r.slot)
    if (act && act.hash !== r.hash) throw Object.assign(new Error(`a later change touches ${r.date}`), { status: 409 })
    if (r.date < today) throw Object.assign(new Error(`${r.date} is in the past`), { status: 422 })
    const prev = db.prepare("SELECT s.* FROM plan_session s JOIN plan_version v ON v.id=s.version_id WHERE s.date=? AND s.slot=? AND v.status IN ('active','superseded') AND v.id < ? ORDER BY v.id DESC LIMIT 1").get(r.date, r.slot, a.to_version)
    sessions.push(prev ? { ...prev, op: prev.op, dose: P(prev.dose), steps: P(prev.steps), est: P(prev.est), tags: P(prev.tags), legacy: P(prev.legacy), origin: 'revert', hash: prev.hash } : { date: r.date, slot: r.slot, op: 'clear', kind: 'rest', label: '', origin: 'revert' })
  }
  const cur = activeVersion(db), v = createVersion(db, { kind: 'revert', parentId: cur.id, status: 'proposed', sessions, inputs: { revert_of: adjustmentId } })
  const diff = sessions.map((s) => ({ date: s.date, after: s.op === 'clear' ? null : { kind: s.kind, label: s.label, km: s.dose?.km ?? null } }))
  const adj = recordAdjustment(db, { from: cur.id, to: v.id, loop: 'revert', scope: [sessions.map((s) => s.date).sort()[0], sessions.map((s) => s.date).sort().at(-1)], operators: ['revert'], diff, rules: [], inputs: { revert_of: adjustmentId }, rationale: `Reverted adjustment ${adjustmentId}: ${a.rationale_det}` })
  addEvent(db, adj, 'proposed', by)
  const r = activate(db, v.id, { adjustmentId: adj, expectedParent: cur.id, today, by })
  addEvent(db, adjustmentId, 'reverted', by, { by_adjustment: adj })
  return { ...r, reverted: adjustmentId }
}
