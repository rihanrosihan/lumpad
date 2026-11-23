import test from 'node:test'
import assert from 'node:assert'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'studio-'))
const S = await import('./studio.js')
const M = await import('./memory.js')
const { idb } = await import('./db.js')

test('terms: stop words dropped, at most 6, unicode kept', () => {
  assert.deepEqual(S.termsOf('What did the heat do to my Borobudur race?'), ['heat', 'borobudur', 'race'])
  assert.deepEqual(S.termsOf('a b'), [])
})
test('graph evidence is built from fixed Cypher with escaped literals, and the answer only reaches the model as evidence rows', async () => {
  const seen = []
  const neo = async (cy) => { seen.push(cy); if (cy.includes('MATCH (e:Entity) WHERE any')) return { data: { values: [['Event:borobudur', 'Borobudur Marathon', 'Event']] } }; if (cy.includes('RaceEntry')) return { data: { values: [['2026-11-15', 'Borobudur FM', 'DNF', 'black flag', '481', 12.5, 0.8]] } }; return { data: { values: [] } } }
  const g = await S.graphEvidence('why did borobudur "}) DETACH DELETE (n) //', { neo })
  assert.ok(g.lines.some((l) => l.startsWith('ENTITY Event:borobudur')) && g.lines.some((l) => l.startsWith('RACE 2026-11-15')))
  assert.ok(seen.every((c) => !/\bDELETE\b|\bSET\b|\bCREATE\b|\bMERGE\b/i.test(c.replace(/"[^"]*"/g, ''))), 'read-only, user text only inside string literals')
  process.env.NEO4J_URI = 'neo4j+s://x.databases.neo4j.io'; process.env.NEO4J_USER = 'u'; process.env.NEO4J_PASSWORD = 'p'
  const r = await S.graphAsk('why did borobudur end early', { neo, llm: async ({ user }) => { assert.ok(user.includes('EVIDENCE:') && user.includes('black flag')); return { json: { answer_md: 'It ended under a black flag.', paths: ['RACE 2026-11-15 -[DONE_AS]-> SESSION 481'], gaps: [] }, model: 'm', usage: { total_tokens: 10 } } } })
  assert.equal(r.ok, true); assert.match(r.answer_md, /black flag/); assert.equal(r.evidence.races, 1)
})
test('dates in open items resolve to the previous year when they would be in the future', () => {
  assert.equal(S.dateIn('BARU 22 Sep', '2026-11-17', '2026-11-23'), '2026-09-22'); assert.equal(S.dateIn('BARU 22 Des', '2026-11-17', '2026-11-23'), '2025-12-22'); assert.equal(S.dateIn('no date'), null)
})
test('kb audit finds stale open items, references to archived docs and pending extractions', () => {
  const ins = idb.prepare('INSERT INTO kb_docs (doc_id, title, status, source_date, supersedes, path, body, hash, imported_at) VALUES (?,?,?,?,?,?,?,?,?)')
  ins.run('00.4', 'Open items', 'ACTIVE', '2026-11-17', null, 'p', '| 5 | **MTSS clearance** — BARU 22 Sep | open | x |\n| 6 | Recent thing — BARU 15 Nov | open |', 'h1', 'n')
  ins.run('03.4', 'Old pacing', 'SUPERSEDED', '2026-09-01', null, 'p', 'x', 'h2', 'n')
  ins.run('03.9', 'Race plan', 'ACTIVE', '2026-11-10', null, 'p', 'See `03.4` for the old scenarios. Indeks belum disinkronkan.', 'h3', 'n')
  M.addMemory({ tier: 'semantic', kind: 'fact', title: '03.9 · x', body: 'b', payload: { doc: '03.9', quote: 'q' }, status: 'candidate', source: 'kb_extract', source_ref: '03.9#x0.0', created_by: 'extractor' })
  const a = S.kbAudit({ today: '2026-11-23' }), kinds = a.items.map((x) => x.kind)
  assert.ok(kinds.includes('stale-open-item') && kinds.includes('points-at-archived') && kinds.includes('pending-extractions') && kinds.includes('self-reported'))
  assert.ok(a.items.find((x) => x.kind === 'stale-open-item').title.includes('Open item 5') && !a.items.some((x) => x.title.includes('Open item 6')))
})
test('inbox groups pending claims by document with their quote; bulk approve activates them, skips non-pending and locked', () => {
  const a = M.addMemory({ tier: 'semantic', kind: 'fact', title: '03.9 · a', body: 'ba', payload: { doc: '03.9', quote: 'verbatim' }, status: 'candidate', source: 'kb_extract', source_ref: '03.9#x1.0', created_by: 'extractor' })
  const r = M.addMemory({ tier: 'procedural', kind: 'rule', title: '03.9 · r', body: 'br', payload: { doc: '03.9', quote: 'rule quote' }, status: 'proposal', source: 'kb_extract', source_ref: '03.9#x1.1', created_by: 'extractor' })
  const inbox = S.memoryInbox({ source: 'kb_extract' }), g = inbox.groups.find((x) => x.doc === '03.9')
  assert.ok(g && g.rules >= 1 && g.items.some((i) => i.id === a.id && i.quote === 'verbatim') && g.title === 'Race plan')
  assert.equal(S.memoryInbox({ source: 'kb_extract', agreed: true }).total, 0, 'single-model claims are not in the agreed view')
  const res = S.bulkAction([a.id, r.id, 999999], 'approve'); assert.equal(res.done, 2); assert.equal(res.skipped.length, 1)
  assert.equal(M.getMemory(a.id).status, 'active'); assert.equal(M.getMemory(r.id).status, 'active')
  assert.throws(() => S.bulkAction([a.id], 'delete'), /bad action/)
  assert.equal(S.bulkAction([a.id], 'retract').skipped[0].why, 'not pending')
})
test('race brief: next race, days to go and what to do next', () => {
  const b = S.raceBrief({ today: '2027-06-01' }); assert.equal(b.race.name, 'Jakim FM'); assert.equal(b.days_to_go, 12); assert.match(b.suggest, /race plan/i)
  assert.equal(S.raceBrief({ today: '2030-01-01' }).race, null)
})
test('pending queue pages without a cap and approve-all covers everything but rule proposals', () => {
  for (let i = 0; i < 130; i++) M.addMemory({ tier: i % 2 ? 'semantic' : 'episodic', kind: 'fact', title: 'bulk ' + i, body: 'b' + i, status: 'candidate', source: 'coach', source_ref: 'bulk#' + i, created_by: 'test' })
  M.addMemory({ tier: 'procedural', kind: 'rule', title: 'a rule', body: 'r', status: 'proposal', source: 'coach', source_ref: 'bulk#r', created_by: 'test' })
  const p1 = S.pendingPage({ limit: 24 }), p2 = S.pendingPage({ limit: 24, offset: 24 })
  assert.ok(p1.total >= 131 && p1.items.length === 24 && p2.items.length === 24 && p1.items[0].id !== p2.items[0].id && p1.counts.procedural >= 1)
  assert.ok(S.pendingPage({ tier: 'semantic' }).items.every((x) => x.tier === 'semantic') && S.pendingPage({ limit: 500 }).items.length <= 100)
  const r = S.bulkAction([], 'approve', 'athlete', { scope: 'pending' })
  assert.ok(r.done >= 130, 'no 300 / 60 cap'); const after = S.pendingPage({}); assert.equal(after.counts.procedural >= 1, true); assert.ok(!after.counts.semantic && !after.counts.episodic)
  assert.ok(S.bulkAction([], 'approve', 'athlete', { scope: 'pending', includeRules: true }).done >= 1)
})
test('stale sweep flags claims from archived docs, open items whose date has passed, and claims a newer document contradicts; it never retracts', () => {
  const ins = idb.prepare('INSERT OR REPLACE INTO kb_docs (doc_id, title, status, source_date, supersedes, path, body, hash, imported_at) VALUES (?,?,?,?,?,?,?,?,?)')
  ins.run('09.1', 'Old', 'SUPERSEDED', '2026-08-01', null, 'p', 'x', 'h9', 'n'); ins.run('09.2', 'Older plan', 'ACTIVE', '2026-09-01', null, 'p', 'x', 'h10', 'n'); ins.run('09.3', 'Newer', 'ACTIVE', '2026-11-10', null, 'p', 'x', 'h11', 'n')
  const mk = (title, body, kind, doc, quote, ref) => M.addMemory({ tier: 'semantic', kind, title, body, payload: { doc, quote }, status: 'candidate', source: 'kb_extract', source_ref: ref, created_by: 'extractor', valid_from: '2026-09-01' })
  const a = mk('09.1 · fact', 'Something old.', 'fact', '09.1', 'something old', '09.1#s0'), b = mk('09.2 · plan', 'Go/no-go still open as of 25 Oct.', 'plan', '09.2', 'go/no-go still open', '09.2#s0'), c = mk('09.2 · fact', 'Opening pace is 5:57/km.', 'fact', '09.2', 'Opening pace 5:57/km (Skenario C)', '09.2#s1'), d = mk('09.2 · fine', 'A calm fact.', 'fact', '09.2', 'calm fact', '09.2#s2')
  M.addMemory({ tier: 'semantic', kind: 'conflict', title: 'Docs disagree', body: 'newer wins', payload: { doc: '09.2', doc_b: '09.3', quote: 'Opening pace 5:57/km', quote_b: 'Opening pace 6:15/km' }, status: 'candidate', source: 'kb_extract', source_ref: '09.2~09.3.0', created_by: 'consistency' })
  const r = S.staleSweep({ today: '2026-11-23' }), ids = r.items.map((x) => x.id)
  assert.ok(ids.includes(a.id) && ids.includes(b.id) && ids.includes(c.id) && !ids.includes(d.id), JSON.stringify(r.items))
  assert.match(r.items.find((x) => x.id === a.id).reason, /archived/); assert.match(r.items.find((x) => x.id === c.id).reason, /newer/)
  assert.equal(M.getMemory(a.id).status, 'candidate', 'flagged, not retracted'); assert.ok(JSON.parse(M.getMemory(a.id).payload).stale)
  assert.ok(S.memoryInbox({ source: 'kb_extract' }).groups.find((g) => g.doc === '09.1').stale >= 1)
})
test('graph chat: a short follow-up inherits the previous subject; a saved answer is only a candidate', async () => {
  process.env.NEO4J_URI = 'neo4j+s://x.databases.neo4j.io'; process.env.NEO4J_USER = 'u'; process.env.NEO4J_PASSWORD = 'p'
  const seen = []; const neo = async (cy) => { seen.push(cy); return cy.includes('MATCH (e:Entity) WHERE any') ? { data: { values: [['Event:borobudur', 'Borobudur Marathon', 'Event']] } } : { data: { values: [] } } }
  const r = await S.graphAsk('and the heat?', { neo, history: [{ q: 'what happened at borobudur', a: 'It was a DNF.' }], llm: async ({ user }) => { assert.ok(user.includes('EARLIER IN THIS CONVERSATION') && user.includes('It was a DNF.')); return { json: { answer_md: 'Heat was extreme.', paths: [], gaps: [] } } } })
  assert.ok(seen.some((c) => c.includes('"borobudur"')), 'search terms include the earlier subject'); assert.equal(r.ok, true)
  const saved = S.saveAnswer({ question: 'why did borobudur end', answer_md: 'It ended under a black flag.', paths: ['RACE x'] }); assert.equal(saved.created, true)
  const m = M.getMemory(saved.id); assert.equal(m.status, 'candidate'); assert.equal(m.source, 'graph_ask'); assert.throws(() => S.saveAnswer({ question: 'x', answer_md: '' }), /nothing to save/)
})
