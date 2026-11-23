// Coach provider settings editable from Profile → AI Coach: base URL, API key and model. Stored in server/data/llm_config.json (mode 600) with the KEY SEALED
// (AES-256-GCM, LUMPAD_TOKEN_KEY — the same sealing as the COROS/Strava tokens). A saved field overrides the environment default (DEEPSEEK_* in .env); reset removes it.
// The key is never returned by any function that feeds the API (publicConfig returns a masked form) and never appears in test results or error text.
import fs from 'node:fs'
import { load, save } from '../db.js'
import { mdb } from './db.js'
import { seal, unseal } from '../coros/oauth.js'

export const DEFAULT_BASE = 'https://api.deepseek.com', FILE = 'llm_config', DEFAULT_MAX_CALLS = 0 // 0 = no daily run limit
// Two providers, each with its OWN saved key and model; `active` is the one the coach uses. Base URLs are fixed presets (no free-form URL, nothing to point at an internal host).
// deepseek = the original DeepSeek API (its key can also come from .env: DEEPSEEK_API_KEY); tokenomix = the Tokenomix gateway (no balance endpoint → daily run limit instead of spend).
export const PROVIDERS = {
  deepseek: { label: 'DeepSeek (original)', base: () => process.env.DEEPSEEK_BASE || DEFAULT_BASE, envKey: 'DEEPSEEK_API_KEY', envModel: 'DEEPSEEK_MODEL', balance: true },
  // Tokenomix reads its key from a separate env file (OPENAI_API_KEY / OPENAI_BASE_URL, default /opt/lumpad/tokenomixai.env, override with TOKENOMIX_ENV_FILE); a key saved in the UI wins over the file
  tokenomix: { label: 'Tokenomix (gateway)', base: () => tokenomixBase(), envKey: null, envModel: null, envFile: 'OPENAI_API_KEY', balance: false },
}
const TOKENOMIX_BASE = 'https://api.tokenomixai.com/v1', TOKENOMIX_HOST = 'api.tokenomixai.com'
export const envFilePath = () => process.env.TOKENOMIX_ENV_FILE || '/opt/lumpad/tokenomixai.env'
let fileCache = { path: null, mtime: 0, vars: {} }
// KEY=VALUE lines only (no shell evaluation, no expansion); re-read when the file changes. Values never leave this module except through getConfig().key.
export function fileVars(file = envFilePath()) {
  try {
    const st = fs.statSync(file); if (fileCache.path === file && fileCache.mtime === st.mtimeMs) return fileCache.vars
    const vars = {}; for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line); if (m && !line.trim().startsWith('#')) vars[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2') }
    fileCache = { path: file, mtime: st.mtimeMs, vars }; return vars
  } catch { return {} }
}
// the file may name a base URL, but only the Tokenomix host is accepted (so a file cannot redirect the key to another server)
function tokenomixBase() { try { const u = new URL(fileVars().OPENAI_BASE_URL || ''); if (u.protocol === 'https:' && u.hostname === TOKENOMIX_HOST && !u.username && !u.password) return (u.origin + u.pathname).replace(/\/+$/, '') } catch {} return TOKENOMIX_BASE }
export const providerId = (x) => { if (!Object.hasOwn(PROVIDERS, x)) throw Object.assign(new Error('Unknown provider'), { status: 400 }); return x }
const env = () => process.env
export const mask = (k) => (!k ? null : k.length > 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '…' + k.slice(-2))
const raw = () => { try { return load(FILE, null) } catch { return null } }
const entry = (s, id) => s?.providers?.[id] || {}
const keyInfo = (s, id) => {
  const e = entry(s, id), P = PROVIDERS[id]; let k = null
  if (e.key_sealed) { try { k = unseal(e.key_sealed)?.k || null } catch { k = null } }
  if (k) return { key: k, source: 'saved' }
  if (P.envKey && env()[P.envKey]) return { key: env()[P.envKey], source: 'env' }
  if (P.envFile && fileVars()[P.envFile]) return { key: fileVars()[P.envFile], source: 'file' }
  return { key: null, source: null }
}
const keyOf = (s, id) => keyInfo(s, id).key

