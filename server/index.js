import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import * as strava from './strava.js'
import * as pubmed from './pubmed.js'
import * as coros from './coros.js'
import * as lib from './library.js'
import { load, save } from './db.js'
import * as corosAuth from './coros/oauth.js'
import { withCoros } from './coros/mcp.js'
import { startJob, recentJobs, isRunning, startScheduler, hooks } from './jobs.js'
import { idb, mdb } from './intel/db.js'
import { latestTwin, twinDiff } from './intel/twin.js'
import { listEdges } from './intel/corr.js'
import { listMemory, setStatus, getMemory } from './intel/memory.js'
import { runIntel, recentIntelJobs, afterSync } from './intel/run.js'
import { startIntelScheduler } from './intel/schedule.js'
import { runCoach, recentRuns, getRun, newRun, finishRun, coachStatus } from './intel/coach.js'
import { retrieveRunnerContext, renderPrompt, TASKS, OUTPUT_SCHEMA } from './intel/context.js'
import { guardStatus, resolveModel } from './intel/llm.js'
import { status as archiveStatus } from './coros/archive.js'
import { listMerged, activityDetail, gearList, setShoe, readinessData, lapsInRange, exportRows, toCsv } from './activities.js'
import { authorize, principal } from './auth.js'
import { applyIngest, checkToken, syncStatus, coverage, healthRange, activitiesRange, lapsOf, validDate } from './ingest.js'

const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
const readBody = (req, max = 20e6) => new Promise((ok, no) => { const c = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > max) { no(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy() } else c.push(d) }); req.on('end', () => ok(Buffer.concat(c))) })

const KEY = /^lumpad\.[A-Za-z0-9._-]{1,80}$/
const kvKey = (q) => { const k = q.get('key') || ''; if (!KEY.test(k)) throw Object.assign(new Error('bad key'), { status: 400 }); return k }

