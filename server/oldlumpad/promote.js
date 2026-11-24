// Phase 5: promotion of QA-passed claims into memory.db and of per-session notes into session_context. This is the ONLY module allowed to write live stores.
// Invariants (blueprint 7.1): nothing is written 'active'; every row carries source='old_lumpad', a bounded valid_to <= horizon and a batch id; re-runs are no-ops (unique source_ref);
// every write is logged in ol_write so a rollback can remove exactly these rows. Locked rules and existing memories are never touched.
import crypto from 'node:crypto'
import { OLD_SOURCE, OLD_ERA, OLD_HORIZON, nowIso } from './db.js'
import { redactX } from './redact.js'

const CLIN = /\b(physio|physiotherap|sports-medicine|physician|dry needling|needling|ultrasound|TENS|clinic|hospital)\b/i
const HEALTH_EPISODE = /\b(pain|nyeri|injur|cedera|plantar|shin|mtss|illness|fever|diare|diarrhea|overreach|flare|tender)/i
export const batchId = (d = new Date()) => 'olx-' + d.toISOString().slice(0, 10).replace(/-/g, '') + '-1'

// pure: claim -> memory row (or null when the claim must not be promoted)
export function toMemory(c, { doc, batch }) {
  if (c.qa_status !== 'pass' || c.novelty === 'duplicate' || c.novelty === 'unjudged') return null
  const clin = CLIN.test(c.title + ' ' + c.text), health = c.sensitivity === 'S2' && HEALTH_EPISODE.test(c.title + ' ' + c.text)
  const tag = c.kind === 'hypothesis' || c.kind === 'rule' || c.kind === 'constraint' ? 'HYPOTHESIS' : clin ? 'CLINICIAN' : 'REPORTED'
  // EVERY row is 'archived' (never candidate/proposal/active): the Go v2 coach and the Node coach both merge fresh findings into candidate/proposal rows (write-back dedupe), and the review
  // queues list them, so only 'archived' keeps both engines clear of this import. The row kind says what it is; the athlete can restore any of them (status -> candidate) from the Studio.
  const status = 'archived'; let tier, kind
  if (c.novelty === 'contradicts') { tier = 'semantic'; kind = 'old_conflict' }
  else if (c.novelty === 'stale') { tier = 'semantic'; kind = 'old_fact' }
  else if (c.kind === 'episode' || c.kind === 'decision') { tier = 'episodic'; kind = health ? 'old_episode' : 'old_reflection' }
  else if (c.kind === 'lesson') { tier = 'semantic'; kind = 'old_lesson' }
  else if (c.kind === 'hypothesis') { tier = 'semantic'; kind = 'old_hypothesis' }
  else if (c.kind === 'rule' || c.kind === 'constraint') { tier = 'procedural'; kind = 'old_rule' }
  else if (c.kind === 'plan') { tier = 'semantic'; kind = 'old_plan' }
  else { tier = 'semantic'; kind = 'old_fact' }
  const vf = c.valid_from || doc.doc_date, vt = c.valid_to || vf
  if (!vt || vt > OLD_HORIZON) return null
  const title = `[old notes ${vf}] ${redactX(c.title)}`.slice(0, 200)
  const body = `${redactX(c.text)} (From the athlete's old notes written ${doc.doc_date}; historical context, not current.${c.novelty === 'contradicts' ? ' It disagrees with an existing memory #' + c.matched_memory_id + ': ' + (c.judge_note || '') : ''})`
  return { tier, kind, title, body, evidence_tag: tag, status, confidence: c.confidence, valid_from: vf, valid_to: vt, source: OLD_SOURCE, source_ref: 'old:' + c.claim_id, created_by: 'old_lumpad_import',
    payload: { era: OLD_ERA, doc: doc.rule_id, doc_date: doc.doc_date, quote: redactX(c.quote), subject: c.subject_key, sensitivity: c.sensitivity, novelty: c.novelty, matched_memory_id: c.matched_memory_id, models: JSON.parse(c.models || '[]'), batch_id: batch, claim_id: c.claim_id } }
}
export function toSessionContext(ev) {
  const p = JSON.parse(ev.payload)
  if (ev.kind === 'run_context') return { date: ev.event_date, label: ev.label_id, note: redactX(`Athlete context (old notes, completeness ${p.score_updated}/100): ${p.activity}. ${p.reason}`).slice(0, 600), key: ev.event_id }
  if (ev.kind === 'checkin') { const s = Object.entries(p.scores || {}).map(([k, v]) => `${k} ${v}/10`).join(', '); return { date: ev.event_date, label: null, note: redactX(`Post-run check-in (old notes)${s ? ': ' + s : ''}. ${p.notes || ''}`).trim().slice(0, 600), key: ev.event_id } }
  return null
}

