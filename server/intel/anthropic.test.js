process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-test-data-coach-')); process.env.LUMPAD_DB = ':memory:'
import test from 'node:test'
import assert from 'node:assert'
const A = await import('./anthropic.js'), K = await import('./coach.js'), { mdb } = await import('./db.js')
const ok = (j) => ({ ok: true, status: 200, text: async () => JSON.stringify(j) })
const setEnv = () => Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm-1', ANTHROPIC_PRICE_IN_USD_PER_MTOK: '3', ANTHROPIC_PRICE_OUT_USD_PER_MTOK: '15', USD_CNY: '7' })
const clear = () => ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_PRICE_IN_USD_PER_MTOK', 'ANTHROPIC_PRICE_OUT_USD_PER_MTOK', 'USD_CNY', 'COACH_CLAUDE_INTENTS'].forEach((k) => delete process.env[k])

test('refuses to run when key, model or any price is unset', async () => {
  clear(); await assert.rejects(A.complete({ system: 's', user: 'u', fetchFn: async () => { throw new Error('must not call') } }), /not configured.*PRICE_IN/)
  setEnv(); delete process.env.USD_CNY; assert.deepEqual(A.configured().missing, ['USD_CNY'])
})
test('cost comes from env prices; JSON parsed through a fence; repair-style messages fold the system turn', async () => {
  clear(); setEnv(); let seen
  const r = await A.complete({ messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }, { role: 'assistant', content: 'A' }, { role: 'user', content: 'again' }], fetchFn: async (u, o) => { seen = JSON.parse(o.body); return ok({ model: 'm-1', content: [{ type: 'text', text: '```json\n{"a":1}\n```' }], stop_reason: 'end_turn', usage: { input_tokens: 1000000, output_tokens: 100000 } }) } })
  assert.deepEqual(r.json, { a: 1 }); assert.equal(r.cost_cny, +((3 + 1.5) * 7).toFixed(4))
  assert.match(seen.system, /^S/); assert.equal(seen.messages.length, 3); assert.equal(seen.messages[0].role, 'user')
})
test('truncation is an error carrying its cost; the monthly cap blocks further calls', async () => {
  clear(); setEnv()
  await assert.rejects(A.complete({ system: 's', user: 'u', fetchFn: async () => ok({ content: [{ type: 'text', text: '{' }], stop_reason: 'max_tokens', usage: { input_tokens: 10, output_tokens: 10 } }) }), (e) => e.truncated && e.cost_cny >= 0)
  const m = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
  mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, ok, cost_cny) VALUES (?,?,?,?,?)").run(m + '-02T00:00:00Z', 'race_plan', 'anthropic', 1, 20)
  await assert.rejects(A.complete({ system: 's', user: 'u', fetchFn: async () => { throw new Error('must not call') } }), (e) => e.status === 429)
})
test('routing is off by default, on per intent, and falls back to deepseek when unconfigured or over cap', () => {
  clear(); setEnv(); assert.equal(K.pickProvider('race_plan'), 'deepseek')
  process.env.COACH_CLAUDE_INTENTS = 'race_plan, session_review'
  mdb.prepare('DELETE FROM coach_run').run()
  assert.equal(K.pickProvider('race_plan'), 'anthropic'); assert.equal(K.pickProvider('daily_brief'), 'deepseek')
  delete process.env.ANTHROPIC_PRICE_IN_USD_PER_MTOK; assert.equal(K.pickProvider('race_plan'), 'deepseek')
})
