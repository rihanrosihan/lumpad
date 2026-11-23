// Versions, atomic activation, materialised effective plan, import of plan.json as version 1.
import crypto from 'node:crypto'
import { tx } from './db.js'

export const ENGINE_VERSION = 'plan-engine/0.1.0'
const KEY = new Set(['quality', 'tt', 'long', 'race'])
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const now = () => new Date().toISOString()
export const wibDate = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const J = (x) => JSON.stringify(x ?? null)

// a session row (op 'set') from a plan.json-shaped day
export function sessionFromDay(d, origin = 'import') {
  const body = { date: d.date, kind: d.kind, label: d.label, km: d.km, steps: d.steps ?? [], note: d.note ?? null, tags: d.tags ?? [] }
  return {
    date: d.date, slot: 0, op: 'set', kind: d.kind, label: d.label ?? '', week: d.week ?? null, phase: d.phase ?? null,
    dose: { km: d.km ?? 0 }, steps: d.steps ?? [], est: d.sec != null || d.tl != null ? { sec: d.sec ?? null, tl: d.tl ?? null, km: d.km ?? 0 } : null,
    tags: d.tags ?? [], is_key: KEY.has(d.kind) ? 1 : 0, locked: d.kind === 'race' || /gate|CP\d/i.test(`${d.label || ''} ${(d.tags || []).join(' ')}`) ? 1 : 0,
    note: d.note ?? null, origin, legacy: d, hash: sha(JSON.stringify(body)),
  }
}

const insertSession = (db, versionId, s) => db.prepare(`INSERT INTO plan_session (version_id, date, slot, op, template_id, template_version, kind, label, week, phase, dose, steps, est, tags, is_key, locked, note, origin, legacy, hash)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(versionId, s.date, s.slot ?? 0, s.op ?? 'set', s.template_id ?? null, s.template_version ?? null, s.kind ?? 'rest', s.label ?? '', s.week ?? null, s.phase ?? null,
  J(s.dose ?? {}), J(s.steps ?? []), s.est ? J(s.est) : null, J(s.tags ?? []), s.is_key ? 1 : 0, s.locked ? 1 : 0, s.note ?? null, s.origin ?? 'generated', s.legacy ? J(s.legacy) : null, s.hash ?? sha(J(s)))

export const activeVersion = (db) => db.prepare("SELECT * FROM plan_version WHERE status='active'").get() || null

// inputs_hash: same inputs → no second version (FR-PLN-6)
export function createVersion(db, { kind, parentId = null, baseMacroId = null, status = 'proposed', sessions, goalId = null, zoneSetVersion = null, inputs, summary = {}, createdBy = 'engine' }) {
  const hash = sha(J({ engine: ENGINE_VERSION, kind, parentId, inputs, s: sessions.map((s) => [s.date, s.slot ?? 0, s.op ?? 'set', s.hash ?? sha(J(s))]) }))
  const dup = db.prepare("SELECT id FROM plan_version WHERE inputs_hash=? AND status IN ('proposed','active','draft')").get(hash)
  if (dup) return { id: dup.id, created: false, inputs_hash: hash }
  const dates = sessions.map((s) => s.date).sort()
  return tx(db, () => {
    const id = Number(db.prepare(`INSERT INTO plan_version (parent_id, base_macro_id, kind, status, horizon_from, horizon_to, goal_id, zone_set_version, engine_version, inputs_hash, summary, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(parentId, baseMacroId, kind, status === 'active' ? 'draft' : status, dates[0], dates.at(-1), goalId, zoneSetVersion, ENGINE_VERSION, hash, J(summary), createdBy, now()).lastInsertRowid)
    for (const s of sessions) insertSession(db, id, s)
    return { id, created: true, inputs_hash: hash }
  })
}

