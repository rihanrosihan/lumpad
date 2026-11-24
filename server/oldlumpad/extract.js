// Phase 2: LLM claim extraction from the kept documents. Only REDACTED chunk text is sent (redactX + leak self-check); a claim survives only if its quote is a verbatim substring of the
// chunk it came from. Resumable per (pass, chunk), token-metered into ol_run, and stopped by a hard ceiling and by the app's quota gate. Nothing here writes to memory.db or any live table
// (the only side effect outside oldlumpad.db is the app's own token counter inside complete()).
import crypto from 'node:crypto'
import { redactX, leaks } from './redact.js'
import { OLD_HORIZON, nowIso, kvGet, kvSet } from './db.js'

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
export const norm = (s) => String(s || '').toLowerCase().replace(/[*_`>#|]/g, ' ').replace(/\s+/g, ' ').trim()
export const SYSTEM = `You extract durable claims from a runner's OWN historical notes (Indonesian and English mixed) so a coach can remember them. The notes were written on the document date given; they describe the PAST.
Return ONLY JSON: {"claims":[{"kind":"episode|lesson|fact|rule|hypothesis|decision|constraint|plan","title":"<=100 chars","body":"<=450 chars","quote":"<=240 chars copied EXACTLY from the text","event_date":"YYYY-MM-DD or null","subject":"<=60 chars: race, injury site, run, shoe or topic","sensitivity":"S0|S1|S2","confidence":0.0-1.0}]}.
Rules:
- ONE atomic claim each, understandable alone (name the race, date, run, shoe or test; keep every number, unit and date exactly as written). Write title and body in English; keep original Indonesian terms in brackets when useful.
- Write in the PAST tense, as of the document date. Never state something as current, never carry a plan, target, zone or threshold forward as if it still applied; if the text gives a plan or target, say it was the plan at that date.
- "quote" must be a verbatim substring of the text (character for character). A claim without a faithful quote is worthless: do not invent one.
- kind: episode = a dated event or the athlete's reflection on it (race, run, injury onset, illness, decision on the day); lesson = what an event taught; rule = an instruction or gate the athlete followed; hypothesis = anything the text marks as estimate, hypothesis, "likely", unconfirmed, or an empirical pattern with a small n (never upgrade it to a fact); decision; constraint; plan = a scheduled item; fact = everything else that is established.
- event_date: the date the thing happened if the text gives it (or it is the document date for a same-day entry), else null.
- sensitivity: S2 = injury, pain, illness, medical or clinician detail, supplements, labs, body composition; S1 = family, workplace or other personal context; S0 = pure running/race/training data.
- Skip: formatting, navigation, generated gate tables, anything the text itself calls superseded or wrong, duplicates inside the same text. Do not diagnose and do not give medical clearance. Never add anything that is not in the text.
- At most 12 claims; fewer is fine; return {"claims":[]} when nothing durable is there.`

export function chunkText(body, max) {
  const secs = String(body).split(/\n(?=#{1,3} )/), out = []; let cur = ''
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = '' }
  for (const s of secs) {
    if (s.length > max) { flush(); let buf = ''; for (const p of s.split(/\n{2,}/)) { if (buf.length + p.length > max && buf) { out.push(buf.trim()); buf = '' } buf += p + '\n\n' ; while (buf.length > max * 1.5) { out.push(buf.slice(0, max)); buf = buf.slice(max) } } if (buf.trim()) out.push(buf.trim()) }
    else if (cur.length + s.length > max) { flush(); cur = s + '\n' } else cur += s + '\n'
  }
  flush(); return out
}
// documents that go through the model: everything textual except structured tables (parsed in Phase 1), generated cards, and the JSON copy of the answers
export const extractable = (d) => ['K1', 'K2', 'K3', 'K4', 'T1', 'T2', 'T3', 'T4', 'T5'].includes(d.rule_id) && /\.md$/.test(d.entry) && !/\/data\//.test(d.entry)
const KINDS = new Set(['episode', 'lesson', 'fact', 'rule', 'hypothesis', 'decision', 'constraint', 'plan'])
const HEALTH = /\b(pain|nyeri|sakit|injur|cedera|plantar|shin|mtss|physio|needling|illness|fever|diare|diarrhea|supplement|creatine|melatonin|magnesium|blood|lab|body fat|medical|doctor|clinic)\b/i

// pure: model reply -> verified claim rows
export function verify(reply, { chunk, docDate, docSens, pass, model }) {
  const hay = norm(chunk.text), out = [], dropped = {}
  const drop = (k) => { dropped[k] = (dropped[k] || 0) + 1 }
  for (const c of Array.isArray(reply?.claims) ? reply.claims.slice(0, 12) : []) {
    const title = String(c?.title || '').trim().slice(0, 160), body = String(c?.body || '').trim().slice(0, 600), quote = String(c?.quote || '').trim()
    if (!title || !body || !quote) { drop('incomplete'); continue }
    if (!hay.includes(norm(quote))) { drop('quote-not-in-text'); continue }
    const kind = KINDS.has(c?.kind) ? c.kind : 'fact'
    let ev = /^20\d\d-\d\d-\d\d$/.test(c?.event_date || '') ? c.event_date : null; if (ev && ev > OLD_HORIZON) ev = null
    const d = ev || docDate, sens = ['S0', 'S1', 'S2'].includes(c?.sensitivity) ? c.sensitivity : 'S0'
    const s = docSens === 'S2' || HEALTH.test(title + ' ' + body) ? 'S2' : sens
    out.push({ claim_id: sha(chunk.doc_id + '|' + norm(quote)).slice(0, 24), doc_id: chunk.doc_id, chunk_id: chunk.chunk_id, pass, quote: quote.slice(0, 300), text: body, title, kind, event_date: ev, valid_from: d, valid_to: d,
      subject_key: String(c?.subject || '').slice(0, 60) || null, sensitivity: s, models: [model].filter(Boolean), confidence: Number.isFinite(+c?.confidence) ? Math.min(1, Math.max(0, +c.confidence)) : 0.5 })
  }
  return { claims: out, dropped }
}
export function mergeClaim(db, c) {
  const ex = db.prepare('SELECT models, pass, confidence FROM ol_claim WHERE claim_id=?').get(c.claim_id)
  if (!ex) { db.prepare(`INSERT INTO ol_claim (claim_id, doc_id, chunk_id, pass, quote, text, title, kind, event_date, valid_from, valid_to, subject_key, sensitivity, models, confidence, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(c.claim_id, c.doc_id, c.chunk_id, c.pass, c.quote, c.text, c.title, c.kind, c.event_date, c.valid_from, c.valid_to, c.subject_key, c.sensitivity, JSON.stringify(c.models), c.confidence, nowIso()); return 'new' }
  const models = [...new Set([...JSON.parse(ex.models || '[]'), ...c.models])], passes = [...new Set(String(ex.pass).split(',').concat(c.pass))].join(',')
  db.prepare('UPDATE ol_claim SET models=?, pass=?, confidence=? WHERE claim_id=?').run(JSON.stringify(models), passes, Math.min(1, Math.max(ex.confidence || 0, c.confidence || 0) + 0.1), c.claim_id); return 'agreed'
}

export async function runExtract({ db, pass, size, model = null, limit = Infinity, conc = 2, dry = false, effort = 'high', ceiling = 5e6, log = () => {}, complete, quotaStop = () => false }) {
  const docs = db.prepare('SELECT doc_id, entry, rule_id, sensitivity, doc_date, body FROM ol_doc ORDER BY entry').all().filter(extractable)
  const insC = db.prepare('INSERT OR IGNORE INTO ol_chunk VALUES (?,?,?,?,?)'), done = kvGet(db, 'done:' + pass, {}), jobs = []
  for (const d of docs) chunkText(redactX(d.body), size).forEach((t, i) => { const id = sha(`${d.doc_id}|${pass}|${i}|${t}`).slice(0, 20); insC.run(id, d.doc_id, i, t, sha(t)); if (!done[id]) jobs.push({ doc: d, chunk: { chunk_id: id, doc_id: d.doc_id, idx: i, text: t } }) })
  const todo = jobs.slice(0, limit), spent0 = db.prepare("SELECT COALESCE(SUM(tokens),0) t FROM ol_run WHERE phase LIKE 'extract%'").get().t
  log(`extract ${pass}: ${todo.length} chunks (${jobs.length - todo.length} deferred, ${Object.keys(done).length} done); ceiling ${ceiling} tokens, spent so far ${spent0}`)
  if (dry) { todo.slice(0, 8).forEach((j) => log('  would read', j.doc.entry, '#' + j.chunk.idx, j.chunk.text.length, 'chars')); return { dry: true, chunks: todo.length } }
  const run = Number(db.prepare('INSERT INTO ol_run (phase, started_at) VALUES (?,?)').run('extract:' + pass, nowIso()).lastInsertRowid)
  const tot = { calls: 0, tokens: 0, new: 0, agreed: 0, dropped: {}, failed: 0, stopped: null }
  let i = 0
  await Promise.all(Array.from({ length: Math.max(1, conc) }, async () => {
    while (i < todo.length && !tot.stopped) {
      if (quotaStop()) { tot.stopped = 'quota'; break }
      if (spent0 + tot.tokens >= ceiling) { tot.stopped = 'ceiling'; break }
      const j = todo[i++], user = `Document type ${j.doc.rule_id}, document date ${j.doc.doc_date} (part ${j.chunk.idx + 1})\n\nTEXT:\n${j.chunk.text}`
      const lk = leaks(user); if (lk.length) { tot.failed++; log('  LEAK GUARD blocked', j.doc.entry, lk.join(',')); continue }
      try {
        const res = await complete({ system: SYSTEM, user, effort, intent: 'weekly_review', ...(model ? { model } : {}) })
        if (!res.json || !Array.isArray(res.json.claims)) throw new Error('reply was not {"claims":[…]}')
        const v = verify(res.json, { chunk: j.chunk, docDate: j.doc.doc_date, docSens: j.doc.sensitivity, pass, model: res.model || model })
        let nn = 0, na = 0; db.exec('BEGIN'); for (const c of v.claims) (mergeClaim(db, c) === 'new' ? nn++ : na++); db.exec('COMMIT')
        const tk = res.usage?.total_tokens || 0; tot.calls++; tot.tokens += tk; tot.new += nn; tot.agreed += na; for (const [k, n] of Object.entries(v.dropped)) tot.dropped[k] = (tot.dropped[k] || 0) + n
        done[j.chunk.chunk_id] = { at: nowIso(), n: v.claims.length }; kvSet(db, 'done:' + pass, done)
        log(`  ${j.doc.entry}#${j.chunk.idx}: ${v.claims.length} claims (${nn} new, ${na} agreed, dropped ${JSON.stringify(v.dropped)}) ${tk} tok`)
      } catch (e) { tot.failed++; log('  FAILED', j.doc.entry + '#' + j.chunk.idx, String(e.message).slice(0, 160)) }
    }
  }))
  db.prepare('UPDATE ol_run SET finished_at=?, calls=?, tokens=?, notes=? WHERE id=?').run(nowIso(), tot.calls, tot.tokens, JSON.stringify(tot), run)
  return tot
}
