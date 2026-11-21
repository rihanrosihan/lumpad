// Google Maps Platform gateway. The key lives only in the server environment (GOOGLE_MAPS_API_KEY in /opt/lumpad/.env) and never reaches the
// browser or the repository: map tiles are fetched here and passed through, so the page CSP (img-src 'self') does not change.
// PRIVACY: only what a call needs leaves the server, coordinates rounded to 0.1° for conditions (like weather.js); never routes or times.
// COST: every upstream call counts against a daily cap (GOOGLE_DAILY_CAP, default 4000) so a bug or a loop cannot run up a bill.
const API = 'https://tile.googleapis.com'
const day = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) // WIB day
export const apiKey = () => key()
const key = () => (process.env.GOOGLE_MAPS_API_KEY || '').trim()
export const configured = () => /^[A-Za-z0-9_-]{20,80}$/.test(key())
const cap = () => Math.max(0, Number(process.env.GOOGLE_DAILY_CAP) || 4000)
const used = { day: '', n: 0, by: {} }
export function spend(kind) {
  if (used.day !== day()) { used.day = day(); used.n = 0; used.by = {} }
  if (used.n >= cap()) throw Object.assign(new Error(`Google daily cap reached (${cap()} calls)`), { status: 429 })
  used.n++; used.by[kind] = (used.by[kind] || 0) + 1
}
export const status = () => { if (used.day !== day()) { used.day = day(); used.n = 0; used.by = {} } return { configured: configured(), used_today: used.n, cap: cap(), by: { ...used.by } } }

