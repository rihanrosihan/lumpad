// Coach Studio: four read-mostly capabilities on top of the knowledge graph and the memory store.
//  - graphAsk:    ask a question; the answer is built ONLY from rows read out of the Neo4j graph (+ the memory text those rows point at), with the paths it used
//  - kbAudit:     deterministic staleness / consistency audit of the knowledge-base documents, the open-items table and the pending extractions
//  - memoryInbox: the pending (candidate / proposal) memories grouped by source document, with the verbatim quote each one was extracted from; bulk approve / retract
//  - raceBrief:   the next race, days to go, the lessons and post-mortems that apply, and what to run next
// The browser can only send a question or ids; the Cypher below is fixed and every user term is passed as an escaped string literal.
import { idb, mdb } from './db.js'
import { run as neoRun, configured as neoConfigured } from '../neo4j.js'
import { getMemory, setStatus, ftsSearch } from './memory.js'
import { RACES } from '../../src/lib/season.js'

const wib = (ms = Date.now()) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10)
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5)
const lit = (s) => JSON.stringify(String(s)) // a JSON string is a valid Cypher string literal

// ---------------------------------------------------------------- graph ask
const STOP = new Set(['the', 'and', 'for', 'what', 'when', 'why', 'how', 'did', 'does', 'was', 'were', 'are', 'about', 'with', 'from', 'that', 'this', 'have', 'has', 'last', 'my', 'me', 'dan', 'yang', 'apa', 'kenapa', 'bagaimana', 'saya', 'ini', 'itu'])
export const termsOf = (q) => [...new Set((String(q || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,29}/gu) || []).filter((t) => !STOP.has(t)))].slice(0, 6)
const rows = (j) => j?.data?.values || []
export async function graphEvidence(question, { neo = neoRun } = {}) {
  const terms = termsOf(question); if (!terms.length) return { terms, ev: {}, lines: [] }
  const T = '[' + terms.map(lit).join(',') + ']', q = async (s) => { try { return rows(await neo(s, { timeout: 8000 })) } catch { return [] } }
  const ents = await q(`MATCH (e:Entity) WHERE any(t IN ${T} WHERE toLower(e.name) CONTAINS t OR toLower(e.id) CONTAINS t) RETURN e.id, e.name, e.kind LIMIT 8`)
  const ids = '[' + ents.map((e) => lit(e[0])).join(',') + ']'
  const [docs, concerns, races, mems, cps, rules] = await Promise.all([
    ents.length ? q(`MATCH (d:Document)-[x:MENTIONS]->(e:Entity) WHERE e.id IN ${ids} AND d.archived = false RETURN d.id, d.title, e.name, x.n ORDER BY x.n DESC LIMIT 10`) : [],
    ents.length ? q(`MATCH (c)-[:CONCERNS]->(e:Entity) WHERE e.id IN ${ids} AND (c:Conflict OR c:OpenItem) RETURN labels(c)[0], c.id, coalesce(c.topic, c.item), coalesce(c.winner, c.detail), e.name LIMIT 10`) : [],
    q(`MATCH (r:RaceEntry) WHERE any(t IN ${T} WHERE toLower(r.name) CONTAINS t OR toLower(coalesce(r.note,'')) CONTAINS t) OPTIONAL MATCH (r)-[:DONE_AS]->(s:Session) RETURN r.date, r.name, r.result, r.note, s.label_id, s.onset_km, s.run_share ORDER BY r.date LIMIT 8`),
    ents.length ? q(`MATCH (m:Memory)-[:MENTIONS]->(e:Entity) WHERE e.id IN ${ids} AND m.status = 'active' RETURN m.id, m.title, e.name LIMIT 12`) : [],
    /checkpoint|\bcp\d+|time trial|\btt\b/i.test(question) ? q(`MATCH (c:Checkpoint) RETURN c.id, c.test, c.date_text, c.line, c.green, c.red ORDER BY toInteger(c.num) LIMIT 20`) : [],
    [],
  ])
  const memText = mems.map((m) => { const x = getMemory(m[0]); return x ? [m[0], m[1], String(x.body || '').slice(0, 420), m[2]] : null }).filter(Boolean)
  const lines = []
  for (const e of ents) lines.push(`ENTITY ${e[0]} "${e[1]}" (${e[2]})`)
  for (const d of docs) lines.push(`DOC ${d[0]} "${d[1]}" -[MENTIONS x${d[3]}]-> ${d[2]}`)
  for (const c of concerns) lines.push(`${String(c[0]).toUpperCase()} ${c[1]} "${c[2]}" -[CONCERNS]-> ${c[4]} :: ${String(c[3] || '').slice(0, 260)}`)
  for (const r of races) lines.push(`RACE ${r[0]} "${r[1]}" result: ${r[2]} :: ${String(r[3] || '').slice(0, 260)}${r[4] ? ` -[DONE_AS]-> SESSION ${r[4]} (onset km ${r[5] ?? 'n/a'}, run share ${r[6] ?? 'n/a'})` : ''}`)
  for (const c of cps) lines.push(`CHECKPOINT ${c[0]} test "${c[1]}" date ${c[2]} line VDOT ${c[3]} green ≤ ${c[4]} red > ${c[5]}`)
  for (const m of memText) lines.push(`MEMORY #${m[0]} "${m[1]}" -[MENTIONS]-> ${m[3]} :: ${m[2]}`)
  for (const r of rules) lines.push(`RULE ${r[0]} "${r[1]}"`)
  return { terms, ev: { entities: ents.length, docs: docs.length, concerns: concerns.length, races: races.length, memories: memText.length, checkpoints: cps.length }, lines }
}
export const ASK_SYSTEM = `You answer a runner's question about their own training knowledge graph. You are given EVIDENCE rows read from the graph (entities, documents, conflicts, open items, race ledger entries, checkpoints, memories).
Rules: use ONLY the evidence; if it does not contain the answer, say plainly that the graph has nothing on it and what is missing. Quote numbers exactly as given. Name the evidence you used by its id (DOC 04.9, CONFLICT 00.3#c1, MEMORY #123, RACE 2026-11-15 …). Plain, short sentences; no diagnosis, no medical clearance.
Return ONLY JSON: {"answer_md":"<=1500 chars","paths":["DOC 03.9 -[MENTIONS]-> Event:borobudur", …at most 6 paths you actually used],"gaps":["what the graph does not say", …at most 3]}.`
export async function graphAsk(question, { neo = neoRun, llm } = {}) {
  const q = String(question || '').trim().slice(0, 400); if (q.length < 3) throw Object.assign(new Error('Ask a question first'), { status: 400 })
  if (!neoConfigured()) return { ok: false, error: 'The knowledge graph is not connected (NEO4J_* in .env.v2).' }
  const g = await graphEvidence(q, { neo })
  if (!g.lines.length) return { ok: true, answer_md: 'The graph has nothing that matches these words. Try the name of a race, a shoe, a document number or a topic such as MTSS, heat or fuelling.', paths: [], gaps: [], evidence: g.ev, terms: g.terms }
  const complete = llm || (await import('./llm.js')).complete
  const r = await complete({ system: ASK_SYSTEM, user: `QUESTION: ${q}\n\nEVIDENCE:\n${g.lines.join('\n')}`, effort: 'high', intent: 'question' })
  if (!r.json?.answer_md) throw Object.assign(new Error('The model did not return an answer'), { status: 502 })
  return { ok: true, answer_md: String(r.json.answer_md).slice(0, 2000), paths: (r.json.paths || []).slice(0, 6).map(String), gaps: (r.json.gaps || []).slice(0, 3).map(String), evidence: g.ev, terms: g.terms, model: r.model, tokens: r.usage?.total_tokens || null }
}

