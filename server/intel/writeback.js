// Post-analysis memory write-back hook. The LLM's memory_writes are UNTRUSTED: schema-checked, citation-checked, number-checked, de-duplicated, and stored as
// unconfirmed candidates. Locked rules and measured data are never touched; procedural writes become proposals for the athlete.
import { mdb, idb } from './db.js'
import { addMemory, audit, getMemory, ftsSearch } from './memory.js'
import { numbersStrict } from './grounding.js'

const TRIVIAL = (x) => Number.isInteger(x) && Math.abs(x) <= 12
const strip = (t) => String(t).replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ').replace(/\[\d+\]/g, ' ')
export const numbersOf = (t) => (strip(t).match(/-?\d+(?:[.,]\d+)?/g) || []).map((x) => parseFloat(x.replace(',', '.'))).filter((x) => isFinite(x))
export const timesOf = (t) => String(t).match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || []
const near = (a, b) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.011)
// every non-trivial number (and every time token) in `text` must exist in the evidence corpus
export function unverified(text, corpus) {
  const have = numbersOf(corpus), tm = new Set(timesOf(corpus)), bad = []
  for (const n of numbersOf(text)) { if (TRIVIAL(n) || (n >= 2024 && n <= 2030)) continue; if (!have.some((h) => near(n, h))) bad.push(String(n)) }
  for (const t of timesOf(text)) if (!tm.has(t)) bad.push(t)
  return bad
}
export const tokens = (s) => new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])
export const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1) }

export function applyWriteback(parsed, { runId = null, itemIds = [], corpus = '', provider = 'deepseek', strictNumbers = process.env.COACH_STRICT_NUMBERS !== 'off', base = '' } = {}) {
  const out = { stored: [], merged: [], rejected: [] }, allowed = new Set(itemIds)
  for (const w of parsed?.memory_writes || []) {
    const why = []
    if (!['episodic', 'semantic', 'procedural'].includes(w.tier)) why.push('bad tier')
    if (!Array.isArray(w.cites) || !w.cites.length) why.push('no citation')
    else if (!w.cites.every((c) => allowed.has(c))) why.push('cites an id that was not in the context')
    const evidence = [strictNumbers ? base : corpus, ...(w.cites || []).map((c) => getMemory(c)?.body || '')].join('\n')
    const bad = strictNumbers ? [...numbersStrict(`${w.title}\n${w.body}`, numbersOf(evidence)), ...timesOf(`${w.title}\n${w.body}`).filter((t) => !timesOf(evidence).includes(t))] : unverified(`${w.title}\n${w.body}`, evidence); if (bad.length) why.push('unverified numbers: ' + [...new Set(bad)].slice(0, 6).join(', '))
    if ((w.cites || []).some((c) => getMemory(c)?.locked)) { /* citing a locked rule is fine */ }
    if (why.length) { out.rejected.push({ title: w.title, why }); audit('writeback:rejected', null, { title: w.title, why, provider }, runId); continue }
    const status = w.tier === 'procedural' ? 'proposal' : 'candidate'
    // dedupe: near-identical existing memory (same tier) → count it as another observation instead of a new row
    const sim = ftsSearch(w.title + ' ' + w.body, { tiers: [w.tier], statuses: ['candidate', 'active', 'proposal'], limit: 5 }).find((x) => x.source !== 'kb' && !x.locked && jaccard(tokens(x.title + ' ' + x.body), tokens(w.title + ' ' + w.body)) >= 0.6)
    if (sim) {
      // re-observation only raises n; activation is the athlete's decision (no self-promotion). n >= 3 marks it ready for review.
      const m = getMemory(sim.id), n = m.n + 1, ready = m.status === 'candidate' && n >= 3
      const payload = m.payload ? JSON.parse(m.payload) : {}; if (ready) payload.ready_for_review = true
      mdb.prepare('UPDATE memory SET n=?, payload=?, updated_at=? WHERE id=?').run(n, JSON.stringify(payload), new Date().toISOString(), m.id); audit(ready ? 'writeback:ready_for_review' : 'writeback:merged', m.id, { n, provider }, runId); out.merged.push({ id: m.id, n, ready_for_review: ready }); continue
    }
    const r = addMemory({ tier: w.tier, kind: String(w.kind || 'insight').slice(0, 30), title: w.title, body: w.body, payload: { cites: w.cites, run: runId, provider, tags: Array.isArray(w.tags) ? w.tags.slice(0, 8).map((t) => String(t).slice(0, 40)) : undefined }, confidence: typeof w.confidence === 'number' ? Math.max(0, Math.min(1, w.confidence)) : undefined, evidence_tag: 'HYPOTHESIS', status, source: 'coach', created_by: provider === 'claude-code' ? 'claude-code' : 'llm' }, { runId })
    out.stored.push({ id: r.id, status })
  }
  return out
}
