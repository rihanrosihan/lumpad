// Pure metric functions over a 1 Hz series (see fit.js). Definitions follow the KB (04.9 §5D, 04.8 §2, 03.9) so numbers match.
import { ATHLETE } from '../../src/lib/athlete.js'
import { hrZoneOf, paceZoneOf } from '../../src/lib/zones.js'
// stop = speed < 0.3 m/s · run = moving and cadence >= 125 spm · walk = moving and cadence < 125 spm.
// Every function returns null (with a reason where useful) rather than a guess when its validity rule is not met.
export const STOP_MS = 0.3, RUN_CAD = 125
export const BASELINE = { gct: 300, cad: 170, hr800: 143.1, hr800sd: 5.0, lthr: ATHLETE.lthr, hrmax: ATHLETE.hrmax, tpace: ATHLETE.tpace_s } // KB 04.8 / 01.1 / 03.9; recomputed monthly by the pipeline

const mean = (a) => { let s = 0, n = 0; for (const x of a) if (!isNaN(x)) { s += x; n++ } return n ? s / n : NaN }
const med = (a) => { const v = [...a].filter((x) => !isNaN(x)).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN }
const r1 = (x, d = 1) => (isNaN(x) || x == null ? null : Math.round(x * 10 ** d) / 10 ** d)
const sd = (a) => { const v = a.filter((x) => !isNaN(x)), m = mean(v); return v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : NaN }
const paceOf = (speed) => (speed > 0 ? 1000 / speed : NaN)

// per-second speed from the distance step (KB definition: stop = the watch distance did not advance, i.e. < 0.3 m/s)
export function stepSpeed(S) { const v = new Float64Array(S.n); for (let i = 1; i < S.n; i++) v[i] = S.dist[i] - S.dist[i - 1]; v[0] = v[1] || 0; return v }
// classification per second: 0 stop, 1 walk, 2 run
export function classify(S) {
  const c = new Uint8Array(S.n); let lastCad = NaN, since = 99
  if (!S.v) S.v = stepSpeed(S)
  for (let i = 0; i < S.n; i++) {
    const sp = S.v[i]
    if (!(sp >= STOP_MS)) { c[i] = 0; continue }
    let cad = S.cad[i]
    if (isNaN(cad)) { cad = since <= 5 ? lastCad : NaN } else { lastCad = cad; since = 0 }
    since++
    c[i] = isNaN(cad) ? (sp >= 2.0 ? 2 : 1) : cad >= RUN_CAD ? 2 : 1
  }
  return c
}

// grade (fraction) from altitude smoothed over ±15 s, differenced over 30 s
export function gradeSeries(S) {
  const a = new Float64Array(S.n), g = new Float64Array(S.n).fill(0), W = 15
  for (let i = 0; i < S.n; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - 7); j <= Math.min(S.n - 1, i + 7); j++) if (!isNaN(S.alt[j])) { s += S.alt[j]; k++ } a[i] = k ? s / k : NaN }
  for (let i = W; i < S.n - W; i++) { const dd = S.dist[i + W] - S.dist[i - W], da = a[i + W] - a[i - W]; g[i] = dd > 20 && !isNaN(da) ? Math.max(-0.15, Math.min(0.15, da / dd)) : 0 }
  return g
}
const minetti = (g) => 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6
export const gapSpeed = (speed, g) => speed * (minetti(g) / minetti(0)) // flat-equivalent speed [calc]

// sums over [i0, i1) → seconds by class and run-phase means
export function window(S, cls, i0 = 0, i1 = S.n) {
  let stop = 0, walk = 0, run = 0, sp = 0, hr = [], pw = [], cad = [], gct = [], st = [], vr = [], vo = [], n = 0
  for (let i = i0; i < Math.min(i1, S.n); i++) {
    n++; if (cls[i] === 0) stop++; else if (cls[i] === 1) walk++
    else { run++; sp += (S.v ? S.v[i] : S.speed[i]); hr.push(S.hr[i]); pw.push(S.power[i]); cad.push(S.cad[i]); gct.push(S.gct[i]); st.push(S.step[i]); vr.push(S.vr[i]); vo.push(S.vo[i]) }
  }
  const runSpeed = run ? sp / run : NaN, runHr = mean(hr), runPw = mean(pw)
  return { elapsed: n, stop, walk, run, moving: n - stop, runShare: n ? run / n : NaN, runSpeed, runPace: paceOf(runSpeed), runHr, runPower: runPw, runCad: mean(cad), runGct: mean(gct), runStep: mean(st), runVr: mean(vr), runVo: mean(vo),
    economy: runSpeed > 0 ? runPw / runSpeed : NaN, beatsKm: runHr * (paceOf(runSpeed) / 60), ef: runHr > 0 ? (runSpeed * 60) / runHr : NaN }
}