export async function runPromote({ db, yes = false, log = () => {}, mem, mdb, batch = batchId() }) {
  const claims = db.prepare("SELECT c.*, d.rule_id AS d_rule, d.doc_date AS d_date FROM ol_claim c JOIN ol_doc d ON d.doc_id=c.doc_id WHERE c.qa_status='pass' AND c.promoted_memory_id IS NULL").all()
  const events = db.prepare("SELECT * FROM ol_event WHERE kind IN ('run_context','checkin') AND batch_id IS NULL").all()
  const rows = claims.map((c) => ({ c, m: toMemory(c, { doc: { rule_id: c.d_rule, doc_date: c.d_date }, batch }) })).filter((x) => x.m)
  const ctxs = events.map((e) => ({ e, s: toSessionContext(e) })).filter((x) => x.s && x.s.date <= OLD_HORIZON)
  const plan = { batch, memory: rows.length, by: {}, session_context: ctxs.length, claims_total: claims.length }
  for (const { m } of rows) { const k = `${m.tier}/${m.kind}/${m.status}`; plan.by[k] = (plan.by[k] || 0) + 1 }
  if (!yes) return { dry: true, ...plan }
  if (rows.some(({ m }) => m.status !== 'archived')) throw new Error('invariant I4 violated: a non-archived row in the promotion plan')
  const logW = db.prepare('INSERT INTO ol_write (at, batch_id, store, tbl, row_id, action) VALUES (?,?,?,?,?,?)'), setC = db.prepare('UPDATE ol_claim SET promoted_memory_id=?, batch_id=?, target=? WHERE claim_id=?')
  const has = mdb.prepare('SELECT id FROM memory WHERE source=? AND source_ref=?'), done = { memory: 0, existing: 0, ctx: 0 }
  for (const { c, m } of rows) {
    const ex = has.get(OLD_SOURCE, m.source_ref); let id
    if (ex) { id = ex.id; done.existing++ } else { const r = mem.addMemory(m); id = r.id; if (r.created) { done.memory++; logW.run(nowIso(), batch, 'memory.db', 'memory', String(id), 'insert') } else done.existing++ }
    setC.run(id, batch, `${m.tier}/${m.kind}`, c.claim_id)
  }
  const hasCtx = mdb.prepare("SELECT id FROM session_context WHERE kind='old_lumpad' AND created_by=? AND note=?"), insCtx = mdb.prepare('INSERT INTO session_context (date, label_id, purpose, note, intentional_walking, counts_for_fitness, kind, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  for (const { e, s } of ctxs) {
    if (!hasCtx.get('old_lumpad_import', s.note)) { const r = insCtx.run(s.date, s.label, 'other', s.note, 0, 1, 'old_lumpad', 'old_lumpad_import', nowIso(), nowIso()); done.ctx++; logW.run(nowIso(), batch, 'memory.db', 'session_context', String(r.lastInsertRowid), 'insert') }
    db.prepare('UPDATE ol_event SET batch_id=? WHERE event_id=?').run(batch, e.event_id)
  }
  const live = mdb.prepare("SELECT count(*) c FROM memory WHERE source=? AND status <> 'archived'").get(OLD_SOURCE).c
  if (live) throw new Error('invariant I4 violated after write: ' + live + ' non-archived old_lumpad rows')
  log('promote:', JSON.stringify(done)); return { ...plan, written: done }
}
export async function rollback({ db, mdb, batch }) {
  const w = db.prepare("SELECT tbl, row_id FROM ol_write WHERE store='memory.db' AND action='insert' AND (batch_id=? OR ? IS NULL)").all(batch || null, batch || null), n = { memory: 0, session_context: 0 }
  for (const r of w) { if (r.tbl === 'memory') { n.memory += mdb.prepare("DELETE FROM memory WHERE id=? AND source='old_lumpad'").run(+r.row_id).changes } else { n.session_context += mdb.prepare("DELETE FROM session_context WHERE id=? AND kind='old_lumpad'").run(+r.row_id).changes } }
  db.prepare('UPDATE ol_claim SET promoted_memory_id=NULL, batch_id=NULL, target=NULL WHERE batch_id=? OR ? IS NULL').run(batch || null, batch || null)
  db.prepare("UPDATE ol_event SET batch_id=NULL WHERE kind IN ('run_context','checkin') AND (batch_id=? OR ? IS NULL)").run(batch || null, batch || null)
  return n
}
