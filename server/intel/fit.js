// FIT → 1 Hz series. Units normalised: cadence in steps/min (FIT stores strides/min per foot), step_length in m,
// altitude in m, speed m/s, distance m (cumulative). Missing values are NaN. Timer pauses become stopped seconds.
import fs from 'node:fs'
import FitParserMod from 'fit-file-parser'
const FitParser = FitParserMod.default || FitParserMod

export const PARSER_VERSION = 3 // 3: altitude from enhanced_altitude first (Garmin files carry only that field); 2: six-zone HR/pace time, pacing discipline, % LTHR
const NUM = (x) => (typeof x === 'number' && isFinite(x) ? x : NaN)

export function parseFitBuffer(buf) {
  return new Promise((ok, no) => {
    new FitParser({ force: true, mode: 'list', speedUnit: 'm/s', lengthUnit: 'm', temperatureUnit: 'celsius' })
      .parse(buf, (e, d) => (e ? no(new Error(String(e))) : ok(d)))
  })
}
export const parseFitFile = (file) => parseFitBuffer(fs.readFileSync(file))

export function toSeries(d) {
  const rec = (d.records || []).filter((r) => r.timestamp instanceof Date && !isNaN(r.timestamp))
  if (rec.length < 30) throw new Error('FIT: too few records')
  const t0 = rec[0].timestamp.getTime(), n = Math.round((rec.at(-1).timestamp.getTime() - t0) / 1000) + 1
  const f = () => new Float64Array(n).fill(NaN)
  const S = { n, t0, startMs: t0, speed: f(), dist: f(), hr: f(), cad: f(), power: f(), gct: f(), vo: f(), vr: f(), step: f(), alt: f(), effort: f(), lat: NaN, lon: NaN, paused: new Uint8Array(n).fill(1) }
  for (const r of rec) {
    const i = Math.round((r.timestamp.getTime() - t0) / 1000); if (i < 0 || i >= n) continue
    S.paused[i] = 0
    S.speed[i] = NUM(r.speed); S.dist[i] = NUM(r.distance); S.hr[i] = NUM(r.heart_rate); S.alt[i] = NUM(r.enhanced_altitude ?? r.altitude); S.power[i] = NUM(r.power)
    const c = NUM(r.cadence); S.cad[i] = isNaN(c) ? NaN : (c + (NUM(r.fractional_cadence) || 0)) * 2
    const g = NUM(r.stance_time); S.gct[i] = g > 0 ? g : NaN
    const vo = NUM(r.vertical_oscillation); S.vo[i] = vo > 0 ? vo : NaN
    const vr = NUM(r.vertical_ratio); S.vr[i] = vr > 0 ? vr : NaN
    const st = NUM(r.step_length); S.step[i] = st > 0 ? st / 1000 : NaN
    S.effort[i] = NUM(r['Effort Pace'])
    if (isNaN(S.lat) && isFinite(r.position_lat) && isFinite(r.position_long)) { S.lat = r.position_lat; S.lon = r.position_long }
  }
  // fill gaps: distance carried forward (paused → no movement), speed 0 while paused
  let last = 0
  for (let i = 0; i < n; i++) { if (isNaN(S.dist[i])) S.dist[i] = last; else last = S.dist[i]; if (S.paused[i]) S.speed[i] = 0 }
  // HR artefacts (optical wrist): outside physiological range or a >25 bpm jump from the 5 s median
  for (let i = 0; i < n; i++) {
    const h = S.hr[i]; if (isNaN(h)) continue
    if (h < 40 || h > 230) { S.hr[i] = NaN; continue }
    const w = []; for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (!isNaN(S.hr[j])) w.push(S.hr[j])
    w.sort((a, b) => a - b); if (w.length >= 3 && Math.abs(h - w[w.length >> 1]) > 25) S.hr[i] = NaN
  }
  const s = d.sessions?.[0] || {}
  S.session = { sport: s.sport, start: s.start_time instanceof Date ? s.start_time.toISOString() : null, elapsed: NUM(s.total_elapsed_time), timer: NUM(s.total_timer_time), distance: NUM(s.total_distance),
    ascent: NUM(s.total_ascent), descent: NUM(s.total_descent), avgHr: NUM(s.avg_heart_rate), maxHr: NUM(s.max_heart_rate), tempC: NUM(s.avg_temperature), avgPower: NUM(s.avg_power), calories: NUM(s.total_calories) }
  S.laps = (d.laps || []).length
  return S
}
