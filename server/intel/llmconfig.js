// Coach provider settings editable from Profile → AI Coach: base URL, API key and model. Stored in server/data/llm_config.json (mode 600) with the KEY SEALED
// (AES-256-GCM, LUMPAD_TOKEN_KEY — the same sealing as the COROS/Strava tokens). A saved field overrides the environment default (DEEPSEEK_* in .env); reset removes it.
// The key is never returned by any function that feeds the API (publicConfig returns a masked form) and never appears in test results or error text.
import { load, save } from '../db.js'
import { seal, unseal } from '../coros/oauth.js'

export const DEFAULT_BASE = 'https://api.deepseek.com', FILE = 'llm_config', DEFAULT_MAX_CALLS = 100
// Two providers, each with its OWN saved key and model; `active` is the one the coach uses. Base URLs are fixed presets (no free-form URL, nothing to point at an internal host).
// deepseek = the original DeepSeek API (its key can also come from .env: DEEPSEEK_API_KEY); tokenomix = the Tokenomix gateway (no balance endpoint → daily run limit instead of spend).
export const PROVIDERS = {
  deepseek: { label: 'DeepSeek (original)', base: () => process.env.DEEPSEEK_BASE || DEFAULT_BASE, envKey: 'DEEPSEEK_API_KEY', envModel: 'DEEPSEEK_MODEL', balance: true },
  tokenomix: { label: 'Tokenomix (gateway)', base: () => 'https://api.tokenomixai.com/v1', envKey: null, envModel: null, balance: false },
}
export const providerId = (x) => { if (!Object.hasOwn(PROVIDERS, x)) throw Object.assign(new Error('Unknown provider'), { status: 400 }); return x }
const env = () => process.env
export const mask = (k) => (!k ? null : k.length > 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '…' + k.slice(-2))
const raw = () => { try { return load(FILE, null) } catch { return null } }
const entry = (s, id) => s?.providers?.[id] || {}
const keyOf = (s, id) => { const e = entry(s, id); let k = null; if (e.key_sealed) { try { k = unseal(e.key_sealed)?.k || null } catch { k = null } } return k || (PROVIDERS[id].envKey ? env()[PROVIDERS[id].envKey] || null : null) }

// internal (contains the plaintext key): used by llm.js only. Describes the ACTIVE provider.
export function getConfig(id) {
  const s = raw() || {}, act = id || (Object.hasOwn(PROVIDERS, s.active) ? s.active : 'deepseek'), P = PROVIDERS[act], e = entry(s, act)
  return { provider: act, label: P.label, base: P.base(), key: keyOf(s, act), model: e.model || (P.envModel ? env()[P.envModel] || null : null), max_calls_per_day: e.max_calls_per_day || DEFAULT_MAX_CALLS, custom_endpoint: !P.balance,
    saved: { key: !!e.key_sealed, model: !!e.model }, updated_at: s.updated_at || null }
}
const view = (id, active) => { const c = getConfig(id); return { id, label: c.label, base: c.base, active: id === active, key_set: !!c.key, key_masked: mask(c.key), key_source: c.saved.key ? 'saved' : c.key ? 'env' : null, model: c.model && c.model !== 'auto-flash' ? c.model : null,
  model_mode: c.model && c.model !== 'auto-flash' ? 'fixed' : 'auto-flash', max_calls_per_day: c.max_calls_per_day, custom_endpoint: c.custom_endpoint, saved: c.saved } }
export function publicConfig() {
  const act = getConfig().provider, list = Object.keys(PROVIDERS).map((id) => view(id, act)), a = list.find((x) => x.active)
  return { ...a, id: undefined, label: a.label, active: act, providers: list, updated_at: getConfig().updated_at } // flat fields = the active provider (status screens)
}
const redact = (text, key) => (key ? String(text).split(key).join('«key»') : String(text))

