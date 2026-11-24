// Phase 4: QA gate. Deterministic checks first (numbers must come from the source, horizon, leak check), then an adversarial LLM review of every high-impact claim (health, rules, hypotheses, decisions,
// constraints) plus a deterministic 20 % sample of the rest. A claim reaches promotion only with qa_status='pass'. Anything doubtful is 'needs_human' and is NOT promoted.
import crypto from 'node:crypto'
import { redactX, leaks } from './redact.js'
import { norm } from './extract.js'
import { OLD_HORIZON, nowIso } from './db.js'

export const numbersOf = (s) => [...new Set((String(s).match(/\d+(?:[.:,]\d+)+|\d{2,}/g) || []).map((x) => x.replace(/,/g, '.')))]
export function deterministic(c, chunkText) {
  const src = norm(c.quote + ' ' + (chunkText || '')).replace(/,/g, '.'), dateParts = new Set([c.valid_from, c.valid_to, c.event_date].filter(Boolean).flatMap((d) => d.split('-').flatMap((x) => [x, String(+x)]))), miss = numbersOf(c.text.replace(/\b20\d\d-\d\d-\d\d\b/g, ' ')).filter((n) => !dateParts.has(n) && !src.includes(n.toLowerCase()))
  if (miss.length) return { status: 'fail', note: 'number not in source: ' + miss.slice(0, 4).join(', ') }
  if (!c.valid_to || c.valid_to > OLD_HORIZON || (c.valid_from && c.valid_from > c.valid_to)) return { status: 'fail', note: 'validity outside horizon' }
  if (leaks(c.title + ' ' + c.text + ' ' + c.quote).length) return { status: 'fail', note: 'leak guard' }
  return { status: 'ok' }
}
// the reviewer sees a window of the chunk CENTRED on the quote (a head-of-chunk cut wrongly 'lost' quotes that sit later in a 6,000-char chunk)
export function windowAround(text, quote, size = 2800) {
  const t = String(text || ''), i = t.toLowerCase().indexOf(String(quote || '').toLowerCase().slice(0, 60)); if (i < 0 || t.length <= size) return t.slice(0, size)
  const from = Math.max(0, Math.min(i - Math.floor(size / 3), t.length - size)); return t.slice(from, from + size)
}
export const needsReview = (c) => c.sensitivity === 'S2' || ['rule', 'hypothesis', 'constraint', 'decision'].includes(c.kind) || parseInt(crypto.createHash('sha256').update(c.claim_id).digest('hex').slice(0, 4), 16) % 5 === 0
export const SYSTEM = `You are an adversarial reviewer of facts that an automatic extractor took from a runner's old notes. For each claim you get the claim, the quote it cites, and the source text around it.
Return ONLY JSON: {"reviews":[{"id":"<claim id>","supported":"yes|partial|no","overreach":true|false,"current_tense":true|false,"advice":true|false,"note":"<=140 chars"}]}.
- supported: does the SOURCE TEXT really say what the claim says (numbers, dates, causes, who did what)? partial = some detail is added, merged or softened/strengthened.
- overreach: the claim states more certainty than the source (a diagnosis, a cause the source only suspects, a rule from a single event, "always"/"never" that the source does not say).
- current_tense: the claim presents an old plan, target, zone, threshold, shoe mileage or status as still current.
- advice: the claim gives medical clearance, a diagnosis or a treatment instruction.
Be strict. Judge only against the source text shown.`
export function parseReviews(reply, ids) {
  const out = new Map(), set = new Set(ids)
  for (const r of Array.isArray(reply?.reviews) ? reply.reviews : []) { if (!set.has(r?.id) || out.has(r.id)) continue
    const ok = r.supported === 'yes' && !r.overreach && !r.current_tense && !r.advice
    out.set(r.id, { status: ok ? 'pass' : (r.supported === 'no' ? 'fail' : 'needs_human'), note: `${r.supported}${r.overreach ? ' overreach' : ''}${r.current_tense ? ' current-tense' : ''}${r.advice ? ' advice' : ''}: ${String(r.note || '').slice(0, 120)}` }) }
  return out
}
export async function runQa({ db, batchSize = 6, limit = Infinity, conc = 2, dry = false, model = 'deepseek-v4-pro', ceiling = 8e6, log = () => {}, complete, quotaStop = () => false }) {
  const claims = db.prepare("SELECT * FROM ol_claim WHERE qa_status='pending' AND novelty IN ('new','refines','contradicts','stale') ORDER BY claim_id").all().slice(0, limit)
  const chunkOf = db.prepare('SELECT text FROM ol_chunk WHERE chunk_id=?'), upd = db.prepare('UPDATE ol_claim SET qa_status=?, qa_note=? WHERE claim_id=?'), tot = { claims: claims.length, det_fail: 0, auto_pass: 0, reviewed: 0, calls: 0, tokens: 0, failed: 0, result: {} }
  const queue = []
  for (const c of claims) {
    const ct = chunkOf.get(c.chunk_id)?.text || '', d = deterministic(c, ct)
    if (d.status === 'fail') { upd.run('fail', d.note, c.claim_id); tot.det_fail++; continue }
    if (needsReview(c)) queue.push({ c, ct }); else { upd.run('pass', 'deterministic checks', c.claim_id); tot.auto_pass++ }
  }
  const batches = []; for (let i = 0; i < queue.length; i += batchSize) batches.push(queue.slice(i, i + batchSize)); tot.reviewed = queue.length
  log(`qa: ${claims.length} claims -> ${tot.det_fail} failed deterministic, ${tot.auto_pass} auto-pass, ${queue.length} to adversarial review in ${batches.length} calls`)
  if (dry) return { dry: true, ...tot, calls: batches.length }
  const run = Number(db.prepare('INSERT INTO ol_run (phase, started_at) VALUES (?,?)').run('qa', nowIso()).lastInsertRowid)
  const spent0 = db.prepare("SELECT COALESCE(SUM(tokens),0) t FROM ol_run WHERE phase LIKE 'qa%'").get().t; let i = 0, stop = null
  await Promise.all(Array.from({ length: Math.max(1, conc) }, async () => {
    while (i < batches.length && !stop) {
      if (quotaStop()) { stop = 'quota'; break } if (spent0 + tot.tokens >= ceiling) { stop = 'ceiling'; break }
      const b = batches[i++], user = b.map(({ c, ct }) => `CLAIM id=${c.claim_id} (${c.kind}, ${c.valid_from}): ${redactX(c.title)} — ${redactX(c.text)}\nQUOTE: ${redactX(c.quote)}\nSOURCE TEXT:\n${windowAround(redactX(ct), redactX(c.quote))}`).join('\n\n=====\n')
      if (leaks(user).length) { tot.failed++; continue }
      try {
        const res = await complete({ system: SYSTEM, user, effort: 'high', intent: 'weekly_review', ...(model ? { model } : {}) })
        if (!res.json) throw new Error('not JSON')
        const rv = parseReviews(res.json, b.map((x) => x.c.claim_id)); db.exec('BEGIN')
        for (const { c } of b) { const r = rv.get(c.claim_id) || { status: 'needs_human', note: 'no review returned' }; upd.run(r.status, r.note, c.claim_id); tot.result[r.status] = (tot.result[r.status] || 0) + 1 }
        db.exec('COMMIT'); tot.calls++; tot.tokens += res.usage?.total_tokens || 0; log(`  review batch ${i}/${batches.length}: ${rv.size}/${b.length}, ${res.usage?.total_tokens || 0} tok`)
      } catch (e) { tot.failed++; log('  FAILED review batch', i, String(e.message).slice(0, 120)) }
    }
  }))
  db.prepare('UPDATE ol_run SET finished_at=?, calls=?, tokens=?, notes=? WHERE id=?').run(nowIso(), tot.calls, tot.tokens, JSON.stringify({ ...tot, stop }), run)
  return { ...tot, stop }
}
