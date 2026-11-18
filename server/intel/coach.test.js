import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = '/tmp/lumpad-test-data-coach'; process.env.LUMPAD_DB = ':memory:'
process.env.DEEPSEEK_API_KEY = 'sk-test'; process.env.DEEPSEEK_MONTHLY_CAP_CNY = '15'; process.env.DEEPSEEK_MODEL = 'auto-flash'
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
const L = await import('./llm.js'), W = await import('./writeback.js'), M = await import('./memory.js'), { validate } = await import('./schema.js'), C = await import('./context.js'), { mdb } = await import('./db.js')

const models = { data: [{ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }, { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', effort: { supported_levels: ['low', 'high', 'max'] } }, { id: 'deepseek-flash-old', name: 'DeepSeek-V4-Flash' }] }
test('newest Flash is chosen by parsed version; a newer Flash wins without code changes; Pro is never chosen', () => {
  assert.equal(L.pickFlash(models.data).id, 'deepseek-flash')
  assert.equal(L.pickFlash([...models.data, { id: 'deepseek-flash-2', name: 'DeepSeek-V4.2-Flash' }]).id, 'deepseek-flash-2')
  assert.equal(L.pickFlash([{ id: 'p', name: 'DeepSeek-V9-Pro' }]), null); assert.ok(L.cmpVer([4, 10], [4, 9]) > 0)
})
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })
test('spend: month spend = sum of balance DROPS only (top-ups ignored); 80 % limits intents; 100 % pauses', () => {
  const ins = (b) => mdb.prepare('INSERT INTO balance_snap (at, month, balance_cny) VALUES (?,?,?)').run(new Date().toISOString(), '2099-01', b)
  ;[17.5, 17.0, 16.0, 30.0, 29.0].forEach(ins)                       // drops 0.5 + 1 + (top-up ignored) + 1 = 2.5
  assert.equal(L.monthSpend('2099-01'), 2.5)
  assert.equal(L.guard('weekly_review', { month: '2099-01' }).ok, true)
  ;[18.0].forEach(ins)                                                 // + 11 → 13.5 ≥ 12 (80 %)
  assert.equal(L.guard('weekly_review', { month: '2099-01' }).ok, false); assert.equal(L.guard('daily_brief', { month: '2099-01' }).ok, true)
  ;[16.0].forEach(ins)                                                 // + 2 → 15.5 ≥ cap
  const g = L.guard('daily_brief', { month: '2099-01' }); assert.equal(g.ok, false); assert.equal(g.level, 'paused')
})
test('complete(): resolves the model, sends effort only when supported, parses JSON, computes cost from the balance drop', async () => {
  let n = 0, seen
  const fetchFn = async (url, opt) => {
    if (url.endsWith('/models')) return ok(models)
    if (url.endsWith('/user/balance')) return ok({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: String(n++ === 0 ? 10.0 : 9.97) }] })
    seen = JSON.parse(opt.body); return ok({ choices: [{ message: { content: '```json\n{"a":1}\n```' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  }
  const r = await L.complete({ system: 's', user: 'u', effort: 'high', intent: 'daily_brief', fetchFn })
  assert.equal(r.model, 'deepseek-flash'); assert.deepEqual(r.json, { a: 1 }); assert.equal(seen.reasoning_effort, 'high'); assert.equal(seen.response_format.type, 'json_object'); assert.ok(Math.abs(r.cost_cny - 0.03) < 1e-9)
})
test('schema validator rejects wrong shapes with paths', () => {
  const bad = { summary: 1, analysis_md: 'x', recommendations: [{ action: 'a', why: 'b', priority: 'soon' }], flags: [], memory_writes: [], cited_ids: [] }
  const e = validate(bad, C.OUTPUT_SCHEMA); assert.ok(e.some((x) => x.includes('$.summary')) && e.some((x) => x.includes('priority')))
})

const items = { a: M.addMemory({ tier: 'episodic', kind: 'session', title: 'Run 2026-11-15 36.9 km', body: 'Run share 48 % · EF 0.789 · HR 169 · fade onset km 5 · 5:30:52', evidence_tag: 'MEASURED', status: 'active', source: 'fit', source_ref: 'x1', created_by: 'system' }).id }
test('write-back: accepts a cited, number-verified insight as a CANDIDATE hypothesis', () => {
  const out = W.applyWriteback({ memory_writes: [{ tier: 'semantic', kind: 'pattern', title: 'Run-walk began at km 5 at Borobudur', body: 'Run share 48 % and EF 0.789 with onset at km 5 on 2026-11-15 (5:30:52).', cites: [items.a] }] }, { itemIds: [items.a], corpus: '' })
  assert.equal(out.stored.length, 1); assert.equal(M.getMemory(out.stored[0].id).status, 'candidate'); assert.equal(M.getMemory(out.stored[0].id).evidence_tag, 'HYPOTHESIS')
})
test('write-back: rejects invented numbers, uncited ids, bad tier; procedural becomes a proposal', () => {
  M.seedRules()
  let seq = 0; const w = (o) => W.applyWriteback({ memory_writes: [{ tier: 'semantic', kind: 'k', title: 'Title ' + 'abcdefghijk'[seq++], body: 'b', cites: [items.a], ...o }] }, { itemIds: [items.a], corpus: '' })
  assert.match(JSON.stringify(w({ body: 'Efficiency dropped to 0.612 late in the run.' }).rejected), /unverified numbers: 0\.612/)
  assert.match(JSON.stringify(w({ body: 'Finished in 5:12:00 total.' }).rejected), /5:12:00/)
  assert.match(JSON.stringify(w({ cites: [99999] }).rejected), /not in the context/)
  assert.match(JSON.stringify(w({ cites: [] }).rejected), /no citation/)
  assert.match(JSON.stringify(w({ tier: 'nonsense' }).rejected), /bad tier/)
  assert.equal(w({ tier: 'procedural', title: 'Cap opening HR at 160', body: 'Keep HR under 160 for the first 10 km.' }).rejected.length, 1)   // 160 is not in the evidence
  const p2 = w({ tier: 'procedural', title: 'Hold back early', body: 'Keep the opening easy (HR 169 was too high).' }); assert.equal(M.getMemory(p2.stored[0].id).status, 'proposal')
})
test('write-back: near-duplicates merge and are promoted after 3 observations; KB chunks and locked rules are never merge targets', () => {
  const body = 'Mechanical trigger cadence fell before km 5 so walking started early at km 5.', mk = (t) => W.applyWriteback({ memory_writes: [{ tier: 'semantic', kind: 'pattern', title: t, body, cites: [items.a] }] }, { itemIds: [items.a], corpus: '' })
  const a = mk('Cadence trigger precedes run-walk'); assert.equal(a.stored.length, 1)
  const b = mk('Cadence trigger precedes run-walk start'), c = mk('Cadence trigger precedes run-walk start again')
  assert.equal(b.merged.length, 1); assert.equal(c.merged[0].promoted, true); assert.equal(M.getMemory(a.stored[0].id).status, 'active')
  const kb = M.addMemory({ tier: 'semantic', kind: 'kb', title: 'KB chunk', body: 'Sleep heart rate above sixtyseven means no hard running validated nights', evidence_tag: 'KB', status: 'active', source: 'kb', source_ref: 'k#1', created_by: 'kb' })
  const r = W.applyWriteback({ memory_writes: [{ tier: 'semantic', kind: 'x', title: 'Sleep heart rate above sixtyseven', body: 'Sleep heart rate above sixtyseven means no hard running validated nights', cites: [items.a] }] }, { itemIds: [items.a], corpus: '' })
  assert.equal(r.stored.length, 1); assert.equal(M.getMemory(kb.id).n, 1)
})
test('redact(): names, employer, e-mail, URLs and secrets never leave (fake look-alike values only)', () => {
  const fakeKey = 'sk-' + 'a1b2c3d4'.repeat(4), fakeHex = 'ab12cd34'.repeat(5)
  const t = C.redact(`Rihan Rosihan works at Pizza Hut Indonesia, mail a.b@example.com, see https://x.y/z token ${fakeKey} and ${fakeHex}`)
  assert.ok(!/Rihan|Rosihan|Pizza|example\.com|https|a1b2c3d4|ab12cd34/.test(t), t)
})
