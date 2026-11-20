import test from 'node:test'
import assert from 'node:assert/strict'
process.env.GOOGLE_MAPS_API_KEY = 'AIzaTESTKEYTESTKEYTESTKEYTESTKEY12'
process.env.GOOGLE_DAILY_CAP = '5'
const G = await import('./google.js')
const hdr = (t) => ({ get: () => t })
test('tile: creates one session, reuses it, passes the image through; the key goes only upstream', async () => {
  const urls = []
  const fetchFn = async (url, opt) => {
    urls.push(String(url))
    if (String(url).includes('createSession')) return { ok: true, status: 200, json: async () => ({ session: 'S1', expiry: String(Math.floor(Date.now() / 1000) + 3600) }) }
    return { ok: true, status: 200, headers: hdr('image/png'), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
  }
  G.resetSession()
  const a = await G.tile(new URLSearchParams('z=14&x=13000&y=8000'), { fetchFn }), b = await G.tile(new URLSearchParams('z=14&x=13001&y=8000'), { fetchFn })
  assert.deepEqual([...a.body], [1, 2, 3]); assert.equal(a.type, 'image/png'); assert.equal(urls.filter((u) => u.includes('createSession')).length, 1)
  assert.ok(urls[1].startsWith('https://tile.googleapis.com/v1/2dtiles/14/13000/8000?session=S1&key=')); assert.ok(b)
})
test('tile: bad coordinates are rejected before any upstream call', async () => {
  const fetchFn = async () => { throw new Error('must not be called') }
  for (const qs of ['z=99&x=1&y=1', 'z=3&x=8&y=0', 'z=3&x=-1&y=0', 'z=a&x=1&y=1', 'z=3&x=1.5&y=1', 'z=3&x=1/../../y&y=1']) await assert.rejects(G.tile(new URLSearchParams(qs), { fetchFn }), (e) => e.status === 400)
})
test('daily cap stops upstream calls', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, headers: hdr('image/png'), arrayBuffer: async () => new ArrayBuffer(1), json: async () => ({ session: 'S2', expiry: String(Math.floor(Date.now() / 1000) + 3600) }) })
  G.resetSession(); let err
  for (let i = 0; i < 10 && !err; i++) { try { await G.tile(new URLSearchParams('z=5&x=1&y=1'), { fetchFn }) } catch (e) { err = e } }
  assert.equal(err?.status, 429); assert.ok(G.status().used_today <= 5)
})
test('shapeConditions: reads the real Google shapes (current weather + air quality with a local index)', async () => {
  const w = { currentTime: '2026-11-20T04:00:00Z', weatherCondition: { description: { text: 'Cloudy' } }, temperature: { degrees: 30.2 }, feelsLikeTemperature: { degrees: 35.3 }, dewPoint: { degrees: 23.9 }, relativeHumidity: 70, uvIndex: 6, isDaytime: true, cloudCover: 90,
    precipitation: { probability: { percent: 15 } }, wind: { direction: { degrees: 160 }, speed: { value: 9, unit: 'KILOMETERS_PER_HOUR' } } }
  const a = { dateTime: '2026-11-20T04:00:00Z', indexes: [{ code: 'uaqi', aqi: 53, category: 'Moderate air quality', dominantPollutant: 'pm25' }, { code: 'idn_menlhk', displayName: 'ISPU (ID)', aqi: 55, category: 'Moderate air quality' }], pollutants: [{ code: 'pm25', concentration: { value: 31.41 } }] }
  const c = (await import('./google.js')).shapeConditions(w, a)
  assert.equal(c.weather.temp_c, 30.2); assert.equal(c.weather.wind_kmh, 9); assert.equal(c.weather.rain_pct, 15); assert.ok(c.weather.wbgt_shade > 25 && c.weather.wbgt_shade < 35)
  assert.equal(c.air.universal.aqi, 53); assert.equal(c.air.local.name, 'ISPU (ID)'); assert.equal(c.air.local.aqi, 55); assert.equal(c.air.pm25, 31.41)
  assert.equal((await import('./google.js')).shapeConditions(null, null).weather, null) // missing parts never throw
})
test('conditions: rounds to 0.1° (privacy), rejects bad coordinates, caches per cell', async () => {
  const G = await import('./google.js'); process.env.GOOGLE_DAILY_CAP = '1000'; const urls = []
  const fetchFn = async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({ temperature: { degrees: 30 }, relativeHumidity: 70, indexes: [] }) } }
  await G.conditions(-7.6123456, 110.2987654, { fetchFn }); await G.conditions(-7.6, 110.3, { fetchFn })
  assert.ok(urls.every((u) => !/7\.6123|110\.2987/.test(u))); assert.ok(urls[0].includes('location.latitude=-7.6&location.longitude=110.3')); assert.equal(urls.length, 2) // second call served from the cache
  await assert.rejects(G.conditions(95, 0, { fetchFn }), (e) => e.status === 400)
})
