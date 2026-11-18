// Weather per run from Open-Meteo (free, no key). PRIVACY: only coordinates rounded to 0.1° (~11 km) + a date leave the server; never routes or times.
// WBGT here is the Australian Bureau of Meteorology shade approximation: WBGT ≈ 0.567·Ta + 0.393·e + 3.94 (e = vapour pressure, hPa) [calc]. It ignores sun and wind, so it is a lower bound at midday.
import { idb } from './db.js'

export const round01 = (x) => Math.round(x * 10) / 10
export const cellOf = (lat, lon) => `${round01(lat).toFixed(1)},${round01(lon).toFixed(1)}`
export function wbgtShade(ta, rh) { if (![ta, rh].every(Number.isFinite)) return NaN; const e = (rh / 100) * 6.105 * Math.exp((17.27 * ta) / (237.7 + ta)); return 0.567 * ta + 0.393 * e + 3.94 }

const URL = (lat, lon, d) => `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${d}&end_date=${d}&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,shortwave_radiation&timezone=Asia%2FJakarta&wind_speed_unit=ms`
export async function dayHours(lat, lon, date, { fetchFn = fetch } = {}) {
  const cell = cellOf(lat, lon), hit = idb.prepare('SELECT hours FROM weather_cache WHERE cell=? AND date=?').get(cell, date)
  if (hit) return JSON.parse(hit.hours)
  const [la, lo] = cell.split(',').map(Number)
  const r = await fetchFn(URL(la, lo, date), { signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error('open-meteo ' + r.status)
  const j = await r.json(), h = j.hourly; if (!h?.time?.length) throw new Error('open-meteo: no hourly data')
  const hours = h.time.map((t, i) => ({ h: +t.slice(11, 13), temp: h.temperature_2m[i], rh: h.relative_humidity_2m[i], dew: h.dew_point_2m[i], wind: h.wind_speed_10m[i], rad: h.shortwave_radiation[i] }))
  idb.prepare('INSERT OR REPLACE INTO weather_cache (cell,date,hours,fetched_at) VALUES (?,?,?,?)').run(cell, date, JSON.stringify(hours), new Date().toISOString())
  return hours
}
// conditions over the run: hours (WIB local) from start to end, weighted equally; returns the means and the hourly detail
export function summarise(hours, startMs, endMs) {
  const wib = (ms) => new Date(ms + 7 * 3600e3), a = wib(startMs).getUTCHours(), b = wib(endMs).getUTCHours()
  const sel = hours.filter((x) => (a <= b ? x.h >= a && x.h <= b : x.h >= a || x.h <= b)); if (!sel.length) return null
  const m = (k) => sel.reduce((s, x) => s + x[k], 0) / sel.length
  const temp = m('temp'), rh = m('rh')
  return { temp_c: +temp.toFixed(1), dew_c: +m('dew').toFixed(1), rh: +rh.toFixed(0), wind_ms: +m('wind').toFixed(1), rad_wm2: +m('rad').toFixed(0), wbgt: +wbgtShade(temp, rh).toFixed(1), hours: sel }
}

// job: fill run_weather for sessions that have GPS (lat1/lon1) and none yet; treadmill/indoor runs are marked indoor
export async function weatherJob({ fetchFn = fetch, delayMs = 300, limit = 400 } = {}) {
  const rows = idb.prepare(`SELECT s.label_id, s.date, s.start_ms, s.elapsed_s, s.lat1, s.lon1 FROM fit_session s LEFT JOIN run_weather w ON w.label_id = s.label_id WHERE w.label_id IS NULL ORDER BY s.date DESC LIMIT ?`).all(limit)
  let ok = 0, indoor = 0, failed = 0; const now = () => new Date().toISOString()
  for (const r of rows) {
    if (r.lat1 == null || r.lon1 == null) { idb.prepare('INSERT INTO run_weather (label_id, indoor, source, fetched_at) VALUES (?,1,?,?)').run(r.label_id, 'no-gps', now()); indoor++; continue }
    try {
      const had = idb.prepare('SELECT 1 FROM weather_cache WHERE cell=? AND date=?').get(cellOf(r.lat1, r.lon1), r.date)
      const hours = await dayHours(r.lat1, r.lon1, r.date, { fetchFn }), s = summarise(hours, r.start_ms, r.start_ms + (r.elapsed_s || 0) * 1000); if (!s) throw new Error('no hours')
      idb.prepare('INSERT OR REPLACE INTO run_weather (label_id, indoor, temp_c, dew_c, rh, wind_ms, rad_wm2, wbgt, hours, source, fetched_at) VALUES (?,0,?,?,?,?,?,?,?,?,?)').run(r.label_id, s.temp_c, s.dew_c, s.rh, s.wind_ms, s.rad_wm2, s.wbgt, JSON.stringify(s.hours), 'open-meteo', now())
      ok++; if (!had && delayMs) await new Promise((x) => setTimeout(x, delayMs))
    } catch (e) { failed++; if (failed > 8) break }
  }
  return { ok, indoor, failed, pending: idb.prepare('SELECT COUNT(*) n FROM fit_session s LEFT JOIN run_weather w ON w.label_id=s.label_id WHERE w.label_id IS NULL').get().n }
}
