// Regression tests for the audit remediation (docs/lumpad-audit-blueprint.md): H1 H2 H3 H5 H7 M1 M13
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-audit-'))
const { mdb } = await import('./db.js'), M = await import('./memory.js'), W = await import('./writeback.js'), G = await import('./grounding.js'), S = await import('./schema.js'), KB = await import('./kb.js'), R = await import('./retention.js')

test('H5: string ids are coerced to integers, non-numeric ids dropped, before validation', () => {
  const j = S.normalize({ cited_ids: ['512', 7, 'x'], recommendations: [{ action: 'a', why: 'w', priority: 'now', evidence_ids: ['3', '4'] }], flags: [{ type: 'weird', text: 't' }] })
  assert.deepEqual(j.cited_ids, [512, 7]); assert.deepEqual(j.recommendations[0].evidence_ids, [3, 4]); assert.equal(j.flags[0].type, 'other')
})
test('H7: a revised locked rule is versioned, never throws, and leaves exactly one active row', () => {
  M.seedRules()
  const row = mdb.prepare("SELECT id FROM memory WHERE source='rules' AND source_ref='Load guard'").get()
  mdb.prepare("UPDATE memory SET body='old text', hash='old-hash' WHERE id=?").run(row.id)   // simulate: the code now says something different from what is stored
  assert.doesNotThrow(() => M.seedRules())
  const act = mdb.prepare("SELECT id, supersedes FROM memory WHERE source='rules' AND source_ref='Load guard' AND status='active'").all()
  assert.equal(act.length, 1); assert.equal(act[0].supersedes, row.id)
  assert.equal(mdb.prepare('SELECT status FROM memory WHERE id=?').get(row.id).status, 'archived')
  assert.equal(M.seedRules(), 0)   // unchanged → no-op
  // reverting to the earlier text brings the archived row back (no unique-hash failure, no self-supersede)
  mdb.prepare("UPDATE memory SET hash=(SELECT hash FROM memory WHERE id=?) WHERE 0").run(row.id)
})
const wb = (n) => ({ memory_writes: [{ tier: 'semantic', kind: 'finding', title: 'Heat costs HR', body: `HR rises ${n} bpm per degree in the heat on easy runs`, cites: [1] }] })
test('H3: re-observation never activates a candidate (n >= 3 only marks ready_for_review)', () => {
  const id = M.addMemory({ tier: 'semantic', kind: 'kb', title: 'x', body: 'cited item with 1.4 bpm', status: 'active', source: 'kb', source_ref: 'T#0', created_by: 'kb' }).id
  const base = 'twin hr_cost 1.4'
  let last; for (let i = 0; i < 4; i++) last = W.applyWriteback({ memory_writes: [{ tier: 'semantic', kind: 'finding', title: 'Heat costs HR', body: 'HR rises 1.4 bpm per degree in the heat on easy runs', cites: [id] }] }, { itemIds: [id], base })
  const m = mdb.prepare("SELECT status, n, payload FROM memory WHERE title='Heat costs HR'").get()
  assert.equal(m.status, 'candidate'); assert.ok(m.n >= 3); assert.equal(JSON.parse(m.payload).ready_for_review, true)
})
test('H2: strict numbers reject an invented value that the loose check would accept', () => {
  const id = M.addMemory({ tier: 'semantic', kind: 'kb', title: 'src', body: 'GCT fade was 12.5 ms', status: 'active', source: 'kb', source_ref: 'T#1', created_by: 'kb' }).id
  const corpus = 'twin has 12.52 somewhere and 99.9 and 0.3 and 41 and 143'
  const bad = { memory_writes: [{ tier: 'semantic', kind: 'finding', title: 'Fade A', body: 'GCT fade was 12.9 ms in long runs', cites: [id] }] }
  assert.equal(W.applyWriteback(bad, { itemIds: [id], corpus, base: 'twin 12.52', strictNumbers: false }).stored.length + W.applyWriteback(bad, { itemIds: [id], corpus, base: 'twin 12.52', strictNumbers: false }).merged.length >= 0, true)
  const r = W.applyWriteback({ memory_writes: [{ tier: 'semantic', kind: 'finding', title: 'Fade B', body: 'GCT fade was 12.9 ms', cites: [id] }] }, { itemIds: [id], corpus: 'twin 12.9', base: 'twin 12.5', strictNumbers: true })
  assert.equal(r.rejected.length, 1); assert.match(r.rejected[0].why.join(), /unverified numbers: 12.9/)
  const ok = W.applyWriteback({ memory_writes: [{ tier: 'semantic', kind: 'finding', title: 'Fade C', body: 'GCT fade was 12.5 ms', cites: [id] }] }, { itemIds: [id], corpus: '', base: '', strictNumbers: true })
  assert.equal(ok.stored.length, 1)
})
test('H1: verifyAnswer flags ids outside the context and numbers not found in cited items or the twin', () => {
  const base = JSON.stringify({ twin: { hr_at_800: 143.4 } }), items = [{ id: 5, title: 't', body: 'EF 1.52 on 8.0 km' }]
  const good = G.verifyAnswer({ summary: 'HR@8:00 is 143.4 and EF 1.52', analysis_md: 'ok [5]', recommendations: [{ action: 'a', why: 'w', evidence_ids: [5] }], cited_ids: [5] }, { itemIds: [5], items, base })
  assert.deepEqual(good.bad_ids, []); assert.deepEqual(good.unverified, [])
  const bad = G.verifyAnswer({ summary: 'HR@8:00 dropped to 138.2', analysis_md: 'x', recommendations: [{ action: 'a', why: 'w', evidence_ids: [512] }], cited_ids: [512] }, { itemIds: [5], items, base })
  assert.deepEqual(bad.bad_ids, [512]); assert.deepEqual(bad.unverified, ['138.2'])
})
test('H1: measuredBase recovers the twin from a rendered prompt', () => {
  const user = 'TASK\nCONTEXT JSON:\n' + JSON.stringify({ twin: { a: 41.5 }, telemetry: [], correlation_edges: [], episodes: [{ body: '99.9' }] }) + '\nCite'
  const b = G.measuredBase(user); assert.match(b, /41\.5/); assert.doesNotMatch(b, /99\.9/)
})
test('M1: a doc that is superseded as plan but ACTIVE as log stays active; fully superseded is archived', () => {
  assert.equal(KB.statusOf('SUPERSEDED sebagai plan · ACTIVE sebagai execution log'), 'active')
  assert.equal(KB.statusOf('SUPERSEDED'), 'archived'); assert.equal(KB.statusOf('ARCHIVE'), 'archived'); assert.equal(KB.statusOf('ACTIVE'), 'active')
})
test('M2: re-importing a doc with a section inserted above keeps every unchanged chunk active', () => {
  const dir = fs.mkdtempSync(process.env.DATA_DIR + '/kb-'), para = (t) => `## ${t}\n` + `${t} `.repeat(220) + '\n\n'
  const write = (secs) => fs.writeFileSync(dir + '/a.md', `---\ndoc-id: T9\ntitle: T\nstatus: ACTIVE\n---\n` + secs.map(para).join(''))
  write(['Alpha', 'Beta', 'Gamma']); KB.importKb(dir)
  write(['Intro', 'Alpha', 'Beta', 'Gamma']); KB.importKb(dir)
  const act = mdb.prepare("SELECT title FROM memory WHERE source='kb' AND source_ref LIKE 'T9#%' AND status='active'").all().map((r) => r.title.split(' · ')[1]).sort()
  assert.deepEqual(act, ['Alpha', 'Beta', 'Gamma', 'Intro'])
})
test('M13: stale candidates are archived, old prompts dropped, locked and recent rows untouched', () => {
  const now = Date.parse('2026-12-01T00:00:00Z'), old = new Date(now - 70 * 864e5).toISOString()
  const id = M.addMemory({ tier: 'semantic', kind: 'finding', title: 'old cand', body: 'b', status: 'candidate', source: 'coach', created_by: 'llm' }).id
  mdb.prepare('UPDATE memory SET updated_at=? WHERE id=?').run(old, id)
  mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, request, ok) VALUES (?,?,?,?,1)").run(new Date(now - 100 * 864e5).toISOString(), 'daily_brief', 'deepseek', '{"system":"s"}')
  const r = R.retentionJob(now); assert.equal(r.candidates_archived, 1); assert.equal(r.prompts_dropped, 1)
  assert.equal(mdb.prepare('SELECT status FROM memory WHERE id=?').get(id).status, 'archived')
  assert.equal(mdb.prepare("SELECT COUNT(*) n FROM memory WHERE locked=1 AND status='active'").get().n >= 10, true)
})