// ---------------------------------------------------------------- KB audit
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 }
// "BARU 22 Sep" / "sejak 25 Okt" → ISO date in the doc's year (or the previous one when that would be in the future)
export function dateIn(text, docDate, today = wib()) {
  const m = /(\d{1,2})\s+(jan|feb|mar|apr|mei|may|jun|jul|agu|aug|sep|okt|oct|nov|des|dec)[a-z]*/i.exec(text || ''); if (!m) return null
  let y = Number((docDate || today).slice(0, 4)); const iso = (yy) => `${yy}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (iso(y) > today) y -= 1
  return iso(y)
}
export function kbAudit({ today = wib() } = {}) {
  const docs = idb.prepare('SELECT doc_id, title, status, source_date, body FROM kb_docs ORDER BY doc_id').all(), byId = new Map(docs.map((d) => [d.doc_id, d]))
  const archived = (d) => /^(SUPERSEDED|ARCHIVE|RETIRED)/i.test(d.status || '') && !/\bACTIVE\b/i.test(d.status)
  const out = []
  // 1) active documents that still point at archived ones
  const refs = new Map()
  for (const d of docs) { if (archived(d)) continue; for (const m of d.body.matchAll(/`(\d{2}\.\d{1,2})`/g)) { const t = byId.get(m[1]); if (t && t.doc_id !== d.doc_id && archived(t)) { const k = d.doc_id + '>' + t.doc_id; refs.set(k, (refs.get(k) || 0) + 1) } } }
  for (const [k, n] of [...refs].sort((a, b) => b[1] - a[1]).slice(0, 8)) { const [a, b] = k.split('>'); out.push({ kind: 'points-at-archived', severity: 'medium', doc: a, title: `${a} still points at ${b}, which is archived`, detail: `${n} reference${n > 1 ? 's' : ''} to ${b} (${byId.get(b).status}). Check whether they should point at its replacement.` }) }
  // 2) open items that have sat for more than 30 days
  const oi = byId.get('00.4')
  if (oi) for (const line of oi.body.split('\n')) {
    const m = /^\|\s*(\d+[a-d]?)\s*\|\s*([^|]+)\|/.exec(line); if (!m) continue
    const since = dateIn(line.match(/(?:BARU|sejak|opened|terbuka sejak)[^|]{0,20}\d{1,2}\s+\w{3,4}/i)?.[0] || '', oi.source_date, today); if (!since) continue
    const age = dayDiff(today, since); if (age > 30) out.push({ kind: 'stale-open-item', severity: age > 60 ? 'high' : 'medium', doc: '00.4', title: `Open item ${m[1]} has been open ${age} days`, detail: m[2].replace(/\*|`/g, '').trim().slice(0, 200) })
  }
  // 3) active documents not touched for a long time
  for (const d of docs) { if (archived(d) || !d.source_date) continue; const age = dayDiff(today, d.source_date); if (age > 45 && !/^0[0-1]/.test(d.doc_id) && !/reference/i.test(d.status)) out.push({ kind: 'old-active-doc', severity: 'low', doc: d.doc_id, title: `${d.doc_id} is marked active but last dated ${d.source_date} (${age} days ago)`, detail: d.title }) }
  // 4) the doc index itself says other docs are out of sync
  for (const d of docs) for (const m of d.body.matchAll(/([^\n|]{0,120}(?:belum disinkronkan|usang|sudah tidak berlaku|out of sync)[^\n|]{0,120})/gi)) { out.push({ kind: 'self-reported', severity: 'medium', doc: d.doc_id, title: `${d.doc_id} reports its own staleness`, detail: m[1].replace(/\*|`/g, '').trim() }); break }
  // 5) extractions waiting for approval
  const pend = mdb.prepare("SELECT json_extract(payload,'$.doc') d, COUNT(*) n, MIN(created_at) oldest FROM memory WHERE source='kb_extract' AND status IN ('candidate','proposal') GROUP BY d ORDER BY n DESC").all()
  const total = pend.reduce((s, r) => s + r.n, 0)
  if (total) out.push({ kind: 'pending-extractions', severity: total > 100 ? 'medium' : 'low', doc: null, title: `${total} extracted claims are waiting for your approval`, detail: pend.slice(0, 6).map((r) => `${r.d}: ${r.n}`).join(' · ') })
  const rank = { high: 0, medium: 1, low: 2 }
  out.sort((a, b) => rank[a.severity] - rank[b.severity])
  return { generated: today, docs: docs.length, findings: out.length, items: out.slice(0, 40) }
}

// ---------------------------------------------------------------- memory inbox
const PENDING = "('candidate','proposal')"
export function memoryInbox({ source = '', doc = '', agreed = false, limitDocs = 12, offsetDocs = 0 } = {}) {
  const all = mdb.prepare(`SELECT id, tier, kind, title, body, payload, evidence_tag, confidence, status, source, source_ref, created_by, created_at, valid_from FROM memory WHERE status IN ${PENDING} ${source ? 'AND source=@source' : ''} ORDER BY id`).all(source ? { source } : {})
  const groups = new Map()
  for (const m of all) {
    let p = {}; try { p = JSON.parse(m.payload || '{}') } catch {}
    const g = p.doc || (m.source_ref || '').split('#')[0] || (m.source === 'coach' ? 'coach' : 'other')
    if (doc && g !== doc) continue
    if (agreed && (p.models || []).length < 2) continue
    if (!groups.has(g)) groups.set(g, { doc: g, title: idb.prepare('SELECT title FROM kb_docs WHERE doc_id=?').get(g)?.title || (g === 'coach' ? 'Written by the coach' : g), count: 0, rules: 0, agreed: 0, items: [] })
    const G = groups.get(g); G.count++; if (m.tier === 'procedural') G.rules++; if ((p.models || []).length >= 2) G.agreed = (G.agreed || 0) + 1
    G.items.push({ id: m.id, tier: m.tier, kind: m.kind, title: m.title, body: m.body.slice(0, 600), quote: p.quote || null, quote_b: p.quote_b || null, doc_b: p.doc_b || null, models: p.models || [], agreed: (p.models || []).length >= 2, tag: m.evidence_tag, confidence: m.confidence, status: m.status, source: m.source, by: m.created_by, valid_from: m.valid_from })
  }
  const list = [...groups.values()].sort((a, b) => b.count - a.count || a.doc.localeCompare(b.doc))
  return { total: list.reduce((n, g) => n + g.count, 0), docs: list.length, groups: list.slice(offsetDocs, offsetDocs + limitDocs) }
}
// bulk approve / retract; locked rules are skipped, never changed. A proposal approved here becomes an ACTIVE rule the coach is bound by.
export function bulkAction(ids, action, by = 'athlete') {
  const to = { approve: 'active', retract: 'retracted', archive: 'archived' }[action]; if (!to) throw Object.assign(new Error('bad action'), { status: 400 })
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, 300); if (!list.length) throw Object.assign(new Error('no ids'), { status: 400 })
  const done = [], skipped = []
  for (const id of list) { try { const m = getMemory(id); if (!m || !['candidate', 'proposal'].includes(m.status)) { skipped.push({ id, why: 'not pending' }); continue } setStatus(id, to, by); done.push(id) } catch (e) { skipped.push({ id, why: e.message }) } }
  return { done: done.length, skipped }
}

// ---------------------------------------------------------------- race brief
export function raceBrief({ today = wib() } = {}) {
  const next = RACES.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || null
  const runs = (intent, n = 3) => mdb.prepare("SELECT id, created_at, question, parsed FROM coach_run WHERE ok=1 AND intent=? ORDER BY id DESC LIMIT ?").all(intent, n).map((r) => { let p = {}; try { p = JSON.parse(r.parsed || '{}') } catch {} return { id: r.id, at: r.created_at.slice(0, 10), question: r.question, summary: p.summary || '' } })
  const postmortems = runs('race_postmortem', 4), plan = runs('race_plan', 1)[0] || null
  let lessons = []
  if (next) lessons = ftsSearch(`${next.name} race pacing heat fuelling opening lesson`, { tiers: ['semantic', 'procedural'], statuses: ['active'], limit: 6 }).map((m) => ({ id: m.id, title: m.title, body: String(m.body || '').slice(0, 220), tag: m.evidence_tag }))
  const days = next ? dayDiff(next.date, today) : null
  const planAge = plan ? dayDiff(today, plan.at) : null
  const suggest = !next ? 'No upcoming race in the calendar.' : days <= 21 && (planAge == null || planAge > 3) ? 'Run the race plan now: the race is close and the last plan is old or missing.' : days <= 90 ? 'Review the post-mortems below and set the opening pace / heart-rate cap before the build ends.' : 'Race is far away: keep the post-mortem lessons in mind and revisit at 12 weeks to go.'
  return { today, race: next, days_to_go: days, postmortems, lessons, race_plan: plan, suggest }
}