const TYPES = { roadmap: { mapType: 'roadmap' }, satellite: { mapType: 'satellite' }, terrain: { mapType: 'terrain', layerTypes: ['layerRoadmap'] } }
const sessions = {} // map type -> { token, exp (ms) }
export async function tileSession({ fetchFn = fetch, type = 'roadmap' } = {}) {
  const sess = sessions[type]
  if (sess && sess.exp - Date.now() > 300e3) return sess.token
  spend('session')
  const r = await fetchFn(`${API}/v1/createSession?key=${encodeURIComponent(key())}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(TYPES[type] || TYPES.roadmap), language: 'en-US', region: 'ID' }), signal: AbortSignal.timeout(10000) })
  if (!r.ok) throw Object.assign(new Error('google createSession ' + r.status), { status: 502 })
  const j = await r.json(); if (!j.session) throw Object.assign(new Error('google createSession: no session'), { status: 502 })
  sessions[type] = { token: j.session, exp: (Number(j.expiry) || Date.now() / 1000 + 3600) * 1000 }
  return j.session
}
export const resetSession = () => { for (const k of Object.keys(sessions)) delete sessions[k] }

const intIn = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null }
// returns { status, type, body (Buffer) }; z/x/y are validated so the query cannot be bent into another upstream path
export async function tile(q, { fetchFn = fetch } = {}) {
  if (!configured()) throw Object.assign(new Error('GOOGLE_MAPS_API_KEY not set'), { status: 503 })
  const z = intIn(q.get('z'), 0, 21); if (z == null) throw Object.assign(new Error('bad z'), { status: 400 })
  const x = intIn(q.get('x'), 0, 2 ** z - 1), y = intIn(q.get('y'), 0, 2 ** z - 1); if (x == null || y == null) throw Object.assign(new Error('bad x/y'), { status: 400 })
  const type = Object.hasOwn(TYPES, q.get('t')) ? q.get('t') : 'roadmap'
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await tileSession({ fetchFn, type }); spend('tile')
    const r = await fetchFn(`${API}/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(token)}&key=${encodeURIComponent(key())}`, { signal: AbortSignal.timeout(10000) })
    if (r.status === 400 || r.status === 403) { if (attempt === 0) { resetSession(); continue } }
    if (!r.ok) throw Object.assign(new Error('google tile ' + r.status), { status: 502 })
    return { type: r.headers.get('content-type') || 'image/png', body: Buffer.from(await r.arrayBuffer()) }
  }
  throw Object.assign(new Error('google tile: session rejected'), { status: 502 })
}

// Diagnostic for the other APIs (shapes are checked on the real server before any parsing is written): which keys come back, never the key itself.
export async function probe({ lat = -7.6, lon = 110.2, fetchFn = fetch } = {}) {
  const out = {}, la = Math.round(lat * 10) / 10, lo = Math.round(lon * 10) / 10
  const call = async (name, url, init) => {
    try { spend('probe'); const r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(10000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {}
      out[name] = { http: r.status, keys: j && typeof j === 'object' ? Object.keys(j) : null, sample: j ? JSON.stringify(j).slice(0, 700) : t.slice(0, 200) } }
    catch (e) { out[name] = { error: e.message } }
  }
  const k = encodeURIComponent(key())
  await call('weather_current', `https://weather.googleapis.com/v1/currentConditions:lookup?key=${k}&location.latitude=${la}&location.longitude=${lo}`)
  await call('weather_hours', `https://weather.googleapis.com/v1/forecast/hours:lookup?key=${k}&location.latitude=${la}&location.longitude=${lo}&hours=6`)
  await call('air_current', `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location: { latitude: la, longitude: lo }, extraComputations: ['LOCAL_AQI', 'DOMINANT_POLLUTANT_CONCENTRATION'] }) })
  await call('elevation', `https://maps.googleapis.com/maps/api/elevation/json?locations=${la},${lo}&key=${k}`)
  await call('geocode', `https://maps.googleapis.com/maps/api/geocode/json?latlng=${la},${lo}&key=${k}`)
  await call('timezone', `https://maps.googleapis.com/maps/api/timezone/json?location=${la},${lo}&timestamp=${Math.floor(Date.now() / 1000)}&key=${k}`)
  await call('air_forecast', `https://airquality.googleapis.com/v1/forecast:lookup?key=${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location: { latitude: la, longitude: lo }, period: { startTime: new Date(Math.floor(Date.now() / 3600e3) * 3600e3).toISOString(), endTime: new Date(Math.floor(Date.now() / 3600e3) * 3600e3 + 6 * 3600e3).toISOString() } }) })
  await call('air_history', `https://airquality.googleapis.com/v1/history:lookup?key=${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location: { latitude: la, longitude: lo }, hours: 3 }) })
  await call('roads', `https://roads.googleapis.com/v1/snapToRoads?path=${la},${lo}|${la + 0.001},${lo + 0.001}&interpolate=true&key=${k}`)
  await call('places', 'https://places.googleapis.com/v1/places:searchNearby', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key(), 'X-Goog-FieldMask': 'places.id,places.displayName' }, body: JSON.stringify({ maxResultCount: 1, locationRestriction: { circle: { center: { latitude: la, longitude: lo }, radius: 300 } } }) })
  await call('routes', 'https://routes.googleapis.com/directions/v2:computeRoutes', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key(), 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' }, body: JSON.stringify({ origin: { location: { latLng: { latitude: la, longitude: lo } } }, destination: { location: { latLng: { latitude: la + 0.02, longitude: lo + 0.02 } } }, travelMode: 'DRIVE' }) })
  return out
}

// ---- current conditions at a 0.1° cell: Google Weather (current) + Air Quality (universal AQI and the local index, e.g. ISPU in Indonesia).
// Response shapes were checked on the real server via /api/google/probe. WBGT is the same shade approximation as weather.js (a lower bound in the sun).
import { wbgtShade } from './intel/weather.js'
const memo = new Map() // cell → { at, v }
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const kmh = (w) => { const v = num(w?.speed?.value); if (v == null) return null; const u = w.speed.unit; return u === 'MILES_PER_HOUR' ? +(v * 1.609).toFixed(1) : +v.toFixed(1) }
export function shapeConditions(w, a) {
  const t = num(w?.temperature?.degrees), rh = num(w?.relativeHumidity), idx = Array.isArray(a?.indexes) ? a.indexes : []
  const uaqi = idx.find((i) => i.code === 'uaqi'), local = idx.find((i) => i.code !== 'uaqi'), pm = (a?.pollutants || []).find((p) => p.code === 'pm25')
  return {
    available: true, at: w?.currentTime || a?.dateTime || null,
    weather: w ? { text: w.weatherCondition?.description?.text || null, temp_c: t, feels_c: num(w.feelsLikeTemperature?.degrees), dew_c: num(w.dewPoint?.degrees), rh, wind_kmh: kmh(w.wind), uv: num(w.uvIndex),
      rain_pct: num(w.precipitation?.probability?.percent), cloud_pct: num(w.cloudCover), daytime: typeof w.isDaytime === 'boolean' ? w.isDaytime : null, wbgt_shade: t != null && rh != null ? +wbgtShade(t, rh).toFixed(1) : null } : null,
    air: a ? { universal: uaqi ? { aqi: num(uaqi.aqi), category: uaqi.category || null, dominant: uaqi.dominantPollutant || null } : null, local: local ? { name: local.displayName || local.code, aqi: num(local.aqi), category: local.category || null } : null,
      pm25: pm ? num(pm.concentration?.value) : null } : null,
  }
}
export async function conditions(lat, lon, { fetchFn = fetch, ttlMs = 20 * 60e3 } = {}) {
  if (!configured()) throw Object.assign(new Error('GOOGLE_MAPS_API_KEY not set'), { status: 503 })
  const la = Math.round(Number(lat) * 10) / 10, lo = Math.round(Number(lon) * 10) / 10
  if (!(Math.abs(la) <= 90) || !(Math.abs(lo) <= 180) || !Number.isFinite(la) || !Number.isFinite(lo)) throw Object.assign(new Error('bad coordinates'), { status: 400 })
  const cell = `${la.toFixed(1)},${lo.toFixed(1)}`, hit = memo.get(cell)
  if (hit && Date.now() - hit.at < ttlMs) return hit.v
  const k = encodeURIComponent(key()), get = async (url, init) => { spend('conditions'); try { const r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(10000) }); return r.ok ? await r.json() : null } catch { return null } }
  const [w, a] = await Promise.all([
    get(`https://weather.googleapis.com/v1/currentConditions:lookup?key=${k}&location.latitude=${la}&location.longitude=${lo}`),
    get(`https://airquality.googleapis.com/v1/currentConditions:lookup?key=${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location: { latitude: la, longitude: lo }, extraComputations: ['LOCAL_AQI', 'DOMINANT_POLLUTANT_CONCENTRATION'] }) }),
  ])
  if (!w && !a) throw Object.assign(new Error('google conditions unavailable'), { status: 502 })
  const v = { ...shapeConditions(w, a), cell }; memo.set(cell, { at: Date.now(), v }); return v
}
