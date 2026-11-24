// QA stage E2: golden-set recall. The old Jakim race-context summary (exports/jakim-2026-race-context.md, a DERIVED bundle skipped by the pipeline, S3 in the matrix) is used as an answer key:
// the model lists its checkable facts, then each fact is looked up in (a) what Lumpad already remembered BEFORE this import, (b) the absorbed claims, (c) the parsed Jakim events.
// Recall of the union is the gate (>= 90 %); the split shows how much the import actually added.
import { openZip } from './zip.js'
import { redactX, leaks } from './redact.js'
import { openRO } from './fence.js'
import { jaccard, words, ftsQuery } from './judge.js'
import { nowIso, kvSet, kvGet } from './db.js'

const KEY = 'exports/jakim-2026-race-context.md'
const FACTS = `List the checkable facts in this race summary as atomic items. Return ONLY JSON: {"facts":[{"fact":"<=200 chars, one verifiable statement with its numbers","quote":"<=200 chars copied from the text"}]}. At most 40; prefer facts about timing, stops and their reasons, pain, fuelling, pacing, heat, decisions and recovery; skip pure formatting.`
const COVER = `For each FACT decide whether the EVIDENCE snippets (from the runner's stored knowledge) state it. Return ONLY JSON: {"covered":[{"id":<n>,"verdict":"yes|partial|no","source":"memory|claim|event|none","note":"<=100 chars"}]}. yes = the same statement with the same numbers; partial = related but a detail is missing or different; no = not stated. Judge meaning, not wording. "source" = the evidence label that supports it best.`
export async function runGolden({ db, zipPath, complete, model = 'deepseek-v4-pro', log = () => {} }) {
  const z = openZip(zipPath), text = redactX(z.text(KEY)).split('## Complete Stop Detection Log')[0]; z.close()
  if (leaks(text).length) throw new Error('leak guard on golden text')
  let facts = kvGet(db, 'golden_facts', null), a = { usage: null }   // the answer key is generated once and then frozen, so runs are comparable
  if (!facts) { a = await complete({ system: FACTS, user: text, effort: 'high', intent: 'weekly_review', model }); facts = (a.json?.facts || []).filter((f) => f?.fact).slice(0, 40).map((f, i) => ({ id: i + 1, fact: String(f.fact).slice(0, 200) })); kvSet(db, 'golden_facts', facts) }
  const mdb = openRO('memory'), claims = db.prepare("SELECT claim_id, title, text FROM ol_claim WHERE qa_status = 'pass'").all().map((c) => ({ tag: 'claim', t: c.title + ' ' + c.text, w: words(c.title + ' ' + c.text) }))
  const evs = db.prepare("SELECT payload FROM ol_event WHERE kind LIKE 'jakim_%'").all().map((e) => { const t = Object.values(JSON.parse(e.payload)).join(' '); return { tag: 'event', t, w: words(t) } })
  const pool = [...claims, ...evs], batches = []
  const ev = facts.map((f) => {
    const fw = words(f.fact), top = pool.map((p) => ({ ...p, s: jaccard(fw, p.w) })).sort((x, y) => y.s - x.s).slice(0, 8)
    let mem = []; const q = ftsQuery(f.fact, 8); if (q) try { mem = mdb.prepare("SELECT m.title AS title, m.body AS body FROM memory_fts JOIN memory m ON m.id = memory_fts.rowid WHERE memory_fts MATCH ? AND m.status <> 'retracted' AND COALESCE(m.source,'') <> 'old_lumpad' ORDER BY bm25(memory_fts, 3.0, 1.0) LIMIT 4").all(q) } catch {}
    return { ...f, evidence: [...mem.map((m) => ({ tag: 'memory', t: m.title + ' — ' + String(m.body).slice(0, 260) })), ...top.map((p) => ({ tag: p.tag, t: p.t.slice(0, 240) }))] }
  })
  mdb.close(); for (let i = 0; i < ev.length; i += 8) batches.push(ev.slice(i, i + 8))
  const res = new Map(); let tokens = a.usage?.total_tokens || 0
  for (const b of batches) {
    const user = b.map((f) => `FACT ${f.id}: ${f.fact}\nEVIDENCE:\n` + f.evidence.map((e) => `  [${e.tag}] ${redactX(e.t)}`).join('\n')).join('\n\n')
    const r = await complete({ system: COVER, user, effort: 'high', intent: 'weekly_review', model }); tokens += r.usage?.total_tokens || 0
    for (const c of r.json?.covered || []) if (Number.isInteger(+c.id)) res.set(+c.id, c)
  }
  const score = (v) => (v === 'yes' ? 1 : v === 'partial' ? 0.5 : 0), n = facts.length
  const recall = facts.reduce((s, f) => s + score(res.get(f.id)?.verdict), 0) / (n || 1)
  const by = (src) => facts.filter((f) => res.get(f.id)?.verdict === 'yes' && res.get(f.id)?.source === src).length
  const missed = facts.filter((f) => (res.get(f.id)?.verdict || 'no') === 'no').map((f) => f.fact)
  const out = { facts: n, recall: +recall.toFixed(3), yes: facts.filter((f) => res.get(f.id)?.verdict === 'yes').length, partial: facts.filter((f) => res.get(f.id)?.verdict === 'partial').length, covered_by: { memory: by('memory'), claim: by('claim'), event: by('event') }, missed, tokens }
  kvSet(db, 'golden', { at: nowIso(), ...out }); log('golden:', JSON.stringify({ ...out, missed: missed.length })); return out
}
