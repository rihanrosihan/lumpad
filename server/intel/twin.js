// AthleteDigitalTwin (schema twin/1): a versioned JSON state rebuilt from measured data. A new version is written only when its inputs changed.
import crypto from 'node:crypto'
import { db as app } from '../store.js'
import { load } from '../db.js'
import { readinessData } from '../activities.js'
import { idb, mdb } from './db.js'
import { mean, sd, quantile, ols, rng } from './stats.js'
import { dailyLoadSeries, pmc, acwrRolling, monotonyStrain, distanceProgression, ctlRamp } from '../../src/lib/load.js'
import { hrvState, rhrState } from '../../src/lib/hrv.js'
import { sleepState } from '../../src/lib/sleep.js'
import { computeReadiness } from '../../src/lib/readiness.js'
import { vdotFromRace, raceTime } from '../../src/lib/vdot.js'
import { CHECKPOINTS, TARGET, killGate } from '../../src/lib/plan.js'
import { HARD } from '../../src/lib/gate.js'
import PLAN from '../../src/data/plan.json' with { type: 'json' }
import { ATHLETE, Z2_CEILING } from '../../src/lib/athlete.js'
import { listEdges } from './corr.js'
import { matrices } from './matrices.js'

export const SCHEMA = 'twin/1'
const PLAN_BY = Object.fromEntries(PLAN.map((d) => [d.date, d]))
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const wibDate = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const r = (x, d = 1) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d)
const sessions = (since) => idb.prepare('SELECT s.*, w.wbgt, w.temp_c AS wx_temp, w.indoor FROM fit_session s LEFT JOIN run_weather w ON w.label_id = s.label_id WHERE s.date >= ? ORDER BY s.date, s.start_ms, s.label_id').all(since) // chronological, deterministic for same-day runs

// ---- load + readiness: the same code and inputs as the client (src/lib), so the numbers agree
function loadAndReadiness(T, aer = null) {
  const from = addDays(T, -120), R = readinessData(from, T), series = dailyLoadSeries(R.loads || [], from, T), P = pmc(series), cur = P.at(-1) || null
  const acts = app.prepare('SELECT * FROM activities WHERE date BETWEEN ? AND ?').all(from, T).map((a) => ({ ...a, sport_class: a.sport === 'Run' ? 'run' : 'other' })).filter((a) => a.source === 'coros')
  const settings = load('kv', {})['lumpad.settings']?.value || {}, f = load('kv', {})['lumpad.daily.' + T]?.value || {}
  const health = R.health || [], hrv = hrvState(health, T), rhr = rhrState(health, T), sleep = sleepState(health, T, settings.sleepNeedMin || 480), mono = monotonyStrain(series), prog = distanceProgression(acts, T)
  const sess = PLAN_BY[T], shr = health.find((h) => h.date === T)?.sleep_hr_avg ?? null
  const rd = computeReadiness({ f, hrv, rhr, sleep, pmcPoint: cur, monotony: mono, progression: prog, muscleMax: null, phase: sess?.phase, hard: sess ? HARD.has(sess.kind) : false, sleepHR: shr, aerobic: aer })
  const wk = acts.filter((a) => a.sport === 'Run' && a.date > addDays(T, -28)), longest30 = Math.max(0, ...acts.filter((a) => a.sport === 'Run' && a.date > addDays(T, -30) && a.date < T).map((a) => a.distance_m / 1000))
  const recent = health.filter((h) => h.date > addDays(T, -8)).map((h) => ({ date: h.date, hrv: h.hrv_avg ?? null, hrv_status: h.hrv_status ?? null, hrv_baseline: h.hrv_baseline ?? null, sleep_hr: h.sleep_hr_avg ?? null, rhr: h.resting_hr ?? null,
    sleep_min_asleep: h.sleep_total_min != null ? h.sleep_total_min - (h.sleep_awake_min || 0) : null, sleep_score: h.sleep_score ?? null, stress: h.stress_avg ?? null, load_short: h.load_short ?? null, load_long: h.load_long ?? null }))
  return {
    recent_days: recent,
    load: { ctl: cur?.ctl ?? null, atl: cur?.atl ?? null, tsb: cur?.tsb ?? null, acwr_uncoupled: acwrRolling(series), acwr_ewma: cur?.acwr ?? null, monotony: mono?.monotony ?? null, ramp_7d: ctlRamp(P), km_vs_4wk_avg_pct: prog?.pct ?? null,
      weekly_km_4w: r(wk.reduce((s, a) => s + a.distance_m / 1000, 0) / 4), longest_run_km_30d: r(longest30), coros_ratio: health.at(-1)?.load_ratio ?? null },
    readiness: { score: rd.score, raw: rd.raw, tier: rd.tier?.id ?? null, caps: rd.caps.map((c) => c.why), coverage: rd.coverage, pillars: Object.fromEntries(Object.entries(rd.pillars).map(([k, p]) => [k, p.haveWeight ? Math.round((p.earned / p.haveWeight) * 100) : null])), gate: rd.caps.length ? 'red' : rd.score == null ? 'unknown' : rd.score >= 65 ? 'green' : rd.score >= 45 ? 'amber' : 'red' },
  }
}

