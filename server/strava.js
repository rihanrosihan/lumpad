// Strava public API v3 (OAuth2). Requires STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / PUBLIC_URL in env.
// Rate limits not verified — responses are cached and we surface X-RateLimit headers.
import { load, save } from './db.js'
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
  save('strava_token', { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, athlete: j.athlete?.id ?? load('strava_token', {}).athlete })
}
export const exchange = (code) => tokenReq({ code, grant_type: 'authorization_code' })
async function token() {
  let t = load('strava_token', null)
  if (!t) throw Object.assign(new Error('not connected'), { status: 401 })
  if (t.expires_at - 60 < Date.now() / 1000) { await tokenReq({ grant_type: 'refresh_token', refresh_token: t.refresh_token }); t = load('strava_token') }
  return t.access_token
}
async function get(path) {
  const r = await fetch(API + path, { headers: { authorization: 'Bearer ' + (await token()) } })
  if (!r.ok) throw Object.assign(new Error('strava ' + r.status), { status: r.status === 429 ? 429 : 502 })
  return { data: await r.json(), limit: r.headers.get('x-ratelimit-usage') }
}
export const status = () => ({ configured: configured(), connected: !!load('strava_token', null) })
// Normalised: distance in m, time in s — keeps "belum ditarik" semantics (pulledAt on every record).
export async function activities(after) {
  const { data } = await get(`/athlete/activities?per_page=100${after ? '&after=' + after : ''}`)
  const pulledAt = new Date().toISOString()
  const acts = data.map((a) => ({ id: a.id, name: a.name, type: a.sport_type, date: a.start_date_local, distance: a.distance, moving: a.moving_time, hr: a.average_heartrate ?? null, gear: a.gear_id ?? null, source: 'strava', pulledAt }))
  save('strava_acts', acts); return acts
}
export const streams = (id) => get(`/activities/${id}/streams?keys=time,distance,heartrate,cadence,watts,velocity_smooth&key_by_type=true`).then((r) => r.data)
export const gear = (id) => get('/gear/' + id).then((r) => r.data) // mileage shown in gear.distance (m)