// Atomic activation (FR-PLN-4): optimistic parent check, supersede old, flip new, rebuild plan_active_day for the horizon, audit row. Past days are never touched (FR-PLN-5).
export function activate(db, versionId, { adjustmentId = null, expectedParent = undefined, today = wibDate(), trigger = null, loop = null, rationale = '', rules = [], operators = [], inputs = {}, auto = 0, by = 'system' } = {}) {
  return tx(db, () => {
    const v = db.prepare('SELECT * FROM plan_version WHERE id=?').get(versionId)
    if (!v) throw Object.assign(new Error('version not found'), { status: 404 })
    if (!['draft', 'proposed'].includes(v.status)) throw Object.assign(new Error(`version is ${v.status}`), { status: 409 })
    const cur = activeVersion(db)
    if (expectedParent !== undefined && (cur?.id ?? null) !== expectedParent) throw Object.assign(new Error('active version changed (expected_parent mismatch)'), { status: 409 })
    const rows = db.prepare('SELECT * FROM plan_session WHERE version_id=?').all(versionId)
    if (v.kind !== 'import' && rows.some((r) => r.date < today)) throw Object.assign(new Error('version changes a past day'), { status: 422 })
    const before = new Map(db.prepare('SELECT a.date, a.slot, s.kind, s.label, s.dose FROM plan_active_day a JOIN plan_session s ON s.id=a.session_id').all().map((r) => [`${r.date}|${r.slot}`, r]))
    if (cur) db.prepare("UPDATE plan_version SET status='superseded', superseded_at=? WHERE id=?").run(now(), cur.id)
    db.prepare("UPDATE plan_version SET status='active', activated_at=? WHERE id=?").run(now(), versionId)
    for (const r of rows) {
      if (r.op === 'clear') db.prepare('DELETE FROM plan_active_day WHERE date=? AND slot=?').run(r.date, r.slot)
      else db.prepare('INSERT OR REPLACE INTO plan_active_day (date, slot, session_id, version_id) VALUES (?,?,?,?)').run(r.date, r.slot, r.id, versionId)
    }
    const diff = rows.map((r) => ({ date: r.date, slot: r.slot, before: before.get(`${r.date}|${r.slot}`) ? { kind: before.get(`${r.date}|${r.slot}`).kind, label: before.get(`${r.date}|${r.slot}`).label } : null, after: r.op === 'clear' ? null : { kind: r.kind, label: r.label } }))
      .filter((x) => JSON.stringify(x.before) !== JSON.stringify(x.after))
    const dates = rows.map((r) => r.date).sort()
    const adj = adjustmentId ?? recordAdjustment(db, { trigger, from: cur?.id ?? null, to: versionId, loop: loop || v.kind, scope: [dates[0] ?? v.horizon_from, dates.at(-1) ?? v.horizon_to], operators, diff, rules, inputs, rationale: rationale || `${v.kind} version ${versionId} activated`, auto })
    db.prepare("INSERT INTO plan_adjustment_event (adjustment_id, at, event, by, detail) VALUES (?,?, 'applied', ?, NULL)").run(adj, now(), by)
    return { version: versionId, adjustment: adj, changed_days: diff.length }
  })
}

// one audit row per change; created when a change is proposed (or directly at activation for imports and manual edits). Append-only (DB triggers).
export function recordAdjustment(db, { trigger = null, from = null, to, loop, scope, operators = [], diff = [], rules = [], inputs = {}, rationale, rationaleLlm = null, auto = 0, expected = null }) {
  return Number(db.prepare(`INSERT INTO plan_adjustment (created_at, trigger_id, from_version, to_version, loop, scope_from, scope_to, operators, diff, rules, inputs, rationale_det, rationale_llm, auto, expected)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(now(), trigger, from, to, loop, scope[0], scope[1], J(operators), J(diff), J(rules), J(inputs), rationale, rationaleLlm, auto ? 1 : 0, expected ? J(expected) : null).lastInsertRowid)
}
export const addEvent = (db, adjustmentId, event, by, detail = null) => db.prepare('INSERT INTO plan_adjustment_event (adjustment_id, at, event, by, detail) VALUES (?,?,?,?,?)').run(adjustmentId, now(), event, by, detail ? J(detail) : null)

export function importPlan(db, days) {
  const existing = db.prepare("SELECT id FROM plan_version WHERE kind='import' ORDER BY id LIMIT 1").get()
  if (existing) return { id: existing.id, created: false }
  const sessions = days.map((d) => sessionFromDay(d, 'import')), r = createVersion(db, { kind: 'import', status: 'draft', sessions, inputs: { source: 'src/data/plan.json', n: days.length }, createdBy: 'import', summary: { days: days.length } })
  activate(db, r.id, { loop: 'import', rationale: 'one-time import of src/data/plan.json as version 1', by: 'system', operators: ['import'] })
  return { id: r.id, created: true, days: days.length }
}

// effective plan in plan.json shape (the golden test compares this with the file)
export function renderDays(db, { from = '0000', to = '9999' } = {}) {
  return db.prepare('SELECT s.legacy, s.kind, s.label, s.dose, s.steps, s.date FROM plan_active_day a JOIN plan_session s ON s.id=a.session_id WHERE a.slot=0 AND a.date BETWEEN ? AND ? ORDER BY a.date').all(from, to)
    .map((r) => (r.legacy ? JSON.parse(r.legacy) : { date: r.date, kind: r.kind, label: r.label, km: JSON.parse(r.dose).km ?? 0, steps: JSON.parse(r.steps) }))
}
