// Scenario traces for the Go model gateway (redesign Phase 4-c): the REAL Node complete() (server/intel/llm.js) is run against a scripted fake
// DeepSeek API; every request it makes (path, auth, body), every retry delay and the final result / error are recorded. The Go DeepSeek provider
// must make the identical requests and return the identical result. Synthetic only. Regenerate: node tools/gen_llm_traces.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-llm-trace-'))
process.env.DEEPSEEK_API_KEY = 'sk-test'; process.env.DEEPSEEK_BASE = 'http://x.test'; process.env.DEEPSEEK_MONTHLY_CAP_CNY = '1000'
const L = await import('../server/intel/llm.js'), K = await import('../server/db.js')
const delays = []; const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { delays.push(ms); return realSetTimeout(fn, 0, ...a) } return realSetTimeout(fn, ms, ...a) } // record retry sleeps, do not wait

const MODELS = { data: [{ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }, { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context_window: 128000, effort: { supported_levels: ['low', 'high', 'max'] } }, { id: 'deepseek-flash-old', name: 'DeepSeek-V4-Flash' }] }
const MODELS_NOEFFORT = { data: [{ id: 'flash-plain', name: 'DeepSeek-V4-Flash' }] }
const bal = (v) => ({ status: 200, body: { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: String(v) }, { currency: 'USD', total_balance: '1.00' }] } })
const chat = (content, o = {}) => ({ status: 200, body: { choices: [{ message: { content }, finish_reason: o.finish ?? 'stop' }], usage: o.usage ?? { prompt_tokens: 120, completion_tokens: 60, prompt_cache_hit_tokens: 100, completion_tokens_details: { reasoning_tokens: 20 } } } })
const err = (status, message) => ({ status, body: { error: { message } } })
const raw = (status, text) => ({ status, text })
const J = '{"summary":"ok"}'

