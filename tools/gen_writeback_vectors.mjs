// Reference results for the Go memory write-back (redesign Phase 4-d): the REAL Node applyWriteback run on seeded memories. Synthetic only.
// Regenerate: node tools/gen_writeback_vectors.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-wb-vec-'))
const { mdb } = await import('../server/intel/db.js'), M = await import('../server/intel/memory.js'), W = await import('../server/intel/writeback.js')

const SEED = [
  { tier: 'semantic', kind: 'kb', title: 'Baseline efficiency', body: 'EF 0.789 on easy runs; HR at 8:00/km 143 bpm', evidence_tag: 'KB', status: 'active', source: 'kb', created_by: 'system' },
  { tier: 'episodic', kind: 'session', title: 'Run 2026-11-14 21.1 km', body: 'EF 0.789 · run share 48 % · 36.92 km in 5:30:52 · GCT 262 ms', evidence_tag: 'MEASURED', status: 'active', source: 'fit', created_by: 'system' },
  { tier: 'semantic', kind: 'insight', title: 'Durability fades after km 20', body: 'Run share falls below 60 % after km 20 on long runs in heat', evidence_tag: 'HYPOTHESIS', status: 'candidate', n: 1, source: 'coach', created_by: 'llm' },
  { tier: 'procedural', kind: 'rule', title: 'Pain at or above 2/10', body: 'Treat pain 2/10 or more as a durability event: stop the hard session', evidence_tag: 'VALIDATED', status: 'active', locked: true, source: 'system', created_by: 'system' },
  { tier: 'semantic', kind: 'insight', title: 'Alpha bravo', body: 'charlie delta', evidence_tag: 'HYPOTHESIS', status: 'candidate', n: 1, source: 'coach', created_by: 'llm' },
  { tier: 'semantic', kind: 'insight', title: 'Café stop résumé naïve', body: 'Jakarta mornings feel cooler après la pluie', evidence_tag: 'HYPOTHESIS', status: 'candidate', n: 2, source: 'coach', created_by: 'llm' },
]
const W1 = (o = {}) => ({ tier: 'semantic', kind: 'insight', title: 'Heat raises GCT late in long runs', body: 'GCT rises 12 ms after km 25 when WBGT is 28.5 in 36.92 km runs', cites: [2], confidence: 0.6, ...o })
// distinct wording (no shared 4-letter words) so writes in one answer do not merge into each other unless a scenario wants that
const B = ['Pacing discipline improves slowly across weeks', 'Hydration planning matters during hot mornings', 'Sleep consistency supports quality sessions', 'Fueling rehearsals reduce stomach trouble', 'Vertical oscillation increases beyond fatigue threshold', 'Cadence declines gradually during warm afternoon efforts']
const scenarios = [
  { name: 'clean semantic write is stored as a candidate', writes: [W1()] },
  { name: 'procedural write becomes a proposal', writes: [W1({ tier: 'procedural', kind: 'rule', title: 'Shorten long runs in heat', body: 'Cap long runs at 36.92 km when WBGT is 28.5', cites: [2] })] },
  { name: 'bad tier', writes: [W1({ tier: 'working' })] },
  { name: 'no citation: empty or missing cites (a non-list throws in Node, but the answer schema rules it out first)', writes: [W1({ cites: [] }), W1({ cites: undefined, title: 'T2' })] },
  { name: 'cites an id that was not in the context', writes: [W1({ cites: [2, 99] })] },
  { name: 'a fractional cite is not an id; 2.0 is', writes: [W1({ cites: [2.5] }), W1({ cites: [2.0], title: 'T3 stored' })] },
  { name: 'unverified numbers are listed once each, at most 6', writes: [W1({ body: 'EF 0.91, 0.91, 55.5 km, 77 %, 123, 4:44:44, 8.88, 999 and 7.77 appear nowhere' })] },
  { name: 'numbers verified through the cited item body only', corpus: 'nothing numeric here', writes: [W1({ cites: [2], body: 'GCT 262 ms and 36.92 km' })] },
  { name: 'exact duplicate returns the existing id', writes: [W1(), W1()] },
  { name: 'near duplicate of a candidate merges (n 1→2)', writes: [{ tier: 'semantic', kind: 'insight', title: 'Durability fades after km 20', body: 'Run share falls below 60 % after km 20 on long runs in heat today', cites: [2, 3] }] },
  { name: 'near duplicate reaching n=3 is promoted to active', writes: [{ tier: 'semantic', kind: 'insight', title: 'Café stop résumé naïve', body: 'Jakarta mornings feel cooler après la pluie vraiment', cites: [2, 6] }] },
  { name: 'similarity exactly 0.6 merges (3 of 5 tokens); exactly 0.5 does not (3 of 6)', writes: [{ tier: 'semantic', kind: 'insight', title: 'Alpha bravo', body: 'charlie echoo', cites: [2] }, { tier: 'semantic', kind: 'insight', title: 'Alpha bravo', body: 'charlie foxtrot golf', cites: [2] }] },
  { name: 'an exact copy of a KB item skips the similarity merge and is caught by the hash instead', writes: [{ tier: 'semantic', kind: 'kb', title: 'Baseline efficiency', body: 'EF 0.789 on easy runs; HR at 8:00/km 143 bpm', cites: [1] }] },
  { name: 'a near duplicate of a locked rule or a KB item is not merged', writes: [{ tier: 'procedural', kind: 'rule', title: 'Pain at or above 2/10', body: 'Treat pain 2/10 or more as a durability event: stop the hard session now', cites: [4] }, { tier: 'semantic', kind: 'insight', title: 'Baseline efficiency', body: 'EF 0.789 on easy runs; HR at 8:00/km 143 bpm today', cites: [1] }] },
  { name: 'confidence is clamped; non-numbers dropped', writes: [W1({ confidence: 1.7, title: 'C1', body: B[0] }), W1({ confidence: -0.2, title: 'C2', body: B[1] }), W1({ confidence: 'high', title: 'C3', body: B[2] }), W1({ confidence: undefined, title: 'C4', body: B[3] }), W1({ confidence: 0.42, title: 'C5', body: B[4] })] },
  { name: 'kind longer than 30 characters is cut; default kind', writes: [W1({ kind: 'k'.repeat(45), title: 'K1', body: B[0] }), W1({ kind: undefined, title: 'K2', body: B[1] }), W1({ kind: '', title: 'K3', body: B[2] }), W1({ kind: 'é'.repeat(31), title: 'K4', body: B[3] })] },
  { name: 'tags: capped at 8, each cut at 40, empty list kept, non-array dropped', writes: [W1({ tags: Array.from({ length: 11 }, (_, i) => 'tag' + i + 'x'.repeat(50)), title: 'TG1', body: B[0] }), W1({ tags: [], title: 'TG2', body: B[1] }), W1({ tags: 'x', title: 'TG3', body: B[2] }), W1({ tags: ['é🙂'.repeat(25)], title: 'TG4', body: B[3] })] },
  { name: 'claude-code provider is recorded as such', provider: 'claude-code', writes: [W1()] },
  { name: 'memory_writes missing or not an array', writes: undefined },
  { name: 'two writes in one answer: the second merges into the first', writes: [W1({ title: 'Stride shortens late', body: 'Stride length drops late in long runs during heat stress' }), W1({ title: 'Stride shortens late', body: 'Stride length drops late in long runs during heat stress again', cites: [2] })] },
  { name: 'accents and html-like characters survive', writes: [W1({ title: 'Café <b>résumé</b> & "quotes"', body: 'naïve 36.92 km run — ünïcode ≥ 5', tags: ['é', '<t>'] })] },
  { name: 'rejection reasons accumulate', writes: [W1({ tier: 'x', cites: [99], body: 'nothing 12345 here' })] },
]
const out = []
for (const sc of scenarios) {
  mdb.exec('DELETE FROM memory; DELETE FROM memory_audit; DELETE FROM sqlite_sequence')
  SEED.forEach((m) => M.addMemory(m))
  mdb.exec('DELETE FROM memory_audit; DELETE FROM sqlite_sequence WHERE name = \'memory_audit\'')
  const itemIds = [1, 2, 3, 4, 5, 6], corpus = sc.corpus ?? 'EF 0.789 run share 48 % 36.92 km in 5:30:52 GCT 262 ms WBGT 28.5 12 ms km 25', parsed = { memory_writes: sc.writes }, provider = sc.provider || 'deepseek'
  const result = W.applyWriteback(parsed, { runId: 17, itemIds, corpus, provider })
  const rows = mdb.prepare('SELECT id, tier, kind, title, body, payload, evidence_tag, n, confidence, status, locked, source, created_by, hash FROM memory ORDER BY id').all().map((r) => ({ ...r }))
  const audits = mdb.prepare('SELECT run_id, action, memory_id, detail FROM memory_audit ORDER BY id').all().map((a) => ({ run_id: a.run_id, action: a.action, memory_id: a.memory_id, detail: JSON.parse(a.detail) }))
  out.push({ name: sc.name, seed: SEED.map((m, i) => ({ id: i + 1, ...m })), itemIds, corpus, provider, parsed: JSON.parse(JSON.stringify(parsed)), result, rows, audits })
}
fs.mkdirSync('lumpadd/internal/coach/testdata', { recursive: true })
fs.writeFileSync('lumpadd/internal/coach/testdata/writeback_vectors.json', JSON.stringify(out))
const kinds = {}; for (const o of out) for (const k of ['stored', 'merged', 'rejected']) kinds[k] = (kinds[k] || 0) + o.result[k].length
console.log('writeback scenarios:', out.length, kinds, 'promoted:', out.filter((o) => o.result.merged.some((m) => m.promoted)).length)