// range of seconds between two cumulative watch distances (m)
export function distRange(S, d0, d1) {
  let a = 0, b = S.n
  while (a < S.n && S.dist[a] < d0) a++
  b = a; while (b < S.n && S.dist[b] < d1) b++
  return [a, b]
}

export function perKm(S, cls, grade) {
  const out = [], total = S.dist[S.n - 1]
  for (let k = 0; k * 1000 < total; k++) {
    const [a, b] = distRange(S, k * 1000, (k + 1) * 1000); if (b - a < 20) continue
    const w = window(S, cls, a, b); let gain = 0
    for (let i = a + 1; i < b; i++) if (grade[i] > 0) gain += grade[i] * (S.dist[i] - S.dist[i - 1])
    out.push({ km: k + 1, sec: w.elapsed, run: w.run, walk: w.walk, stop: w.stop, runShare: r1(w.runShare, 3), pace: r1(w.elapsed / ((S.dist[b - 1] - S.dist[a]) / 1000 || NaN), 0), runPace: r1(w.runPace, 0),
      hr: r1(mean(S.hr.slice(a, b)), 0), power: r1(w.runPower, 0), cad: r1(w.runCad, 0), gct: r1(w.runGct, 0), step: r1(w.runStep, 3), vr: r1(w.runVr, 2), ef: r1(w.ef, 3), gain: r1(gain, 0) })
  }
  return out
}

// steady 60 s blocks (KB 04.8 §2): minute 3–60, cadence >= 150, |grade| < 2.5 %, speed SD < 8 %, Δpace vs previous < 8 %; HR after the first 10 s
export function steadyBlocks(S, cls, grade) {
  const blocks = []; let prev = NaN
  for (let a = 180; a + 60 <= Math.min(S.n, 3600); a += 60) {
    let ok = true, sp = [], cad = [], hr = [], g = 0
    for (let i = a; i < a + 60; i++) { if (cls[i] !== 2) { ok = false; break } sp.push(S.speed[i]); cad.push(S.cad[i]); g += grade[i]; if (i >= a + 10) hr.push(S.hr[i]) }
    if (!ok) { prev = NaN; continue }
    const msp = mean(sp), pace = paceOf(msp), mg = Math.abs(g / 60), mh = mean(hr)
    const good = mean(cad) >= 150 && mg < 0.025 && sd(sp) / msp < 0.08 && !isNaN(mh) && !(Math.abs(pace - prev) / prev >= 0.08)
    prev = pace
    if (good) blocks.push({ at: a, pace, hr: mh })
  }
  return blocks
}
const SLOPE = -0.073 // bpm per s/km, pooled within-run (KB 04.8 §2)
export function hrAtPace(blocks, minBlocks = 5) {
  const P = blocks.filter((b) => b.pace >= 460 && b.pace <= 500), H = blocks.filter((b) => b.hr >= 146 && b.hr <= 154)
  return {
    hr800: P.length >= minBlocks ? r1(mean(P.map((b) => b.hr + SLOPE * (480 - b.pace)))) : null, hr800Minutes: P.length,
    paceAtHr150: H.length >= minBlocks ? r1(mean(H.map((b) => b.pace)), 0) : null, paceAtHr150Minutes: H.length,
  }
}

