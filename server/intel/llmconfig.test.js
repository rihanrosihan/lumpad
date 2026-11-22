import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-llmcfg-')); process.env.LUMPAD_TOKEN_KEY = 'ab'.repeat(32); process.env.LUMPAD_DB = ':memory:'
delete process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_BASE; delete process.env.DEEPSEEK_MODEL
const C = await import('./llmconfig.js')
const KEY = 'sk-test-0123456789abcdefTAIL'

test('base URL: https only, public host, normalised; no credentials/localhost/private ranges', () => {
  assert.equal(C.normalizeBase('https://api.example.com/v1/'), 'https://api.example.com/v1')
  assert.equal(C.normalizeBase(' https://api.deepseek.com '), 'https://api.deepseek.com')
  for (const bad of ['http://api.example.com', 'ftp://x.com', 'https://localhost/v1', 'https://127.0.0.1', 'https://10.0.0.5/v1', 'https://192.168.1.2', 'https://172.20.1.1', 'https://169.254.169.254/latest', 'https://user:pw@api.example.com', 'https://intranet', 'https://x.internal', 'not a url', '']) assert.throws(() => C.normalizeBase(bad), bad)
})
test('default config comes from the environment; nothing saved', () => {
  const p = C.publicConfig(); assert.equal(p.base, C.DEFAULT_BASE); assert.equal(p.key_set, false); assert.equal(p.custom_endpoint, false); assert.deepEqual(p.saved, { base: false, key: false, model: false })
  process.env.DEEPSEEK_API_KEY = 'sk-env-key-000000ENVK'; process.env.DEEPSEEK_MODEL = 'auto-flash'
  const q = C.publicConfig(); assert.equal(q.key_set, true); assert.equal(q.key_source, 'env'); assert.equal(q.model_mode, 'auto-flash'); assert.equal(q.key_masked, 'sk-…ENVK')
})
test('saved key is sealed at rest, overrides env, is masked in the public view and never returned', async () => {
  const p = await C.saveConfig({ base: 'https://gw.example.com/v1', api_key: KEY, model: 'deepseek-v4.1-flash', max_calls_per_day: 50 })
  assert.equal(p.key_source, 'saved'); assert.equal(p.base, 'https://gw.example.com/v1'); assert.equal(p.model, 'deepseek-v4.1-flash'); assert.equal(p.custom_endpoint, true); assert.equal(p.max_calls_per_day, 50)
  assert.ok(!JSON.stringify(p).includes(KEY)); assert.equal(p.key_masked, 'sk-…TAIL')
  const file = fs.readFileSync(path.join(process.env.DATA_DIR, 'llm_config.json'), 'utf8'); assert.ok(!file.includes(KEY) && !file.includes('0123456789abcdef')); assert.equal(C.getConfig().key, KEY)
  assert.equal((fs.statSync(path.join(process.env.DATA_DIR, 'llm_config.json')).mode & 0o077), 0, 'file is private (600)')
})
test('partial update keeps the key; empty api_key keeps it; clearing the model returns to auto', async () => {
  await C.saveConfig({ model: 'glm-5.3' }); assert.equal(C.getConfig().key, KEY); assert.equal(C.getConfig().model, 'glm-5.3')
  await C.saveConfig({ api_key: '' }); assert.equal(C.getConfig().key, KEY)
  await C.saveConfig({ model: '' }); assert.equal(C.getConfig().saved.model, false)
  await assert.rejects(() => C.saveConfig({ api_key: 'short' })); await assert.rejects(() => C.saveConfig({ model: 'bad model' })); await assert.rejects(() => C.saveConfig({ max_calls_per_day: 0 }))
})
test('connection test: ok path, auth failure, bad model, no JSON — and the key never appears in any result', async () => {
  const mk = (h) => async (url, opts) => { const r = h(url, opts); return { status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) } }
  const good = mk((url) => (url.endsWith('/models') ? { status: 200, body: { data: [{ id: 'deepseek-v4.1-flash' }, { id: 'glm-5.3' }] } } : { status: 200, body: { choices: [{ message: { content: '{"ok": true}' } }], usage: { prompt_tokens: 20, completion_tokens: 4 } } }))
  let t = await C.testConnection({ base: 'https://gw.example.com/v1', api_key: KEY, fetchFn: good }); assert.equal(t.ok, true); assert.equal(t.model, 'deepseek-v4.1-flash'); assert.equal(t.json_mode, true); assert.deepEqual(t.models, ['deepseek-v4.1-flash', 'glm-5.3'])
  t = await C.testConnection({ base: 'https://gw.example.com/v1', api_key: KEY, fetchFn: mk(() => ({ status: 403, body: '' })) }); assert.equal(t.ok, false); assert.equal(t.stage, 'auth')
  t = await C.testConnection({ base: 'https://gw.example.com/v1', api_key: KEY, model: 'nope', fetchFn: good }); assert.equal(t.ok, false); assert.equal(t.stage, 'model')
  t = await C.testConnection({ base: 'https://gw.example.com/v1', api_key: KEY, fetchFn: mk((u) => (u.endsWith('/models') ? { status: 200, body: { data: [{ id: 'm1' }] } } : { status: 200, body: { choices: [{ message: { content: 'plain text' } }] } })) }); assert.equal(t.ok, true); assert.equal(t.json_mode, false); assert.match(t.warning, /JSON/)
  t = await C.testConnection({ base: 'https://gw.example.com/v1', api_key: KEY, fetchFn: mk(() => ({ status: 500, body: { error: { message: 'boom ' + KEY } } })) }); assert.equal(t.ok, false); assert.ok(!JSON.stringify(t).includes(KEY), 'key redacted from errors')
  t = await C.testConnection({ base: 'https://gw.example.com/v1', api_key: KEY, fetchFn: async () => { throw new Error('connect failed for ' + KEY) } }); assert.ok(!JSON.stringify(t).includes(KEY))
  await assert.rejects(() => C.testConnection({ base: 'http://insecure.example.com', api_key: KEY, fetchFn: good }))
})
test('reset removes the saved values (back to the environment default)', async () => {
  const p = C.resetConfig(); assert.equal(p.base, C.DEFAULT_BASE); assert.deepEqual(p.saved, { base: false, key: false, model: false }); assert.equal(p.key_source, 'env')
})
test('llm.js uses the saved config and limits a custom endpoint by runs per day (no balance endpoint there)', async () => {
  const L = await import('./llm.js'), { mdb } = await import('./db.js')
  await C.saveConfig({ base: 'https://gw.example.com/v1', api_key: KEY, model: 'deepseek-v4.1-flash', max_calls_per_day: 2 })
  const m = await L.resolveModel(); assert.equal(m.id, 'deepseek-v4.1-flash'); assert.equal(m.pinned, true); assert.deepEqual(m.efforts, ['low', 'high', 'max'])
  assert.equal(L.guard('weekly_review').ok, true)
  for (let i = 0; i < 2; i++) mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, ok) VALUES (?,?,?,1)").run(new Date().toISOString(), 'question', 'custom')
  const g = L.guard('question'); assert.equal(g.ok, false); assert.match(g.reason, /daily limit of 2/); assert.equal(L.guardStatus().mode, 'calls')
  C.resetConfig(); delete process.env.DEEPSEEK_API_KEY
})