const AGE = { fresh: 1000, stale: 2 * 864e5, near: 0.95 * 864e5, over: 1.05 * 864e5 }
const scenarios = [
  { name: 'pinned model, success, cost from the balance drop', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/user/balance': [bal(10), bal(9.97)], '/chat/completions': [chat(J)] } },
  { name: 'auto-flash resolves the newest Flash and caches it; fenced JSON is unwrapped', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: null, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/models': [{ status: 200, body: MODELS }], '/user/balance': [bal(10), bal(9.5)], '/chat/completions': [chat('```json\n' + J + '\n```')] } },
  { name: 'auto-flash with a fresh cache does not call /models', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context: 128000, efforts: ['low', 'high', 'max'], age: 'fresh' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [bal(5), bal(4.99)], '/chat/completions': [chat(J)] } },
  { name: 'cache just under a day old is still fresh (no /models call)', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash', name: 'x', efforts: ['low', 'high'], age: 'near' }, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/user/balance': [bal(5), bal(4.9)], '/chat/completions': [chat(J)] } },
  { name: 'cache just over a day old is refreshed from /models', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash-old', name: 'DeepSeek-V4-Flash', efforts: ['low'], age: 'over' }, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/models': [{ status: 200, body: MODELS }], '/user/balance': [bal(5), bal(4.9)], '/chat/completions': [chat(J)] } },
  { name: 'stale cache + /models down → the stale model is used', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', efforts: ['low', 'high'], age: 'stale' }, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/models': [err(500, 'down')], '/user/balance': [bal(5), bal(5)], '/chat/completions': [chat(J)] } },
  { name: 'stale cache + a newer Flash listed → switches and marks changed', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash-old', name: 'DeepSeek-V4-Flash', efforts: ['low'], age: 'stale' }, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/models': [{ status: 200, body: MODELS }], '/user/balance': [bal(5), bal(4)], '/chat/completions': [chat(J)] } },
  { name: 'no cache and /models down → error', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: null, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/models': [err(503, 'models unavailable')] } },
  { name: 'no Flash model listed → error', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: null, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/models': [{ status: 200, body: { data: [{ id: 'p', name: 'DeepSeek-V9-Pro' }] } }] } },
  { name: 'a PINNED model never gets reasoning_effort (levels only come from the model list)', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, cache: { id: 'deepseek-flash', name: 'x', efforts: ['low', 'high'], age: 'fresh' }, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/user/balance': [bal(9), bal(8.9)], '/chat/completions': [chat(J)] } },
  { name: 'model without effort levels: no reasoning_effort is sent', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: null, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/models': [{ status: 200, body: MODELS_NOEFFORT }], '/user/balance': [bal(3), bal(2.9)], '/chat/completions': [chat(J)] } },
  { name: '400 on reasoning_effort → resent without it', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash', name: 'x', efforts: ['low', 'high'], age: 'fresh' }, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/user/balance': [bal(9), bal(8.9)], '/chat/completions': [err(400, 'reasoning_effort not supported'), chat(J)] } },
  { name: '429 twice then success → sleeps 1.5 s and 3 s', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [bal(9), bal(8.9)], '/chat/completions': [err(429, 'slow down'), err(429, 'slow down'), chat(J)] } },
  { name: '500 three times → gives up with the last error', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [bal(9)], '/chat/completions': [err(500, 'boom 1'), err(502, 'boom 2'), err(503, 'boom 3')] } },
  { name: '401 is not retried', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [bal(9)], '/chat/completions': [err(401, 'bad key')] } },
  { name: '400 with nothing to drop is an error', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [bal(9)], '/chat/completions': [err(400, 'bad request')] } },
  { name: 'non-JSON error body', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [bal(9)], '/chat/completions': [raw(502, '<html>Bad gateway</html>'), raw(502, 'still bad'), raw(504, '')] } },
  { name: 'truncated at high effort → one retry at low effort, costs add up', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash', name: 'x', efforts: ['low', 'high'], age: 'fresh' }, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/user/balance': [bal(10), bal(9.2), bal(9.2), bal(9.1)], '/chat/completions': [chat('', { finish: 'length' }), chat(J)] } },
  { name: 'truncated at high and again at low → truncation error', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash', name: 'x', efforts: ['low', 'high'], age: 'fresh' }, opts: { system: 'S', user: 'U', effort: 'high', intent: 'question' }, script: { '/user/balance': [bal(10), bal(9.2), bal(9.2), bal(9.1)], '/chat/completions': [chat('', { finish: 'length' }), chat('{"a', { finish: 'length' })] } },
  { name: 'truncated at low effort is not retried', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [bal(10), bal(9.9)], '/chat/completions': [chat('', { finish: 'length' })] } },
  { name: 'invalid JSON text → json null, text kept', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [bal(10), bal(9.9)], '/chat/completions': [chat('Sorry, here is prose, not JSON')] } },
  { name: 'balance endpoint down → cost null', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [err(500, 'x'), err(500, 'x')], '/chat/completions': [chat(J)] } },
  { name: 'balance without a CNY entry → cost null', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [{ status: 200, body: { balance_infos: [{ currency: 'USD', total_balance: '1' }] } }, { status: 200, body: { balance_infos: [] } }], '/chat/completions': [chat(J)] } },
  { name: 'balance rose (top-up) → cost 0', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { system: 'S', user: 'U', effort: 'low', intent: 'daily_brief' }, script: { '/user/balance': [bal(5), bal(20)], '/chat/completions': [chat(J)] } },
  { name: 'explicit messages (the repair prompt) and maxTokens are sent as given', env: { DEEPSEEK_MODEL: 'deepseek-flash' }, opts: { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }, { role: 'assistant', content: 'bad' }, { role: 'user', content: 'fix it' }], effort: 'low', maxTokens: 777, intent: 'question' }, script: { '/user/balance': [bal(5), bal(4.98)], '/chat/completions': [chat(J)] } },
  { name: 'medium effort uses its own budget; max falls back to 14000', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash', name: 'x', efforts: ['low', 'medium', 'high', 'max'], age: 'fresh' }, opts: { system: 'S', user: 'U', effort: 'medium', intent: 'question' }, script: { '/user/balance': [bal(5), bal(4.5)], '/chat/completions': [chat(J)] } },
  { name: 'effort max', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash', name: 'x', efforts: ['low', 'high', 'max'], age: 'fresh' }, opts: { system: 'S', user: 'U', effort: 'max', intent: 'question' }, script: { '/user/balance': [bal(5), bal(4.5)], '/chat/completions': [chat(J)] } },
  { name: 'no effort given defaults to high; reply without choices → empty text', env: { DEEPSEEK_MODEL: 'auto-flash' }, cache: { id: 'deepseek-flash', name: 'x', efforts: ['low', 'high'], age: 'fresh' }, opts: { system: 'S', user: 'U', intent: 'question' }, script: { '/user/balance': [bal(5), bal(5)], '/chat/completions': [{ status: 200, body: { usage: { prompt_tokens: 1 } } }] } },
]
const out = []
for (const sc of scenarios) {
  for (const k of ['DEEPSEEK_MODEL']) delete process.env[k]; Object.assign(process.env, sc.env || {})
  if (sc.cache !== undefined) K.save('deepseek_model', sc.cache ? { id: sc.cache.id, name: sc.cache.name, context: sc.cache.context, efforts: sc.cache.efforts, at: Date.now() - AGE[sc.cache.age] } : null); else K.save('deepseek_model', null)
  const queues = Object.fromEntries(Object.entries(sc.script).map(([k, v]) => [k, [...v]])), requests = []; delays.length = 0
  const fetchFn = async (url, opt = {}) => {
    const p = url.replace('http://x.test', ''); requests.push({ method: opt.method || 'GET', path: p, auth: opt.headers?.authorization ?? null, body: opt.body ? JSON.parse(opt.body) : null })
    const r = queues[p]?.shift(); if (!r) throw new Error('script exhausted for ' + p)
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => (r.text !== undefined ? r.text : JSON.stringify(r.body)) }
  }
  let result = null, error = null
  try { const r = await L.complete({ ...sc.opts, fetchFn }); result = { text: r.text, json: r.json, usage: r.usage, model: r.model, model_name: r.model_name, cost_cny: r.cost_cny, effort: r.effort, retried_low: r.retried_low ?? null } }
  catch (e) { error = { message: e.message, status: e.status ?? null, truncated: !!e.truncated, cost_cny: e.cost_cny ?? null, text: e.text ?? null } }
  const cacheAfter = K.load('deepseek_model', null)
  out.push({ name: sc.name, env: sc.env || {}, cache: sc.cache === undefined ? null : sc.cache, opts: sc.opts, script: sc.script, requests, delays: [...delays], result, error, cacheAfter: cacheAfter ? { id: cacheAfter.id, name: cacheAfter.name, changed: cacheAfter.changed ?? null } : null })
}
fs.mkdirSync('lumpadd/internal/llm/testdata', { recursive: true })
fs.writeFileSync('lumpadd/internal/llm/testdata/deepseek_traces.json', JSON.stringify(out))
console.log(out.map((t) => `${t.error ? 'ERR' : 'ok '} reqs ${String(t.requests.length).padStart(2)} delays ${JSON.stringify(t.delays).padEnd(18)} ${t.name}`).join('\n'))
