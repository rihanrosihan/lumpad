// Bulk coach jobs that use the model heavily: backfill session reviews, race post-mortems, and memory extraction from the knowledge-base documents.
//   node --env-file=.env server/intel/bulk.js reviews     [--limit N] [--conc 2] [--dry]   one high-effort review for every FIT session that has none yet (newest first)
//   node --env-file=.env server/intel/bulk.js postmortems [--limit N] [--conc 2] [--dry]   one race post-mortem per race in the ledger that has a FIT file
//   node --env-file=.env server/intel/bulk.js extract     [--limit N] [--conc 3] [--dry]   claims from the KB documents → memory CANDIDATES (you approve them in the memory view)
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
export function claimsToMemories(reply, { docId, chunkText, ref, sourceDate, docStatus }) {
  const hay = norm(chunkText), out = [], dropped = []
  for (const c of Array.isArray(reply?.claims) ? reply.claims.slice(0, 12) : []) {
    const title = String(c?.title || '').trim().slice(0, 160), body = String(c?.body || '').trim().slice(0, 600), quote = String(c?.quote || '').trim(), kind = KINDS.has(c?.kind) ? c.kind : 'fact'
    if (!title || !body || !quote) { dropped.push('incomplete'); continue }
    if (!hay.includes(norm(quote))) { dropped.push('quote not in text'); continue }
    const procedural = kind === 'rule' || kind === 'constraint'
    out.push({ tier: procedural ? 'procedural' : 'semantic', kind, title: `${docId} · ${title}`.slice(0, 200), body, payload: { doc: docId, quote: quote.slice(0, 300), doc_status: docStatus, extracted: true }, evidence_tag: kind === 'hypothesis' ? 'HYPOTHESIS' : 'KB',
      confidence: Number.isFinite(+c.confidence) ? Math.min(1, Math.max(0, +c.confidence)) : null, status: procedural ? 'proposal' : 'candidate', source: 'kb_extract', source_ref: `${ref}.${out.length}`, created_by: 'extractor', valid_from: sourceDate || null })
  }
  return { memories: out, dropped }
}
async function extract(conc) {
  const { chunk, statusOf, parseDoc } = await import('./kb.js'), { complete } = await import('./llm.js'), { addMemory } = await import('./memory.js')
  const progressFile = path.join(dir, 'tmp', 'extract-progress.json'); fs.mkdirSync(path.dirname(progressFile), { recursive: true, mode: 0o700 })
  let prog = {}; try { prog = JSON.parse(fs.readFileSync(progressFile, 'utf8')) } catch {}
  const jobs = []
  for (const d of idb.prepare('SELECT doc_id, title, status, source_date, body FROM kb_docs ORDER BY doc_id').all()) {
    if (statusOf(d.status) === 'archived') continue
    chunk(parseDoc(d.body).body, 6000).forEach((c, i) => { const hash = crypto.createHash('sha256').update(EXTRACT_SYSTEM + '|' + c).digest('hex').slice(0, 24); if (!prog[hash]) jobs.push({ label: `${d.doc_id}#${i}`, hash, doc: d, text: c, ref: `${d.doc_id}#x${i}` }) })
  }
  const todo = jobs.slice(0, limit)
  log(`extract: ${todo.length} chunks to read (${jobs.length - todo.length} deferred, ${Object.keys(prog).length} already done)`)
  if (dry) { todo.slice(0, 15).forEach((j) => log('  would read', j.label, j.text.length, 'chars')); return }
  const totals = { claims: 0, created: 0, dup: 0, dropped: 0, tokens: 0 }
  const r = await pool(todo, conc, async (j) => {
    const res = await complete({ system: EXTRACT_SYSTEM, user: `Document ${j.doc.doc_id} — ${j.doc.title} (status: ${j.doc.status || 'n/a'}, date: ${j.doc.source_date || 'n/a'})\n\nTEXT:\n${j.text}`, effort: 'high', intent: 'weekly_review' })
    if (!res.json || !Array.isArray(res.json.claims)) throw new Error('reply was not {"claims":[…]}')
    const { memories, dropped } = claimsToMemories(res.json, { docId: j.doc.doc_id, chunkText: j.text, ref: j.ref, sourceDate: j.doc.source_date, docStatus: j.doc.status })
    let created = 0, dup = 0
    for (const m of memories) { const a = addMemory(m); if (a.created) created++; else dup++ }
    Object.assign(totals, { claims: totals.claims + memories.length, created: totals.created + created, dup: totals.dup + dup, dropped: totals.dropped + dropped.length, tokens: totals.tokens + (res.usage?.total_tokens || 0) })
    prog[j.hash] = { at: new Date().toISOString(), n: memories.length }; fs.writeFileSync(progressFile, JSON.stringify(prog), { mode: 0o600 })
    log(`  ${j.label}: ${memories.length} claims (${created} new, ${dup} dup, ${dropped.length} dropped)`)
  })
  log(`extract: done — ${r.ok} chunks ok, ${r.failed} failed; ${totals.created} new candidates, ${totals.dup} duplicates, ${totals.dropped} dropped (no faithful quote); ${totals.tokens} tokens`)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  try {
    if (cmd === 'reviews') await coachJobs('session_review', unreviewedSessions().slice(0, limit), Number(arg('conc', 2)))
    else if (cmd === 'postmortems') await coachJobs('race_postmortem', raceSessions().slice(0, limit), Number(arg('conc', 2)))
    else if (cmd === 'extract') await extract(Number(arg('conc', 3)))
    else { console.error('commands: reviews | postmortems | extract   [--limit N] [--conc N] [--dry]'); process.exit(2) }
  } catch (e) { console.error('error:', e.message); process.exit(1) }
}
