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
  const res = S.bulkAction([a.id, r.id, 999999], 'approve'); assert.equal(res.done, 2); assert.equal(res.skipped.length, 1)
  assert.equal(M.getMemory(a.id).status, 'active'); assert.equal(M.getMemory(r.id).status, 'active')
  assert.throws(() => S.bulkAction([a.id], 'delete'), /bad action/)
  assert.equal(S.bulkAction([a.id], 'retract').skipped[0].why, 'not pending')
})
test('race brief: next race, days to go and what to do next', () => {
  const b = S.raceBrief({ today: '2027-06-01' }); assert.equal(b.race.name, 'Jakim FM'); assert.equal(b.days_to_go, 12); assert.match(b.suggest, /race plan/i)
  assert.equal(S.raceBrief({ today: '2030-01-01' }).race, null)
})
