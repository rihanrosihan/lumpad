// 3-tier long-term memory (memory.db). Episodic = session/day cards; Semantic = facts with evidence (KB chunks, validated patterns); Procedural = rules (locked ones are immutable).
// Retrieval: FTS5 BM25 + numeric fingerprints (+ optional text vectors) fused with Reciprocal Rank Fusion. Everything the LLM writes arrives as a CANDIDATE.
import crypto from 'node:crypto'
import { mdb, tx } from './db.js'
import { RACE_CALENDAR_TEXT } from './racecal.js'

export const EVIDENCE_ORDER = ['VALIDATED', 'MEASURED', 'CALCULATED', 'CLINICIAN', 'KB', 'REPORTED', 'LITERATURE', 'HYPOTHESIS']
const rankOf = (t) => { const i = EVIDENCE_ORDER.indexOf(t); return i < 0 ? EVIDENCE_ORDER.length : i }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const now = () => new Date().toISOString()

export function addMemory(m, { runId = null } = {}) {
  const hash = sha(`${m.tier}|${m.kind}|${m.title}|${m.body}`), ex = mdb.prepare('SELECT id FROM memory WHERE hash = ?').get(hash)
  if (ex) return { id: ex.id, created: false }
  const id = Number(mdb.prepare(`INSERT INTO memory (tier, kind, title, body, payload, evidence_tag, n, confidence, status, locked, supersedes, valid_from, valid_to, source, source_ref, created_by, hash, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(m.tier, m.kind || 'fact', m.title, m.body, m.payload ? JSON.stringify(m.payload) : null, m.evidence_tag || 'HYPOTHESIS', m.n || 1, m.confidence ?? null, m.status || 'candidate', m.locked ? 1 : 0,
    m.supersedes ?? null, m.valid_from ?? null, m.valid_to ?? null, m.source ?? null, m.source_ref ?? null, m.created_by || 'system', hash, now(), now()).lastInsertRowid)
  audit('add', id, { tier: m.tier, status: m.status || 'candidate', by: m.created_by }, runId)
  return { id, created: true }
}
export function audit(action, memoryId, detail, runId = null) { mdb.prepare('INSERT INTO memory_audit (at, run_id, action, memory_id, detail) VALUES (?,?,?,?,?)').run(now(), runId, action, memoryId, JSON.stringify(detail || {})) }
export const getMemory = (id) => mdb.prepare('SELECT * FROM memory WHERE id=?').get(id)
export function setStatus(id, status, by = 'athlete', runId = null) {
  const m = getMemory(id); if (!m) throw Object.assign(new Error('memory not found'), { status: 404 })
  if (m.locked) throw Object.assign(new Error('locked rule: only the athlete can change it in the code/config'), { status: 403 })
  mdb.prepare('UPDATE memory SET status=?, updated_at=? WHERE id=?').run(status, now(), id); audit('status:' + status, id, { by, from: m.status }, runId); return getMemory(id)
}
export const listMemory = ({ tier, status, kind, limit = 100 } = {}) => mdb.prepare(`SELECT id, tier, kind, title, substr(body,1,240) AS body, evidence_tag, n, status, locked, source, created_by, created_at FROM memory WHERE 1=1 ${tier ? 'AND tier=@tier' : ''} ${status ? 'AND status=@status' : ''} ${kind ? 'AND kind=@kind' : ''} ORDER BY id DESC LIMIT @limit`)
  .all(Object.fromEntries(Object.entries({ tier, status, kind, limit }).filter(([, v]) => v != null)))

// FTS5 query from free text: word tokens (≥3 chars), OR-joined, quoted so punctuation can't break the syntax
export const ftsQuery = (text) => { const t = [...new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.-]{2,}/gu) || [])].slice(0, 24); return t.map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ') }
export function ftsSearch(text, { tiers = ['semantic', 'episodic', 'procedural'], statuses = ['active'], limit = 20, since } = {}) {
  const q = ftsQuery(text); if (!q) return []
  return mdb.prepare(`SELECT m.id, m.tier, m.kind, m.title, m.body, m.evidence_tag, m.status, m.locked, m.valid_from, m.source, m.source_ref, bm25(memory_fts, 3.0, 1.0) AS score FROM memory_fts JOIN memory m ON m.id = memory_fts.rowid
    WHERE memory_fts MATCH ? AND m.tier IN (${tiers.map(() => '?').join(',')}) AND m.status IN (${statuses.map(() => '?').join(',')}) ${since ? 'AND (m.valid_from IS NULL OR m.valid_from >= ?)' : ''} ORDER BY score LIMIT ?`)
    .all(q, ...tiers, ...statuses, ...(since ? [since] : []), limit)
}
// Reciprocal Rank Fusion over any number of ranked id lists (k = 60)
export function rrf(lists, k = 60) { const s = new Map(); for (const l of lists) l.forEach((id, i) => s.set(id, (s.get(id) || 0) + 1 / (k + i + 1))); return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([id, score]) => ({ id, score })) }
// Maximal marginal relevance over text overlap (no vectors needed): avoids returning five near-identical cards
export function mmr(items, k, lambda = 0.7) {
  const tok = (x) => new Set(String(x.title + ' ' + x.body).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []), T = items.map(tok), jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1) }
  const out = [], rest = items.map((_, i) => i)
  while (out.length < k && rest.length) { let best = -1, bs = -1e9; for (const i of rest) { const rel = items[i].fused ?? 0, div = out.length ? Math.max(...out.map((j) => jac(T[i], T[j]))) : 0, sc = lambda * rel - (1 - lambda) * div * (items[0].fused || 1); if (sc > bs) { bs = sc; best = i } } out.push(best); rest.splice(rest.indexOf(best), 1) }
  return out.map((i) => items[i])
}
export const sortByEvidence = (a, b) => rankOf(a.evidence_tag) - rankOf(b.evidence_tag)

// ---- procedural rules that can never be changed by the LLM (immutable; the athlete changes them here, in code review)
export const LOCKED_RULES = [
  ['Race calendar 2027', RACE_CALENDAR_TEXT, 'CALCULATED'],
  ['Sleep HR > 67 = no hard running', 'If the previous night\'s Sleep HR average is above 67 bpm, do not run hard (quality, long run at effort, race effort). Validated on 103+ nights.', 'VALIDATED'],
  ['Pain ≥ 2/10 while running = durability event', 'Mechanical pain of 2/10 or more during running is a durability event: shorten or stop, do not "monitor". Probe runs stop at 1/10. Pain sites seen so far: left VMO (Oct 2026), Achilles (Oct 2026), plantar (Jakim 2026), tibia (MTSS history).', 'CLINICIAN'],
  ['HRV Reduced + quality session = downgrade', 'If sleep HRV status is Reduced and today is a quality/long/race session, downgrade the session (overreach risk 2–3 days).', 'VALIDATED'],
  ['Strength guardrails', 'Tibialis/toe raise in position 1 of every Lower session; no sets to failure on compound Lower; Lower sessions ≥ 72 h apart; no heavy leg work within 24 h before a run test.', 'KB'],
  ['Fuel and GI protocol', '≥ 90 min between eating and running; any snack < 90 min is low-fibre/liquid; 0.7 km GI-flush shakeout jog before races.', 'KB'],
  ['No new product on race day', 'Nothing untested on race day: gels, caffeine, salt capsules, breakfast format. (Broken at Borobudur 2026.)', 'KB'],
  ['Load guard', 'Weekly running km ≤ +10 % vs the previous 4-week average; a long run ≤ 110 % of the longest run in the previous 30 days; any pain ≥ 2/10 freezes progression for 7 days; change only one variable per step (duration or run/walk ratio).', 'KB'],
  ['Evidence discipline', 'Never write a number that was not pulled from data; plan is not execution; literature never overrides this athlete\'s own measured data; "belum ditarik" = unknown, not estimated.', 'KB'],
]
export function seedRules() {
  let n = 0
  for (const [title, body, tag] of LOCKED_RULES) { const r = addMemory({ tier: 'procedural', kind: 'rule', title, body, evidence_tag: tag, status: 'active', locked: 1, source: 'rules', source_ref: title, created_by: 'system' }); if (r.created) n++ }
  // coach recommendations awaiting the athlete's approval (NOT locked, NOT active)
  addMemory({ tier: 'procedural', kind: 'rule', title: 'Race opening cap (proposal)', body: 'FM km 0–10: pace no faster than marathon pace + 10 s/km and HR ≤ ~160 even if it feels easy. Borobudur 2026 opened at HR ≈ 169 (≈ +23 bpm over baseline for that pace) and run-walk began at km 5.', evidence_tag: 'HYPOTHESIS', status: 'proposal', source: 'rules', source_ref: 'race-opening-cap', created_by: 'system' })
  return n
}
