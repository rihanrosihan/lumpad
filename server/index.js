import http from 'node:http'
import * as strava from './strava.js'
import * as pubmed from './pubmed.js'
import * as coros from './coros.js'
import * as lib from './library.js'
import { load, save } from './db.js'

const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
const readBody = (req, max = 20e6) => new Promise((ok, no) => { const c = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > max) { no(new Error('too large')); req.destroy() } else c.push(d) }); req.on('end', () => ok(Buffer.concat(c))) })

const KEY = /^lumpad\.[A-Za-z0-9._-]{1,80}$/
const kvKey = (q) => { const k = q.get('key') || ''; if (!KEY.test(k)) throw Object.assign(new Error('bad key'), { status: 400 }); return k }

const PREFIX = /^lumpad\.[A-Za-z0-9._-]{0,60}$/
const routes = {
  'GET /api/kv/prefix': async (q) => { const p = q.get('prefix') || ''; if (!PREFIX.test(p)) throw Object.assign(new Error('bad prefix'), { status: 400 }); return Object.fromEntries(Object.entries(load('kv', {})).filter(([k]) => k.startsWith(p)).map(([k, v]) => [k, v.value])) },
  'GET /api/kv': async (q) => { const k = kvKey(q), e = load('kv', {})[k]; return e ? { found: true, ...e } : { found: false } },
  'PUT /api/kv': async (q, req) => {
    const k = kvKey(q), body = JSON.parse((await readBody(req, 1e6)).toString()), kv = load('kv', {})
    kv[k] = { value: body.value, updatedAt: new Date().toISOString() }; save('kv', kv); return { ok: true, updatedAt: kv[k].updatedAt }
  },
  'GET /api/health': async () => ({ ok: true }),
  'GET /api/sources': async () => ({ strava: strava.status(), coros: coros.status(), consensus: lib.consensusStatus(), pubmed: { api: 'public' } }),
  'GET /api/strava/login': async (_q, _b, res) => { if (!strava.configured()) throw Object.assign(new Error('Set STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET'), { status: 501 }); res.writeHead(302, { location: strava.authUrl() }); res.end(); return null },
  'GET /api/strava/callback': async (q, _b, res) => { await strava.exchange(q.get('code')); res.writeHead(302, { location: '/?strava=ok' }); res.end(); return null },
  'GET /api/strava/activities': async (q) => strava.activities(q.get('after')),
  'GET /api/strava/streams': async (q) => strava.streams(+q.get('id')),
  'GET /api/strava/gear': async (q) => strava.gear(q.get('id')),
  'GET /api/pubmed/search': async (q) => pubmed.search(q.get('q') || '', Math.min(+q.get('max') || 8, 20)),
  'POST /api/coros/fit': async (_q, req) => { const a = await coros.parseFit(await readBody(req)); save('coros_acts', [a, ...load('coros_acts', [])].slice(0, 500)); return a },
  'GET /api/coros/activities': async () => load('coros_acts', []),
  'GET /api/library': async () => lib.list(),
  'POST /api/library': async (_q, req) => lib.add(JSON.parse((await readBody(req, 1e5)).toString())),
  'DELETE /api/library': async (q) => lib.remove(q.get('id')),
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), h = routes[`${req.method} ${u.pathname}`]
  if (!h) return send(res, 404, { error: 'not found' })
  try { const out = await h(u.searchParams, req, res); if (out !== null) send(res, 200, out) }
  catch (e) { send(res, e.status || 500, { error: e.message }) }
}).listen(process.env.PORT || 8787, '127.0.0.1', () => console.log('lumpad api :' + (process.env.PORT || 8787)))
