// Bulk coach jobs that use the model heavily: backfill session reviews, race post-mortems, and memory extraction from the knowledge-base documents.
//   node --env-file=.env server/intel/bulk.js reviews     [--limit N] [--conc 2] [--dry]   one high-effort review for every FIT session that has none yet (newest first)
//   node --env-file=.env server/intel/bulk.js postmortems [--limit N] [--conc 2] [--dry]   one race post-mortem per race in the ledger that has a FIT file
//   node --env-file=.env server/intel/bulk.js extract     [--limit N] [--conc 4] [--chunk 6000] [--dry]   (--chunk 2500 = a finer second pass; sentences already claimed are skipped)
//   node --env-file=.env server/intel/bulk.js consistency [--limit N] [--conc 4] [--dry]   find contradictions between documents that reference each other → candidates   claims from the KB documents → memory CANDIDATES (you approve them in the memory view)
// Everything is resumable: a finished item is never run twice (a saved run with the same prompt is reused, extraction keeps a progress file). Started as root it drops to the owner of
// server/data first, like cli.js. Nothing is written as active knowledge: reviews follow the normal coach write-back rules, extracted claims are candidates / proposals.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const dir = process.env.DATA_DIR || path.resolve('server/data')
if (process.getuid?.() === 0) { const st = fs.statSync(dir); if (st.uid !== 0) { process.setgid(st.gid); process.setuid(st.uid) } }
const [cmd, ...rest] = process.argv.slice(2), arg = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d }, flag = (k) => rest.includes('--' + k)
const limit = Number(arg('limit', 0)) || Infinity, dry = flag('dry')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// run `fn` over items with a small worker pool; one failure never stops the batch
export async function pool(items, conc, fn) {
  const out = { ok: 0, failed: 0, errors: [] }; let i = 0
  await Promise.all(Array.from({ length: Math.max(1, conc) }, async () => {
    while (i < items.length) { const k = i++; try { await fn(items[k], k); out.ok++ } catch (e) { out.failed++; out.errors.push(`${items[k]?.label || items[k]?.id || k}: ${String(e.message).slice(0, 160)}`); log('  failed', items[k]?.label || k, '-', String(e.message).slice(0, 140)) } }
  }))
  return out
}

const { idb, mdb } = await import('./db.js')

// ---- 1) session reviews
export function unreviewedSessions() {
  const done = new Set(mdb.prepare("SELECT question FROM coach_run WHERE intent='session_review' AND ok=1 AND question LIKE 'session %'").all().map((r) => r.question.replace(/^session /, '')))
  return idb.prepare('SELECT label_id, activity_id, date, distance_m FROM fit_session ORDER BY date DESC').all().filter((s) => !done.has(s.label_id)).map((s) => ({ ...s, label: s.label_id }))
}

