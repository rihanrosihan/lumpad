import http from 'node:http'
import * as strava from './strava.js'
import * as pubmed from './pubmed.js'
import * as coros from './coros.js'
import * as lib from './library.js'
import { load, save } from './db.js'
import * as corosAuth from './coros/oauth.js'
import { withCoros } from './coros/mcp.js'
import { startJob, recentJobs, isRunning, startScheduler } from './jobs.js'
import { applyIngest, checkToken, syncStatus, healthRange, activitiesRange, lapsOf, validDate } from './ingest.js'

const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
const readBody = (req, max = 20e6) => new Promise((ok, no) => { const c = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > max) { no(new Error('too large')); req.destroy() } else c.push(d) }); req.on('end', () => ok(Buffer.concat(c))) })

const KEY = /^lumpad\.[A-Za-z0-9._-]{1,80}$/
const kvKey = (q) => { const k = q.get('key') || ''; if (!KEY.test(k)) throw Object.assign(new Error('bad key'), { status: 400 }); return k }

const PREFIX = /^lumpad\.[A-Za-z0-9._-]{0,60}$/
const range = (q) => { const from = q.get('from'), to = q.get('to') || from; if (!validDate(from) || !validDate(to)) throw Object.assign(new Error('bad date range'), { status: 400 }); return [from, to] }
const baseUrl = (req) => process.env.PUBLIC_URL || `https://${req.headers.host}`
const needCoros = () => { if (!corosAuth.status().connected) throw Object.assign(new Error('COROS belum terhubung — hubungkan dulu di Profil'), { status: 409 }) }
const jobView = () => ({ running: isRunning(), jobs: recentJobs(8) })
const routes = {
  // --- direct COROS connection (OAuth + PKCE, tokens sealed at rest)
  'GET /api/coros/status': async () => ({ ...corosAuth.status(), mcp: corosAuth.MCP_URL(), ...jobView() }),
  'GET /api/coros/login': async (_q, req, res) => {
    let to; try { to = await corosAuth.startAuth(baseUrl(req) + '/api/coros/callback') } catch (e) { console.error('coros login:', e.message); to = '/?coros=error&why=' + encodeURIComponent(String(e.message).slice(0, 200)) + '#/profile' }
    res.writeHead(302, { location: to }); res.end(); return null },
  'GET /api/coros/callback': async (q, _r, res) => {
    let ok = false; try { if (!q.get('error')) { await corosAuth.finishAuth(q.get('code'), q.get('state')); ok = true } } catch (e) { console.error('coros callback:', e.message) }
    res.writeHead(302, { location: '/?coros=' + (ok ? 'ok' : 'error') + '#/profile' }); res.end(); return null },
  'POST /api/coros/test': async () => withCoros(async (call) => { const t = await call('queryDevices'); return { ok: true, devices: [...t.matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((m) => m[1].trim()) } }, { archive: false }),
  'POST /api/coros/disconnect': async () => { await corosAuth.disconnect(); return { ok: true } },
  'POST /api/sync/run': async () => { needCoros(); return { job: startJob('daily') } },
  'POST /api/sync/backfill': async (_q, req) => { needCoros(); const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}'); if (b.from && !validDate(b.from)) throw Object.assign(new Error('bad from date'), { status: 400 }); return { job: startJob('backfill', { from: b.from }) } },
  'GET /api/sync/jobs': async () => jobView(),
  // read-only monitoring for the sync routine / Claude (bearer token, no health values — counts and dates only)
  'GET /api/ingest/status': async (_q, req) => { checkToken(req); return { ...syncStatus(), ...jobView(), coros: corosAuth.status() } },
  'POST /api/ingest': async (_q, req) => { checkToken(req); return applyIngest(JSON.parse((await readBody(req, 5e6)).toString())) },
  'GET /api/sync/status': async () => syncStatus(),
  'GET /api/health/range': async (q) => healthRange(...range(q)),
  'GET /api/activities': async (q) => activitiesRange(...range(q)).map((a) => ({ ...a, laps: q.get('laps') ? lapsOf(a.id) : undefined })),
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
  // CSRF: browsers attach Basic-auth credentials to cross-site requests, so state-changing calls must carry a custom header
  // (impossible for a cross-site form/img; fetch from our own origin adds it). /api/ingest authenticates with its own bearer token.
  if (req.method !== 'GET' && u.pathname !== '/api/ingest' && req.headers['x-lumpad'] !== '1') return send(res, 403, { error: 'missing X-Lumpad header' })
  try { const out = await h(u.searchParams, req, res); if (out !== null) send(res, 200, out) }
  catch (e) { send(res, e.status || 500, { error: e.message }) }
}).listen(process.env.PORT || 8787, '127.0.0.1', () => { console.log('lumpad api :' + (process.env.PORT || 8787)); if (process.env.SCHEDULER !== 'off') startScheduler() })
