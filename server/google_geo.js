// The rest of the Google Maps Platform, behind the same gateway (key in .env, daily cap counted per call, nothing reaches the browser but results).
// Two privacy levels:
//   coarse  : only a 0.1° cell (~11 km) leaves the server  -> place names, time zone, forecasts (always available when the key is set)
//   route   : real route points / exact places leave the server -> elevation, road snapping, places along a route, Street View, static route map,
//             travel time. OFF unless GOOGLE_ROUTE_DATA=1 is set in .env.
// Response shapes follow Google's documentation as I know it; /api/google/probe shows the real ones on the server, and every parser here tolerates a
// missing field (it returns null/[] instead of throwing).
import { spend, configured, apiKey } from './google.js'
import { wbgtShade } from './intel/weather.js'

const fail = (msg, status) => Object.assign(new Error(msg), { status })
export const routeAllowed = () => process.env.GOOGLE_ROUTE_DATA === '1'
export const needKey = () => { if (!configured()) throw fail('GOOGLE_MAPS_API_KEY not set', 503) }
export const needRoute = () => { needKey(); if (!routeAllowed()) throw fail('route data to Google is off: set GOOGLE_ROUTE_DATA=1 in /opt/lumpad/.env to allow it', 403) }
const cell = (x) => Math.round(Number(x) * 10) / 10
const okLatLon = (la, lo) => Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180
const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
async function call(kind, url, init = {}, { fetchFn = fetch, binary = false } = {}) {
  spend(kind)
  const r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(12000) })
  if (!r.ok) throw fail(`google ${kind} ${r.status}`, 502)
  return binary ? { type: r.headers?.get?.('content-type') || 'image/png', body: Buffer.from(await r.arrayBuffer()) } : r.json()
}
const memo = new Map()
const cached = async (k, ttl, fn) => { const h = memo.get(k); if (h && Date.now() - h.at < ttl) return h.v; const v = await fn(); memo.set(k, { at: Date.now(), v }); if (memo.size > 300) memo.delete(memo.keys().next().value); return v }

