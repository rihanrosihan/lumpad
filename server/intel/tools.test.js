import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-tools-'))
process.env.DEEPSEEK_API_KEY = 'sk-test'; process.env.DEEPSEEK_MODEL = 'deepseek-flash'; process.env.DEEPSEEK_MONTHLY_CAP_CNY = '15'
const { idb, mdb } = await import('./db.js'), { db: app } = await import('../store.js'), T = await import('./tools.js'), C = await import('./coach.js'), M = await import('./memory.js')

const sess = idb.prepare("INSERT INTO fit_session (label_id, activity_id, date, start_ms, distance_m, run_pace, run_hr, ef, run_share, onset_km, gct_fade, drift_pahr, tl, parser_version, metrics, km, processed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,'{}',?,'x')")
const wx = idb.prepare("INSERT INTO run_weather (label_id, indoor, temp_c, wbgt, fetched_at) VALUES (?,?,?,?,'x')")
const hour = 3600e3
// 4 runs: two follow a gym session within 72 h (poorer GCT fade), two do not; one long hot run
const base = Date.parse('2026-10-01T22:00:00Z')
for (const [i, [lid, date, km, hr, gct, wbgt]] of [['A', '2026-10-02', 8, 150, 20, 30], ['B', '2026-10-05', 6, 146, 8, 27], ['C', '2026-10-09', 21, 155, 25, 31], ['D', '2026-10-12', 7, 144, 6, 24]].entries()) { sess.run(lid, 'coros:' + lid, date, base + i * 3 * 24 * hour, km * 1000, 400 + i * 5, hr, 1.5 - i * 0.01, 0.95, null, gct, 3, 80 + i, JSON.stringify([{ km: 1, pace: 400, hr: 140, cad: 170, gct: 280, runShare: 1 }, { km: 2, pace: 405, hr: 146, cad: 169, gct: 285, runShare: 1 }])); wx.run(lid, 0, 28, wbgt) }
M.addMemory({ tier: 'episodic', kind: 'session', title: 'Run 2026-10-02 8.0 km', body: 'A: easy run in heat, gct fade high', status: 'active', source: 'fit', source_ref: 'A', created_by: 'system', valid_from: '2026-10-02' })
const kb = M.addMemory({ tier: 'semantic', kind: 'kb', title: 'Heat acclimation protocol', body: 'WBGT above 27 raises heart rate; drink early, use gels and run by heart rate in hot humid weather', status: 'active', source: 'kb', source_ref: 'K#1', created_by: 'kb', evidence_tag: 'KB' }).id
for (const [d, ts] of [['2026-10-01', Math.floor((base - 12 * hour) / 1000)], ['2026-10-04', Math.floor((base + 3 * 24 * hour - 12 * hour) / 1000)]]) app.prepare("INSERT INTO activities (id, source, source_id, date, sport, name, distance_m, duration_s, start_ts, training_load, pulled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run('coros:g' + d, 'coros', 'g' + d, d, 'Strength', 'Lower body', 0, 3000, ts, 60, 'x')
idb.prepare("INSERT INTO twin_state (as_of, created_at, trigger, schema, inputs_hash, state) VALUES ('2026-11-22','x','t','twin/1','h',?)").run(JSON.stringify({ as_of: '2026-11-22', load: { ctl: 76.1, atl: 106.4, tsb: -14.2 } }))

test('specs: seven tools with valid function schemas', () => {
  const s = T.toolSpecs(); assert.deepEqual(s.map((x) => x.function.name).sort(), ['find_sessions', 'gym_to_run', 'memory_search', 'plan_day', 'session_detail', 'topic_context', 'whatif_session'])
  for (const x of s) { assert.equal(x.type, 'function'); assert.equal(x.function.parameters.type, 'object'); assert.ok(x.function.description.length > 20) }
})
test('bad calls become error RESULTS the model can recover from, never exceptions', () => {
  for (const [n, a] of [['nope', '{}'], ['find_sessions', '{not json'], ['find_sessions', '[1]'], ['find_sessions', '{"from":"yesterday"}'], ['whatif_session', '{"km":-3}'], ['memory_search', '{"query":"a"}'], ['topic_context', '{"topic":"astrology"}'], ['session_detail', '{}']]) { const r = T.runTool(n, a); assert.equal(r.ok, false, n + ' ' + a); assert.ok(JSON.parse(r.text).error) }
})
test('find_sessions: filters, newest first, metrics rounded, the card id for citation', () => {
  const r = T.runTool('find_sessions', '{"min_km":7,"from":"2026-10-01"}'); assert.equal(r.ok, true); const o = r.out
  assert.deepEqual(o.sessions.map((s) => s.label_id), ['D', 'C', 'A']); assert.equal(o.sessions[2].km, 8); assert.equal(o.sessions[2].wbgt, 30); assert.ok(Number.isInteger(o.sessions[2].id))
  assert.equal(T.runTool('find_sessions', '{"limit":1}').out.sessions.length, 1)
})
test('session_detail by date; splits come from the FIT km table', () => { const o = T.runTool('session_detail', '{"date":"2026-10-09"}').out; assert.equal(o.label_id, 'C'); assert.deepEqual(o.splits[0], [1, 400 + 10, 140, 170, 280, 1].map((x, i) => (i === 1 ? 400 : x))) })
test('memory_search and topic_context return cited-able notes', () => {
  const m = T.runTool('memory_search', '{"query":"heat acclimation heart rate"}').out; assert.ok(m.notes.some((n) => n.id === kb))
  const t = T.runTool('topic_context', '{"topic":"heat"}').out; assert.ok(t.notes.some((n) => n.id === kb)); assert.deepEqual(t.recent_runs.map((s) => s.label_id).sort(), ['A', 'B', 'C'])   // outdoor runs at WBGT >= 25.7
})
test('gym_to_run: runs within 72 h after a gym session are grouped apart from the rest', () => {
  const o = T.runTool('gym_to_run', '{}').out; assert.ok(o.after_gym_72h.n >= 1); assert.equal(o.after_gym_72h.n + o.other_runs.n, 4); assert.ok(o.pairs.every((p) => p.hours_after > 0 && p.hours_after <= 72)); assert.match(o.note, /not proof/)
})
test('whatif_session: load estimate and the form carried into the next day (EWMA 42/7)', () => {
  const o = T.runTool('whatif_session', '{"km":8,"zone":2}').out, tl = o.estimated_load
  assert.equal(o.form_now, -30.3); assert.equal(o.form_next_day, Math.round(((76.1 + (tl - 76.1) / 42) - (106.4 + (tl - 106.4) / 7)) * 10) / 10); assert.ok(o.form_next_day > o.form_now - 5 && tl > 0)
  assert.equal(T.runTool('plan_day', '{"date":"2026-11-23"}').out.planned.km, 8)
})
test('idsIn collects nested ids', () => assert.deepEqual([...T.idsIn({ notes: [{ id: 5 }, { id: 'x' }], sessions: [{ id: 9, inner: { id: 11 } }] })].sort(), [11, 5, 9]))

// ---- the loop, with a scripted model
const reply = (message, finish = 'stop') => ({ ok: true, json: async () => ({ choices: [{ message, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 10 } }), text: async () => '' })
const fake = (script) => { const seen = []; let i = 0; return { seen, fetchFn: async (url, opt) => { if (String(url).endsWith('/user/balance')) return { ok: true, text: async () => JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] }), json: async () => ({}) }
  const b = JSON.parse(opt.body); seen.push(b); const r = script[Math.min(i++, script.length - 1)]; const msg = typeof r === 'function' ? r(b) : r; return { ok: true, text: async () => JSON.stringify({ choices: [{ message: msg, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }), json: async () => ({}) } } } }
const call = (id, name, args) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const answer = { summary: 's', analysis_md: 'a', recommendations: [], flags: [], memory_writes: [], cited_ids: [] }

test('loop: tool call → tool message with the matching id → final JSON; usage is summed, ids and evidence collected', async () => {
  const f = fake([call('c1', 'memory_search', { query: 'heat acclimation' }), { role: 'assistant', content: JSON.stringify(answer) }])
  const r = await C.agenticLlm({ system: 'sys', user: 'u', fetchFn: f.fetchFn })
  assert.deepEqual(r.json, answer); assert.equal(r.usage.prompt_tokens, 200); assert.equal(r.tools.calls.length, 1); assert.equal(r.tools.calls[0].ok, true); assert.ok(r.tools.ids.includes(kb)); assert.match(r.tools.evidence, /Heat acclimation/)
  const second = f.seen[1].messages; assert.equal(second.at(-1).role, 'tool'); assert.equal(second.at(-1).tool_call_id, 'c1'); assert.equal(second.at(-2).role, 'assistant'); assert.ok(second.at(-2).tool_calls)   // the assistant turn goes back unchanged
  assert.ok(f.seen[0].tools.length === 7 && f.seen[0].tool_choice === 'auto'); assert.match(f.seen[0].messages[0].content, /EVIDENCE TOOLS/); assert.match(f.seen[0].messages[0].content, /ONLY values of fields named exactly "id"/)
})
test('loop: a failing tool is reported to the model, which can still answer', async () => {
  const f = fake([call('c1', 'find_sessions', { from: 'nonsense' }), { role: 'assistant', content: JSON.stringify(answer) }])
  const r = await C.agenticLlm({ system: 's', user: 'u', fetchFn: f.fetchFn }); assert.equal(r.tools.calls[0].ok, false); assert.match(JSON.parse(f.seen[1].messages.at(-1).content).error, /YYYY-MM-DD/); assert.deepEqual(r.json, answer)
})
test('loop: at most 3 calls per turn are run; the extra ones get an error reply so the protocol stays valid', async () => {
  const five = { role: 'assistant', content: '', tool_calls: Array.from({ length: 5 }, (_, i) => ({ id: 'x' + i, type: 'function', function: { name: 'plan_day', arguments: '{"date":"2026-11-23"}' } })) }
  const f = fake([five, { role: 'assistant', content: JSON.stringify(answer) }]); const r = await C.agenticLlm({ system: 's', user: 'u', fetchFn: f.fetchFn })
  assert.equal(r.tools.calls.length, 3); const tm = f.seen[1].messages.filter((m) => m.role === 'tool'); assert.equal(tm.length, 5); assert.match(tm[4].content, /too many tool calls/)
})
test('loop: the last round offers no tools, and a model that never answers is stopped', async () => {
  const f = fake([call('c', 'plan_day', { date: '2026-11-23' })])   // always asks for a tool
  await assert.rejects(C.agenticLlm({ system: 's', user: 'u', fetchFn: f.fetchFn }), /kept calling tools/); assert.equal(f.seen.length, C.MAX_TOOL_ROUNDS); assert.equal(f.seen.at(-1).tools, undefined)
})
test('grounding: a number that only appears in a tool result is verified; the same number without the tool evidence is not', () => {
  const run = Number(mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, request, context_ids, ok) VALUES (?,?,?,?,?,0)").run('2026-11-22T10:00:00Z', 'question', 'deepseek', JSON.stringify({ system: 's', user: 'CONTEXT JSON:\n' + JSON.stringify({ twin: { a: 1 }, telemetry: [], correlation_edges: [] }) }), '[]').lastInsertRowid)
  const ans = { ...answer, summary: 'Your last long run was 21.3 km and the ground contact fade was 25.4 ms', cited_ids: [] }
  const with_ = C.finishRun(run, structuredClone(ans), { provider: 'deepseek', tools: { calls: [{ tool: 'find_sessions', ok: true }], evidence: '{"sessions":[{"km":21.3,"gct_fade_ms":25.4}]}', ids: [kb] } })
  assert.equal(with_.parsed.grounding.unverified.length, 0); assert.deepEqual(with_.parsed.tools, { calls: 1, used: ['find_sessions'], failed: 0 })
  const run2 = Number(mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, request, context_ids, ok) VALUES (?,?,?,?,?,0)").run('2026-11-22T10:01:00Z', 'question', 'deepseek', JSON.stringify({ system: 's', user: 'CONTEXT JSON:\n{"twin":{"a":1}}' }), '[]').lastInsertRowid)
  assert.deepEqual(C.finishRun(run2, structuredClone(ans), { provider: 'deepseek' }).parsed.grounding.unverified.sort(), ['21.3', '25.4'])
})