// schema checks for the values that feed safety and the twin (ranges, types); other keys stay free-form
function kvInvalid(k, v) {
  if (/^lumpad\.daily\.\d{4}-\d{2}-\d{2}$/.test(k)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return 'daily value must be an object'
    if (v.painSites != null) { if (typeof v.painSites !== 'object' || Array.isArray(v.painSites)) return 'painSites must be an object'; for (const x of Object.values(v.painSites)) if (typeof x !== 'number' || !(x >= 0 && x <= 10)) return 'pain must be 0–10' }
    if (v.pain != null && v.pain !== '' && !(Number(v.pain) >= 0 && Number(v.pain) <= 10)) return 'pain must be 0–10'
    if (v.energy != null && !(typeof v.energy === 'number' && v.energy >= 0 && v.energy <= 10)) return 'energy must be 0–10'
  }
  return null
}
const PREFIX = /^lumpad\.[A-Za-z0-9._-]{0,60}$/
const range = (q) => { const from = q.get('from'), to = q.get('to') || from; if (!validDate(from) || !validDate(to)) throw Object.assign(new Error('bad date range'), { status: 400 }); return [from, to] }
const baseUrl = (req) => process.env.PUBLIC_URL || `https://${req.headers.host}`
const needCoros = () => { if (!corosAuth.status().connected) throw Object.assign(new Error('COROS is not connected — connect it first in Profile'), { status: 409 }) }
const jobView = () => ({ running: isRunning(), jobs: recentJobs(8) })
const routes = {
  // --- direct COROS connection (OAuth + PKCE, tokens sealed at rest)
  'GET /api/coros/status': async () => ({ ...corosAuth.status(), mcp: corosAuth.MCP_URL(), ...jobView() }),
  'GET /api/coros/login': async (_q, req, res) => {
    let to; try { to = await corosAuth.startAuth(baseUrl(req) + '/api/coros/callback') } catch (e) { console.error('coros login:', e.message); to = '/profile?coros=error&why=' + encodeURIComponent(String(e.message).slice(0, 200)) }
    res.writeHead(302, { location: to }); res.end(); return null },
  'GET /api/coros/callback': async (q, _r, res) => {
    let ok = false; try { if (!q.get('error')) { await corosAuth.finishAuth(q.get('code'), q.get('state')); ok = true } } catch (e) { console.error('coros callback:', e.message) }
    res.writeHead(302, { location: '/profile?coros=' + (ok ? 'ok' : 'error') }); res.end(); return null },
  'POST /api/coros/test': async () => withCoros(async (call) => { const t = await call('queryDevices'); return { ok: true, devices: [...t.matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((m) => m[1].trim()) } }, { archive: false }),
  'POST /api/coros/disconnect': async () => { await corosAuth.disconnect(); return { ok: true } },
  'POST /api/sync/run': async () => { needCoros(); return { job: startJob('daily') } },
  'POST /api/sync/backfill': async (_q, req) => { needCoros(); const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}'); if (b.from && !validDate(b.from)) throw Object.assign(new Error('bad from date'), { status: 400 }); return { job: startJob('backfill', { from: b.from }) } },
  // dedicated COROS archive (coros.db): 2025→today, all tools, daily budget — progress, budget and ETA (counts/dates only)
  'GET /api/coros/archive': async () => ({ ...archiveStatus(), ...jobView() }),
  'POST /api/coros/archive/run': async () => { needCoros(); return { job: startJob('archive') } },
  'GET /api/activities/merged': async (q) => listMerged(...range(q)),
  'GET /api/activities/detail': async (q) => { const a = activityDetail(q.get('id') || ''); if (!a) throw Object.assign(new Error('not found'), { status: 404 }); return a },
  'GET /api/gear': async () => gearList(),
  'GET /api/readiness': async (q) => readinessData(...range(q)),
  'GET /api/laps': async (q) => lapsInRange(...range(q)),
  // personal data export (behind the web login): activities / health as CSV or JSON
  'GET /api/export': async (q, _r, res) => {
    const what = q.get('what') === 'health' ? 'health_daily' : 'activities', fmt = q.get('format') === 'csv' ? 'csv' : 'json'
    const rows = exportRows(what), name = `lumpad-${what}-${new Date().toISOString().slice(0, 10)}.${fmt}`
    const body = fmt === 'json' ? JSON.stringify(rows, null, 1) : toCsv(rows)
    res.writeHead(200, { 'content-type': fmt === 'json' ? 'application/json' : 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` }); res.end(body); return null },
  'GET /api/sync/jobs': async () => jobView(),
  // read-only monitoring for the sync routine / Claude (bearer token, no health values — counts and dates only)
  'GET /api/ingest/status': async (_q, req) => { checkToken(req); const a = archiveStatus(); return { ...syncStatus(), coverage: coverage(), strava: strava.status(), ...jobView(), coros: corosAuth.status(), archive: { backlog: a.backlog, etaDays: a.etaDays, complete: a.complete, healthFrom: a.healthFrom, activities: a.activities, fit: a.fit, total: a.total, tools: a.tools, buckets: a.buckets } } },
  'POST /api/ingest': async (_q, req) => { checkToken(req); return applyIngest(JSON.parse((await readBody(req, 5e6)).toString())) },
  'GET /api/sync/status': async () => syncStatus(),
  'GET /api/health/range': async (q) => healthRange(...range(q)),
  'GET /api/activities': async (q) => activitiesRange(...range(q)).map((a) => ({ ...a, laps: q.get('laps') ? lapsOf(a.id) : undefined })),
  'GET /api/kv/prefix': async (q) => { const p = q.get('prefix') || ''; if (!PREFIX.test(p)) throw Object.assign(new Error('bad prefix'), { status: 400 }); return Object.fromEntries(Object.entries(load('kv', {})).filter(([k]) => k.startsWith(p)).map(([k, v]) => [k, v.value])) },
  'GET /api/kv': async (q) => { const k = kvKey(q), e = load('kv', {})[k]; return e ? { found: true, ...e } : { found: false } },
  'PUT /api/kv': async (q, req) => {
    const k = kvKey(q), body = JSON.parse((await readBody(req, 1e6)).toString()), kv = load('kv', {})
    if (body.value === undefined) throw Object.assign(new Error('value required'), { status: 400 }) // never wipe a stored value with an empty write
    const bad = kvInvalid(k, body.value); if (bad) throw Object.assign(new Error(bad), { status: 400 })
    // append-only history of every check-in / result write (who, when, previous value): an overwrite can never erase that pain was reported
    if (/^lumpad\.(daily|results|fuel)/.test(k)) { try { const h = load('kv_history', []); h.push({ key: k, at: new Date().toISOString(), by: principal(req) || 'web', prev: kv[k]?.value ?? null }); save('kv_history', h.slice(-2000)) } catch (e) { console.error('kv_history', e.message) } }
    kv[k] = { value: body.value, updatedAt: new Date().toISOString() }; save('kv', kv); return { ok: true, updatedAt: kv[k].updatedAt }
  },
  'GET /api/health': async () => ({ ok: true }),
  // monitoring view (audit M6): freshness and failure signals in one place; counts and ages only
  'GET /api/health/deep': async () => {
    const hr = (t) => (t ? Math.round((Date.now() - Date.parse(t)) / 36e5 * 10) / 10 : null), tw = latestTwin(), j = recentIntelJobs(1)[0]
    const runs = mdb.prepare("SELECT ok FROM coach_run WHERE provider != 'safety' AND created_at >= ?").all(new Date(Date.now() - 7 * 864e5).toISOString())
    const failedSteps = recentIntelJobs(20).filter((x) => x.started_at >= new Date(Date.now() - 864e5).toISOString() && (x.status === 'partial' || x.error)).length
    return { ok: true, twin_age_h: hr(tw?.created_at), last_intel_job: j ? { kind: j.kind, status: j.status, age_h: hr(j.started_at) } : null, intel_failures_24h: failedSteps,
      coach_quality_pass_7d: (() => { const q = mdb.prepare("SELECT json_extract(parsed,'$.quality.pass') p FROM coach_run WHERE ok=1 AND provider != 'safety' AND json_extract(parsed,'$.quality') IS NOT NULL AND created_at >= ?").all(new Date(Date.now() - 7 * 864e5).toISOString()); return q.length ? { n: q.length, pass: Math.round(q.filter((x) => x.p).length / q.length * 100) / 100 } : null })(),
      coach_ok_rate_7d: runs.length ? Math.round(runs.filter((r) => r.ok).length / runs.length * 100) / 100 : null, coach_runs_7d: runs.length,
      alerts: [tw && hr(tw.created_at) > 30 ? 'twin older than 30 h' : null, failedSteps ? 'intel step failures in the last 24 h' : null].filter(Boolean) }
  },
  'GET /api/graph/node': async (q) => (await import('./neo4j.js')).node(q.get('kind') || 'races'),
  'GET /api/graph/live': async (q) => (await import('./neo4j.js')).live(q.get('view') || 'sessions'),
  'GET /api/graph/overview': async () => (await import('./neo4j.js')).overview(),
  'GET /api/data/quality': async () => {
    const cov = coverage()
    const countOf = (db, sql) => { try { return db.prepare(sql).get()?.n ?? 0 } catch { return 0 } }
    const fitSessions = countOf(idb, 'SELECT COUNT(*) AS n FROM fit_session')
    const runWeather = countOf(idb, 'SELECT COUNT(*) AS n FROM run_weather')
    const corosRuns = cov?.runs ?? fitSessions
    return {
      coros_runs: corosRuns,
      fit_sessions: fitSessions,
      missing_fit: Math.max(0, corosRuns - fitSessions),
      missing_weather: Math.max(0, fitSessions - runWeather),
      missing_shoe: cov?.missingShoe ?? 0,
      checkins_30d: countOf(idb, "SELECT COUNT(*) AS n FROM daily_log WHERE date >= date('now','-30 days')"),
      sync_runs_with_rejects: 0,
    }
  },
  'GET /api/server/info': async () => {
    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'server/data')
    const sz = (f) => { try { return Math.round((fs.statSync(path.join(dataDir, f)).size / (1024 * 1024)) * 100) / 100 } catch { return null } }
    const countOf = (db, table) => { try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? null } catch { return null } }
    return {
      nodeVersion: process.version,
      uptimeSec: Math.floor(process.uptime()),
      memRssMb: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
      dbSizesMb: { lumpad: sz('lumpad.db'), coros: sz('coros.db'), intel: sz('intel.db'), memory: sz('memory.db'), kv: sz('kv.json') },
      dbCounts: { fit_sessions: countOf(idb, 'fit_session'), run_weather: countOf(idb, 'run_weather'), daily_feat: countOf(idb, 'daily_feat'), kb_docs: countOf(idb, 'kb_docs'), memories: countOf(mdb, 'memory'), coach_runs: countOf(mdb, 'coach_run') },
      p0Guards: { backoff: true, safety: true, verifier: true },
    }
  },

  'GET /api/sources': async () => ({ strava: strava.status(), coros: coros.status(), consensus: lib.consensusStatus(), pubmed: { api: 'public' } }),
  'GET /api/strava/login': async (_q, _b, res) => { if (!strava.configured()) throw Object.assign(new Error('Set STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET'), { status: 501 }); res.writeHead(302, { location: strava.authUrl() }); res.end(); return null },
  'GET /api/strava/callback': async (q, _b, res) => { await strava.exchange(q.get('code')); res.writeHead(302, { location: '/?strava=ok' }); res.end(); return null },
  'GET /api/strava/activities': async (q) => strava.activities(q.get('after')),
  'GET /api/strava/streams': async (q) => strava.streams(+q.get('id')),
  'GET /api/strava/gear': async (q) => strava.gear(q.get('id')),
  // --- intelligence layer (docs/plan-intelligence-layer.md)
  'GET /api/twin': async (q) => latestTwin(+q.get('version') || null),
  'GET /api/twin/history': async () => idb.prepare('SELECT version, as_of, created_at, trigger, json_extract(state, \'$.readiness.score\') AS readiness, json_extract(state, \'$.load.ctl\') AS ctl, json_extract(state, \'$.aerobic.hr_at_800.value\') AS hr800 FROM twin_state ORDER BY version DESC LIMIT 90').all(),
  'GET /api/twin/diff': async (q) => ({ diff: twinDiff(+q.get('a'), +q.get('b')) }),
  'GET /api/intel/status': async () => ({ jobs: recentIntelJobs(5), busy: (await import('./intel/run.js')).isBusy(), guard: guardStatus(), model: load('deepseek_model', null), key: !!process.env.DEEPSEEK_API_KEY,
    counts: { fit_sessions: idb.prepare('SELECT COUNT(*) n FROM fit_session').get().n, weather: idb.prepare('SELECT COUNT(*) n FROM run_weather WHERE indoor=0').get().n, daily_log: idb.prepare('SELECT COUNT(*) n FROM daily_log').get().n, kb_docs: idb.prepare('SELECT COUNT(*) n FROM kb_docs').get().n,
      memory: mdb.prepare('SELECT tier, status, COUNT(*) n FROM memory GROUP BY tier, status').all(), edges: idb.prepare('SELECT status, COUNT(*) n FROM corr_edge GROUP BY status').all() }, coach_runs: recentRuns(6) }),
  'POST /api/intel/run': async (_q, req) => { const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}'), kind = b.kind === 'quick' ? 'quick' : 'full'; runIntel(kind, { trigger: 'manual' }).catch((e) => console.error('intel', e.message)); return { started: kind } },
  'GET /api/intel/session': async (q) => { const id = String(q.get('id') || '').replace(/^coros:/, ''), s = idb.prepare('SELECT * FROM fit_session WHERE label_id=? OR activity_id=?').get(id, q.get('id')); if (!s) return { found: false }
    return { found: true, ...s, metrics: JSON.parse(s.metrics), km: JSON.parse(s.km), features: undefined, similar: (await import('./intel/context.js')).similarSessions(s.label_id, 5), weather: idb.prepare('SELECT temp_c, dew_c, rh, wind_ms, rad_wm2, wbgt, indoor FROM run_weather WHERE label_id=?').get(s.label_id) || null } },
  'GET /api/intel/stream': async (q) => {
    const id = String(q.get('id') || '').replace(/^coros:/, ''); if (!id) throw Object.assign(new Error('id required'), { status: 400 })
    const s = idb.prepare('SELECT label_id FROM fit_session WHERE label_id=? OR activity_id=?').get(id, q.get('id')), label = s?.label_id || id
    const row = (await import('./coros/archive.js')).adb.prepare('SELECT path FROM fit_files WHERE label_id=?').get(label); if (!row) return { found: false }
    const S = await import('./intel/stream.js'), file = S.fitPath(row.path); if (!fs.existsSync(file)) return { found: false }
    try { return { found: true, ...(await S.streamFor(file)) } } catch (e) { return { found: false, error: String(e.message).slice(0, 120) } }
  },
  'GET /api/intel/longruns': async () => idb.prepare('SELECT s.label_id, s.activity_id, s.date, s.distance_m, s.elapsed_s, s.run_share, s.ef, s.drift_pahr, s.run_drift, s.gct_fade, s.stride_fade, s.onset_km, s.mech_abs_km, s.hr800, s.run_hr, s.gain_m, w.wbgt, w.temp_c FROM fit_session s LEFT JOIN run_weather w ON w.label_id=s.label_id WHERE s.distance_m >= 16000 ORDER BY s.date DESC LIMIT 40').all(),
  'GET /api/intel/matrices': async () => (await import('./intel/matrices.js')).matrices() || { gym_to_stride: [], z2_discipline: [], modalities: [], sessions: 0 },
  'GET /api/intel/edges': async (q) => listEdges(q.get('status') || undefined),
  'GET /api/memory': async (q) => listMemory({ tier: q.get('tier') || undefined, status: q.get('status') || undefined, kind: q.get('kind') || undefined, limit: Math.min(+q.get('limit') || 100, 300) }),
  'GET /api/memory/item': async (q) => getMemory(+q.get('id')) || { error: 'not found' },
  'POST /api/memory/action': async (_q, req) => { const b = JSON.parse((await readBody(req, 1e4)).toString()), to = { approve: 'active', retract: 'retracted', archive: 'archived' }[b.action]; if (!to) throw Object.assign(new Error('bad action'), { status: 400 }); return setStatus(+b.id, to, principal(req) || 'athlete') },
  'POST /api/coach/run': async (_q, req) => { const b = JSON.parse((await readBody(req, 2e4)).toString() || '{}'); if (!TASKS[b.intent || 'daily_brief']) throw Object.assign(new Error('bad intent'), { status: 400 }); return runCoach({ intent: b.intent || 'daily_brief', question: String(b.question || '').slice(0, 1000), activityId: b.activity_id || null, force: b.force === true }) },
  'GET /api/coach/status': async (q) => { const i = q.get('intent') || 'daily_brief'; if (!TASKS[i]) throw Object.assign(new Error('bad intent'), { status: 400 }); return coachStatus({ intent: i, question: String(q.get('question') || '').slice(0, 1000), activityId: q.get('activity_id') || null }) },
  'GET /api/coach/runs': async () => recentRuns(20),
  // every session that has a successful coach review (the activity feed badge used to look only at the last 20 runs of any kind)
  // newest successful review for one question (e.g. "session <id>"), however old: the run list above only holds the last 20 runs
  'GET /api/coach/latest': async (q) => mdb.prepare("SELECT id, created_at FROM coach_run WHERE intent='session_review' AND ok=1 AND question=? ORDER BY id DESC LIMIT 1").get(String(q.get('question') || '').slice(0, 200)) || null,
  'GET /api/coach/analysed': async () => mdb.prepare("SELECT DISTINCT question FROM coach_run WHERE intent='session_review' AND ok=1 AND question LIKE 'session %'").all().map((r) => r.question),
  'GET /api/coach/run': async (q) => getRun(+q.get('id')) || { error: 'not found' },
  // pull mode for a Claude routine / Claude Code: context out, answer back (same validation + write-back hook as DeepSeek)
  // free preview of what retrieval would send (no model call): counts, retrieved items, the decomposed query and the split telemetry it attached
  'GET /api/coach/preview': async (q) => {
    const intent = TASKS[q.get('intent')] ? q.get('intent') : 'daily_brief', ctx = retrieveRunnerContext({ intent, question: String(q.get('question') || '').slice(0, 1000) }), v = ctx.volatile
    const item = (i) => ({ id: i.id, title: i.title, why: i.why })
    return { schema: ctx.schema, tokens_est: ctx.tokens_est, rules_count: ctx.stable.rules.length, episodes: v.episodes.map(item), facts: v.facts.map(item), query: v.query, edges: v.correlation_edges.length,
      telemetry: v.telemetry.map((t) => ({ date: t.date, km: t.km_total, splits: t.km.length })), twin_version: v.twin_version } },
  'GET /api/coach/context': async (q, req) => { checkToken(req); const intent = TASKS[q.get('intent')] ? q.get('intent') : 'daily_brief', ctx = retrieveRunnerContext({ intent, question: q.get('question') || '', activityId: q.get('activity') || null }), prompt = renderPrompt(ctx, TASKS[intent])
    return { run_id: newRun({ intent, provider: 'claude-code', ctx, prompt, question: q.get('question') }), ...prompt, output_schema: OUTPUT_SCHEMA, item_ids: ctx.item_ids } },
  'POST /api/coach/writeback': async (_q, req) => { checkToken(req); const b = JSON.parse((await readBody(req, 2e5)).toString()); const row = mdb.prepare('SELECT provider, ok FROM coach_run WHERE id=?').get(+b.run_id); if (!row || row.provider !== 'claude-code' || row.ok) throw Object.assign(new Error('run not open for write-back'), { status: 409 }); return finishRun(+b.run_id, b.answer, { provider: 'claude-code', raw: JSON.stringify(b.answer) }) },
  // shoe assigned by hand on the Activity page: written to every record of the merged activity (COROS + its Strava twin) so Twin & FIT see it
  'POST /api/activities/shoe': async (_q, req) => {
    const b = JSON.parse((await readBody(req, 1e4)).toString() || '{}'), id = String(b.id || ''), a = activityDetail(id)
    if (!a) throw Object.assign(new Error('not found'), { status: 404 })
    const g = b.gear_id == null || b.gear_id === '' ? null : String(b.gear_id)
    if (g && !gearList().some((x) => String(x.id) === g)) throw Object.assign(new Error('unknown shoe'), { status: 400 })
    return { ok: true, gear_id: g, ids: setShoe(a.ids || [id], g) } },
  'POST /api/strava/sync-shoes': async () => strava.syncShoes(),
  'GET /api/pubmed/search': async (q) => pubmed.search(q.get('q') || '', Math.min(+q.get('max') || 8, 20)),
  'POST /api/coros/fit': async (_q, req) => { const a = await coros.parseFit(await readBody(req)); save('coros_acts', [a, ...load('coros_acts', [])].slice(0, 500)); return a },
  'GET /api/coros/activities': async () => load('coros_acts', []),
  'GET /api/coros/plan': async () => load('coros_plan', { rows: null, at: null }),
  'GET /api/library': async () => lib.list(),
  'POST /api/library': async (_q, req) => lib.add(JSON.parse((await readBody(req, 1e5)).toString())),
  'DELETE /api/library': async (q) => lib.remove(q.get('id')),
  // weather during one run (Open-Meteo, already stored per session) + the air and weather right now at that 0.1° cell (Google, when configured)
  'GET /api/env/activity': async (q) => {
    const id = String(q.get('id') || '').replace(/^coros:/, ''), s = idb.prepare('SELECT label_id, lat1, lon1 FROM fit_session WHERE label_id=? OR activity_id=?').get(id, q.get('id'))
    if (!s) return { found: false }
    const run = idb.prepare('SELECT temp_c, dew_c, rh, wind_ms, rad_wm2, wbgt, indoor FROM run_weather WHERE label_id=?').get(s.label_id) || null
    let now = null
    if (s.lat1 != null && s.lon1 != null) { const G = await import('./google.js'); if (G.configured()) { try { now = await G.conditions(s.lat1, s.lon1) } catch {} } }
    return { found: true, run, now, cell: s.lat1 != null ? `${(Math.round(s.lat1 * 10) / 10).toFixed(1)},${(Math.round(s.lon1 * 10) / 10).toFixed(1)}` : null }
  },
  'GET /api/map/status': async () => { const G = await import('./google.js'); return G.status() },
  'GET /api/map/tile': async (q, req, res) => {
    const G = await import('./google.js'), t = await G.tile(q)
    res.writeHead(200, { 'content-type': t.type, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' }); res.end(t.body); return null
  },
  'GET /api/env/conditions': async (q) => {
    const G = await import('./google.js'); if (!G.configured()) return { available: false, reason: 'no key' }
    let lat = q.get('lat'), lon = q.get('lon')
    if (lat == null || lon == null) { const r = idb.prepare('SELECT lat1, lon1 FROM fit_session WHERE lat1 IS NOT NULL ORDER BY date DESC, start_ms DESC LIMIT 1').get(); if (!r) return { available: false, reason: 'no GPS run yet' }; lat = r.lat1; lon = r.lon1 }
    try { return await G.conditions(lat, lon) } catch (e) { if (e.status === 400) throw e; return { available: false, reason: e.message } }
  },
  // ---- Google Maps Platform, beyond tiles and current conditions (server/google_geo.js). Coarse ones send a 0.1° cell; route ones need GOOGLE_ROUTE_DATA=1.
  'GET /api/geo/capabilities': async () => { const G = await import('./google.js'), N = await import('./google_geo.js'); return { configured: G.configured(), route_data: N.routeAllowed() } },
  'GET /api/geo/place': async (q) => (await import('./google_geo.js')).placeName(q.get('lat'), q.get('lon')),
  'GET /api/geo/timezone': async (q) => (await import('./google_geo.js')).timeZoneAt(q.get('lat'), q.get('lon'), q.get('ts') ? Number(q.get('ts')) : undefined),
  'GET /api/env/window': async (q) => { const [la, lo] = await hereCell(q); return (await import('./google_geo.js')).runWindow(la, lo) },
  'GET /api/env/airforecast': async (q) => { const [la, lo] = await hereCell(q); return (await import('./google_geo.js')).airForecast(la, lo) },
  'GET /api/env/airhistory': async (q) => { const [la, lo] = await hereCell(q); return (await import('./google_geo.js')).airHistory(la, lo, Number(q.get('hours')) || 24, {}, q.get('ts') ? Number(q.get('ts')) : null) },
  'GET /api/geo/elevation': async (q) => (await import('./google_geo.js')).elevationProfile(await routeOf(q.get('id'))),
  'GET /api/geo/snap': async (q) => (await import('./google_geo.js')).snapToRoads(await routeOf(q.get('id'))),
  'GET /api/geo/places': async (q) => (await import('./google_geo.js')).placesAlong(await routeOf(q.get('id')), q.get('kind') || 'water'),
  'GET /api/geo/loop': async (q) => { const [la, lo] = await hereCell(q); return (await import('./google_geo.js')).planLoop(la, lo, Number(q.get('km')), { bearing: Number(q.get('bearing')) || 0, water: q.get('water') !== '0' }) },
  'GET /api/geo/route': async (q) => (await import('./google_geo.js')).travelTime([+q.get('olat'), +q.get('olon')], [+q.get('dlat'), +q.get('dlon')], q.get('depart') || undefined),
  'GET /api/map/static': async (q, req, res) => {
    // one Google call per activity and size, kept in memory afterwards (the card list asks for many thumbnails; the browser also caches them for a day)
    const id = String(q.get('id') || ''), size = q.get('s') === 'thumb' ? 'thumb' : 'full', k = id + '|' + size
    const N = await import('./google_geo.js'); let t = staticCache.get(k)
    if (!t) { t = await N.staticRouteMap(await routeOf(id), { size }); staticCache.set(k, t); if (staticCache.size > 200) staticCache.delete(staticCache.keys().next().value) }
    res.writeHead(200, { 'content-type': t.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' }); res.end(t.body); return null
  },
  'GET /api/geo/streetview': async (q, req, res) => { const t = await (await import('./google_geo.js')).streetView(+q.get('lat'), +q.get('lon'), Number(q.get('heading')) || 0); res.writeHead(200, { 'content-type': t.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' }); res.end(t.body); return null },
  'GET /api/google/probe': async () => { const G = await import('./google.js'); if (!G.configured()) return { configured: false }; return G.probe() },
  'GET /api/v2/sub4': async (_q, req) => { try { const r = await fetch('http://127.0.0.1:8788/api/v2/sub4', { headers: userHdr(req) }); if (r.ok) return await r.json() } catch {} return { ok: false, offline: true } },
  'GET /api/v2/decisions': async (q, req) => { try { const qs = q.toString(); const r = await fetch('http://127.0.0.1:8788/api/v2/decisions' + (qs ? '?' + qs : ''), { headers: userHdr(req) }); if (r.ok) return await r.json() } catch {} return { items: [], offline: true } },
}

const userHdr = (req) => (principal(req) ? { 'x-lumpad-user': principal(req) } : {})
const staticCache = new Map()
// lat/lon from the query, else the place of the last GPS run (rounded later to 0.1° by the callers)
async function hereCell(q) {
  if (q.get('lat') != null && q.get('lon') != null) return [Number(q.get('lat')), Number(q.get('lon'))]
  const r = idb.prepare('SELECT lat1, lon1 FROM fit_session WHERE lat1 IS NOT NULL ORDER BY date DESC, start_ms DESC LIMIT 1').get()
  if (!r) throw Object.assign(new Error('no GPS run yet'), { status: 404 })
  return [r.lat1, r.lon1]
}
// the real route (lat/lon points) of one activity from its FIT file
async function routeOf(id) {
  const key = String(id || '').replace(/^coros:/, ''); if (!key) throw Object.assign(new Error('id required'), { status: 400 })
  const s = idb.prepare('SELECT label_id FROM fit_session WHERE label_id=? OR activity_id=?').get(key, id), label = s?.label_id || key
  const row = (await import('./coros/archive.js')).adb.prepare('SELECT path FROM fit_files WHERE label_id=?').get(label); if (!row) throw Object.assign(new Error('no FIT file for this activity'), { status: 404 })
  const S = await import('./intel/stream.js'), file = S.fitPath(row.path); if (!fs.existsSync(file)) throw Object.assign(new Error('FIT file missing'), { status: 404 })
  const route = (await S.streamFor(file)).route; if (!route || route.length < 2) throw Object.assign(new Error('this activity has no GPS route'), { status: 404 }); return route
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), h = routes[`${req.method} ${u.pathname}`]
  if (!h) return send(res, 404, { error: 'not found' })
  const denied = authorize(req, u.pathname); if (denied) return send(res, denied.status, { error: denied.error })
  // CSRF: browsers attach Basic-auth credentials to cross-site requests, so state-changing calls must carry a custom header
  // (impossible for a cross-site form/img; fetch from our own origin adds it). /api/ingest authenticates with its own bearer token.
  if (req.method !== 'GET' && u.pathname !== '/api/ingest' && req.headers['x-lumpad'] !== '1') return send(res, 403, { error: 'missing X-Lumpad header' })
  try { const out = await h(u.searchParams, req, res); if (out !== null) send(res, 200, out) }
  catch (e) { const st = e.status || 500; if (st >= 500) console.error(req.method, u.pathname, e.message); send(res, st, { error: st >= 500 ? 'internal error (see server log)' : e.message }) }
}).listen(process.env.PORT || 8787, '127.0.0.1', () => { console.log('lumpad api :' + (process.env.PORT || 8787)); if (process.env.SCHEDULER !== 'off') { startScheduler(); startIntelScheduler(); hooks.afterJob = () => afterSync() } })
