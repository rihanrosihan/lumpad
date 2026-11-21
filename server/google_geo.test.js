import test from 'node:test'
import assert from 'node:assert/strict'
process.env.GOOGLE_MAPS_API_KEY = 'AIzaTESTKEYTESTKEYTESTKEYTESTKEY12'
process.env.GOOGLE_DAILY_CAP = '100000'
delete process.env.GOOGLE_ROUTE_DATA
const N = await import('./google_geo.js')
const json = (j) => async () => ({ ok: true, status: 200, json: async () => j })
const route = Array.from({ length: 300 }, (_, i) => [-7.6 + i * 1e-4, 110.2 + i * 1e-4])

test('encodePolyline matches Google\'s documented example', () => {
  assert.equal(N.encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]), '_p~iF~ps|U_ulLnnqC_mqNvxq`@')
})
test('thin keeps the first and last point and at most n points', () => {
  const t = N.thin(route, 100); assert.equal(t.length, 100); assert.deepEqual(t[0], route[0]); assert.deepEqual(t.at(-1), route.at(-1))
})
test('route-level calls are refused until GOOGLE_ROUTE_DATA=1, and nothing is sent', async () => {
  const fetchFn = async () => { throw new Error('must not be called') }
  for (const f of [() => N.elevationProfile(route, { fetchFn }), () => N.snapToRoads(route, { fetchFn }), () => N.placesAlong(route, 'water', { fetchFn }), () => N.staticRouteMap(route, { fetchFn }), () => N.streetView(-7.6, 110.2, 0, { fetchFn }), () => N.travelTime([-7.6, 110.2], [-7.5, 110.3], null, { fetchFn })])
    await assert.rejects(f(), (e) => e.status === 403)
})
test('place name and time zone only send a 0.1° cell and parse the documented shape', async () => {
  const urls = []
  const f1 = async (u) => { urls.push(String(u)); return { ok: true, json: async () => ({ results: [{ address_components: [{ long_name: 'Jatisari', types: ['sublocality_level_1'] }, { long_name: 'West Java', types: ['administrative_area_level_1'] }] }] }) } }
  const p = await N.placeName(-6.2412345, 106.9987654, { fetchFn: f1 })
  assert.equal(p.label, 'Jatisari, West Java'); assert.ok(urls[0].includes('latlng=-6.2%2C107') || urls[0].includes('latlng=-6.2,107')); assert.ok(!/6\.2412|106\.9987/.test(urls[0]))
  const z = await N.timeZoneAt(-8.4, 115.2, 1e9, { fetchFn: json({ timeZoneId: 'Asia/Makassar', timeZoneName: 'Central Indonesia Time', rawOffset: 28800, dstOffset: 0 }) })
  assert.deepEqual([z.id, z.utc_offset_s], ['Asia/Makassar', 28800])
  await assert.rejects(N.placeName(95, 0, { fetchFn: f1 }), (e) => e.status === 400)
})
test('bestWindow picks the coolest daylight hours, in clock order', () => {
  const h = (hour, t, rh) => ({ displayDateTime: { hours: hour }, temperature: { degrees: t }, relativeHumidity: rh, precipitation: { probability: { percent: 10 } }, isDaytime: true })
  const w = N.bestWindow([h(3, 22, 90), h(5, 24, 90), h(6, 25, 88), h(9, 31, 70), h(13, 34, 60), h(17, 30, 70), h(22, 27, 80)])
  assert.deepEqual(w.best.map((x) => x.hour), [5, 6, 17].sort((a, b) => a - b)); assert.ok(w.hours.every((x) => x.hour >= 4 && x.hour <= 21)); assert.ok(w.best[0].wbgt < 30)
  assert.deepEqual(N.bestWindow(null), { best: [], hours: [] })
})
test('route calls work once the switch is on: elevation, snap, places, travel time, images', async () => {
  process.env.GOOGLE_ROUTE_DATA = '1'
  try {
    const el = await N.elevationProfile(route, { fetchFn: json({ results: [{ elevation: 100 }, { elevation: 110.4 }, { elevation: 105 }] }) })
    assert.deepEqual([el.points.length, el.gain_m, el.loss_m], [3, 10, 5])
    const sn = await N.snapToRoads(route, { fetchFn: json({ snappedPoints: [{ location: { latitude: -7.6, longitude: 110.2 } }, { location: { latitude: -7.5, longitude: 110.3 } }] }) })
    assert.equal(sn.points.length, 2)
    let n = 0
    const pl = await N.placesAlong(route, 'water', { fetchFn: async () => { n++; return { ok: true, json: async () => ({ places: [{ id: 'P1', displayName: { text: 'Indomaret' }, location: { latitude: -7.6, longitude: 110.2 }, types: ['convenience_store'] }] }) } } })
    assert.equal(pl.places.length, 1); assert.equal(n, 6); assert.match(pl.attribution, /Google/)
    await assert.rejects(N.placesAlong(route, 'bogus', { fetchFn: json({}) }), (e) => e.status === 400)
    const tt = await N.travelTime([-7.6, 110.2], [-7.5, 110.3], '2026-12-06T22:00:00Z', { fetchFn: json({ routes: [{ duration: '5400s', staticDuration: '4200s', distanceMeters: 61500 }] }) })
    assert.deepEqual(tt, { minutes_traffic: 90, minutes_free_flow: 70, km: 61.5 })
    const img = await N.staticRouteMap(route, { fetchFn: async (u) => { assert.ok(String(u).includes('enc%3A') || String(u).includes('enc:')); return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array([1, 2]).buffer } } })
    assert.equal(img.type, 'image/png'); assert.equal(img.body.length, 2)
  } finally { delete process.env.GOOGLE_ROUTE_DATA }
})
test('air quality forecast and history tolerate missing fields', async () => {
  const a = await N.airForecast(-7.6, 110.2, { fetchFn: json({ hourlyForecasts: [{ dateTime: 'x', indexes: [{ code: 'uaqi', aqi: 53, category: 'Moderate' }, { code: 'idn_menlhk', displayName: 'ISPU', aqi: 55 }] }, {}] }) })
  assert.equal(a.hours[0].local.name, 'ISPU'); assert.equal(a.hours[1].universal, null)
  const h = await N.airHistory(-7.6, 110.2, 5000, { fetchFn: json({}) }); assert.deepEqual(h.hours, [])
})
