// Google Maps Platform gateway. The key lives only in the server environment (GOOGLE_MAPS_API_KEY in /opt/lumpad/.env) and never reaches the
// browser or the repository: map tiles are fetched here and passed through, so the page CSP (img-src 'self') does not change.
// PRIVACY: only what a call needs leaves the server, coordinates rounded to 0.1° for conditions (like weather.js); never routes or times.
// COST: every upstream call counts against a daily cap (GOOGLE_DAILY_CAP, default 4000) so a bug or a loop cannot run up a bill.
const API = 'https://tile.googleapis.com'
const day = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) // WIB day
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

let sess = null // { token, exp (ms) }
export async function tileSession({ fetchFn = fetch } = {}) {
  if (sess && sess.exp - Date.now() > 300e3) return sess.token
  spend('session')
  const r = await fetchFn(`${API}/v1/createSession?key=${encodeURIComponent(key())}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mapType: 'roadmap', language: 'en-US', region: 'ID' }), signal: AbortSignal.timeout(10000) })
  if (!r.ok) throw Object.assign(new Error('google createSession ' + r.status), { status: 502 })
  const j = await r.json(); if (!j.session) throw Object.assign(new Error('google createSession: no session'), { status: 502 })
  sess = { token: j.session, exp: (Number(j.expiry) || Date.now() / 1000 + 3600) * 1000 }
  return sess.token
}
export const resetSession = () => { sess = null }

const intIn = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null }
// returns { status, type, body (Buffer) }; z/x/y are validated so the query cannot be bent into another upstream path
export async function tile(q, { fetchFn = fetch } = {}) {
  if (!configured()) throw Object.assign(new Error('GOOGLE_MAPS_API_KEY not set'), { status: 503 })
  const z = intIn(q.get('z'), 0, 21); if (z == null) throw Object.assign(new Error('bad z'), { status: 400 })
  const x = intIn(q.get('x'), 0, 2 ** z - 1), y = intIn(q.get('y'), 0, 2 ** z - 1); if (x == null || y == null) throw Object.assign(new Error('bad x/y'), { status: 400 })
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await tileSession({ fetchFn }); spend('tile')
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
  return out
}