// internal (contains the plaintext key): used by llm.js only. Describes the ACTIVE provider.
export function getConfig(id) {
  const s = raw() || {}, act = id || (Object.hasOwn(PROVIDERS, s.active) ? s.active : 'deepseek'), P = PROVIDERS[act], e = entry(s, act)
  return { provider: act, label: P.label, base: P.base(), key: keyOf(s, act), key_source: keyInfo(s, act).source, model: e.model || (P.envModel ? env()[P.envModel] || null : null), max_calls_per_day: e.max_calls_per_day ?? DEFAULT_MAX_CALLS, custom_endpoint: !P.balance,
    saved: { key: !!e.key_sealed, model: !!e.model }, updated_at: s.updated_at || null }
}
const view = (id, active) => { const c = getConfig(id); return { id, label: c.label, base: c.base, active: id === active, key_set: !!c.key, key_masked: mask(c.key), key_source: c.key_source, model: c.model && c.model !== 'auto-flash' ? c.model : null,
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
  if (max_calls_per_day !== undefined && max_calls_per_day !== '') { const n = Math.round(Number(max_calls_per_day)); if (!(n >= 0 && n <= 100000)) throw Object.assign(new Error('Max runs per day must be 0 (no limit) to 100000'), { status: 400 }); e.max_calls_per_day = n }
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

// Models available under the provider's key (GET {base}/models) for the model dropdown. Cached 5 minutes per provider; the key never appears in the result.
const modelCache = new Map()
export async function listModels({ provider, api_key, fetchFn = fetch, force = false, timeout = 30000, now = Date.now() } = {}) {
  const id = providerId(provider || getConfig().provider), cur = getConfig(id), key = (api_key && String(api_key).trim()) || cur.key
  if (!key) return { ok: false, provider: id, error: `No API key set for ${PROVIDERS[id].label}`, models: [] }
  const ck = id + '|' + cur.base + '|' + key.length + key.slice(-4), hit = modelCache.get(ck)
  if (hit && !force && now - hit.at < 300000) return hit.v
  try {
    const r = await fetchFn(cur.base + '/models', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(timeout) }), txt = await r.text(); let j = null; try { j = JSON.parse(txt) } catch {}
    if (r.status === 401 || r.status === 403) return { ok: false, provider: id, error: `The server rejected the key (HTTP ${r.status})`, models: [] }
    if (r.status !== 200) return { ok: false, provider: id, error: `Could not list models (HTTP ${r.status})`, models: [] }
    const models = [...new Set((j?.data || (Array.isArray(j) ? j : [])).map((x) => x.id || x.name).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    const v = { ok: true, provider: id, base: cur.base, count: models.length, models }; modelCache.set(ck, { at: now, v }); return v
  } catch (e) { return { ok: false, provider: id, error: redact(e.name === 'TimeoutError' ? 'Timed out waiting for the server' : e.message || 'Network error', key), models: [] } }
}
export const clearModelCache = () => modelCache.clear()

// Tokenomix plan quota: the portal has no API we can call, so the figures are typed in by hand (snapshot below until the first save) and shown as a card.
export const QUOTA_FILE = 'tokenomix_quota', PORTAL_URL = 'https://tokenomixai.com/en/portal'
const QUOTA_SNAPSHOT = { total_m: 600, used_m: 119.4, valid_until: '2026-12-21', status: 'active', as_of: '2026-11-23' }
// Tokens this app spends are counted per call (insert-only, so several processes can write at once), so the quota card can estimate what is left between two manual updates.
export function recordTokens(n, model = null, at = new Date().toISOString()) {
  const t = Math.round(Number(n)); if (!(t > 0)) return
  try { mdb.exec('CREATE TABLE IF NOT EXISTS token_spend (ts TEXT NOT NULL, tokens INTEGER NOT NULL, model TEXT)'); mdb.prepare('INSERT INTO token_spend (ts, tokens, model) VALUES (?,?,?)').run(at, t, model) } catch { /* counting must never break a call */ }
}
const spentSince = (iso) => { try { mdb.exec('CREATE TABLE IF NOT EXISTS token_spend (ts TEXT NOT NULL, tokens INTEGER NOT NULL, model TEXT)'); return mdb.prepare('SELECT COALESCE(SUM(tokens),0) n FROM token_spend WHERE ts > ?').get(iso || '1970').n / 1e6 } catch { return 0 } }
// ok | low (≤ 10 % left or ≤ 7 days) | critical (≤ 2 % left or expired): bulk jobs stop at critical, interactive coach calls are never blocked
export const quotaLevel = (q = getQuota()) => (q.days_left <= 0 || q.est_left_pct <= 2 ? 'critical' : q.est_left_pct <= 10 || q.days_left <= 7 ? 'low' : 'ok')
export function getQuota() {
  let q = null; try { q = load(QUOTA_FILE, null) } catch {}
  q = q || QUOTA_SNAPSHOT
  const left = Math.max(0, q.total_m - q.used_m), days = Math.ceil((Date.parse(q.valid_until + 'T23:59:59+07:00') - Date.now()) / 864e5)
  const spent = spentSince(q.saved_at), estLeft = Math.max(0, left - spent)
  const out = { ...q, left_m: Math.round(left * 100) / 100, left_pct: q.total_m > 0 ? Math.round((left / q.total_m) * 100) : 0, spent_since_m: Math.round(spent * 100) / 100, est_left_m: Math.round(estLeft * 100) / 100, est_left_pct: q.total_m > 0 ? Math.round((estLeft / q.total_m) * 100) : 0, days_left: days, portal: PORTAL_URL }
  return { ...out, level: quotaLevel(out) }
}
export function saveQuota({ total_m, used_m, valid_until, status } = {}, { now = new Date().toISOString() } = {}) {
  const cur = getQuota(), t = total_m === undefined || total_m === '' ? cur.total_m : Number(total_m), u = used_m === undefined || used_m === '' ? cur.used_m : Number(used_m)
  const v = valid_until || cur.valid_until, st = String(status || cur.status).trim().slice(0, 30)
  if (!(t > 0 && t <= 1e6)) throw Object.assign(new Error('Total quota must be a positive number of millions of tokens'), { status: 400 })
  if (!(u >= 0 && u <= t)) throw Object.assign(new Error('Used must be between 0 and the total'), { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw Object.assign(new Error('Valid until must be a date (YYYY-MM-DD)'), { status: 400 })
  save(QUOTA_FILE, { total_m: t, used_m: u, valid_until: v, status: st, as_of: now.slice(0, 10), saved_at: now }); return getQuota()
}
