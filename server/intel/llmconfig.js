// Coach provider settings editable from Profile → AI Coach: base URL, API key and model. Stored in server/data/llm_config.json (mode 600) with the KEY SEALED
// (AES-256-GCM, LUMPAD_TOKEN_KEY — the same sealing as the COROS/Strava tokens). A saved field overrides the environment default (DEEPSEEK_* in .env); reset removes it.
// The key is never returned by any function that feeds the API (publicConfig returns a masked form) and never appears in test results or error text.
import { load, save } from '../db.js'
import { seal, unseal } from '../coros/oauth.js'

export const DEFAULT_BASE = 'https://api.deepseek.com', FILE = 'llm_config', DEFAULT_MAX_CALLS = 100
const env = () => process.env

export function normalizeBase(u) {
  let x; try { x = new URL(String(u || '').trim()) } catch { throw Object.assign(new Error('Base URL is not a valid URL'), { status: 400 }) }
  if (x.protocol !== 'https:') throw Object.assign(new Error('Base URL must start with https://'), { status: 400 })
  if (x.username || x.password) throw Object.assign(new Error('Base URL must not contain credentials'), { status: 400 })
  const h = x.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '::1' || /^\[/.test(h) || !h.includes('.'))
    throw Object.assign(new Error('Base URL must be a public host name (no localhost or private addresses)'), { status: 400 })
  return (x.origin + x.pathname).replace(/\/+$/, '')
}
export const mask = (k) => (!k ? null : k.length > 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '…' + k.slice(-2))
const raw = () => { try { return load(FILE, null) } catch { return null } }

// internal (contains the plaintext key): used by llm.js only
export function getConfig() {
  const s = raw() || {}, e = env()
  let key = null; if (s.key_sealed) { try { key = unseal(s.key_sealed)?.k || null } catch { key = null } }
  const base = s.base || e.DEEPSEEK_BASE || DEFAULT_BASE
  return { base, key: key || e.DEEPSEEK_API_KEY || null, model: s.model || e.DEEPSEEK_MODEL || null, max_calls_per_day: s.max_calls_per_day || DEFAULT_MAX_CALLS, custom_endpoint: base !== DEFAULT_BASE,
    saved: { base: !!s.base, key: !!s.key_sealed, model: !!s.model }, updated_at: s.updated_at || null }
}
export function publicConfig() {
  const c = getConfig()
  return { base: c.base, model: c.model && c.model !== 'auto-flash' ? c.model : null, model_mode: c.model && c.model !== 'auto-flash' ? 'fixed' : 'auto-flash', key_set: !!c.key, key_masked: mask(c.key), key_source: c.saved.key ? 'saved' : c.key ? 'env' : null,
    custom_endpoint: c.custom_endpoint, max_calls_per_day: c.max_calls_per_day, saved: c.saved, updated_at: c.updated_at, default_base: DEFAULT_BASE }
}
const redact = (text, key) => (key ? String(text).split(key).join('«key»') : String(text))

export async function saveConfig({ base, api_key, model, max_calls_per_day } = {}, { now = new Date().toISOString() } = {}) {
  const s = { ...(raw() || {}) }
  if (base !== undefined && base !== '') s.base = normalizeBase(base)
  if (api_key !== undefined && api_key !== '') { const k = String(api_key).trim(); if (k.length < 8 || /\s/.test(k)) throw Object.assign(new Error('API key looks invalid'), { status: 400 }); s.key_sealed = seal({ k }) }
  if (model !== undefined) { const m = String(model).trim(); if (m.length > 120 || /[\s"'<>]/.test(m)) throw Object.assign(new Error('Model id looks invalid'), { status: 400 }); if (m) s.model = m; else delete s.model }
  if (max_calls_per_day !== undefined && max_calls_per_day !== '') { const n = Math.round(Number(max_calls_per_day)); if (!(n >= 1 && n <= 5000)) throw Object.assign(new Error('Max runs per day must be 1–5000'), { status: 400 }); s.max_calls_per_day = n }
  s.updated_at = now; save(FILE, s); save('deepseek_model', null) // the cached "newest Flash" belongs to the old endpoint
  return publicConfig()
}
export function resetConfig() { save(FILE, null); save('deepseek_model', null); return publicConfig() }

// Connection test with the values from the form (anything omitted falls back to what is saved / in .env). Sends a tiny, content-free prompt; never echoes the key.
export async function testConnection({ base, api_key, model, fetchFn = fetch, timeout = 60000 } = {}) {
  const cur = getConfig(), b = base ? normalizeBase(base) : cur.base, key = (api_key && String(api_key).trim()) || cur.key
  if (!key) return { ok: false, stage: 'key', error: 'No API key set' }
  const H = { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, out = { ok: false, base: b }
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
