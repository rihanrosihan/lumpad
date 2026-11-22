import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-test-data-coach-')); process.env.LUMPAD_DB = ':memory:'
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
test('complete(): a run truncated by max_tokens is retried once at low effort with a bigger share left for the answer', async () => {
  const calls = []
  const fetchFn = async (url, opt) => {
    if (url.endsWith('/models')) return ok(models)
    if (url.endsWith('/user/balance')) return ok({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] })
    const b = JSON.parse(opt.body); calls.push({ effort: b.reasoning_effort, max: b.max_tokens })
    return ok({ choices: [{ message: { content: b.reasoning_effort === 'high' ? '' : '{"a":2}' }, finish_reason: b.reasoning_effort === 'high' ? 'length' : 'stop' }], usage: {} })
  }
  const r = await L.complete({ system: 's', user: 'u', effort: 'high', intent: 'daily_brief', fetchFn })
  assert.deepEqual(r.json, { a: 2 }); assert.equal(r.retried_low, true)
  assert.equal(calls[0].effort, 'high'); assert.ok(calls[0].max >= 20000); assert.equal(calls[1].effort, 'low')
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
test('write-back: near-duplicates merge and are marked ready for review after 3 observations (never self-promoted); KB chunks and locked rules are never merge targets', () => {
  const body = 'Mechanical trigger cadence fell before km 5 so walking started early at km 5.', mk = (t) => W.applyWriteback({ memory_writes: [{ tier: 'semantic', kind: 'pattern', title: t, body, cites: [items.a] }] }, { itemIds: [items.a], corpus: '' })
  const a = mk('Cadence trigger precedes run-walk'); assert.equal(a.stored.length, 1)
  const b = mk('Cadence trigger precedes run-walk start'), c = mk('Cadence trigger precedes run-walk start again')
  assert.equal(b.merged.length, 1); assert.equal(c.merged[0].ready_for_review, true); assert.equal(M.getMemory(a.stored[0].id).status, 'candidate')
  const kb = M.addMemory({ tier: 'semantic', kind: 'kb', title: 'KB chunk', body: 'Sleep heart rate above sixtyseven means no hard running validated nights', evidence_tag: 'KB', status: 'active', source: 'kb', source_ref: 'k#1', created_by: 'kb' })
  const r = W.applyWriteback({ memory_writes: [{ tier: 'semantic', kind: 'x', title: 'Sleep heart rate above sixtyseven', body: 'Sleep heart rate above sixtyseven means no hard running validated nights', cites: [items.a] }] }, { itemIds: [items.a], corpus: '' })
  assert.equal(r.stored.length, 1); assert.equal(M.getMemory(kb.id).n, 1)
})
test('redact(): names, employer, e-mail, URLs and secrets never leave (fake look-alike values only)', () => {
  const fakeKey = 'sk-' + 'a1b2c3d4'.repeat(4), fakeHex = 'ab12cd34'.repeat(5)
  const t = C.redact(`Rihan Rosihan works at Pizza Hut Indonesia, mail a.b@example.com, see https://x.y/z token ${fakeKey} and ${fakeHex}`)
  assert.ok(!/Rihan|Rosihan|Pizza|example\.com|https|a1b2c3d4|ab12cd34/.test(t), t)
})
test('complete(): a brief truncated at low effort is retried once with twice the budget', async () => {
  const calls = []
  const fetchFn = async (url, opt) => {
    if (url.endsWith('/models')) return ok(models)
    if (url.endsWith('/user/balance')) return ok({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] })
    const b = JSON.parse(opt.body); calls.push(b.max_tokens); const first = calls.length === 1
    return ok({ choices: [{ message: { content: first ? '' : '{"a":3}' }, finish_reason: first ? 'length' : 'stop' }], usage: {} })
  }
  const r = await L.complete({ system: 's', user: 'u', effort: 'low', intent: 'daily_brief', fetchFn })
  assert.deepEqual(r.json, { a: 3 }); assert.equal(calls.length, 2); assert.equal(calls[1], calls[0] * 2)
})
test('softClamp: over-long display text is cut at a sentence, so a long answer is not a failed one; structure stays strict', async () => {
  const S = await import('./schema.js')
  const long = 'Sentence one is here. ' + 'word '.repeat(2000)
  const j = S.softClamp({ summary: 'ok', analysis_md: long, recommendations: Array.from({ length: 12 }, () => ({ action: 'a'.repeat(900), why: 'b', priority: 'now' })), flags: [], memory_writes: [], cited_ids: [] })
  assert.ok(j.analysis_md.length <= 6000 && j.analysis_md.endsWith('…')); assert.equal(j.recommendations.length, 8); assert.ok(j.recommendations[0].action.length <= 400)
  assert.deepEqual(S.validate(j, S.OUTPUT_SCHEMA).filter((e) => /longer|more than/.test(e)), [])
  const mw = S.softClamp({ memory_writes: [{ tier: 'semantic', title: 't', body: 'x'.repeat(2000), cites: [1] }] })
  assert.equal(mw.memory_writes[0].body.length, 2000) // memory writes are never trimmed
})
test('promptHash: same text same hash, any change in what the model is shown changes it (new metric, new day)', async () => {
  const C = await import('./coach.js')
  const a = { system: 'rules', user: 'session 10 km, HRV 78, as_of 2026-11-21' }
  assert.equal(C.promptHash(a), C.promptHash({ ...a })); assert.notEqual(C.promptHash(a), C.promptHash({ ...a, user: a.user.replace('78', '65') })); assert.notEqual(C.promptHash(a), C.promptHash({ ...a, user: a.user.replace('11-21', '11-22') }))
})
test('a safety note plus eight flags no longer overflows the schema (the run failed with "$.flags: more than 8 items")', async () => {
  const S = await import('./schema.js'), C = await import('./context.js')
  const base = { summary: 's', analysis_md: 'a', recommendations: [], flags: Array.from({ length: 8 }, (_, i) => ({ type: 'other', text: 'f' + i })), memory_writes: [], cited_ids: [] }
  const withNote = { ...base, flags: [{ type: 'rule', text: 'note' }, ...base.flags].slice(0, 8) }
  assert.deepEqual(S.validate(S.softClamp({ ...base, flags: [{ type: 'rule', text: 'note' }, ...base.flags] }), C.OUTPUT_SCHEMA).filter((e) => /more than/.test(e)), []); assert.equal(withNote.flags[0].text, 'note')
})
test('runCoach: an unchanged question is answered from the saved run (no model call); a new day or force makes a new one', async () => {
  const Co = await import('./coach.js'), { idb } = await import('./db.js')
  idb.prepare('INSERT INTO twin_state (as_of, created_at, trigger, schema, inputs_hash, state) VALUES (?,?,?,?,?,?)').run('2026-11-21', new Date().toISOString(), 'test', 'twin/1', 'h', JSON.stringify({ as_of: '2026-11-21', physiological_profile: {}, load: {}, baselines: {}, projection: { scenarios: [] } }))
  let chats = 0
  const answer = { summary: 'ok', analysis_md: 'fine', recommendations: [], flags: [], memory_writes: [], cited_ids: [] }
  const fetchFn = async (url, opt) => {
    if (url.endsWith('/models')) return ok(models)
    if (url.endsWith('/user/balance')) return ok({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] })
    chats++; return ok({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }], usage: {} })
  }
  const a = await Co.runCoach({ intent: 'question', question: 'how is my week', date: '2026-11-21', fetchFn })
  assert.equal(a.ok, true); assert.ok(!a.cached); const n1 = chats; assert.ok(n1 >= 1)
  const st = Co.coachStatus({ intent: 'question', question: 'how is my week', date: '2026-11-21' }); assert.equal(st.up_to_date, true); assert.equal(st.run_id, a.runId)
  const b = await Co.runCoach({ intent: 'question', question: 'how is my week', date: '2026-11-21', fetchFn })
  assert.equal(b.cached, true); assert.equal(b.runId, a.runId); assert.equal(b.cost_cny, 0); assert.equal(chats, n1, 'no second model call')
  const next = Co.coachStatus({ intent: 'question', question: 'how is my week', date: '2026-11-22' }); assert.equal(next.up_to_date, false, 'a new day unlocks a new analysis')
  const c = await Co.runCoach({ intent: 'question', question: 'how is my week', date: '2026-11-22', fetchFn }); assert.ok(!c.cached); assert.ok(chats > n1)
  const n2 = chats; const d = await Co.runCoach({ intent: 'question', question: 'how is my week', date: '2026-11-22', fetchFn, force: true }); assert.ok(!d.cached); assert.ok(chats > n2)
})

test('session review of a run whose FIT is not imported yet is refused, not answered from older runs', async () => {
  const { coachStatus, runCoach } = await import('./coach.js')
  const st = coachStatus({ intent: 'session_review', question: 'session 999000111', activityId: 'coros:999000111' })
  assert.equal(st.no_fit, true)
  await assert.rejects(() => runCoach({ intent: 'session_review', question: 'session 999000111', activityId: 'coros:999000111', fetchFn: async () => { throw new Error('model must not be called') } }), /not imported yet/)
})
