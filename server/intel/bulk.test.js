import test from 'node:test'
import assert from 'node:assert'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'bulk-'))
const B = await import('./bulk.js')
const M = await import('./memory.js')

test('claims must carry a verbatim quote; rules become proposals, everything else candidates; hypotheses are never upgraded', () => {
  const text = '## Pacing\nOpening pace **6:15/km aktif**, kandidat 6:10/km. Threshold pace 5:50/km [HYPOTHESIS n=1].\nBlack flag di Borobudur 15 Nov 2026.'
  const reply = { claims: [
    { kind: 'rule', title: 'Opening pace', body: 'Open at 6:15/km.', quote: 'Opening pace 6:15/km aktif', confidence: 0.9 },
    { kind: 'hypothesis', title: 'Threshold', body: 'Threshold 5:50/km.', quote: 'Threshold pace 5:50/km [HYPOTHESIS n=1]', confidence: 0.5 },
    { kind: 'fact', title: 'Invented', body: 'Not in the text.', quote: 'The athlete ran 100 km a week', confidence: 0.9 },
    { kind: 'fact', title: 'No quote', body: 'x', quote: '' }] }
  const { memories, dropped } = B.claimsToMemories(reply, { docId: '03.9', chunkText: text, ref: '03.9#x0', sourceDate: '2026-11-15', docStatus: 'ACTIVE' })
  assert.equal(memories.length, 2); assert.deepEqual(dropped.sort(), ['incomplete', 'quote not in text'])
  assert.equal(memories[0].tier, 'procedural'); assert.equal(memories[0].status, 'proposal'); assert.equal(memories[1].tier, 'semantic'); assert.equal(memories[1].status, 'candidate'); assert.equal(memories[1].evidence_tag, 'HYPOTHESIS')
  assert.ok(memories.every((m) => m.source === 'kb_extract' && m.created_by === 'extractor' && m.title.startsWith('03.9 · ')))
  const a = M.addMemory(memories[1]), b = M.addMemory(memories[1]); assert.equal(a.created, true); assert.equal(b.created, false, 'same claim twice is stored once')
  assert.notEqual(M.getMemory(a.id).status, 'active', 'extracted knowledge waits for approval')
})
test('ledger rows become dated races (year from the heading, any markdown around the date)', () => {
  const r = B.ledgerRaces('## 2025 Race Ledger\n\n| Date | Race |\n|---|---|\n| 12 Jan | Soekarno Run | 10K |\n| **24 Aug** | Total Combat Run | 7K |\n\n## 2026 Race Ledger\n| 15 Nov | **Borobudur FM** — Tier B | x |\n')
  assert.deepEqual(r.map((x) => x.date + ' ' + x.name), ['2025-01-12 Soekarno Run', '2025-08-24 Total Combat Run', '2026-11-15 Borobudur FM'])
})
test('pool: one failure does not stop the batch', async () => {
  const seen = []; const r = await B.pool([1, 2, 3, 4], 2, async (x) => { if (x === 2) throw new Error('boom'); seen.push(x) })
  assert.deepEqual(seen.sort(), [1, 3, 4]); assert.equal(r.failed, 1); assert.equal(r.ok, 3)
})

test('contradictions need a verbatim quote from EACH document and become candidates', () => {
  const a = { doc_id: '03.9', source_date: '2026-11-10', body: 'Opening pace 6:15/km aktif.' }, b = { doc_id: '04.4', source_date: '2026-10-01', body: 'Opening pace 5:57/km (Skenario C).' }
  const ms = B.contradictionsToMemories({ contradictions: [
    { topic: 'Opening pace', a_quote: 'Opening pace 6:15/km aktif', b_quote: 'Opening pace 5:57/km', explanation: 'A is newer.', severity: 'high' },
    { topic: 'Made up', a_quote: 'Opening pace 6:15/km aktif', b_quote: 'never written', explanation: 'x' }] }, { a, b, ref: '03.9~04.4' })
  assert.equal(ms.length, 1); assert.equal(ms[0].kind, 'conflict'); assert.equal(ms[0].status, 'candidate'); assert.equal(ms[0].payload.doc_b, '04.4'); assert.equal(ms[0].valid_from, '2026-11-10')
})