// HR at 8:00/km baseline valid on T (athlete_baseline, written monthly by baselineJob); the original KB value is the seed until the first row exists
export const SEED_HR800 = { value: 143.1, sd: 5.0, n: 26, source: 'seed: KB Jan–Sep 2026', valid_from: null }
export function hr800Baseline(T) {
  const row = idb.prepare("SELECT value, sd, n, source, valid_from FROM athlete_baseline WHERE name='hr800' AND valid_from <= ? ORDER BY valid_from DESC LIMIT 1").get(T)
  return row && row.value != null && row.sd > 0 ? row : SEED_HR800
}
// steady easy runs only (3–15 km, ≥ 90 % running): races and run-walk sessions measure effort and heat, not aerobic fitness
export const steadyRun = (s) => s.run_share >= 0.9 && s.distance_m >= 3000 && s.distance_m <= 15000
function aerobic(S, T, base = SEED_HR800) {
  const win = (a, b) => S.filter((s) => s.date > addDays(T, -a) && s.date <= addDays(T, -b) && steadyRun(s)), hr = (L) => L.map((s) => s.hr800).filter((x) => x != null), p150 = (L) => L.map((s) => s.pace_hr150).filter((x) => x != null)
  const cur = hr(win(28, 0)), prev = hr(win(56, 28)), easy = win(28, 0).map((s) => s.ef).filter((x) => x != null)
  return { hr_at_800: { value: cur.length ? r(mean(cur)) : null, n: cur.length, z: cur.length ? r((mean(cur) - base.value) / base.sd) : null, prev_28d: prev.length ? r(mean(prev)) : null, baseline: `${base.value} ± ${base.sd} (${base.source}, n=${base.n})`, steady_only: true },
    pace_at_hr150: { value: p150(win(28, 0)).length ? r(mean(p150(win(28, 0))), 0) : null, n: p150(win(28, 0)).length }, ef_easy_28d: { value: easy.length ? r(mean(easy), 3) : null, n: easy.length } }
}
function durability(S, T) {
  const L = S.filter((s) => s.date > addDays(T, -90) && s.distance_m >= 16000), km = (s) => JSON.parse(s.km)
  const cont = (s) => { let best = 0, cur = 0; for (const k of km(s)) { if (k.runShare >= 0.9) { cur++; best = Math.max(best, cur) } else cur = 0 } return best }
  const onset = L.map((s) => s.onset_km).filter((x) => x != null)
  const curve = {}; for (const s of L) for (const k of km(s)) (curve[k.km] ||= []).push(k.runShare)
  const rs = Object.entries(curve).filter(([, v]) => v.length >= 2).map(([k, v]) => ({ km: +k, run_share: r(mean(v), 2), n: v.length })).sort((a, b) => a.km - b.km)
  const below = rs.find((x) => x.km >= 5 && x.run_share < 0.9)
  return { long_runs_90d: L.length, longest_continuous_run_km: Math.max(0, ...L.map(cont)), longest_continuous_run_km_30d: Math.max(0, ...L.filter((s) => s.date > addDays(T, -30)).map(cont)), durability_km: below?.km ?? null,
    fade_onset_km_median_90d: onset.length ? r(quantile(onset, 0.5), 0) : null, gct_fade_ms_median_90d: r(quantile(L.map((s) => s.gct_fade).filter((x) => x != null), 0.5)), run_share_by_km: rs.slice(0, 45) }
}
// heat: EF and HR at matched pace vs WBGT, on steady easy runs (3–15 km, run share ≥ 0.9). Bootstrap CI; needs n ≥ 15.
function heat(S) {
  const L = S.filter((s) => s.indoor === 0 && s.wbgt != null && s.run_share >= 0.9 && s.distance_m >= 3000 && s.distance_m <= 15000 && s.ef != null && s.run_pace != null && s.run_hr != null)
  if (L.length < 15) return { n: L.length, note: 'needs ≥ 15 steady outdoor runs with weather' }
  const fit = (rows, y) => ols(rows.map((s) => [s.run_pace, s.wbgt]), rows.map(y)).coef[2], R = rng(3), B = [], Be = []
  for (let b = 0; b < 200; b++) { const rs = L.map(() => L[Math.floor(R() * L.length)]); B.push(fit(rs, (s) => s.run_hr)); Be.push(fit(rs, (s) => s.ef)) }
  return { n: L.length, hr_cost_bpm_per_c: { value: r(fit(L, (s) => s.run_hr), 2), ci: [r(quantile(B, 0.025), 2), r(quantile(B, 0.975), 2)] }, ef_cost_per_c: { value: r(fit(L, (s) => s.ef), 4), ci: [r(quantile(Be, 0.025), 4), r(quantile(Be, 0.975), 4)] }, wbgt_range: [r(Math.min(...L.map((s) => s.wbgt))), r(Math.max(...L.map((s) => s.wbgt)))] }
}
// shoes: EF residual (after pace, WBGT/temperature, duration) against the shoe's cumulative km at the time of the run
function shoes(S) {
  const gear = app.prepare('SELECT id, name, distance_m, retired FROM gear').all(), out = []
  const runs = app.prepare("SELECT id, date, distance_m, gear_id FROM activities WHERE source='coros' AND sport='Run' AND gear_id IS NOT NULL ORDER BY date, start_ts").all(), cum = new Map(), kmAt = {}
  for (const a of runs) { const c = (cum.get(a.gear_id) || 0) + a.distance_m / 1000; cum.set(a.gear_id, c); kmAt[a.id] = c }
  const base = S.filter((s) => s.run_share >= 0.85 && s.distance_m >= 3000 && s.ef != null && s.run_pace != null), temp = (s) => s.wbgt ?? s.wx_temp ?? s.temp_device_c
  const ok = base.filter((s) => temp(s) != null), model = ok.length >= 20 ? ols(ok.map((s) => [s.run_pace, temp(s), s.elapsed_s / 60]), ok.map((s) => s.ef)) : null
  for (const g of gear) {
    const mine = ok.filter((s) => s.shoe_id === g.id && kmAt[s.activity_id] != null)
    const row = { gear_id: g.id, name: g.name, km: r(g.distance_m / 1000, 0), retired: !!g.retired, n: mine.length, flag: null }
    if (model && mine.length >= 8) {
      const res = mine.map((s) => s.ef - (model.coef[0] + model.coef[1] * s.run_pace + model.coef[2] * temp(s) + model.coef[3] * (s.elapsed_s / 60))), x = mine.map((s) => kmAt[s.activity_id]), R = rng(5), slopes = []
      const slope = (xs, ys) => ols(xs.map((v) => [v]), ys).coef[1]
      for (let b = 0; b < 200; b++) { const ix = mine.map(() => Math.floor(R() * mine.length)); if (new Set(ix).size > 3) slopes.push(slope(ix.map((i) => x[i]), ix.map((i) => res[i]))) }
      const sl = slope(x, res), ci = [quantile(slopes, 0.025), quantile(slopes, 0.975)]
      Object.assign(row, { ef_resid_per_100km: r(sl * 100, 4), ci_per_100km: ci.map((c) => r(c * 100, 4)), flag: ci[1] < 0 ? 'EF declining with mileage (CI excludes 0)' : ci[0] > 0 ? 'EF improving with mileage' : 'no clear change' })
    } else row.flag = 'insufficient data (needs n ≥ 8)'
    out.push(row)
  }
  return out.sort((a, b) => b.km - a.km)
}
function fadeCurves(S) {
  const cls = { '10k': [8000, 13000], hm: [19000, 24000], '25_35': [24000, 37000], fm: [37000, 50000] }, out = {}
  for (const [name, [lo, hi]] of Object.entries(cls)) {
    const L = S.filter((s) => s.distance_m >= lo && s.distance_m < hi); if (!L.length) { out[name] = { n: 0 }; continue }
    const per = {}; for (const s of L) for (const k of JSON.parse(s.km)) (per[k.km] ||= []).push(k.runShare)
    out[name] = { n: L.length, run_share: Object.entries(per).map(([k, v]) => ({ km: +k, v: r(mean(v), 2) })).sort((a, b) => a.km - b.km).slice(0, 45), run_share_overall: r(mean(L.map((s) => s.run_share)), 2), ef_median: r(quantile(L.map((s) => s.ef), 0.5), 3) }
  }
  return out
}
function races(S, kv) {
  const base = TARGET.baseline, fm = S.filter((s) => s.distance_m > 40000).map((s) => ({ date: s.date, km: r(s.distance_m / 1000, 1), time_s: s.elapsed_s, vdot: r(vdotFromRace(Math.min(42195, s.distance_m), s.elapsed_s), 1), ratio: r(vdotFromRace(Math.min(42195, s.distance_m), s.elapsed_s) / base, 2), run_share: s.run_share, open_hr: JSON.parse(s.metrics).open_hr_first_hour }))
  const res = kv['lumpad.results']?.value || {}
  return { baseline_vdot: base, realization_ratio_note: 'Jakim 14 Jun 2026 (6:53:03) = 0.59 (KB); DNF/black-flag races are not valid VDOT points', fm_attempts: fm, results_logged: Object.keys(res).length }
}
function injury(T) {
  const log = idb.prepare('SELECT date, pain FROM daily_log WHERE pain IS NOT NULL ORDER BY date').all(), sites = {}
  for (const l of log) for (const [k, v] of Object.entries(JSON.parse(l.pain))) { const s = (sites[k] ||= { last_pain_date: null, last_pain: 0, pain_free_days: null, events_90d: 0 }); if (v > 0) { s.last_pain_date = l.date; s.last_pain = v } if (v >= 2 && l.date > addDays(T, -90)) s.events_90d++ }
  for (const s of Object.values(sites)) s.pain_free_days = s.last_pain_date ? Math.round((Date.parse(T) - Date.parse(s.last_pain_date)) / 864e5) : null
  return { sites, log_days_90d: log.filter((l) => l.date > addDays(T, -90)).length, note: log.length ? null : 'no pain log yet — injury state unknown, not "healthy"' }
}
function plan(T, kv) {
  const day = PLAN_BY[T] || null, results = kv['lumpad.results']?.value || {}, next = CHECKPOINTS.find((c) => c.date >= T)
  let kg = null; try { kg = killGate(results) } catch {}
  return { phase: day?.phase ?? null, week: day?.week ?? null, today: day ? { km: day.km, kind: day.kind, label: day.label } : null, next_cp: next ? { id: next.id, date: next.date, name: next.name, line: next.line ?? null } : null, kill_gate: kg?.fired ? 'triggered' : 'ok' /* killGate returns { fired, why }; it read .triggered/.warn before, so it always said 'ok' */, race_date: '2027-10-24' }
}
// P(sub-4) Monte Carlo [MODEL]: illustrative scenarios, NOT a prediction. Fitness gain per month ~ N(rate, 0.25) clipped ≥ 0; the FM realises
// fitness × ratio (KB 06.5: FM VDOT 37.9 needs fitness 39.9 at ratio 0.95). Observed ratio: 0.59 (Jakim, n=1, confounded); the plan assumes 0.95.
export function projection(T, vdot0) {
  const months = Math.max(0, (Date.parse('2027-10-24') - Date.parse(T)) / (30.44 * 864e5))
  const run = (seed, rate, [a, c, b]) => {
    const R = rng(seed), out = [], gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += R(); return (u - 3) / 0.7071 }
    const tri = (lo, mode, hi) => { const u = R(), F = (mode - lo) / (hi - lo); return u < F ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode)) }
    for (let i = 0; i < 4000; i++) { const v = vdot0 + months * Math.max(0, rate + 0.25 * gauss()), ratio = tri(a, c, b); out.push(raceTime(Math.max(15, v * ratio), 42195)) }
    return { fm_time_p10_p50_p90: [10, 50, 90].map((p) => Math.round(quantile(out, p / 100))), p_sub4: r(out.filter((t) => t < 14400).length / out.length, 3) }
  }
  const need = (target, ratio) => (target / ratio - vdot0) / Math.max(0.1, months)
  return { months_to_race: r(months, 1), vdot0,
    scenarios: [
      { name: 'observed pace of improvement, realistic marathon ratio', gain_per_month: 0.6, ratio: [0.70, 0.90, 0.97], ...run(11, 0.6, [0.70, 0.90, 0.97]) },
      { name: 'best observed pace (0.74/mo), good marathon ratio', gain_per_month: 0.74, ratio: [0.80, 0.93, 0.98], ...run(12, 0.74, [0.80, 0.93, 0.98]) },
      { name: 'plan assumptions (1.02/mo, ratio ≈ 0.95)', gain_per_month: 1.02, ratio: [0.90, 0.95, 0.98], ...run(13, 1.02, [0.90, 0.95, 0.98]) },
    ],
    required_gain_per_month: { 'ratio 0.95': r(need(37.9, 0.95), 2), 'ratio 0.90': r(need(37.9, 0.9), 2) },
    label: '[MODEL] scenarios built on stated assumptions; the ratio is the biggest unknown (observed 0.59, n=1). Not a prediction.' }
}

