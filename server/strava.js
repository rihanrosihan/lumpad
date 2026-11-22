// Strava public API v3 (OAuth2). Requires STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / PUBLIC_URL in env.
// Rate limits not verified — responses are cached and we surface X-RateLimit headers.
import { load, save } from './db.js'
import { db } from './store.js'
import { seal, unseal } from './coros/oauth.js'
import { gearKey } from './gearkey.js'
const API = 'https://www.strava.com/api/v3', TOK = 'https://www.strava.com/oauth/token'
const cfg = () => ({ id: process.env.STRAVA_CLIENT_ID, secret: process.env.STRAVA_CLIENT_SECRET, base: process.env.PUBLIC_URL || 'http://localhost:5173' })
export const configured = () => !!(cfg().id && cfg().secret)

export function authUrl() {
  const { id, base } = cfg()
  const q = new URLSearchParams({ client_id: id, redirect_uri: base + '/api/strava/callback', response_type: 'code', approval_prompt: 'auto', scope: 'read,activity:read_all,profile:read_all' })
  return `https://www.strava.com/oauth/authorize?${q}`
}
async function tokenReq(body) {
  const { id, secret } = cfg()
  const r = await fetch(TOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: id, client_secret: secret, ...body }) })
  if (!r.ok) throw new Error('strava token ' + r.status)
  const j = await r.json()
  putToken({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, athlete: j.athlete?.id ?? getToken()?.athlete })
}
// tokens are sealed at rest (AES-256-GCM, key LUMPAD_TOKEN_KEY) in oauth_tokens, like COROS; the old plain strava_token.json is migrated once and removed
function getToken() {
  const row = db.prepare("SELECT blob FROM oauth_tokens WHERE provider='strava'").get()
  if (row) return unseal(row.blob)
  const old = load('strava_token', null); if (old) { putToken(old); save('strava_token', null) ; return old }
  return null
}
function putToken(t) { db.prepare("INSERT INTO oauth_tokens (provider, blob, expires_at, scope, updated_at) VALUES ('strava', ?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET blob=excluded.blob, expires_at=excluded.expires_at, updated_at=excluded.updated_at").run(seal(t), t.expires_at, 'read,activity:read_all,profile:read_all', new Date().toISOString()) }
export const exchange = (code) => tokenReq({ code, grant_type: 'authorization_code' })
async function token() {
  let t = getToken()
  if (!t) throw Object.assign(new Error('not connected'), { status: 401 })
  if (t.expires_at - 60 < Date.now() / 1000) { await tokenReq({ grant_type: 'refresh_token', refresh_token: t.refresh_token }); t = getToken() }
  return t.access_token
}
async function get(path) {
  const r = await fetch(API + path, { headers: { authorization: 'Bearer ' + (await token()) } })
  if (!r.ok) throw Object.assign(new Error('strava ' + r.status), { status: r.status === 429 ? 429 : 502 })
  return { data: await r.json(), limit: r.headers.get('x-ratelimit-usage') }
}
export const status = () => { let c = false; try { c = !!getToken() } catch {} return { configured: configured(), connected: c } }
// Normalised: distance in m, time in s — keeps "belum ditarik" semantics (pulledAt on every record).
export async function activities(after) {
  const { data } = await get(`/athlete/activities?per_page=100${after ? '&after=' + after : ''}`)
  const pulledAt = new Date().toISOString()
  const acts = data.map((a) => ({ id: a.id, name: a.name, type: a.sport_type, date: a.start_date_local, distance: a.distance, moving: a.moving_time, hr: a.average_heartrate ?? null, gear: a.gear_id ?? null, source: 'strava', pulledAt }))
  save('strava_acts', acts); return acts
}
export const streams = (id) => get(`/activities/${id}/streams?keys=time,distance,heartrate,cadence,watts,velocity_smooth&key_by_type=true`).then((r) => r.data)
export const gear = (id) => get('/gear/' + id).then((r) => r.data) // mileage shown in gear.distance (m)

// ---- shoe backfill (Lumpad intelligence layer P0.2): Strava knows the shoe of each run, COROS does not.
// Pages through the activity list (200/page, ~3 calls for 2025→today), matches runs to COROS activities by start time (±3 min)
// and writes activities.gear_id on the COROS row; the shoe list (name, brand, mileage) goes to the gear table. Read calls only.
const RUNS = new Set(['Run', 'TrailRun', 'VirtualRun'])
// Options (defaults = the nightly behaviour): `sources` = which activity rows get a shoe (the Garmin history import passes ['garmin']), `writeGear` = also refresh the gear table, `dry` = match only, write nothing.
export async function syncShoes({ since = '2025-01-01', fetchFn = get, maxPages = 8, sources = ['coros'], writeGear = true, dry = false, returnHits = false } = {}) {
  const after = Math.floor(Date.parse(since + 'T00:00:00Z') / 1000), list = []
  for (let page = 1; page <= maxPages; page++) { const { data } = await fetchFn(`/athlete/activities?per_page=200&page=${page}&after=${after}`); list.push(...data); if (data.length < 200) break }
  const prof = await fetchFn('/athlete').then((r) => r.data).catch(() => ({}))
  const shoes = (prof.shoes || []).map((g) => ({ id: gearKey(g.id), name: g.name || g.nickname || g.id, brand: g.brand_name || '', model: g.model_name || '', distance_m: g.distance || 0, retired: !!g.retired }))
  const coros = db.prepare(`SELECT id, start_ts, distance_m FROM activities WHERE source IN (${sources.map(() => '?').join(',')}) AND start_ts IS NOT NULL AND date >= ?`).all(...sources, since)
  let matched = 0, noGear = 0; const unmatched = [], hits = []
  for (const a of list) {
    if (!RUNS.has(a.sport_type || a.type)) continue
    if (!a.gear_id) { noGear++; continue }
    const ts = Math.floor(Date.parse(a.start_date) / 1000), c = coros.filter((x) => Math.abs(x.start_ts - ts) <= 180).sort((x, y) => Math.abs(x.start_ts - ts) - Math.abs(y.start_ts - ts))[0]
    if (c) { if (!dry) db.prepare('UPDATE activities SET gear_id=? WHERE id=?').run(gearKey(a.gear_id), c.id); matched++; hits.push({ id: c.id, gear_id: gearKey(a.gear_id) }) } else unmatched.push(a.id)
  }
  if (writeGear && !dry) for (const g of shoes) db.prepare('INSERT INTO gear (id, name, brand, model, distance_m, retired, pulled_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, brand=excluded.brand, model=excluded.model, distance_m=excluded.distance_m, retired=excluded.retired, pulled_at=excluded.pulled_at').run(g.id, g.name, g.brand, g.model, g.distance_m, g.retired ? 1 : 0, new Date().toISOString())
  const runs = db.prepare("SELECT COUNT(*) n, SUM(gear_id IS NOT NULL) g FROM activities WHERE source='coros' AND sport='Run' AND date >= '2026-01-01'").get()
  return { stravaActivities: list.length, matched, noGear, unmatched: unmatched.length, shoes: shoes.length, ...(returnHits ? { hits } : {}), coverage2026: runs.n ? Math.round((100 * runs.g) / runs.n) : null }
}
