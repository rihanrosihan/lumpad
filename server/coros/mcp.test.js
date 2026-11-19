import test from 'node:test'
import assert from 'node:assert'
import http from 'node:http'
import zlib from 'node:zlib'
process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-test-data-')); process.env.LUMPAD_TOKEN_KEY = 'ef'.repeat(32)
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { z } = await import('zod')

const seen = []
const srv = http.createServer(async (req, res) => {
  if (req.url !== '/mcp') { res.writeHead(404); return res.end() }
  if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end() } // stateless server: no SSE stream, no session teardown
  seen.push(req.headers.authorization)
  if (req.headers.authorization !== 'Bearer TOK') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"unauthorized"}') }
  let body = ''; for await (const c of req) body += c
  const s = new McpServer({ name: 'fake-coros', version: '0' })
  s.registerTool('queryDevices', { description: 'x', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'Bound Devices (1)\n\n1. COROS APEX 4 42mm\n   Bluetooth ID: AAAA' }] }))
  s.registerTool('queryDailyHealthData', { description: 'x', inputSchema: { days: z.number().optional() } }, async ({ days }) => ({ content: [{ type: 'text', text: `Daily Health Data — Last ${days} days` }] }))
  s.registerTool('boom', { description: 'x', inputSchema: {} }, async () => ({ isError: true, content: [{ type: 'text', text: 'COROS says no' }] }))
  const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); res.on('close', () => { t.close(); s.close() })
  await s.connect(t); await t.handleRequest(req, res, JSON.parse(body))
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
process.env.COROS_MCP_URL = `http://127.0.0.1:${srv.address().port}/mcp`
const { db } = await import('../store.js'), { seal } = await import('./oauth.js'), { withCoros } = await import('./mcp.js')
db.prepare("INSERT INTO oauth_tokens (provider, blob, expires_at, scope, updated_at) VALUES ('coros', ?, 9999999999, 's', 'x')").run(seal({ access_token: 'TOK', refresh_token: 'R' }))

test('SDK client sends the bearer token, returns tool text, archives the raw response gzipped', async () => {
  const out = await withCoros(async (call) => ({ a: await call('queryDevices'), b: await call('queryDailyHealthData', { days: 5 }) }), { delayMs: 0 })
  assert.match(out.a, /APEX 4/); assert.equal(out.b, 'Daily Health Data — Last 5 days')
  assert.ok(seen.length > 0 && seen.every((h) => h === 'Bearer TOK'))
  const rows = db.prepare("SELECT tool, params, body FROM raw_pulls ORDER BY id").all()
  assert.deepEqual(rows.map((r) => r.tool), ['queryDevices', 'queryDailyHealthData']); assert.equal(JSON.parse(rows[1].params).days, 5)
  assert.match(zlib.gunzipSync(rows[0].body).toString(), /APEX 4/)
})
test('tool error surfaces as an exception (not silently empty)', async () => {
  await assert.rejects(() => withCoros((call) => call('boom'), { delayMs: 0, archive: false }), /COROS says no/)
})
test('archive:false stores nothing', async () => {
  const n = db.prepare('SELECT COUNT(*) n FROM raw_pulls').get().n
  await withCoros((call) => call('queryDevices'), { delayMs: 0, archive: false }); assert.equal(db.prepare('SELECT COUNT(*) n FROM raw_pulls').get().n, n)
})
test.after(() => srv.close())
