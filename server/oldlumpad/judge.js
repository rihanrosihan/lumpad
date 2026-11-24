// Phase 3: claim-level novelty / dedup / conflict judgement against everything Lumpad already remembers (memory.db, read-only).
//   L0 exact + L2 token overlap (local, 0 tokens)  ->  L1 FTS5 neighbours  ->  L3 LLM verdict for claims that have neighbours (batched). No neighbours = new, no call.
// Verdicts: duplicate | refines | contradicts | stale | new. The model can only point at memory ids it was shown; anything else is treated as new with a note.
import { openRO } from './fence.js'
import { redactX, leaks } from './redact.js'
import { norm } from './extract.js'
import { nowIso } from './db.js'

const STOP = new Set('the and for with that this from have has had was were are what when which would could about after before into over under than then them they their there yang dan untuk dengan dari pada ini itu adalah saya sudah akan bisa lebih sebelum setelah karena dalam oleh not but all any can will been being more most only same also very much many each other some such'.split(' '))
export const words = (s) => [...new Set(norm(s).split(/[^a-z0-9.:]+/).filter((w) => w.length >= 3 && !STOP.has(w)))]
export const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1) }
export function ftsQuery(text, max = 10) {
  const ws = words(text).sort((a, b) => (/\d/.test(b) - /\d/.test(a)) || b.length - a.length).slice(0, max)
  return ws.length ? ws.map((w) => '"' + w.replace(/"/g, '') + '"').join(' OR ') : null
}
export function neighbours(mdb, claim, k = 8) {
  const q = ftsQuery(claim.title + ' ' + claim.text); if (!q) return []
  let rows = []
  try { rows = mdb.prepare(`SELECT m.id, m.tier, m.kind, m.status, m.source, m.valid_from, m.title, m.body FROM memory_fts JOIN memory m ON m.id = memory_fts.rowid WHERE memory_fts MATCH ? AND m.status <> 'retracted' AND COALESCE(m.source,'') <> 'old_lumpad' ORDER BY bm25(memory_fts, 3.0, 1.0) LIMIT ?`).all(q, k) } catch { rows = [] }
  const cw = words(claim.title + ' ' + claim.text)
  return rows.map((r) => ({ ...r, sim: jaccard(cw, words(r.title + ' ' + r.body)) }))
}
export const SYSTEM = `You compare NEW historical claims (from a runner's old notes, dated) with EXISTING memories already stored for the same runner, and judge each new claim.
Return ONLY JSON: {"verdicts":[{"id":"<claim id>","verdict":"duplicate|refines|contradicts|stale|new","matched":<existing memory id or null>,"note":"<=140 chars"}]}.
- duplicate: an existing memory already states the same fact (same event, same numbers); the new claim adds nothing.
- refines: same subject, but the new claim adds a real detail, cause, number or lesson the existing memory lacks.
- contradicts: same subject and date range, but a different number, date, cause or outcome. Name which differs in the note.
- stale: the claim is true only as an old state that a later existing memory has replaced (an old target, plan, threshold, shoe mileage, protocol).
- new: no existing memory covers it, or the neighbours are about something else.
Judge meaning, not wording (the texts mix Indonesian and English). "matched" must be one of the shown existing ids. One verdict per claim id, no extras.`
export function parseVerdicts(reply, batch) {
  const ids = new Map(batch.map((b) => [b.claim.claim_id, new Set(b.cands.map((c) => c.id))])), out = new Map()
  for (const v of Array.isArray(reply?.verdicts) ? reply.verdicts : []) {
    if (!ids.has(v?.id) || out.has(v.id)) continue
    const ok = ['duplicate', 'refines', 'contradicts', 'stale', 'new'].includes(v.verdict) ? v.verdict : null
    if (!ok) continue
    const m = Number.isInteger(+v.matched) && ids.get(v.id).has(+v.matched) ? +v.matched : null
    out.set(v.id, { novelty: ok === 'new' ? 'new' : (m == null && ok !== 'stale' ? 'new' : ok), matched: m, note: String(v.note || '').slice(0, 200) })
  }
  return out
}
export async function runJudge({ db, batchSize = 8, limit = Infinity, conc = 2, dry = false, model = null, ceiling = 6e6, log = () => {}, complete, quotaStop = () => false, only = null }) {
  const mdb = openRO('memory'), claims = db.prepare(`SELECT * FROM ol_claim WHERE novelty='unjudged' ${only ? 'AND ' + only : ''} ORDER BY doc_id, claim_id`).all().slice(0, limit)
  const upd = db.prepare('UPDATE ol_claim SET novelty=?, matched_memory_id=?, judge_note=? WHERE claim_id=?'), tot = { claims: claims.length, local_dup: 0, no_neighbours: 0, llm_claims: 0, calls: 0, tokens: 0, failed: 0, verdicts: {} }
  const queue = []
  for (const c of claims) {
    const cands = neighbours(mdb, c)
    const top = cands.sort((a, b) => b.sim - a.sim)[0]
    if (top && (top.sim >= 0.8 || norm(top.body) === norm(c.text))) { upd.run('duplicate', top.id, `local overlap ${top.sim.toFixed(2)} with #${top.id}`, c.claim_id); tot.local_dup++; continue }
    if (!cands.length || top.sim < 0.08) { upd.run('new', null, 'no neighbours in memory', c.claim_id); tot.no_neighbours++; continue }
    queue.push({ claim: c, cands: cands.filter((x) => x.sim >= 0.04).slice(0, 6) })
  }
  mdb.close(); tot.llm_claims = queue.length
  const batches = []; for (let i = 0; i < queue.length; i += batchSize) batches.push(queue.slice(i, i + batchSize))
  log(`judge: ${claims.length} claims -> ${tot.local_dup} local duplicates, ${tot.no_neighbours} new without neighbours, ${queue.length} to the model in ${batches.length} calls`)
  if (dry) return { dry: true, ...tot, calls: batches.length }
  const run = Number(db.prepare('INSERT INTO ol_run (phase, started_at) VALUES (?,?)').run('judge', nowIso()).lastInsertRowid)
  const spent0 = db.prepare("SELECT COALESCE(SUM(tokens),0) t FROM ol_run WHERE phase LIKE 'judge%'").get().t; let i = 0, stop = null
  await Promise.all(Array.from({ length: Math.max(1, conc) }, async () => {
    while (i < batches.length && !stop) {
      if (quotaStop()) { stop = 'quota'; break } if (spent0 + tot.tokens >= ceiling) { stop = 'ceiling'; break }
      const b = batches[i++]
      const user = b.map(({ claim, cands }) => `CLAIM id=${claim.claim_id} (date ${claim.valid_from}, ${claim.kind}): ${redactX(claim.title)} — ${redactX(claim.text)}\nEXISTING:\n` + cands.map((c) => `  #${c.id} [${c.tier}/${c.status}, ${c.valid_from || 'undated'}, src ${c.source}] ${redactX(c.title)} — ${redactX(String(c.body).slice(0, 320))}`).join('\n')).join('\n\n')
      if (leaks(user).length) { tot.failed++; continue }
      try {
        const res = await complete({ system: SYSTEM, user, effort: 'high', intent: 'weekly_review', ...(model ? { model } : {}) })
        if (!res.json) throw new Error('not JSON')
        const vs = parseVerdicts(res.json, b); db.exec('BEGIN')
        for (const { claim } of b) { const v = vs.get(claim.claim_id) || { novelty: 'unjudged', matched: null, note: 'no verdict' }; if (v.novelty !== 'unjudged') { upd.run(v.novelty, v.matched, v.note, claim.claim_id); tot.verdicts[v.novelty] = (tot.verdicts[v.novelty] || 0) + 1 } }
        db.exec('COMMIT'); tot.calls++; tot.tokens += res.usage?.total_tokens || 0; log(`  batch ${i}/${batches.length}: ${vs.size}/${b.length} verdicts, ${res.usage?.total_tokens || 0} tok`)
      } catch (e) { tot.failed++; log('  FAILED batch', i, String(e.message).slice(0, 120)) }
    }
  }))
  db.prepare('UPDATE ol_run SET finished_at=?, calls=?, tokens=?, notes=? WHERE id=?').run(nowIso(), tot.calls, tot.tokens, JSON.stringify({ ...tot, stop }), run)
  return { ...tot, stop }
}
