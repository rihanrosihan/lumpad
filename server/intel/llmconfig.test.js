import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-llmcfg-')); process.env.LUMPAD_TOKEN_KEY = 'ab'.repeat(32); process.env.LUMPAD_DB = ':memory:'
delete process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_BASE; delete process.env.DEEPSEEK_MODEL
const NO_FILE = path.join(process.env.DATA_DIR, 'no-such.env'); process.env.TOKENOMIX_ENV_FILE = NO_FILE // never read the real /opt/lumpad/tokenomixai.env in tests
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
  await assert.rejects(() => C.saveConfig({ provider: 'tokenomix', api_key: 'short' })); await assert.rejects(() => C.saveConfig({ provider: 'tokenomix', model: 'bad model' })); await assert.rejects(() => C.saveConfig({ provider: 'tokenomix', max_calls_per_day: -1 })); assert.equal((await C.saveConfig({ provider: 'tokenomix', max_calls_per_day: 0, activate: false })).providers.find((x) => x.id === 'tokenomix').max_calls_per_day, 0)
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

test('Tokenomix reads its key from the env file; a key saved in the UI wins; the file cannot redirect the key to another host', async () => {
  const f = path.join(process.env.DATA_DIR, 'tokenomixai.env')
  fs.writeFileSync(f, `# comment\nOPENAI_API_KEY="sk-file-key-ABCDEFGH-FILE"\nOPENAI_BASE_URL=https://api.tokenomixai.com/v1/\nexport OTHER=1\n`, { mode: 0o600 }); process.env.TOKENOMIX_ENV_FILE = f
  C.resetConfig(); let c = C.getConfig('tokenomix'); assert.equal(c.key, 'sk-file-key-ABCDEFGH-FILE'); assert.equal(c.key_source, 'file'); assert.equal(c.base, 'https://api.tokenomixai.com/v1')
  let p = C.publicConfig().providers.find((x) => x.id === 'tokenomix'); assert.equal(p.key_set, true); assert.equal(p.key_source, 'file'); assert.equal(p.key_masked, 'sk-…FILE'); assert.ok(!JSON.stringify(C.publicConfig()).includes('ABCDEFGH'))
  await C.saveConfig({ provider: 'tokenomix', api_key: KEY, activate: false }); assert.equal(C.getConfig('tokenomix').key, KEY); assert.equal(C.getConfig('tokenomix').key_source, 'saved')
  C.resetConfig('tokenomix'); assert.equal(C.getConfig('tokenomix').key_source, 'file', 'removing the saved key falls back to the file')
  await C.saveConfig({ provider: 'tokenomix' }); assert.equal(C.getConfig().provider, 'tokenomix', 'activating works with the file key alone')
  fs.writeFileSync(f, 'OPENAI_API_KEY=sk-file-key-ABCDEFGH-FILE\nOPENAI_BASE_URL=https://evil.example.com/v1\n'); fs.utimesSync(f, new Date(), new Date(Date.now() + 5000))
  assert.equal(C.getConfig('tokenomix').base, 'https://api.tokenomixai.com/v1', 'foreign host in the file is ignored')
  fs.rmSync(f); C.resetConfig(); assert.equal(C.getConfig('tokenomix').key, null); process.env.TOKENOMIX_ENV_FILE = NO_FILE
})
test('model list under a key: sorted ids, cached, auth failure and missing key handled, key never in the result', async () => {
  C.clearModelCache(); let n = 0; const mk = (status, body) => async () => { n++; return { status, text: async () => JSON.stringify(body) } }
  let r = await C.listModels({ provider: 'tokenomix', api_key: KEY, fetchFn: mk(200, { data: [{ id: 'glm-5.3' }, { id: 'auto' }, { id: 'deepseek-v4.1-flash' }, { id: 'auto' }] }) })
  assert.deepEqual(r.models, ['auto', 'deepseek-v4.1-flash', 'glm-5.3']); assert.equal(r.count, 3); assert.equal(r.provider, 'tokenomix')
  await C.listModels({ provider: 'tokenomix', api_key: KEY, fetchFn: mk(200, { data: [] }) }); assert.equal(n, 1, 'second call served from cache')
  C.clearModelCache(); r = await C.listModels({ provider: 'tokenomix', api_key: KEY, fetchFn: mk(403, {}) }); assert.equal(r.ok, false); assert.match(r.error, /rejected/)
  r = await C.listModels({ provider: 'tokenomix', fetchFn: mk(200, {}) }); assert.equal(r.ok, false); assert.match(r.error, /No API key/)
  r = await C.listModels({ provider: 'tokenomix', api_key: KEY, force: true, fetchFn: async () => { throw new Error('down ' + KEY) } }); assert.ok(!JSON.stringify(r).includes(KEY))
  await assert.rejects(() => C.listModels({ provider: 'evil', api_key: KEY }))
})

test('Tokenomix quota: snapshot default, manual update, validation', () => {
  let q = C.getQuota(); assert.equal(q.total_m, 600); assert.equal(q.left_m, 480.6); assert.equal(q.left_pct, 80); assert.equal(q.portal, 'https://tokenomixai.com/en/portal')
  q = C.saveQuota({ used_m: '60', valid_until: '2026-12-31' }); assert.equal(q.left_m, 540); assert.equal(q.left_pct, 90); assert.equal(C.getQuota().used_m, 60)
  assert.throws(() => C.saveQuota({ used_m: 700 }), /between 0 and the total/); assert.throws(() => C.saveQuota({ valid_until: 'soon' }), /date/); assert.throws(() => C.saveQuota({ total_m: -1 }), /positive/)
})

test('token counting feeds an estimate and a level: ok, low, critical', async () => {
  C.saveQuota({ total_m: 100, used_m: 50, valid_until: '2099-01-01' }, { now: '2026-11-23T00:00:00.000Z' })
  assert.equal(C.getQuota().level, 'ok'); assert.equal(C.getQuota().est_left_m, 50)
  C.recordTokens(30e6, 'm', '2026-11-24T00:00:00.000Z'); const q = C.getQuota(); assert.equal(q.spent_since_m, 30); assert.equal(q.est_left_m, 20); assert.equal(q.level, 'ok')
  C.recordTokens(12e6, 'm', '2026-11-24T01:00:00.000Z'); assert.equal(C.getQuota().level, 'low')
  C.recordTokens(7.5e6, 'm', '2026-11-24T02:00:00.000Z'); assert.equal(C.getQuota().level, 'critical')
  C.recordTokens(5e6, 'm', '2026-11-22T00:00:00.000Z'); assert.equal(C.getQuota().spent_since_m, 49.5, 'tokens before the last manual update are not counted again')
  assert.equal(C.quotaLevel({ days_left: 0, est_left_pct: 90 }), 'critical'); assert.equal(C.quotaLevel({ days_left: 5, est_left_pct: 90 }), 'low')
})
