import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-fc-'))
const F = await import('./forecast.js'), { idb } = await import('./db.js')
// a Jakarta-like day: cool and dry before sunrise, hot and humid by midday
const day = (date) => ({ hourly: { time: Array.from({ length: 24 }, (_, i) => `${date}T${String(i).padStart(2, '0')}:00`), temperature_2m: Array.from({ length: 24 }, (_, i) => 24 + Math.max(0, 8 - Math.abs(i - 13)) * 0.9), relative_humidity_2m: Array.from({ length: 24 }, (_, i) => 92 - Math.max(0, 8 - Math.abs(i - 13)) * 3.5),
  dew_point_2m: Array(24).fill(23), wind_speed_10m: Array(24).fill(1.5), shortwave_radiation: Array.from({ length: 24 }, (_, i) => (i > 6 && i < 18 ? 600 : 0)) } })
const fetchOk = (date) => async () => ({ ok: true, json: async () => day(date) })

test('flag-protocol bands match the official thresholds', () => { for (const [w, b] of [[20, 'GREEN'], [22.3, 'YELLOW'], [25.7, 'ORANGE'], [27.9, 'RED'], [32.3, 'BLACK']]) assert.equal(F.bandOf(w), b) })
test('forecastDay: WBGT per hour, cached for 3 hours, only a 0.1° cell is requested', async () => {
  let calls = 0, url = ''; const f = async (u) => { calls++; url = u; return fetchOk('2026-11-23')() }
  const h = await F.forecastDay(-6.3123, 106.9456, '2026-11-23', { fetchFn: f, now: 1000 }); assert.equal(h.length, 24); assert.ok(h[13].wbgt > h[5].wbgt)
  assert.match(url, /latitude=-6.3&longitude=106.9&start_date=2026-11-23/); await F.forecastDay(-6.3123, 106.9456, '2026-11-23', { fetchFn: f, now: 1000 + 3600e3 }); assert.equal(calls, 1)
  await F.forecastDay(-6.3123, 106.9456, '2026-11-23', { fetchFn: f, now: 1000 + 4 * 3600e3 }); assert.equal(calls, 2)
  await assert.rejects(F.forecastDay(1, 1, '2026-11-24', { fetchFn: async () => ({ ok: false, status: 500 }), now: 0 }), /forecast 500/)
})
test('start advice: the earliest cool window wins, compared with the usual start; a small gain does not say "move earlier"', async () => {
  const h = await F.forecastDay(-6.3, 106.9, '2026-11-25', { fetchFn: fetchOk('2026-11-25'), now: 0 })
  const a = F.startAdvice(h, { minutes: 53, usualStart: 11 }); assert.equal(a.usual_start, '11:00'); assert.ok(a.wbgt_best < a.wbgt_usual); assert.ok(a.gain_wbgt > 1); assert.equal(a.move_earlier, true); assert.ok(a.best_start <= '07:00')
  const flat = Array.from({ length: 24 }, (_, i) => ({ h: i, wbgt: 27 })); const b = F.startAdvice(flat, { minutes: 60, usualStart: 7 }); assert.equal(b.move_earlier, false); assert.equal(b.best_start, '04:30')   // ties go to the earlier time but there is nothing to gain
  assert.equal(F.startAdvice([], { minutes: 60 }), null)
})
test('wbgtDuring averages the hours the run covers', () => { const hs = [{ h: 6, wbgt: 24 }, { h: 7, wbgt: 26 }, { h: 8, wbgt: 28 }]; assert.equal(F.wbgtDuring(hs, 6.5, 90), 25); assert.equal(F.wbgtDuring(hs, 12, 60), null) })   // 06:30-08:00 covers the 06:00 and 07:00 hours
test('usual place and start hour come from recent outdoor runs; no GPS history = no forecast', async () => {
  assert.equal(F.usualPlace(), null); assert.equal(await F.plannedForecast('2026-11-23', 8), null)
  for (const [i, h] of [6, 6.5, 7, 7.5, 9].entries()) idb.prepare("INSERT INTO fit_session (label_id, date, start_hour, lat1, lon1, parser_version, metrics, km, processed_at) VALUES (?,?,?,?,?,1,'{}','[]','x')").run('L' + i, '2026-11-1' + i, h, -6.3, 106.9)
  assert.deepEqual(F.usualPlace(), { lat: -6.3, lon: 106.9, usualStart: 7 })
  const p = await F.plannedForecast('2026-11-26', 8, { fetchFn: fetchOk('2026-11-26'), now: 0 }); assert.equal(p.date, '2026-11-26'); assert.equal(p.run_minutes, 53); assert.ok(p.best_start && p.band_best)
})