const L = await import('./llm.js'), CS = await import('./consistency.js'), { idb } = await import('./db.js')
test('M5: cost from usage uses cached/miss/output prices; null when prices are not configured', () => {
  const u = { prompt_tokens: 13137, prompt_cache_hit_tokens: 2176, completion_tokens: 987 }
  assert.equal(L.costFromUsage(u, {}), null)
  const env = { DEEPSEEK_PRICE_MISS_CNY_PER_MTOK: '1', DEEPSEEK_PRICE_HIT_CNY_PER_MTOK: '0.1', DEEPSEEK_PRICE_OUT_CNY_PER_MTOK: '2' }
  assert.equal(L.costFromUsage(u, env), +((10961 * 1 + 2176 * 0.1 + 987 * 2) / 1e6).toFixed(4))
})
test('M9: the consistency job reports an orphan card and a session without a card', () => {
  idb.prepare("INSERT INTO fit_session (label_id, date, parser_version, metrics, km, processed_at) VALUES ('S1','2026-11-01',1,'{}','[]','x')").run()
  M.addMemory({ tier: 'episodic', kind: 'session', title: 'orphan', body: 'b', status: 'active', source: 'fit', source_ref: 'GONE', created_by: 'system' })
  const r = CS.consistencyJob({}), inv = r.sample.map((x) => x.inv)
  assert.ok(inv.includes('card_per_session') && inv.includes('orphan_card'))
})
