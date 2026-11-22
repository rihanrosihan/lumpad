import test from 'node:test'
import assert from 'node:assert/strict'
import { authorize, principal } from './auth.js'
const req = (method, user) => ({ method, headers: user ? { 'x-lumpad-user': user } : {} })
test('off by default: nothing changes until LUMPAD_REQUIRE_USER=1', () => assert.equal(authorize(req('GET'), '/api/twin', {}), null))
test('required: anonymous calls are refused, including the state-changing ones', () => {
  const env = { LUMPAD_REQUIRE_USER: '1' }
  for (const [m, p] of [['GET', '/api/twin'], ['PUT', '/api/kv'], ['POST', '/api/memory/action'], ['POST', '/api/coach/run'], ['GET', '/api/export']]) assert.equal(authorize(req(m), p, env).status, 401, m + ' ' + p)
})
test('required: the stamped user passes; health and the token-protected ingest stay reachable', () => {
  const env = { LUMPAD_REQUIRE_USER: '1' }
  assert.equal(authorize(req('GET', 'rihan'), '/api/twin', env), null)
  for (const [m, p] of [['GET', '/api/health'], ['POST', '/api/ingest'], ['GET', '/api/ingest/status']]) assert.equal(authorize(req(m), p, env), null)
  assert.equal(authorize(req('GET'), '/api/health/deep', env).status, 401)
})
test('a malformed user header is not a principal', () => assert.equal(principal(req('GET', 'a b;drop')), null))
