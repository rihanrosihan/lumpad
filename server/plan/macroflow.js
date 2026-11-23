// Goals, availability and the macro proposal flow (P4). Everything here is a proposal: a macro version is only ever activated by accept() after the athlete saw the diff.
import crypto from 'node:crypto'
import { RACES } from '../../src/lib/season.js'
import { generate, checkCandidate, inFreeze, FREEZES } from './macro.js'
import { renderDays, createVersion, activeVersion, recordAdjustment, addEvent, sessionFromDay, wibDate } from './store.js'
import { markHandled, raise } from './triggers.js'
import { weekTotals } from './kernel.js'
import { addDays, diffDays } from '../../src/lib/dates.js'

const err = (status, message) => Object.assign(new Error(message), { status })
const DATE = /^\d{4}-\d{2}-\d{2}$/, J = (x) => JSON.stringify(x ?? null), sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
const validDate = (s) => DATE.test(s || '') && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s
const now = () => new Date().toISOString()

// ---- goals (FR-INP-1, FR-INP-5: validated so a calendar edit can never break the jobs, cf. audit H7)
export function validateGoal(g, existing = [], today = wibDate()) {
  const bad = []
  if (!validDate(g.race_date)) bad.push('race_date must be a real YYYY-MM-DD date'); else if (g.race_date < today && g.status !== 'archived') bad.push('race_date must be in the future (archive past goals instead)')
  if (!['A', 'B', 'C', 'D'].includes(g.cls)) bad.push('cls must be A, B, C or D')
  if (!(Number(g.distance_m) >= 1000 && Number(g.distance_m) <= 250000)) bad.push('distance_m must be between 1000 and 250000')
  if (!g.name || String(g.name).length > 80) bad.push('name is required (max 80 characters)')
  if (g.target_s != null && !(Number(g.target_s) >= 600 && Number(g.target_s) <= 86400)) bad.push('target_s must be null or 600-86400 seconds')
  const p = g.params ?? {}; if (typeof p !== 'object' || Array.isArray(p)) bad.push('params must be an object')
  else { if (p.peak_cap_km != null && !(p.peak_cap_km >= 10 && p.peak_cap_km <= 150)) bad.push('params.peak_cap_km must be 10-150'); if (p.guard_baseline != null && !['literal', 'build'].includes(p.guard_baseline)) bad.push("params.guard_baseline must be 'literal' or 'build'"); if (p.cutback_ratio != null && !(p.cutback_ratio >= 0.5 && p.cutback_ratio <= 1)) bad.push('params.cutback_ratio must be 0.5-1') }
  if (existing.some((e) => e.race_date === g.race_date && e.status === 'active' && e.id !== g.id) && g.status !== 'archived') bad.push(`another active goal already exists on ${g.race_date}`)
  if (bad.length) throw err(400, bad.join('; '))
  return true
}
const row = (r) => ({ ...r, params: JSON.parse(r.params || '{}') })
export const listGoals = (db, { status = 'active' } = {}) => db.prepare('SELECT * FROM plan_goal WHERE status=? ORDER BY race_date').all(status).map(row)
export function upsertGoal(db, g, { today = wibDate(), by = 'athlete' } = {}) {
  const ex = listGoals(db); validateGoal(g, ex, today)
  const params = J(g.params ?? {}), cols = [g.race_date, g.name, g.cls, +g.distance_m, g.target_s ?? null, params, g.status ?? 'active']
  let id
  if (g.id) { if (!db.prepare('SELECT 1 FROM plan_goal WHERE id=?').get(g.id)) throw err(404, 'goal not found'); db.prepare('UPDATE plan_goal SET race_date=?, name=?, cls=?, distance_m=?, target_s=?, params=?, status=? WHERE id=?').run(...cols, g.id); id = g.id }
  else id = Number(db.prepare('INSERT INTO plan_goal (race_date, name, cls, distance_m, target_s, params, status, valid_from, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...cols, today, by, now()).lastInsertRowid)
  const t = raise(db, { type: 'goal_change', source: 'athlete', key: `goal:${sha(J(listGoals(db)))}`, payload: { goal: id, race_date: g.race_date, cls: g.cls, status: g.status ?? 'active' } })
  return { id, trigger: t.id }
}
// seed from the season's race calendar (RACES in season.js) once; never overwrites
export function seedGoals(db, today = wibDate()) {
  if (db.prepare('SELECT count(*) n FROM plan_goal').get().n) return { seeded: 0 }
  const tgt = { 'sub 4:00': 4 * 3600, 'sub 5:00': 5 * 3600 }; let n = 0
  for (const r of RACES) { db.prepare("INSERT INTO plan_goal (race_date, name, cls, distance_m, target_s, params, status, valid_from, created_by, created_at) VALUES (?,?,?,?,?,?,'active',?, 'import', ?)").run(r.date, r.name, r.cls, 42195, tgt[r.target] ?? null, '{}', today, now()); n++ }
  return { seeded: n }
}

// ---- availability (FR-INP-2). rules: [{dow, windows:[{from,to,max_min}], pref:{long|quality|rest}}]; exceptions: {date: windows[]}
export function validateAvailability({ rules = [], exceptions = {} }) {
  const bad = [], win = (w, where) => { if (!Array.isArray(w) || w.length > 4) return bad.push(`${where}: windows must be a list of at most 4`); for (const x of w) { if (!(x.max_min >= 10 && x.max_min <= 600)) bad.push(`${where}: max_min must be 10-600`); for (const k of ['from', 'to']) if (x[k] != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(x[k])) bad.push(`${where}: ${k} must be HH:MM`) } }
  const seen = new Set()
  for (const r of rules) { if (!Number.isInteger(r.dow) || r.dow < 0 || r.dow > 6) bad.push('rule dow must be 0-6'); if (seen.has(r.dow)) bad.push(`duplicate rule for dow ${r.dow}`); seen.add(r.dow); win(r.windows, `dow ${r.dow}`); for (const k of Object.keys(r.pref || {})) if (!['long', 'quality', 'rest'].includes(k)) bad.push(`dow ${r.dow}: unknown preference ${k}`) }
  if (Object.keys(exceptions).length > 366) bad.push('at most 366 exceptions')
  for (const [d, w] of Object.entries(exceptions)) { if (!validDate(d)) bad.push(`exception date ${d} is not a valid date`); else win(w, d) }
  if (bad.length) throw err(400, [...new Set(bad)].join('; '))
  return true
}
export function getAvailability(db, today = wibDate()) {
  const rules = db.prepare('SELECT dow, windows, pref FROM availability_rule WHERE valid_to IS NULL ORDER BY dow').all().map((r) => ({ dow: r.dow, windows: JSON.parse(r.windows), pref: r.pref ? JSON.parse(r.pref) : {} }))
  const exceptions = Object.fromEntries(db.prepare('SELECT date, windows FROM availability_exception WHERE date >= ?').all(today).map((r) => [r.date, JSON.parse(r.windows)]))
  return { rules, exceptions }
}
export function setAvailability(db, { rules, exceptions }, { today = wibDate() } = {}) {
  validateAvailability({ rules: rules ?? [], exceptions: exceptions ?? {} }); const out = { triggers: [] }
  if (rules) {
    db.prepare('UPDATE availability_rule SET valid_to=? WHERE valid_to IS NULL').run(today)
    for (const r of rules) db.prepare('INSERT INTO availability_rule (dow, windows, pref, valid_from, created_at) VALUES (?,?,?,?,?)').run(r.dow, J(r.windows), r.pref ? J(r.pref) : null, today, now())
    out.triggers.push(raise(db, { type: 'availability_pattern', source: 'athlete', key: `availpat:${sha(J(rules))}`, payload: { rules: rules.length } }).id)
  }
  for (const [d, w] of Object.entries(exceptions ?? {})) {
    db.prepare('INSERT OR REPLACE INTO availability_exception (date, windows, reason, source, created_at) VALUES (?,?,?,?,?)').run(d, J(w), null, 'athlete', now())
    out.triggers.push(raise(db, { type: 'availability_conflict', source: 'athlete', key: `avail:${d}:${sha(J(w))}`, payload: { date: d, windows: w } }).id)
  }
  return out
}

// ---- macro proposal
const sig = (d) => J([d.kind, d.label, d.km, d.steps, d.phase, d.week, d.note, d.event, d.tags])
const keyKind = new Set(['long', 'quality', 'tt', 'race'])
const nonRaceWeeks = (days) => Object.fromEntries([...weekTotals(days, { raceExempt: true })])
export function macroHold(db, today, { force = false, triggerTypes = [] } = {}) {
  if (inFreeze(today)) return { hold: true, why: 'software freeze window: macro proposals are held until it ends' }
  const goals = listGoals(db), inTaper = goals.find((g) => (g.cls === 'A' || g.cls === 'B') && g.race_date >= today && diffDays(g.race_date, today) <= 21)
  if (inTaper) return { hold: true, why: `taper window: ${inTaper.name} is ${diffDays(inTaper.race_date, today)} days away; only safety-direction micro patches are produced` }
  if (!force && !triggerTypes.some((t) => ['goal_change', 'injury_block'].includes(t))) {
    const last = db.prepare("SELECT created_at FROM plan_adjustment WHERE loop='macro' ORDER BY id DESC LIMIT 1").get()
    if (last && Date.parse(now()) - Date.parse(last.created_at) < 7 * 864e5) return { hold: true, why: 'at most one macro proposal per 7 days (anti-thrash) unless a goal or injury changed' }
  }
  return { hold: false }
}
export function proposeMacro(db, { today = wibDate(), ctx = {}, trigger = null, triggerTypes = [], force = false, by = 'engine' } = {}) {
  const cur = activeVersion(db); if (!cur) return { ok: false, reason: 'no active plan version' }
  const h = macroHold(db, today, { force, triggerTypes }); if (h.hold) return { ok: false, held: true, reason: h.why }
  const goals = listGoals(db); if (!goals.length) return { ok: false, reason: 'no goals: seed or add the race calendar first' }
  const A = goals.find((g) => g.cls === 'A'), av = getAvailability(db, today), plan = renderDays(db)
  const c = { weekly4w: 15, longest30: 0, ...ctx, guardBaseline: ctx.guardBaseline ?? A?.params?.guard_baseline ?? 'literal', cutbackRatio: ctx.cutbackRatio ?? A?.params?.cutback_ratio ?? 0.9, peakCap: ctx.peakCap ?? A?.params?.peak_cap_km ?? 60 }
  const g = generate({ today, plan, goals, availability: av, ctx: c }), chk = checkCandidate(g.days, c, g.report.start)
  if (chk.violations.length) return { ok: false, reason: 'the generated plan breaks the guardrails; not proposed', violations: chk.violations.slice(0, 10) }
  const before = Object.fromEntries(plan.map((d) => [d.date, d])), changed = chk.days.filter((d) => !before[d.date] || sig(before[d.date]) !== sig(d))
  if (!changed.length) return { ok: true, no_change: true }
  const sessions = changed.map((d) => ({ ...sessionFromDay(d, 'generated'), template_id: d.template ?? null }))
  const wb = nonRaceWeeks(plan), wa = nonRaceWeeks(chk.days), keyChanges = changed.filter((d) => keyKind.has(d.kind) || keyKind.has(before[d.date]?.kind)).length
  const summary = { start: g.report.start, weeks_before: wb, weeks_after: wa, peak_before: Math.max(...Object.values(wb)), peak_after: g.report.peak_km, changed_days: changed.length, key_session_changes: keyChanges,
    guard_baseline: c.guardBaseline, cutback: g.report.cutback, conflicts: g.report.conflicts, shortfalls: g.report.shortfalls, kept_violations: chk.kept_violations.length, repaired: chk.repaired }
  const v = createVersion(db, { kind: 'macro', parentId: cur.id, baseMacroId: cur.id, status: 'proposed', sessions, goalId: A?.id ?? null, inputs: { goals: goals.map((x) => [x.race_date, x.cls, x.distance_m]), avail: av, ctx: [c.weekly4w, c.longest30, c.guardBaseline, c.cutbackRatio, c.peakCap], start: g.report.start }, summary })
  if (!v.created) { const a = db.prepare('SELECT id FROM plan_adjustment WHERE to_version=?').get(v.id); return { ok: true, duplicate: true, version: v.id, adjustment: a?.id ?? null, summary } }
  const diff = changed.map((d) => ({ date: d.date, before: before[d.date] ? { kind: before[d.date].kind, label: before[d.date].label, km: before[d.date].km } : null, after: { kind: d.kind, label: d.label, km: d.km } }))
  const rationale = `Season regenerated from ${g.report.start}: weekly volume now starts from your actual ${c.weekly4w} km (4-week average) and ramps inside the load guard (${c.guardBaseline === 'build' ? 'baseline = previous 4 build weeks' : 'rule as written'}), cutback every ${g.report.cutback.every} weeks at ×${g.report.cutback.ratio}, taper and recovery around ${goals.length} goal race(s). Peak ${summary.peak_after} km/week (was ${summary.peak_before}); ${changed.length} days changed, ${keyChanges} key sessions.${g.report.conflicts.length ? ` ${g.report.conflicts.length} checkpoint(s) postponed because the load cannot carry them.` : ''}`
  const adj = recordAdjustment(db, { trigger, from: cur.id, to: v.id, loop: 'macro', scope: [diff[0].date, diff.at(-1).date], operators: ['macro'], diff, rules: ['R-LOAD-10', 'R-LR-110', 'R-48H', 'R-TAPER', 'R-RACE-LOCK', 'R-PAST'].map((id) => ({ id, status: 'pass' })), inputs: { weekly4w: c.weekly4w, longest30: c.longest30, guard_baseline: c.guardBaseline, peak_cap_km: c.peakCap, goals: goals.length, freeze_windows: FREEZES }, rationale, expected: { peak_after: summary.peak_after } })
  addEvent(db, adj, 'proposed', by)
  if (trigger) markHandled(db, trigger)
  return { ok: true, version: v.id, adjustment: adj, summary, changed_days: changed.length }
}
// open macro triggers -> one proposal (escalations, goal and availability edits). Marks them handled or leaves them held.
export function handleMacroTriggers(db, args = {}) {
  const open = db.prepare("SELECT id, type FROM plan_trigger WHERE route='macro' AND status='new' ORDER BY id").all(); if (!open.length) return { handled: 0 }
  const r = proposeMacro(db, { ...args, trigger: open[0].id, triggerTypes: open.map((o) => o.type) })
  if (r.ok) for (const o of open) markHandled(db, o.id, 'handled', `macro proposal ${r.adjustment ?? 'none'}`)
  return { handled: r.ok ? open.length : 0, result: r }
}