// physiological profile: the athlete's COROS settings + what the data currently shows (so a stale setting is visible)
function profile(S, T) {
  const h = app.prepare('SELECT resting_hr FROM health_daily WHERE date > ? AND date <= ? AND resting_hr IS NOT NULL').all(addDays(T, -7), T).map((x) => x.resting_hr)
  const maxObs = Math.max(0, ...S.filter((s) => s.date > addDays(T, -180)).map((s) => JSON.parse(s.metrics).max_hr || 0)) || null
  return { lthr: ATHLETE.lthr, hrmax: ATHLETE.hrmax, rhr_setting: ATHLETE.rhr, threshold_pace_s_km: ATHLETE.tpace_s, z2_ceiling: Z2_CEILING, vo2max_coros: ATHLETE.vo2max_coros, weight_kg: ATHLETE.weight_kg, src: ATHLETE.src,
    rhr_7d: h.length ? r(mean(h), 0) : null, hrmax_observed_180d: maxObs, devices: ATHLETE.devices }
}
// 30-day vs 90-day baselines for the anomaly check (steady 3–15 km runs, run share ≥ 0.9) + biomechanical signature (COROS Pod 2)
function baselines(S, T) {
  const steady = (d) => S.filter((s) => s.date > addDays(T, -d) && s.run_share >= 0.9 && s.distance_m >= 3000 && s.distance_m <= 15000)
  const pick = (L, f) => L.map(f).filter((x) => x != null && isFinite(x)), m = (s) => JSON.parse(s.metrics), mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null) // empty → null, never 0
  const one = (d) => { const L = steady(d); return { n: L.length, ef: r(mean(pick(L, (s) => s.ef)), 3), hr_at_800: r(mean(pick(L, (s) => s.hr800))), pace_at_hr150_s: r(mean(pick(L, (s) => s.pace_hr150)), 0),
    cadence_spm: r(mean(pick(L, (s) => m(s).run_cad))), gct_ms: r(mean(pick(L, (s) => m(s).run_gct)), 0), stride_m: r(mean(pick(L, (s) => m(s).run_step)), 3), vertical_ratio_pct: r(mean(pick(L, (s) => m(s).run_vr)), 2) } }
  const a = one(30), b = one(90), delta = (k) => (a[k] != null && b[k] != null ? r(a[k] - b[k], k === 'ef' ? 3 : k === 'stride_m' ? 3 : 1) : null)
  return { d30: a, d90: b, delta_30_vs_90: Object.fromEntries(['ef', 'hr_at_800', 'pace_at_hr150_s', 'cadence_spm', 'gct_ms', 'stride_m', 'vertical_ratio_pct'].map((k) => [k, delta(k)])),
    note: 'EF up / HR@8:00 down / pace@HR150 lower = fitter. Means of steady 3–15 km runs; small n is noisy.' }
}
// intensity distribution over 28 days from per-second HR (six COROS zones) + easy runs above the Z2 ceiling
function intensity(S, T) {
  const L = S.filter((s) => s.date > addDays(T, -28)), tot = Array(7).fill(0)
  for (const s of L) { const z = JSON.parse(s.metrics).z6?.hr_s; if (z) z.forEach((v, i) => { tot[i] += v }) }
  const all = tot.reduce((x, y) => x + y, 0), pct = all ? tot.map((v) => Math.round((v / all) * 100)) : null
  const easy = L.filter((s) => s.distance_m <= 15000 && ['easy', 'social', 'recovery'].includes(PLAN_BY[s.date]?.kind || 'easy') && s.run_hr != null)
  return { hr_zone_pct_28d: pct, low_share_pct: pct ? pct[0] + pct[1] + pct[2] : null, minutes_28d: Math.round(all / 60), easy_runs: easy.length, easy_runs_above_z2: easy.filter((s) => s.run_hr > Z2_CEILING).length, z2_ceiling: Z2_CEILING }
}
// strength → running transfer: gym-vs-fresh matrix + any correlation edges whose exposure is strength
function strengthTransfer() {
  let mx = null; try { mx = matrices() } catch {}
  const edges = listEdges().filter((e) => /^strength/.test(e.exposure)).slice(0, 6).map((e) => ({ exposure: e.exposure, outcome: e.outcome, days_before: [e.lag_lo, e.lag_hi], partial_rho: e.partial_rho, n: e.n, status: e.status }))
  return { gym_vs_fresh: mx?.gym_to_stride || [], by_lag_hours: mx?.gym_lag || [], edges, note: 'associations in observational data, not proof of cause' }
}
export function buildTwin(T = wibDate()) {
  const kv = load('kv', {}), S = sessions('2025-01-01'), aer = aerobic(S, T, hr800Baseline(T)), lr = loadAndReadiness(T, { z: aer.hr_at_800.z, n: aer.hr_at_800.n })
  const results = kv['lumpad.results']?.value || {}, last = CHECKPOINTS.filter((c) => results[c.id]?.vdot != null && c.kind === 'tt').at(-1), vdot0 = last ? results[last.id].vdot : TARGET.baseline
  const gaps = []; const noShoe = S.filter((s) => s.date >= '2026-01-01' && !s.shoe_id).length; if (noShoe) gaps.push(`${noShoe} runs in 2026 without a shoe`)
  const noWx = idb.prepare("SELECT COUNT(*) n FROM fit_session s LEFT JOIN run_weather w ON w.label_id=s.label_id WHERE w.label_id IS NULL").get().n; if (noWx) gaps.push(`${noWx} sessions without weather`)
  if (!idb.prepare('SELECT COUNT(*) n FROM daily_log WHERE pain IS NOT NULL').get().n) gaps.push('no pain log yet')
  const pending = app.prepare("SELECT 1 FROM activities WHERE sport='Run' AND source='coros'").all().length - S.length; if (pending > 0) gaps.push(`${pending} runs have no FIT file yet (laps-only metrics)`)
  return { schema: SCHEMA, as_of: T, physiological_profile: profile(S, T), ...lr, baselines: baselines(S, T), intensity: intensity(S, T), strength_to_run_transfer: strengthTransfer(), aerobic: aer, durability: durability(S, T), heat: heat(S), shoes: shoes(S), fade_curves: fadeCurves(S), races: races(S, kv), injury: injury(T), plan: plan(T, kv),
    projection: projection(T, vdot0), sessions_with_fit: S.length, data_gaps: gaps }
}
// write a new version only when the content (minus the date) changed
export function saveTwin(trigger = 'job', T = wibDate()) {
  const state = buildTwin(T), body = JSON.stringify({ ...state, as_of: undefined }), hash = crypto.createHash('sha256').update(body).digest('hex')
  const last = idb.prepare('SELECT version, inputs_hash FROM twin_state ORDER BY version DESC LIMIT 1').get()
  if (last?.inputs_hash === hash) return { version: last.version, changed: false }
  const id = Number(idb.prepare('INSERT INTO twin_state (as_of, created_at, trigger, schema, inputs_hash, state) VALUES (?,?,?,?,?,?)').run(T, new Date().toISOString(), trigger, SCHEMA, hash, JSON.stringify(state)).lastInsertRowid)
  return { version: id, changed: true }
}
export const latestTwin = (version) => { const row = version ? idb.prepare('SELECT * FROM twin_state WHERE version=?').get(version) : idb.prepare('SELECT * FROM twin_state ORDER BY version DESC LIMIT 1').get(); return row ? { version: row.version, created_at: row.created_at, trigger: row.trigger, state: JSON.parse(row.state) } : null }
export function twinDiff(a, b) {
  const A = latestTwin(a)?.state, B = latestTwin(b)?.state; if (!A || !B) return null
  const out = {}, walk = (x, y, path) => { if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? path + '.' + k : k) } else if (JSON.stringify(x) !== JSON.stringify(y) && typeof x !== 'object') out[path] = { from: x, to: y } }
  walk(A, B, ''); return out
}
