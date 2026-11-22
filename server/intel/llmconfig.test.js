import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-llmcfg-')); process.env.LUMPAD_TOKEN_KEY = 'ab'.repeat(32); process.env.LUMPAD_DB = ':memory:'
delete process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_BASE; delete process.env.DEEPSEEK_MODEL
const C = await import('./llmconfig.js')
const KEY = 'sk-test-0123456789abcdefTAIL'

test('two fixed providers, each with its own base; unknown ids rejected', async () => {
  assert.equal(C.PROVIDERS.deepseek.base(), C.DEFAULT_BASE); assert.equal(C.PROVIDERS.tokenomix.base(), 'https://api.tokenomixai.com/v1')
  assert.throws(() => C.providerId('openai')); await assert.rejects(() => C.saveConfig({ provider: 'evil', api_key: KEY })); await assert.rejects(() => C.testConnection({ provider: 'evil', api_key: KEY }))
})
test('default: DeepSeek (original) with the .env key; Tokenomix has none', () => {
  process.env.DEEPSEEK_API_KEY = 'sk-env-key-000000ENVK'; process.env.DEEPSEEK_MODEL = 'auto-flash'
  const p = C.publicConfig(); assert.equal(p.active, 'deepseek'); assert.equal(p.key_set, true); assert.equal(p.key_source, 'env'); assert.equal(p.key_masked, 'sk-…ENVK'); assert.equal(p.model_mode, 'auto-flash')
  const tk = p.providers.find((x) => x.id === 'tokenomix'); assert.equal(tk.key_set, false); assert.equal(tk.active, false); assert.equal(p.providers.length, 2)
})
test('saving a Tokenomix key seals it, activates Tokenomix, masks it, and leaves the DeepSeek key alone', async () => {
  const p = await C.saveConfig({ provider: 'tokenomix', api_key: KEY, model: 'deepseek-v4.1-flash', max_calls_per_day: 50 })
  assert.equal(p.active, 'tokenomix'); assert.equal(p.base, 'https://api.tokenomixai.com/v1'); assert.equal(p.key_source, 'saved'); assert.equal(p.model, 'deepseek-v4.1-flash'); assert.equal(p.custom_endpoint, true); assert.equal(p.max_calls_per_day, 50)
  assert.ok(!JSON.stringify(p).includes(KEY)); assert.equal(p.key_masked, 'sk-…TAIL')
  const dsv = p.providers.find((x) => x.id === 'deepseek'); assert.equal(dsv.key_source, 'env'); assert.equal(dsv.active, false)
  const file = fs.readFileSync(path.join(process.env.DATA_DIR, 'llm_config.json'), 'utf8'); assert.ok(!file.includes(KEY) && !file.includes('0123456789abcdef')); assert.equal(C.getConfig().key, KEY)
  assert.equal((fs.statSync(path.join(process.env.DATA_DIR, 'llm_config.json')).mode & 0o077), 0, 'file is private (600)')
})
test('switching providers keeps both keys; activating a provider without a key is refused', async () => {
  let p = await C.saveConfig({ provider: 'deepseek' }); assert.equal(p.active, 'deepseek'); assert.equal(C.getConfig().key, 'sk-env-key-000000ENVK'); assert.equal(C.getConfig('tokenomix').key, KEY, 'Tokenomix key still saved')
  p = await C.saveConfig({ provider: 'tokenomix' }); assert.equal(p.active, 'tokenomix'); assert.equal(C.getConfig().key, KEY)
  const keep = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY
  await assert.rejects(() => C.saveConfig({ provider: 'deepseek' }), /No API key for DeepSeek/); assert.equal(C.getConfig().provider, 'tokenomix', 'still on Tokenomix after the refusal')
  await C.saveConfig({ provider: 'deepseek', api_key: 'sk-own-deepseek-key-DSEK' }); assert.equal(C.getConfig().provider, 'deepseek'); assert.equal(C.getConfig().key, 'sk-own-deepseek-key-DSEK'); assert.equal(C.publicConfig().key_source, 'saved')
  process.env.DEEPSEEK_API_KEY = keep
})
test('partial updates keep the key; clearing the model returns to automatic; bad values rejected', async () => {
  await C.saveConfig({ provider: 'tokenomix', model: 'glm-5.3', activate: false }); assert.equal(C.getConfig('tokenomix').model, 'glm-5.3'); assert.equal(C.getConfig('tokenomix').key, KEY); assert.equal(C.getConfig().provider, 'deepseek', 'activate:false keeps the active provider')
  await C.saveConfig({ provider: 'tokenomix', api_key: '', activate: false }); assert.equal(C.getConfig('tokenomix').key, KEY)
  await C.saveConfig({ provider: 'tokenomix', model: '', activate: false }); assert.equal(C.getConfig('tokenomix').saved.model, false)
  await assert.rejects(() => C.saveConfig({ provider: 'tokenomix', api_key: 'short' })); await assert.rejects(() => C.saveConfig({ provider: 'tokenomix', model: 'bad model' })); await assert.rejects(() => C.saveConfig({ provider: 'tokenomix', max_calls_per_day: 0 }))
})
test('connection test uses the provider\'s own base; ok / auth / model / no-JSON / error — the key never appears in any result', async () => {
  const urls = [], mk = (h) => async (url, opts) => { urls.push(url); const r = h(url, opts); return { status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) } }
  const good = mk((url) => (url.endsWith('/models') ? { status: 200, body: { data: [{ id: 'deepseek-v4.1-flash' }, { id: 'glm-5.3' }] } } : { status: 200, body: { choices: [{ message: { content: '{"ok": true}' } }], usage: { prompt_tokens: 20, completion_tokens: 4 } } }))
  let t = await C.testConnection({ provider: 'tokenomix', api_key: KEY, fetchFn: good }); assert.equal(t.ok, true); assert.equal(t.provider, 'tokenomix'); assert.equal(t.model, 'deepseek-v4.1-flash'); assert.equal(t.json_mode, true); assert.ok(urls.every((u) => u.startsWith('https://api.tokenomixai.com/v1/')))
  urls.length = 0; t = await C.testConnection({ provider: 'deepseek', api_key: KEY, fetchFn: good }); assert.ok(urls.every((u) => u.startsWith('https://api.deepseek.com/')))
  t = await C.testConnection({ provider: 'tokenomix', api_key: KEY, fetchFn: mk(() => ({ status: 403, body: '' })) }); assert.equal(t.stage, 'auth')
  t = await C.testConnection({ provider: 'tokenomix', api_key: KEY, model: 'nope', fetchFn: good }); assert.equal(t.stage, 'model')
  t = await C.testConnection({ provider: 'tokenomix', api_key: KEY, fetchFn: mk((u) => (u.endsWith('/models') ? { status: 200, body: { data: [{ id: 'm1' }] } } : { status: 200, body: { choices: [{ message: { content: 'plain text' } }] } })) }); assert.equal(t.json_mode, false); assert.match(t.warning, /JSON/)
  t = await C.testConnection({ provider: 'tokenomix', api_key: KEY, fetchFn: mk(() => ({ status: 500, body: { error: { message: 'boom ' + KEY } } })) }); assert.equal(t.ok, false); assert.ok(!JSON.stringify(t).includes(KEY))
  t = await C.testConnection({ provider: 'tokenomix', api_key: KEY, fetchFn: async () => { throw new Error('connect failed for ' + KEY) } }); assert.ok(!JSON.stringify(t).includes(KEY))
  C.resetConfig(); t = await C.testConnection({ provider: 'tokenomix', fetchFn: good }); assert.equal(t.stage, 'key'); assert.match(t.error, /Tokenomix/)
})
test('reset one provider removes only its saved values; reset all returns to DeepSeek with the .env key', async () => {
  await C.saveConfig({ provider: 'tokenomix', api_key: KEY }); await C.saveConfig({ provider: 'deepseek', api_key: 'sk-own-deepseek-key-DSEK', activate: false })
  let p = C.resetConfig('tokenomix'); assert.equal(p.active, 'deepseek'); assert.equal(p.providers.find((x) => x.id === 'tokenomix').key_set, false); assert.equal(p.providers.find((x) => x.id === 'deepseek').key_source, 'saved')
  p = C.resetConfig(); assert.equal(p.active, 'deepseek'); assert.equal(p.key_source, 'env')
})
test('llm.js follows the active provider and limits Tokenomix by runs per day (no balance endpoint there)', async () => {
  const L = await import('./llm.js'), { mdb } = await import('./db.js')
  await C.saveConfig({ provider: 'tokenomix', api_key: KEY, model: 'deepseek-v4.1-flash', max_calls_per_day: 2 })
  const m = await L.resolveModel(); assert.equal(m.id, 'deepseek-v4.1-flash'); assert.equal(m.pinned, true); assert.deepEqual(m.efforts, ['low', 'high', 'max'])
  assert.equal(L.guard('weekly_review').ok, true)
  for (let i = 0; i < 2; i++) mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, ok) VALUES (?,?,?,1)").run(new Date().toISOString(), 'question', 'tokenomix')
  const g = L.guard('question'); assert.equal(g.ok, false); assert.match(g.reason, /daily limit of 2/); assert.equal(L.guardStatus().mode, 'calls')
  await C.saveConfig({ provider: 'deepseek' }); assert.equal(L.guardStatus().mode, undefined, 'DeepSeek keeps the spend-based guard')
  C.resetConfig()
})