// ---- coarse -------------------------------------------------------------------------------------------------------------------------------
export async function placeName(lat, lon, o = {}) {
  needKey(); const la = cell(lat), lo = cell(lon); if (!okLatLon(la, lo)) throw fail('bad coordinates', 400)
  return cached(`geo:${la},${lo}`, 7 * 864e5, async () => {
    const j = await call('geocode', `https://maps.googleapis.com/maps/api/geocode/json?${q({ latlng: `${la},${lo}`, result_type: 'sublocality|locality|administrative_area_level_3', key: apiKey() })}`, {}, o)
    const comp = (j.results?.[0]?.address_components || []), pick = (t) => comp.find((c) => c.types?.includes(t))?.long_name
    const name = pick('sublocality_level_1') || pick('sublocality') || pick('locality') || pick('administrative_area_level_3') || null, region = pick('administrative_area_level_1') || null
    return { cell: `${la.toFixed(1)},${lo.toFixed(1)}`, name, region, label: [name, region].filter(Boolean).join(', ') || null }
  })
}
export async function timeZoneAt(lat, lon, ts = Math.floor(Date.now() / 1000), o = {}) {
  needKey(); const la = cell(lat), lo = cell(lon); if (!okLatLon(la, lo)) throw fail('bad coordinates', 400)
  const j = await call('timezone', `https://maps.googleapis.com/maps/api/timezone/json?${q({ location: `${la},${lo}`, timestamp: Math.floor(ts), key: apiKey() })}`, {}, o)
  return { id: j.timeZoneId || null, name: j.timeZoneName || null, utc_offset_s: Number.isFinite(j.rawOffset) ? j.rawOffset + (j.dstOffset || 0) : null }
}
// next hours of weather -> the best hour to run: lowest shade WBGT between 04:00 and 21:00 local, daylight hours only
export function bestWindow(hours) {
  const rows = (hours || []).map((h) => {
    const t = h.temperature?.degrees, rh = h.relativeHumidity, dt = h.displayDateTime
    return { hour: Number.isFinite(dt?.hours) ? dt.hours : null, start: h.interval?.startTime || null, temp_c: Number.isFinite(t) ? t : null, rh: Number.isFinite(rh) ? rh : null, rain_pct: h.precipitation?.probability?.percent ?? null, uv: h.uvIndex ?? null, daytime: h.isDaytime ?? null,
      wbgt: Number.isFinite(t) && Number.isFinite(rh) ? +wbgtShade(t, rh).toFixed(1) : null }
  }).filter((r) => r.wbgt != null && r.hour != null && r.hour >= 4 && r.hour <= 21 && r.daytime !== false) // dark hours are not offered as a run window
  const ranked = [...rows].sort((a, b) => a.wbgt - b.wbgt || (a.rain_pct ?? 0) - (b.rain_pct ?? 0))
  return { best: ranked.slice(0, 3).sort((a, b) => a.hour - b.hour), hours: rows }
}
export async function runWindow(lat, lon, o = {}) {
  needKey(); const la = cell(lat), lo = cell(lon); if (!okLatLon(la, lo)) throw fail('bad coordinates', 400)
  return cached(`win:${la},${lo}`, 30 * 60e3, async () => {
    const j = await call('weather_forecast', `https://weather.googleapis.com/v1/forecast/hours:lookup?${q({ key: apiKey(), 'location.latitude': la, 'location.longitude': lo, hours: 24 })}`, {}, o)
    return { cell: `${la.toFixed(1)},${lo.toFixed(1)}`, ...bestWindow(j.forecastHours) }
  })
}
const idx = (list) => { const u = (list || []).find((i) => i.code === 'uaqi'), l = (list || []).find((i) => i.code !== 'uaqi'); return { universal: u ? { aqi: u.aqi ?? null, category: u.category ?? null } : null, local: l ? { name: l.displayName || l.code, aqi: l.aqi ?? null, category: l.category ?? null } : null } }
export async function airForecast(lat, lon, o = {}) {
  needKey(); const la = cell(lat), lo = cell(lon); if (!okLatLon(la, lo)) throw fail('bad coordinates', 400)
  return cached(`aqf:${la},${lo}`, 60 * 60e3, async () => {
    const next = new Date(Math.ceil((Date.now() + 60e3) / 3600e3) * 3600e3), now = next, end = new Date(next.getTime() + 24 * 3600e3), hr = (d) => d.toISOString() // a forecast period must start in the future (Google answers 400 otherwise)
    const j = await call('air_forecast', 'https://airquality.googleapis.com/v1/forecast:lookup?' + q({ key: apiKey() }), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location: { latitude: la, longitude: lo }, period: { startTime: hr(now), endTime: hr(end) }, extraComputations: ['LOCAL_AQI'] }) }, o)
    return { cell: `${la.toFixed(1)},${lo.toFixed(1)}`, hours: (j.hourlyForecasts || []).map((h) => ({ at: h.dateTime || null, ...idx(h.indexes) })) }
  })
}
export async function airHistory(lat, lon, hours = 24, o = {}) {
  needKey(); const la = cell(lat), lo = cell(lon); if (!okLatLon(la, lo)) throw fail('bad coordinates', 400)
  const n = Math.max(1, Math.min(720, Math.floor(hours)))
  return cached(`aqh:${la},${lo},${n}`, 60 * 60e3, async () => {
    const j = await call('air_history', 'https://airquality.googleapis.com/v1/history:lookup?' + q({ key: apiKey() }), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location: { latitude: la, longitude: lo }, hours: n, extraComputations: ['LOCAL_AQI'] }) }, o)
    return { cell: `${la.toFixed(1)},${lo.toFixed(1)}`, hours: (j.hoursInfo || []).map((h) => ({ at: h.dateTime || null, ...idx(h.indexes) })) }
  })
}