// Pa:HR drift: only valid on a steady, continuous effort (>= 45 min after a 10 min warm-up, run share >= 90 %, pace CV < 8 %)
export function drift(S, cls) {
  const a = 600, b = S.n; if (b - a < 2700) return { value: null, why: 'steady portion < 45 min' }
  const w = window(S, cls, a, b); if (w.runShare < 0.9) return { value: null, why: 'run share < 90 %' }
  const blocks = []; for (let i = a; i + 60 <= b; i += 60) blocks.push(mean(S.speed.slice(i, i + 60)))
  if (sd(blocks) / mean(blocks) >= 0.08) return { value: null, why: 'pace CV >= 8 % (not steady)' }
  const m = a + ((b - a) >> 1), h1 = window(S, cls, a, m), h2 = window(S, cls, m, b)
  if (!(h1.ef > 0 && h2.ef > 0)) return { value: null, why: 'no HR' }
  return { value: r1(((h1.ef - h2.ef) / h1.ef) * 100, 2), ef1: r1(h1.ef, 3), ef2: r1(h2.ef, 3) }
}
// run-phase drift for run-walk / long sessions: EF of run seconds, first vs second half of the run seconds (after warm-up)
export function runPhaseDrift(S, cls) {
  const idx = []; for (let i = 600; i < S.n; i++) if (cls[i] === 2) idx.push(i)
  if (idx.length < 3600) return { value: null, why: 'run phase < 60 min after warm-up' }
  const ef = (ids) => { let sp = 0, h = [], n = 0; for (const i of ids) { sp += S.speed[i]; h.push(S.hr[i]); n++ } return (sp / n) * 60 / mean(h) }
  const e1 = ef(idx.slice(0, idx.length >> 1)), e2 = ef(idx.slice(idx.length >> 1))
  return { value: r1(((e1 - e2) / e1) * 100, 2), ef1: r1(e1, 3), ef2: r1(e2, 3) }
}

// late-run biomechanical fade: last 25 % vs first 25 % of run seconds after a 10 min warm-up (needs >= 30 min of run seconds)
export function bioFade(S, cls) {
  const idx = []; for (let i = 600; i < S.n; i++) if (cls[i] === 2) idx.push(i)
  if (idx.length < 1800) return null
  const q = idx.length >> 2, A = idx.slice(0, q), B = idx.slice(-q)
  const m = (ids, arr) => mean(ids.map((i) => arr[i]))
  const eff = (ids) => mean(ids.map((i) => S.speed[i] - S.effort[i]))
  return { gct_ms: r1(m(B, S.gct) - m(A, S.gct)), stride_m: r1(m(B, S.step) - m(A, S.step), 3), vratio_pct: r1(m(B, S.vr) - m(A, S.vr), 2), vo_mm: r1(m(B, S.vo) - m(A, S.vo)),
    cadence: r1(m(B, S.cad) - m(A, S.cad)), power_w: r1(m(B, S.power) - m(A, S.power)), effort_gap_ms: r1(eff(B) - eff(A), 3), n_run_s: idx.length }
}

// first km (after km 4) where fade starts, relative to the session's own km 2–4 (a km-1 trigger against a race-pace reference fires on every easy run):
// run share < 85 % over 2 km, cadence −5 spm, or GCT +15 ms (the 03.9 mechanical trigger sizes). The absolute 03.9 check is kept separately as mech_abs.
export function fadeOnset(km, baseline = BASELINE) {
  if (km.length < 8) return null
  const ref = km.slice(1, 4).filter((k) => k.runShare >= 0.8), c0 = mean(ref.map((k) => k.cad)), g0 = mean(ref.map((k) => k.gct))
  if (ref.length < 2) return { km: null, trigger: 'no clean reference km 2–4' }
  for (let i = 4; i < km.length; i++) {
    const share = mean(km.slice(i, i + 2).map((k) => k.runShare)), k = km[i]
    if (share < 0.85) return { km: k.km, trigger: 'run_share<85%' }
    if (k.runShare >= 0.5 && k.gct != null && !isNaN(g0) && k.gct > g0 + 15) return { km: k.km, trigger: 'gct>ref+15' }
    if (k.runShare >= 0.5 && k.cad != null && !isNaN(c0) && k.cad < c0 - 5) return { km: k.km, trigger: 'cadence<ref-5' }
  }
  return { km: null, trigger: 'none' }
}
export function mechAbs(km, baseline = BASELINE) { // first km hitting the absolute 03.9 trigger (cadence < 165 or GCT > 315 while mostly running)
  const k = km.find((x) => x.runShare >= 0.5 && ((x.cad != null && x.cad < baseline.cad - 5) || (x.gct != null && x.gct > baseline.gct + 15)))
  return k ? k.km : null
}

