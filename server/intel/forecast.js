// Heat-aware planning: the hourly forecast for a planned run day → WBGT per hour, the best start time, and how it compares with the athlete's usual start.
// Same source (Open-Meteo) and same shade-WBGT formula as the historical per-run weather, so forecast and past runs are directly comparable.
// PRIVACY: only coordinates rounded to 0.1° (~11 km) and a date leave the server. The result is advice about WHEN to run; it never changes a locked rule.
import { idb } from './db.js'
import { wbgtShade, cellOf } from './weather.js'
import PLAN from '../../src/data/plan.json' with { type: 'json' }

// the official JRF 2026 flag-protocol bands (the same thresholds as lumpadd/internal/graph WBGTBand)
export const bandOf = (w) => (w >= 32.3 ? 'BLACK' : w >= 27.9 ? 'RED' : w >= 25.7 ? 'ORANGE' : w >= 22.3 ? 'YELLOW' : 'GREEN')
const URL = (lat, lon, d) => `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${d}&end_date=${d}&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,shortwave_radiation&timezone=Asia%2FJakarta&wind_speed_unit=ms`
const cache = new Map(), TTL = 3 * 3600e3

export async function forecastDay(lat, lon, date, { fetchFn = fetch, now = Date.now() } = {}) {
  const cell = cellOf(lat, lon), key = cell + '|' + date, hit = cache.get(key)
  if (hit && now - hit.at < TTL) return hit.hours
  const [la, lo] = cell.split(',').map(Number)
  const r = await fetchFn(URL(la, lo, date), { signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error('open-meteo forecast ' + r.status)
  const h = (await r.json()).hourly; if (!h?.time?.length) throw new Error('open-meteo forecast: no hourly data')
  const hours = h.time.map((t, i) => { const w = wbgtShade(h.temperature_2m[i], h.relative_humidity_2m[i]); return { h: +t.slice(11, 13), temp: h.temperature_2m[i], rh: h.relative_humidity_2m[i], wind: h.wind_speed_10m[i], rad: h.shortwave_radiation[i], wbgt: Number.isFinite(w) ? Math.round(w * 10) / 10 : null } })
  cache.set(key, { at: now, hours }); if (cache.size > 40) cache.delete(cache.keys().next().value)
  return hours
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
// mean WBGT of a run that starts at `start` (hour, may be .5) and lasts `minutes`
export function wbgtDuring(hours, start, minutes) {
  const end = start + minutes / 60, sel = hours.filter((x) => x.wbgt != null && x.h + 1 > start && x.h < end)
  return sel.length ? Math.round(mean(sel.map((x) => x.wbgt)) * 10) / 10 : null
}
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`

// best start between 04:30 and 09:00 for a run of `minutes`, against the athlete's usual start hour
export function startAdvice(hours, { minutes = 60, usualStart = 7 } = {}) {
  let best = null
  for (let s = 4.5; s <= 9; s += 0.5) { const w = wbgtDuring(hours, s, minutes); if (w != null && (!best || w < best.wbgt - 0.05)) best = { start: s, wbgt: w } }   // earlier wins ties
  const usual = wbgtDuring(hours, usualStart, minutes); if (!best || usual == null) return null
  const gain = Math.round((usual - best.wbgt) * 10) / 10
  return { best_start: hhmm(best.start), wbgt_best: best.wbgt, band_best: bandOf(best.wbgt), usual_start: hhmm(usualStart), wbgt_usual: usual, band_usual: bandOf(usual), gain_wbgt: gain,
    move_earlier: best.start < usualStart && gain >= 1.0 && bandOf(best.wbgt) !== bandOf(usual) || (best.start < usualStart && gain >= 2.0) }
}

// the athlete's usual place and start hour from recent outdoor runs
export function usualPlace(d = idb) {
  const p = d.prepare('SELECT lat1, lon1 FROM fit_session WHERE lat1 IS NOT NULL ORDER BY date DESC, start_ms DESC LIMIT 1').get()
  const hrs = d.prepare("SELECT s.start_hour h FROM fit_session s LEFT JOIN run_weather w ON w.label_id = s.label_id WHERE s.start_hour IS NOT NULL AND COALESCE(w.indoor, 0) = 0 ORDER BY s.date DESC LIMIT 20").all().map((r) => r.h).sort((a, b) => a - b)
  return p ? { lat: p.lat1, lon: p.lon1, usualStart: hrs.length ? Math.round(hrs[hrs.length >> 1] * 2) / 2 : 7 } : null
}
// one call for the API and the coach context; null when unknown (no GPS history, forecast unavailable)
export async function plannedForecast(date, km, opts = {}) {
  try {
    const pl = opts.place || usualPlace(); if (!pl) return null
    const minutes = Math.round((km || 8) * 6.6)   // an easy-run pace of about 6:35/km: only used to pick the hours the run covers
    const a = startAdvice(await forecastDay(pl.lat, pl.lon, date, opts), { minutes, usualStart: Math.min(9, Math.max(4.5, pl.usualStart)) })
    return a ? { date, ...a, run_minutes: minutes } : null
  } catch { return null }
}

// ---- for the coach: the next PLANNED run (today if none done yet, else tomorrow / the day after), values rounded so a small forecast wobble does not change the prompt
const PLAN_BY = Object.fromEntries(PLAN.map((d) => [d.date, d]))
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export function nextRunDay(date, ranToday) {
  for (const off of ranToday ? [1, 2] : [0, 1]) { const p = PLAN_BY[addDays(date, off)]; if (p && p.km > 0 && !['rest', 'gym'].includes(p.kind)) return { date: p.date, km: p.km, label: p.label || p.kind } }
  return null
}
export async function forecastForCoach(date, ranToday, opts = {}) {
  const n = nextRunDay(date, ranToday); if (!n) return undefined
  const f = await plannedForecast(n.date, n.km, opts); if (!f) return undefined
  return { for_date: n.date, session: `${n.label} ${n.km} km`, best_start: f.best_start, band_best: f.band_best, wbgt_best: Math.round(f.wbgt_best), usual_start: f.usual_start, band_usual: f.band_usual, wbgt_usual: Math.round(f.wbgt_usual), move_earlier: !!f.move_earlier }
}
