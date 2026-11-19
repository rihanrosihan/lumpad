import test from 'node:test'
import assert from 'node:assert'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-test-data-'))
const { parseDoc, chunk } = await import('./kb.js')
const M = await import('./memory.js')

test('frontmatter and chunking by headings; short sections merged, long ones split', () => {
  const { fm, body } = parseDoc('---\ndoc-id: "04.9"\nstatus: ACTIVE\nsource-date: 2026-11-15\n---\n# T\n\n## A\n' + 'a '.repeat(60) + '\n\n## B\n' + 'b '.repeat(60) + '\n\n## C\n' + 'c '.repeat(1500))
  assert.equal(fm['doc-id'], '04.9'); assert.equal(fm.status, 'ACTIVE'); const c = chunk(body); assert.ok(c.length >= 2 && c.every((x) => x.length <= 2400))
})
test('memory: dedupe by content, FTS retrieval, locked rules cannot be changed, proposals are not retrieved as active', () => {
  M.seedRules(); const again = M.seedRules(); assert.equal(again, 0)
  const r = M.ftsSearch('sleep hr 67 hard running', { tiers: ['procedural'] }); assert.ok(r.length && /Sleep HR/.test(r[0].title))
  const locked = r[0]; assert.throws(() => M.setStatus(locked.id, 'retracted'), /locked/)
  assert.ok(!M.ftsSearch('race opening cap', { tiers: ['procedural'] }).some((x) => /proposal/.test(x.title)))   // proposal is not active
  assert.ok(M.ftsSearch('race opening cap', { tiers: ['procedural'], statuses: ['proposal'] }).some((x) => /proposal/.test(x.title)))
  const a = M.addMemory({ tier: 'semantic', title: 'x', body: 'same body', created_by: 'llm' }), b = M.addMemory({ tier: 'semantic', title: 'x', body: 'same body', created_by: 'llm' }); assert.equal(b.created, false); assert.equal(a.id, b.id)
  assert.equal(M.getMemory(a.id).status, 'candidate')                                           // LLM writes arrive as candidates
})
test('FTS query building is injection-safe and RRF fuses lists', () => {
  assert.equal(M.ftsQuery('"; DROP TABLE memory; --'), '"drop" OR "table" OR "memory"'); assert.equal(M.ftsQuery('a b'), '')
  assert.deepEqual(M.rrf([[1, 2, 3], [3, 1]]).map((x) => x.id).slice(0, 2), [1, 3])
})