// time in the six COROS zones (index 0 = below Z1 / slower than Z1), HR as % of LTHR and pace as % of threshold pace, over moving seconds.
// Pace uses a 30 s rolling speed so GPS jitter does not scatter seconds across zones.
export function zones6(S, cls, baseline = BASELINE) {
  const cfg = { lthr: baseline.lthr, tpace: baseline.tpace || 356 }, hr = Array(7).fill(0), pace = Array(7).fill(0), W = 30
  for (let i = 0; i < S.n; i++) {
    if (!cls[i]) continue
    const h = hrZoneOf(S.hr[i], cfg); if (h != null) hr[h]++
    const j = Math.max(0, i - W), sp = (S.dist[i] - S.dist[j]) / Math.max(1, i - j), z = sp > 0.3 ? paceZoneOf(1000 / sp, cfg) : 0; if (z != null) pace[z]++
  }
  return { hr_s: hr, pace_s: pace }
}
// pacing discipline over mostly-running kilometres (first km dropped): coefficient of variation of run pace, split direction, 0–100 score
export function pacing(km) {
  const K = km.filter((k) => k.km > 1 && k.runShare >= 0.85 && k.runPace > 0)
  if (K.length < 4) return null
  const p = K.map((k) => k.runPace), m = mean(p), cv = sd(p) / m, h = K.length >> 1, a = mean(p.slice(0, h)), b = mean(p.slice(h)), split = (b - a) / a
  return { km: K.length, cv_pct: r1(cv * 100, 1), score: Math.round(100 * Math.max(0, 1 - cv / 0.10)), split_pct: r1(split * 100, 1), split: split <= -0.01 ? 'negative' : split >= 0.01 ? 'positive' : 'even' }
}
const zone = (S, cls, lo, hi) => { let s = 0; for (let i = 0; i < S.n; i++) if (cls[i] && S.hr[i] >= lo && S.hr[i] < hi) s++; return s }

export function sessionMetrics(S, baseline = BASELINE) {
  const cls = classify(S), grade = gradeSeries(S), all = window(S, cls), km = perKm(S, cls, grade)
  const blocks = steadyBlocks(S, cls, grade), hp = hrAtPace(blocks), dr = drift(S, cls), rd = runPhaseDrift(S, cls), fade = bioFade(S, cls), onset = fadeOnset(km, baseline)
  const dist = S.dist[S.n - 1], e = S.session
  const first = km.slice(0, 5).filter((k) => k.gct != null), openHr = mean(S.hr.slice(0, Math.min(S.n, 3600)).filter((_, i) => cls[i] === 2))
  const lthr = baseline.lthr
  return {
    sport: e.sport, distance_m: r1(dist, 0), elapsed_s: all.elapsed, moving_s: all.moving, stop_s: all.stop, run_s: all.run, walk_s: all.walk,
    run_share: r1(all.runShare, 3), run_pace: r1(all.runPace, 0), run_hr: r1(all.runHr), run_power: r1(all.runPower), run_cad: r1(all.runCad), run_gct: r1(all.runGct), run_step: r1(all.runStep, 3), run_vr: r1(all.runVr, 2),
    economy_jm: r1(all.economy), beats_km: r1(all.beatsKm, 0), ef: r1(all.ef, 3), net_ef: r1(all.moving ? (dist / S.n) * 60 / mean(S.hr) : NaN, 3),
    drift_pahr: dr, run_phase_drift: rd, bio_fade: fade, fade_onset: onset, mech_abs_km: mechAbs(km, baseline),
    hr_at_800: hp.hr800, hr_at_800_min: hp.hr800Minutes, pace_at_hr150: hp.paceAtHr150, pace_at_hr150_min: hp.paceAtHr150Minutes,
    open_hr_first_hour: r1(openHr), gain_m: r1(e.ascent, 0), temp_device_c: r1(e.tempC, 0), avg_hr: r1(mean(S.hr)), max_hr: r1(e.maxHr, 0),
    z_hr: { below_lthr_min: r1(zone(S, cls, 0, lthr * 0.9) / 60, 0), tempo_min: r1(zone(S, cls, lthr * 0.9, lthr * 1.0) / 60, 0), above_lthr_min: r1(zone(S, cls, lthr, 999) / 60, 0) },
    first_km_gct: r1(mean(first.map((k) => k.gct)), 0),
    z6: zones6(S, cls, baseline), pacing: pacing(km), lthr_pct: r1((all.runHr / lthr) * 100, 0),
  }
}
export { mean, sd, med, r1, paceOf }
