// OAuth 2.0 (authorization code + PKCE S256, dynamic client registration) against the COROS MCP authorization server.
// Verified live 11 Nov 2026: discovery docs, registration_endpoint, S256, scopes openid/mcp.tools/offline_access.
// Tokens are sealed with AES-256-GCM (key = LUMPAD_TOKEN_KEY, 64 hex chars, lives only in .env — not in DB or backups).
import crypto from 'node:crypto'
import { db, tx } from '../store.js'

export const MCP_URL = () => process.env.COROS_MCP_URL || 'https://mcp.coros.com/mcp'
const SCOPE = 'openid mcp.tools offline_access', PROVIDER = 'coros'
const b64u = (b) => Buffer.from(b).toString('base64url')

// ---- sealing
const key = () => { const k = process.env.LUMPAD_TOKEN_KEY; if (!k || !/^[0-9a-f]{64}$/i.test(k)) throw Object.assign(new Error('LUMPAD_TOKEN_KEY not set (64 hex chars) — run deploy.sh'), { status: 503 }); return Buffer.from(k, 'hex') }
export function seal(obj) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv), enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]); return b64u(Buffer.concat([iv, c.getAuthTag(), enc])) }
export function unseal(s) { const b = Buffer.from(s, 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')) }

// ---- discovery (cached per process)
let meta
export async function discover(force = false) {
  if (meta && !force) return meta
  const origin = new URL(MCP_URL()).origin
  const j = async (u) => { const r = await fetch(u, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.json() }
  let pr; try { pr = await j(origin + '/.well-known/oauth-protected-resource/mcp') } catch { pr = await j(origin + '/.well-known/oauth-protected-resource') }
  const as = pr.authorization_servers?.[0]; if (!as) throw new Error('no authorization server in protected-resource metadata')
  let am; try { am = await j(as + '/.well-known/oauth-authorization-server') } catch { am = await j(as + '/.well-known/openid-configuration') }
  if (!am.code_challenge_methods_supported?.includes('S256')) throw new Error('authorization server does not support PKCE S256')
  return (meta = { resource: pr.resource, as, authorize: am.authorization_endpoint, token: am.token_endpoint, register: am.registration_endpoint, revoke: am.revocation_endpoint })
}

// ---- client registration (RFC 7591), once per redirect URI
export async function ensureClient(redirectUri) {
  const row = db.prepare('SELECT client_id, redirect_uri FROM oauth_clients WHERE provider = ?').get(PROVIDER)
  if (row && row.redirect_uri === redirectUri) return row.client_id
  const m = await discover()
  if (!m.register) throw new Error('COROS authorization server offers no dynamic client registration')
  const r = await fetch(m.register, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    client_name: 'Lumpad (personal coach app)', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE }) })
  const t = await r.text(); if (!r.ok) throw new Error(`client registration failed (${r.status}): ${t.slice(0, 200)}`)
  const id = JSON.parse(t).client_id; if (!id) throw new Error('registration returned no client_id')
  db.prepare('INSERT INTO oauth_clients (provider, client_id, redirect_uri, created_at) VALUES (?,?,?,?) ON CONFLICT(provider) DO UPDATE SET client_id=excluded.client_id, redirect_uri=excluded.redirect_uri, created_at=excluded.created_at').run(PROVIDER, id, redirectUri, new Date().toISOString())
  return id
}

// ---- authorization code + PKCE
const pending = new Map() // state → {verifier, redirectUri, t}
export async function startAuth(redirectUri) {
  const m = await discover(), clientId = await ensureClient(redirectUri)
  const verifier = b64u(crypto.randomBytes(48)), state = b64u(crypto.randomBytes(24))
  for (const [k, v] of pending) if (Date.now() - v.t > 600000) pending.delete(k)
  pending.set(state, { verifier, redirectUri, t: Date.now() })
  const u = new URL(m.authorize)
  Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPE, state, code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', resource: m.resource }).forEach(([k, v]) => u.searchParams.set(k, v))
  return u.toString()
}
async function tokenReq(params) {
  const m = await discover(), r = await fetch(m.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(params) })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = {} }
  if (!r.ok || !j.access_token) { const e = new Error(`token endpoint ${r.status}: ${j.error || ''} ${j.error_description || ''}`.trim()); e.invalidGrant = j.error === 'invalid_grant'; throw e }
  return j
}
const save = (j, prev) => { // refresh tokens rotate: always persist the newest one before using the access token
  const rec = { access_token: j.access_token, refresh_token: j.refresh_token || prev?.refresh_token, issued: Date.now() }
  db.prepare('INSERT INTO oauth_tokens (provider, blob, expires_at, scope, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET blob=excluded.blob, expires_at=excluded.expires_at, scope=excluded.scope, updated_at=excluded.updated_at')
    .run(PROVIDER, seal(rec), Math.floor(Date.now() / 1000) + (j.expires_in || 3600), j.scope || SCOPE, new Date().toISOString())
  return rec
}
export async function finishAuth(code, state) {
  const p = pending.get(state); if (!p) throw Object.assign(new Error('unknown or expired state — start the connection again'), { status: 400 })
  pending.delete(state)
  const clientId = await ensureClient(p.redirectUri), m = await discover()
  const j = await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, client_id: clientId, code_verifier: p.verifier, resource: m.resource })
  save(j); return { ok: true, scope: j.scope, expires_in: j.expires_in, has_refresh: !!j.refresh_token }
}

// ---- access token with serialized refresh (one refresh at a time; rotation makes concurrent refreshes lethal)
let refreshing
export async function getAccessToken() {
  const row = db.prepare('SELECT blob, expires_at FROM oauth_tokens WHERE provider = ?').get(PROVIDER)
  if (!row) throw Object.assign(new Error('COROS not connected'), { status: 409, notConnected: true })
  if (row.expires_at - 300 > Date.now() / 1000) return unseal(row.blob).access_token
  refreshing ||= (async () => {
    try {
      const cur = unseal(db.prepare('SELECT blob FROM oauth_tokens WHERE provider = ?').get(PROVIDER).blob)
      if (!cur.refresh_token) throw Object.assign(new Error('no refresh token — reconnect COROS'), { status: 409, notConnected: true })
      const clientId = db.prepare('SELECT client_id FROM oauth_clients WHERE provider = ?').get(PROVIDER)?.client_id, m = await discover()
      const j = await tokenReq({ grant_type: 'refresh_token', refresh_token: cur.refresh_token, client_id: clientId, resource: m.resource })
      return save(j, cur).access_token
    } catch (e) { if (e.invalidGrant) e.notConnected = true, e.message = 'COROS login expired — reconnect (' + e.message + ')'; throw e }
    finally { refreshing = undefined }
  })()
  return refreshing
}
export function status() {
  const row = db.prepare('SELECT expires_at, scope, updated_at FROM oauth_tokens WHERE provider = ?').get(PROVIDER)
  return row ? { connected: true, access_expires_at: new Date(row.expires_at * 1000).toISOString(), scope: row.scope, updated_at: row.updated_at } : { connected: false }
}
export async function disconnect() {
  try { const t = unseal(db.prepare('SELECT blob FROM oauth_tokens WHERE provider = ?').get(PROVIDER)?.blob), m = await discover(), id = db.prepare('SELECT client_id FROM oauth_clients WHERE provider = ?').get(PROVIDER)?.client_id
    if (m.revoke && t.refresh_token) await fetch(m.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token, token_type_hint: 'refresh_token', client_id: id }) }) } catch {}
  tx(() => db.prepare('DELETE FROM oauth_tokens WHERE provider = ?').run(PROVIDER))
}