// Change one provider's saved key / model / run limit; `activate` (default true) makes it the one the coach uses. Empty api_key keeps the key; empty model = automatic.
export async function saveConfig({ provider = 'deepseek', api_key, model, max_calls_per_day, activate = true } = {}, { now = new Date().toISOString() } = {}) {
  const id = providerId(provider), s = { ...(raw() || {}) }; s.providers = { ...(s.providers || {}) }; const e = { ...(s.providers[id] || {}) }
  if (api_key !== undefined && api_key !== '') { const k = String(api_key).trim(); if (k.length < 8 || /\s/.test(k)) throw Object.assign(new Error('API key looks invalid'), { status: 400 }); e.key_sealed = seal({ k }) }
  if (model !== undefined) { const m = String(model).trim(); if (m.length > 120 || /[\s"'<>]/.test(m)) throw Object.assign(new Error('Model id looks invalid'), { status: 400 }); if (m) e.model = m; else delete e.model }
  if (max_calls_per_day !== undefined && max_calls_per_day !== '') { const n = Math.round(Number(max_calls_per_day)); if (!(n >= 1 && n <= 5000)) throw Object.assign(new Error('Max runs per day must be 1–5000'), { status: 400 }); e.max_calls_per_day = n }
  s.providers[id] = e
  if (activate) { if (!keyOf(s, id)) throw Object.assign(new Error(`No API key for ${PROVIDERS[id].label}: enter one first`), { status: 400 }); s.active = id }
  s.updated_at = now; save(FILE, s); save('deepseek_model', null) // the cached "newest Flash" belongs to the previous provider
  return publicConfig()
}
// Remove one provider's saved key/model (or everything when no provider is given); the coach falls back to DeepSeek with the .env key.
export function resetConfig(provider) {
  const s = raw() || {}
  if (!provider) save(FILE, null)
  else { const id = providerId(provider); s.providers = { ...(s.providers || {}) }; delete s.providers[id]; if (s.active === id && !keyOf(s, id)) s.active = 'deepseek'; save(FILE, s) }
  save('deepseek_model', null); return publicConfig()
}

// Connection test with the values from the form (anything omitted falls back to what is saved / in .env). Sends a tiny, content-free prompt; never echoes the key.
export async function testConnection({ provider, api_key, model, fetchFn = fetch, timeout = 60000 } = {}) {
  const id = providerId(provider || getConfig().provider), cur = getConfig(id), b = cur.base, key = (api_key && String(api_key).trim()) || cur.key
  if (!key) return { ok: false, provider: id, stage: 'key', error: `No API key set for ${PROVIDERS[id].label}` }
  const H = { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, out = { ok: false, provider: id, base: b }
  const call = async (path, body) => {
    const t = Date.now(); const r = await fetchFn(b + path, { method: body ? 'POST' : 'GET', headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) })
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt) } catch {}
    return { status: r.status, j, text: redact(txt, key).slice(0, 200), ms: Date.now() - t }
  }
  try {
    const m = await call('/models'); out.models_status = m.status
    if (m.status === 401 || m.status === 403) return { ...out, stage: 'auth', error: `The server rejected the key (HTTP ${m.status})` }
    const list = m.status === 200 ? (m.j?.data || (Array.isArray(m.j) ? m.j : [])).map((x) => x.id || x.name).filter(Boolean) : []
    out.models = list.slice(0, 200); out.model_count = list.length
    const pick = (model && String(model).trim()) || (cur.model && cur.model !== 'auto-flash' ? cur.model : null) || list.find((x) => /flash/i.test(x) && !/(mod|vision)/i.test(x)) || list[0]
    if (!pick) return { ...out, stage: 'model', error: 'The server lists no models; enter a model id' }
    out.model = pick; if (list.length && !list.includes(pick)) return { ...out, stage: 'model', error: `Model "${pick}" is not in the server's model list` }
    const c = await call('/chat/completions', { model: pick, messages: [{ role: 'system', content: 'Answer in JSON only.' }, { role: 'user', content: 'Return {"ok": true}' }], response_format: { type: 'json_object' }, max_tokens: 400, stream: false })
    out.chat_status = c.status; out.latency_ms = c.ms
    if (c.status !== 200) return { ...out, stage: 'chat', error: `Chat request failed (HTTP ${c.status}): ${c.j?.error?.message ? redact(c.j.error.message, key).slice(0, 160) : c.text}` }
    let parsed = null; try { parsed = JSON.parse(String(c.j?.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch {}
    out.json_mode = !!parsed; out.usage = c.j?.usage ? { prompt_tokens: c.j.usage.prompt_tokens, completion_tokens: c.j.usage.completion_tokens } : null
    return { ...out, ok: true, warning: parsed ? null : 'The model answered but not in valid JSON: the coach needs JSON output, pick another model' }
  } catch (e) { return { ...out, stage: 'network', error: redact(e.name === 'TimeoutError' ? 'Timed out waiting for the server' : e.message || 'Network error', key) } }
}