// ---- 2) race post-mortems: ledger rows (doc 04.1) matched to the longest FIT session of that date
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 }
export function ledgerRaces(body) {
  const out = []; let year = null
  for (const l of String(body).split('\n')) {
    const h = /^#{1,3} .*?(20\d\d)/.exec(l); if (h) year = h[1]
    const m = /^\|\s*\**(\d{1,2})\s+([A-Za-z]{3})[a-z]*\**\s*\|\s*([^|]+)\|/.exec(l)
    if (m && year && MONTHS[m[2].toLowerCase()]) { if (m[3].includes('~~')) continue; out.push({ date: `${year}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`, name: m[3].replace(/\*|`/g, '').split(' — ')[0].trim() }) }
  }
  return out
}
export function raceSessions() {
  const body = idb.prepare("SELECT body FROM kb_docs WHERE doc_id='04.1'").get()?.body || '', seen = new Set(), out = []
  const done = new Set(mdb.prepare("SELECT question FROM coach_run WHERE intent='race_postmortem' AND ok=1").all().map((r) => r.question))
  for (const r of ledgerRaces(body)) {
    const s = idb.prepare('SELECT label_id, activity_id, date, distance_m FROM fit_session WHERE date=? AND distance_m >= 3000 ORDER BY distance_m DESC LIMIT 1').get(r.date)
    if (!s || seen.has(s.label_id) || done.has('race ' + s.label_id)) continue
    seen.add(s.label_id); out.push({ ...s, label: `${r.date} ${r.name}`, race: r.name })
  }
  return out
}

async function coachJobs(intent, items, conc) {
  const { runCoach } = await import('./coach.js')
  const t0 = Date.now()
  log(`${intent}: ${items.length} to run (concurrency ${conc})`)
  if (dry) { items.slice(0, 15).forEach((s) => log('  would run', s.label)); return }
  const r = await pool(items, conc, async (s, k) => {
    const res = await runCoach({ intent, question: (intent === 'race_postmortem' ? 'race ' : 'session ') + s.label_id, activityId: s.activity_id || s.label_id })
    log(`  [${k + 1}/${items.length}] ${s.label} -> run ${res.runId}${res.cached ? ' (cached)' : ''} ${res.ok === false ? 'NOT OK' : 'ok'}`)
    if (res.ok === false) throw new Error(res.error || 'run not ok')
  })
  log(`${intent}: done ${r.ok} ok, ${r.failed} failed in ${Math.round((Date.now() - t0) / 60000)} min`)
}

// ---- 3) memory extraction from the knowledge-base documents
export const EXTRACT_SYSTEM = `You extract durable claims from a runner's OWN training documentation (Indonesian and English mixed) so a coach can remember them.
Return ONLY JSON: {"claims":[{"kind":"fact|baseline|rule|decision|lesson|hypothesis|plan|constraint","title":"<=100 chars","body":"<=450 chars","quote":"<=240 chars copied EXACTLY from the text","confidence":0.0-1.0}]}.
Rules:
- A claim is ONE atomic statement that is understandable on its own (name the race, date, shoe, test or phase; keep every number, unit and date exactly as written). Write title and body in English; keep original terms in brackets when useful.
- "quote" must be a verbatim substring of the text that supports the claim (copy it character for character). A claim without a faithful quote is worthless: do not invent one.
- kind: rule = an instruction or gate the athlete follows; constraint = a hard limit; decision = something the athlete decided (with the date if stated); baseline = a measured reference value; lesson = what a past event taught; hypothesis = anything the text itself marks as HYPOTHESIS, ALGORITHMIC, estimate or unconfirmed (never upgrade it to a fact); plan = a scheduled future item; fact = everything else that is established.
- Skip: formatting, navigation, changelog chatter, anything the text itself says is superseded, obsolete, cancelled or wrong, and duplicates inside the same text. Do not diagnose or give medical clearance. Never add anything that is not in the text.
- At most 12 claims; fewer is fine; return {"claims":[]} when nothing durable is there.`
const norm = (s) => String(s || '').toLowerCase().replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim()
const KINDS = new Set(['fact', 'baseline', 'rule', 'decision', 'lesson', 'hypothesis', 'plan', 'constraint'])
// pure: turn a model reply into memory rows; claims whose quote is not in the chunk are dropped
export function sameClaim(a, b) {
  const x = norm(a), y = norm(b); if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  const wa = new Set(x.split(' ')), wb = new Set(y.split(' ')); let inter = 0; for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter) >= 0.6
}
export function claimsToMemories(reply, { docId, chunkText, ref, sourceDate, docStatus, model = null }) {
  const hay = norm(chunkText), out = [], dropped = []
  for (const c of Array.isArray(reply?.claims) ? reply.claims.slice(0, 12) : []) {
    const title = String(c?.title || '').trim().slice(0, 160), body = String(c?.body || '').trim().slice(0, 600), quote = String(c?.quote || '').trim(), kind = KINDS.has(c?.kind) ? c.kind : 'fact'
    if (!title || !body || !quote) { dropped.push('incomplete'); continue }
    if (!hay.includes(norm(quote))) { dropped.push('quote not in text'); continue }
    const procedural = kind === 'rule' || kind === 'constraint'
    out.push({ tier: procedural ? 'procedural' : 'semantic', kind, title: `${docId} · ${title}`.slice(0, 200), body, payload: { doc: docId, quote: quote.slice(0, 300), doc_status: docStatus, extracted: true, models: model ? [model] : [] }, evidence_tag: kind === 'hypothesis' ? 'HYPOTHESIS' : 'KB',
      confidence: Number.isFinite(+c.confidence) ? Math.min(1, Math.max(0, +c.confidence)) : null, status: procedural ? 'proposal' : 'candidate', source: 'kb_extract', source_ref: `${ref}.${out.length}`, created_by: 'extractor', valid_from: sourceDate || null })
  }
  return { memories: out, dropped }
}
async function extract(conc, chunkSize = 6000, model = null) {
  const { chunk, statusOf, parseDoc } = await import('./kb.js'), { complete } = await import('./llm.js'), { addMemory } = await import('./memory.js')
  const progressFile = path.join(dir, 'tmp', 'extract-progress.json'); fs.mkdirSync(path.dirname(progressFile), { recursive: true, mode: 0o700 })
  let prog = {}; try { prog = JSON.parse(fs.readFileSync(progressFile, 'utf8')) } catch {}
  const jobs = []
  for (const d of idb.prepare('SELECT doc_id, title, status, source_date, body FROM kb_docs ORDER BY doc_id').all()) {
    if (statusOf(d.status) === 'archived') continue
    chunk(parseDoc(d.body).body, chunkSize).forEach((c, i) => { const hash = crypto.createHash('sha256').update(EXTRACT_SYSTEM + '|' + c + (model ? '|' + model : '')).digest('hex').slice(0, 24); if (!prog[hash]) jobs.push({ label: `${d.doc_id}#${i}`, hash, doc: d, text: c, ref: `${d.doc_id}#x${chunkSize === 6000 ? '' : chunkSize + '-'}${i}${model ? '~' + model : ''}` }) })
  }
  const todo = jobs.slice(0, limit)
  log(`extract: ${todo.length} chunks to read (${jobs.length - todo.length} deferred, ${Object.keys(prog).length} already done)`)
  if (dry) { todo.slice(0, 15).forEach((j) => log('  would read', j.label, j.text.length, 'chars')); return }
  const quotes = new Set(mdb.prepare("SELECT json_extract(payload,'$.quote') q FROM memory WHERE source='kb_extract'").all().map((r) => norm(r.q))) // a finer pass never re-adds a sentence that already has a claim
  const byDoc = new Map()   // existing extracted claims per document, for cross-model agreement
  for (const r of mdb.prepare("SELECT id, payload FROM memory WHERE source='kb_extract' AND created_by='extractor' AND status IN ('candidate','proposal','active')").all()) { let p = {}; try { p = JSON.parse(r.payload) } catch {} if (!byDoc.has(p.doc)) byDoc.set(p.doc, []); byDoc.get(p.doc).push({ id: r.id, quote: p.quote || '', models: p.models || [] }) }
  const markAgreed = (id, m) => { const row = mdb.prepare('SELECT payload, confidence FROM memory WHERE id=?').get(id); let p = {}; try { p = JSON.parse(row.payload) } catch {}; p.models = [...new Set([...(p.models || []), m])]; mdb.prepare('UPDATE memory SET payload=?, confidence=?, updated_at=? WHERE id=?').run(JSON.stringify(p), Math.max(row.confidence ?? 0, 0.9), new Date().toISOString(), id) }
  const totals = { claims: 0, created: 0, dup: 0, dropped: 0, tokens: 0 }
  const r = await pool(todo, conc, async (j) => {
    const res = await complete({ system: EXTRACT_SYSTEM, user: `Document ${j.doc.doc_id} — ${j.doc.title} (status: ${j.doc.status || 'n/a'}, date: ${j.doc.source_date || 'n/a'})\n\nTEXT:\n${j.text}`, effort: 'high', intent: 'weekly_review', ...(model ? { model } : {}) })
    if (!res.json || !Array.isArray(res.json.claims)) throw new Error('reply was not {"claims":[…]}')
    const { memories, dropped } = claimsToMemories(res.json, { docId: j.doc.doc_id, chunkText: j.text, ref: j.ref, sourceDate: j.doc.source_date, docStatus: j.doc.status, model: res.model || model })
    let created = 0, dup = 0, agreed = 0
    for (const m of memories) {
      const qk = norm(m.payload.quote), mine = m.payload.models[0]
      const twin = [...(byDoc.get(m.payload.doc) || [])].find((e) => sameClaim(e.quote, m.payload.quote))
      if (twin) { if (mine && !twin.models.includes(mine)) { twin.models.push(mine); agreed++; markAgreed(twin.id, mine) } else dup++; continue }   // another model already made this claim: record the agreement instead of a duplicate
      if (quotes.has(qk)) { dup++; continue }
      const a = addMemory(m); if (a.created) { created++; quotes.add(qk); if (!byDoc.has(m.payload.doc)) byDoc.set(m.payload.doc, []); byDoc.get(m.payload.doc).push({ id: a.id, quote: m.payload.quote, models: [...m.payload.models] }) } else dup++
    }
    Object.assign(totals, { claims: totals.claims + memories.length, created: totals.created + created, dup: totals.dup + dup, dropped: totals.dropped + dropped.length, tokens: totals.tokens + (res.usage?.total_tokens || 0) })
    prog[j.hash] = { at: new Date().toISOString(), n: memories.length }; fs.writeFileSync(progressFile, JSON.stringify(prog), { mode: 0o600 })
    log(`  ${j.label}: ${memories.length} claims (${created} new, ${agreed} agreed with another model, ${dup} dup, ${dropped.length} dropped)`)
  })
  log(`extract: done — ${r.ok} chunks ok, ${r.failed} failed; ${totals.created} new candidates, ${totals.dup} duplicates, ${totals.dropped} dropped (no faithful quote); ${totals.tokens} tokens`)
}

// ---- 4) cross-document consistency: for every pair of active documents that reference each other, ask where they contradict (quotes from both sides must be verbatim)
export const CONSISTENCY_SYSTEM = `You compare two documents from the same runner's training project (Indonesian and English mixed) and find places where they CONTRADICT each other (a different number, date, rule, target, status or decision for the same thing).
Return ONLY JSON: {"contradictions":[{"topic":"<=100 chars","a_quote":"<=240 chars copied EXACTLY from document A","b_quote":"<=240 chars copied EXACTLY from document B","explanation":"<=350 chars: what differs and which is likely current (use the dates and status lines), in English","severity":"high|medium|low"}]}.
Rules: both quotes must be verbatim substrings of their document or the item is discarded. Ignore differences the documents themselves already mark as resolved, superseded, corrected or historical. Ignore wording differences with the same meaning. At most 6; {"contradictions":[]} when they agree.`
export function docPairs() {
  const docs = idb.prepare('SELECT doc_id, title, status, source_date, body FROM kb_docs ORDER BY doc_id').all(), by = new Map(docs.map((d) => [d.doc_id, d])), pairs = new Map()
  const archived = (d) => /^(SUPERSEDED|ARCHIVE|RETIRED)/i.test(d.status || '') && !/\bACTIVE\b/i.test(d.status)
  for (const d of docs) { if (archived(d)) continue; for (const m of d.body.matchAll(/`(\d{2}\.\d{1,2})`/g)) { const t = by.get(m[1]); if (t && t.doc_id !== d.doc_id && !archived(t)) { const k = [d.doc_id, t.doc_id].sort().join('|'); pairs.set(k, (pairs.get(k) || 0) + 1) } } }
  return [...pairs].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: k.replace('|', ' vs '), a: by.get(k.split('|')[0]), b: by.get(k.split('|')[1]), refs: n }))
}
export function contradictionsToMemories(reply, { a, b, ref }) {
  const out = [], hayA = norm(a.body), hayB = norm(b.body)
  for (const c of Array.isArray(reply?.contradictions) ? reply.contradictions.slice(0, 6) : []) {
    const aq = String(c?.a_quote || '').trim(), bq = String(c?.b_quote || ''). trim(), topic = String(c?.topic || '').trim().slice(0, 100), ex = String(c?.explanation || '').trim().slice(0, 450)
    if (!topic || !ex || !aq || !bq || !hayA.includes(norm(aq)) || !hayB.includes(norm(bq))) continue
    out.push({ tier: 'semantic', kind: 'conflict', title: `Docs disagree · ${topic} (${a.doc_id} vs ${b.doc_id})`.slice(0, 200), body: ex, payload: { doc: a.doc_id, doc_b: b.doc_id, quote: aq.slice(0, 300), quote_b: bq.slice(0, 300), severity: ['high', 'medium', 'low'].includes(c.severity) ? c.severity : 'medium', extracted: true },
      evidence_tag: 'HYPOTHESIS', confidence: null, status: 'candidate', source: 'kb_extract', source_ref: `${ref}.${out.length}`, created_by: 'consistency', valid_from: [a.source_date, b.source_date].filter(Boolean).sort().pop() || null })
  }
  return out
}
async function consistency(conc) {
  const { complete } = await import('./llm.js'), { addMemory } = await import('./memory.js')
  const progressFile = path.join(dir, 'tmp', 'consistency-progress.json'); fs.mkdirSync(path.dirname(progressFile), { recursive: true, mode: 0o700 })
  let prog = {}; try { prog = JSON.parse(fs.readFileSync(progressFile, 'utf8')) } catch {}
  const hashOf = (p) => crypto.createHash('sha256').update(CONSISTENCY_SYSTEM + p.a.body + p.b.body).digest('hex').slice(0, 24)
  const todo = docPairs().filter((p) => !prog[hashOf(p)]).slice(0, limit)
  log(`consistency: ${todo.length} document pairs to compare`)
  if (dry) { todo.slice(0, 15).forEach((p) => log('  would compare', p.label, p.refs, 'refs')); return }
  let created = 0
  const r = await pool(todo, conc, async (p, k) => {
    const cut = (d) => d.body.length > 24000 ? d.body.slice(0, 24000) : d.body
    const res = await complete({ system: CONSISTENCY_SYSTEM, user: `DOCUMENT A — ${p.a.doc_id} ${p.a.title} (status: ${p.a.status}, date: ${p.a.source_date})\n${cut(p.a)}\n\n=====\nDOCUMENT B — ${p.b.doc_id} ${p.b.title} (status: ${p.b.status}, date: ${p.b.source_date})\n${cut(p.b)}`, effort: 'high', intent: 'weekly_review' })
    if (!res.json || !Array.isArray(res.json.contradictions)) throw new Error('reply was not {"contradictions":[…]}')
    const ms = contradictionsToMemories(res.json, { a: { ...p.a, body: cut(p.a) }, b: { ...p.b, body: cut(p.b) }, ref: `${p.a.doc_id}~${p.b.doc_id}` })
    for (const m of ms) if (addMemory(m).created) created++
    prog[hashOf(p)] = { at: new Date().toISOString(), n: ms.length }; fs.writeFileSync(progressFile, JSON.stringify(prog), { mode: 0o600 })
    log(`  [${k + 1}/${todo.length}] ${p.label}: ${ms.length} contradictions`)
  })
  log(`consistency: done — ${r.ok} pairs ok, ${r.failed} failed, ${created} new candidates`)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  try {
    if (cmd === 'reviews') await coachJobs('session_review', unreviewedSessions().slice(0, limit), Number(arg('conc', 2)))
    else if (cmd === 'postmortems') await coachJobs('race_postmortem', raceSessions().slice(0, limit), Number(arg('conc', 2)))
    else if (cmd === 'extract') await extract(Number(arg('conc', 4)), Number(arg('chunk', 6000)), arg('model') || null)
    else if (cmd === 'consistency') await consistency(Number(arg('conc', 4)))
    else { console.error('commands: reviews | postmortems | extract [--chunk N] [--model ID: a second model; claims both models make are marked as agreed] | consistency   [--limit N] [--conc N] [--dry]'); process.exit(2) }
  } catch (e) { console.error('error:', e.message); process.exit(1) }
}
