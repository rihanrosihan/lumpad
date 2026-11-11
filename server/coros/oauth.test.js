import test from 'node:test'
import assert from 'node:assert'
import http from 'node:http'
import crypto from 'node:crypto'
process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = '/tmp/lumpad-test-data'
process.env.LUMPAD_TOKEN_KEY = 'ab'.repeat(32)

// ---- fake COROS authorization server (shape taken from the real discovery documents)
let reg = 0, tokenCalls = [], mode = 'ok'
const srv = http.createServer((req, res) => {
  const o = `http://127.0.0.1:${srv.address().port}`, send = (c, b) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    if (req.url.startsWith('/.well-known/oauth-protected-resource')) return send(200, { resource: o + '/mcp', authorization_servers: [o], scopes_supported: ['openid', 'mcp.tools', 'offline_access'] })
    if (req.url === '/.well-known/oauth-authorization-server') return send(200, { issuer: o, authorization_endpoint: o + '/oauth2/authorize', token_endpoint: o + '/oauth2/token', registration_endpoint: o + '/connect/register', revocation_endpoint: o + '/oauth2/revoke', code_challenge_methods_supported: ['S256'] })
    if (req.url === '/connect/register') { reg++; const j = JSON.parse(body); assert.deepEqual(j.redirect_uris, ['https://lumpad.example/api/coros/callback']); assert.equal(j.token_endpoint_auth_method, 'none'); return send(201, { client_id: 'client-' + reg }) }
    if (req.url === '/oauth2/token') {
      const p = Object.fromEntries(new URLSearchParams(body)); tokenCalls.push(p)
      if (p.grant_type === 'authorization_code') { const ch = crypto.createHash('sha256').update(p.code_verifier).digest('base64url'); if (ch !== srv.challenge) return send(400, { error: 'invalid_grant' }); return send(200, { access_token: 'acc.1', refresh_token: 'ref.1', expires_in: 2592000, scope: 'openid mcp.tools offline_access' }) }
      if (p.grant_type === 'refresh_token') { if (mode === 'revoked') return send(400, { error: 'invalid_grant', error_description: 'refresh token revoked' }); return send(200, { access_token: 'acc.' + tokenCalls.length, refresh_token: 'ref.' + tokenCalls.length, expires_in: 2592000 }) }
    }
    send(404, {})
  })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
process.env.COROS_MCP_URL = `http://127.0.0.1:${srv.address().port}/mcp`
const o = await import('./oauth.js'), { db } = await import('../store.js')
const REDIR = 'https://lumpad.example/api/coros/callback'

test('seal/unseal round-trips and rejects tampering', () => {
  const s = o.seal({ a: 1, secret: 'x' }); assert.deepEqual(o.unseal(s), { a: 1, secret: 'x' }); assert.ok(!s.includes('secret'))
  const t = Buffer.from(s, 'base64url'); t[t.length - 1] ^= 1; assert.throws(() => o.unseal(t.toString('base64url')))
})
test('authorization URL carries PKCE S256, scope, resource, state; client registered once', async () => {
  const u = new URL(await o.startAuth(REDIR)), q = u.searchParams
  assert.equal(q.get('code_challenge_method'), 'S256'); assert.equal(q.get('response_type'), 'code'); assert.equal(q.get('client_id'), 'client-1')
  assert.match(q.get('scope'), /offline_access/); assert.match(q.get('resource'), /\/mcp$/); assert.ok(q.get('state').length > 20)
  srv.challenge = q.get('code_challenge'); srv.state = q.get('state')
  await o.startAuth(REDIR); assert.equal(reg, 1) // second start reuses the registered client
})
test('callback: wrong state refused; right state exchanges code with the verifier and stores sealed tokens', async () => {
  await assert.rejects(() => o.finishAuth('c', 'bogus'), /unknown or expired state/)
  const r = await o.finishAuth('code123', srv.state); assert.equal(r.ok, true); assert.equal(r.has_refresh, true)
  const row = db.prepare('SELECT blob FROM oauth_tokens').get(); assert.ok(!row.blob.includes('acc.1') && !row.blob.includes('ref.1')) // sealed at rest ('.' never occurs in base64url, so no false positives)
  assert.equal(o.status().connected, true); assert.equal(await o.getAccessToken(), 'acc.1')
})
test('refresh when near expiry: rotates the refresh token and persists it; concurrent callers share one refresh', async () => {
  db.prepare('UPDATE oauth_tokens SET expires_at = ?').run(Math.floor(Date.now() / 1000) + 60); const before = tokenCalls.length
  const [a, b] = await Promise.all([o.getAccessToken(), o.getAccessToken()])
  assert.equal(a, b); assert.equal(tokenCalls.length - before, 1)
  assert.equal(tokenCalls.at(-1).refresh_token, 'ref.1'); assert.equal(o.unseal(db.prepare('SELECT blob FROM oauth_tokens').get().blob).refresh_token, 'ref.' + tokenCalls.length)
})
test('revoked refresh token → "reconnect" error flagged notConnected', async () => {
  db.prepare('UPDATE oauth_tokens SET expires_at = ?').run(Math.floor(Date.now() / 1000) + 60); mode = 'revoked'
  await assert.rejects(() => o.getAccessToken(), (e) => e.notConnected === true && /reconnect/.test(e.message))
})
test('no key configured → refuses to store tokens', async () => { const k = process.env.LUMPAD_TOKEN_KEY; delete process.env.LUMPAD_TOKEN_KEY; assert.throws(() => o.seal({}), /LUMPAD_TOKEN_KEY/); process.env.LUMPAD_TOKEN_KEY = k })
test.after(() => srv.close())