// ---- route data (opt-in) ----------------------------------------------------------------------------------------------------------------------
export const thin = (pts, n) => { if (pts.length <= n) return pts; const k = (pts.length - 1) / (n - 1); return Array.from({ length: n }, (_, i) => pts[Math.round(i * k)]) }
export function encodePolyline(pts) { // Google's encoded polyline format, 5 decimals
  let la = 0, lo = 0, out = ''
  const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5 } return s + String.fromCharCode(v + 63) }
  for (const [a, b] of pts) { const x = Math.round(a * 1e5), y = Math.round(b * 1e5); out += enc(x - la) + enc(y - lo); la = x; lo = y }
  return out
}
const path = (pts) => pts.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join('|')
export async function elevationProfile(route, o = {}) {
  needRoute(); const pts = thin(route, 100); if (pts.length < 2) return { points: [] }
  const j = await call('elevation', `https://maps.googleapis.com/maps/api/elevation/json?${q({ path: path(pts), samples: pts.length, key: apiKey() })}`, {}, o)
  const el = (j.results || []).map((r) => (Number.isFinite(r.elevation) ? +r.elevation.toFixed(1) : null))
  let gain = 0, loss = 0; for (let i = 1; i < el.length; i++) if (el[i] != null && el[i - 1] != null) { const d = el[i] - el[i - 1]; if (d > 0) gain += d; else loss -= d }
  return { points: el, gain_m: Math.round(gain), loss_m: Math.round(loss), source: 'google elevation (display only)' }
}
export async function snapToRoads(route, o = {}) {
  needRoute(); const pts = thin(route, 100); if (pts.length < 2) return { points: [] }
  const j = await call('roads', `https://roads.googleapis.com/v1/snapToRoads?${q({ path: path(pts), interpolate: 'true', key: apiKey() })}`, {}, o)
  return { points: (j.snappedPoints || []).map((p) => [p.location?.latitude, p.location?.longitude]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)) }
}
const PLACE_TYPES = { water: ['convenience_store', 'supermarket'], toilets: ['public_bathroom'], medical: ['hospital', 'pharmacy'] }
export async function placesAlong(route, kind = 'water', o = {}) {
  needRoute(); const types = PLACE_TYPES[kind]; if (!types) throw fail('kind must be water, toilets or medical', 400)
  const samples = thin(route, 6), seen = new Map()
  for (const [la, lo] of samples) {
    const j = await call('places', 'https://places.googleapis.com/v1/places:searchNearby', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.types' },
      body: JSON.stringify({ includedTypes: types, maxResultCount: 5, locationRestriction: { circle: { center: { latitude: la, longitude: lo }, radius: 400 } } }) }, o)
    for (const p of j.places || []) if (p.id && !seen.has(p.id)) seen.set(p.id, { id: p.id, name: p.displayName?.text || null, lat: p.location?.latitude ?? null, lon: p.location?.longitude ?? null, types: p.types || [] })
  }
  return { kind, places: [...seen.values()], attribution: 'Places data © Google' } // only the place id and a name are kept, per the Places terms
}
export async function travelTime(from, to, departIso, o = {}) {
  needRoute(); if (!okLatLon(...from) || !okLatLon(...to)) throw fail('bad coordinates', 400)
  const body = { origin: { location: { latLng: { latitude: from[0], longitude: from[1] } } }, destination: { location: { latLng: { latitude: to[0], longitude: to[1] } } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', ...(departIso ? { departureTime: departIso } : {}) }
  const j = await call('routes', 'https://routes.googleapis.com/directions/v2:computeRoutes', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters' }, body: JSON.stringify(body) }, o)
  const r = j.routes?.[0], secs = (d) => { const m = /^(\d+(?:\.\d+)?)s$/.exec(d || ''); return m ? Math.round(+m[1]) : null }
  return r ? { minutes_traffic: secs(r.duration) != null ? Math.round(secs(r.duration) / 60) : null, minutes_free_flow: secs(r.staticDuration) != null ? Math.round(secs(r.staticDuration) / 60) : null, km: r.distanceMeters != null ? +(r.distanceMeters / 1000).toFixed(1) : null } : { minutes_traffic: null }
}
// thumb: small card thumbnail (160x110 @2x, quiet style, thin line); full: share-card size
export async function staticRouteMap(route, o = {}) {
  needRoute(); const pts = thin(route, 120); if (pts.length < 2) throw fail('no route', 404)
  const thumb = o.size === 'thumb', quiet = ['style=feature:poi|visibility:off', 'style=feature:transit|visibility:off']
  const params = [q({ size: thumb ? '160x110' : '640x360', scale: 2, maptype: 'roadmap', path: `color:0xF26B5Bff|weight:${thumb ? 3 : 4}|enc:${encodePolyline(pts)}`, key: apiKey() }), ...(thumb ? quiet.map((x) => x.replace(/\|/g, '%7C')) : [])]
  return call('static_map', `https://maps.googleapis.com/maps/api/staticmap?${params.join('&')}`, {}, { ...o, binary: true })
}
export async function streetView(lat, lon, heading = 0, o = {}) {
  needRoute(); if (!okLatLon(lat, lon)) throw fail('bad coordinates', 400)
  return call('street_view', `https://maps.googleapis.com/maps/api/streetview?${q({ size: '600x300', location: `${(+lat).toFixed(5)},${(+lon).toFixed(5)}`, heading: Math.round(heading) % 360, fov: 90, key: apiKey() })}`, {}, { ...o, binary: true })
}

// ---- loop planner (route data, opt-in): an out-and-back-free circuit of about `km` from a start, by walking routes through three waypoints ------------------------
export function decodePolyline(str) {
  const pts = []; let i = 0, la = 0, lo = 0
  while (i < str.length) {
    for (const axis of [0, 1]) { let sh = 0, r = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5 } while (b >= 0x20 && i <= str.length); const d = r & 1 ? ~(r >> 1) : r >> 1; if (axis === 0) la += d; else lo += d }
    pts.push([la / 1e5, lo / 1e5])
  }
  return pts
}
// three waypoints on a circle of radius rKm around the start, rotated by `bearingDeg`
export function loopWaypoints(lat, lon, rKm, bearingDeg = 0) {
  return [0, 120, 240].map((a) => { const t = ((a + bearingDeg) * Math.PI) / 180; return [lat + (rKm * Math.cos(t)) / 110.574, lon + (rKm * Math.sin(t)) / (111.32 * Math.cos((lat * Math.PI) / 180))] })
}
async function walkVia(start, via, o) {
  const ll = ([la, lo]) => ({ location: { latLng: { latitude: la, longitude: lo } } }), body = { origin: ll(start), destination: ll(start), intermediates: via.map(ll), travelMode: 'WALK' }
  const j = await call('routes', 'https://routes.googleapis.com/directions/v2:computeRoutes', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': 'routes.distanceMeters,routes.polyline.encodedPolyline' }, body: JSON.stringify(body) }, o)
  const r = j.routes?.[0]; if (!r?.polyline?.encodedPolyline) return null
  return { km: (r.distanceMeters || 0) / 1000, points: decodePolyline(r.polyline.encodedPolyline) }
}
export async function planLoop(lat, lon, km, { bearing = 0, water = true, ...o } = {}) {
  needRoute(); if (!okLatLon(lat, lon)) throw fail('bad coordinates', 400)
  const want = Number(km); if (!(want >= 3 && want <= 45)) throw fail('km must be 3–45', 400)
  let rKm = want / 6.75, got = await walkVia([lat, lon], loopWaypoints(lat, lon, rKm, bearing), o)       // 3√3·R × ~1.3 road winding ≈ 6.75·R
  if (!got) throw fail('no walkable loop found here', 404)
  if (Math.abs(got.km - want) / want > 0.1) { rKm *= want / got.km; got = (await walkVia([lat, lon], loopWaypoints(lat, lon, rKm, bearing), o)) || got } // one correction pass
  const pts = thin(got.points, 300), elevation = await elevationProfile(pts, o).catch(() => null)
  const places = water ? await placesAlong(pts, 'water', o).catch(() => null) : null
  return { km: +got.km.toFixed(1), requested_km: want, start: [lat, lon], points: pts, elevation, water: places?.places || [], attribution: 'Routes, elevation and places data © Google' }
}
