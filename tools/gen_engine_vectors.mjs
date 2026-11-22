// Test vectors for the Go engine: runs the CURRENT JavaScript libraries on synthetic inputs (no personal data) and stores inputs + outputs.
// Regenerate with: node tools/gen_engine_vectors.mjs   (Go tests then require identical output)
import fs from 'node:fs'
import { pmc, acwrRolling, monotonyStrain, formZone, ctlRamp, project } from '../src/lib/load.js'
import { vdotFromRace, raceTime, paces, paceSecPerKm, fmtPace, fmtTime } from '../src/lib/vdot.js'
let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10)
const mkSeries = (n, zeros) => Array.from({ length: n }, (_, i) => ({ date: day(i), load: rnd() < zeros ? 0 : Math.round(20 + rnd() * 160) }))
const out = { load: [], vdot: {} }
for (const [n, z] of [[0, 0], [5, 0], [7, 0], [10, 0.2], [35, 0.3], [36, 0.1], [90, 0.25], [120, 0.4], [60, 1], [14, 0]]) {
  const s = mkSeries(n, z), P = pmc(s), ms = monotonyStrain(s)
  out.load.push({ series: s, pmc: P, acwr: acwrRolling(s), acwr20: acwrRolling(s, Math.min(20, n - 1)), mono: ms, ramp: ctlRamp(P), forms: [-45, -30, -29.9, -10, 0, 5, 5.1, 25, 40, null].map((x) => formZone(x)?.id ?? null),
    project: P.length ? project(P.at(-1), mkSeries(14, 0.2)) : [] })
}
// project needs the planned series it was run with: store it
out.load.forEach((c) => { if (c.pmc.length) { seed = 99; const pl = mkSeries(14, 0.2); c.planned = pl; c.project = project(c.pmc.at(-1), pl) } })
out.vdot.races = [[5000, 1782], [10000, 3655], [21097.5, 10451], [42195, 24783], [42195, 14400], [1609.34, 507], [3000, 900]].map(([m, s]) => ({ m, s, vdot: vdotFromRace(m, s) }))
out.vdot.times = [28, 31.7, 35, 37.9, 39.9, 45, 52].flatMap((v) => [[5000], [10000], [21097.5], [42195]].map(([m]) => ({ vdot: v, m, t: raceTime(v, m) })))
out.vdot.paces = [28, 31.7, 39.9, 52].map((v) => ({ vdot: v, paces: paces(v), e: paceSecPerKm(v, 0.59) }))
out.vdot.fmt = [0, 59.5, 60, 359.4, 359.5, 3599.5, 3600, 14399.5, 14400, 24783].map((s) => ({ s, pace: fmtPace(s), time: fmtTime(s) }))
fs.writeFileSync('lumpadd/internal/engine/testdata/vectors.json', JSON.stringify(out))
console.log('vectors:', out.load.length, 'load cases,', out.vdot.times.length, 'race times')

// ---- Phase 2-c: HRV / RHR / sleep states, distance progression, composite readiness (separate RNG so the vectors above stay identical)
const { hrvState, rhrState } = await import('../src/lib/hrv.js'), { sleepState } = await import('../src/lib/sleep.js'), { computeReadiness } = await import('../src/lib/readiness.js')
const { distanceProgression } = await import('../src/lib/load.js')
let s2 = 7; const rn = () => ((s2 = (s2 * 1664525 + 1013904223) % 4294967296) / 4294967296), pick = (a) => a[Math.floor(rn() * a.length)]
const nul = (p, v) => (rn() < p ? null : v)
out.health = []
const PH = ['BASE', 'BUILD', 'PEAK', 'TAPER', 'RACE WEEK', undefined]
for (let c = 0; c < 60; c++) {
  const days = pick([5, 12, 20, 40, 75, 90]), gap = pick([0, 0.1, 0.3, 0.6]), date = day(200 + c), health = []
  for (let i = days - 1; i >= 0; i--) {
    if (i > 0 && rn() < gap) continue
    const total = nul(0.1, Math.round(300 + rn() * 260))
    health.push({ date: day(200 + c - i), hrv_avg: nul(gap, Math.round(25 + rn() * 50)), resting_hr: nul(gap, Math.round(42 + rn() * 14)), sleep_total_min: total,
      sleep_awake_min: nul(0.3, Math.round(rn() * 60)), sleep_deep_min: nul(0.2, Math.round(rn() * 120)), sleep_rem_min: nul(0.2, Math.round(rn() * 120)), sleep_light_min: nul(0.2, Math.round(rn() * 250)),
      sleep_score: nul(0.3, Math.round(40 + rn() * 60)), sleep_hr_avg: nul(0.3, Math.round(50 + rn() * 22)) })
  }
  const acts = Array.from({ length: Math.floor(rn() * 12) }, () => ({ date: day(200 + c - Math.floor(rn() * 15)), sport_class: rn() < 0.8 ? 'run' : 'other', distance_m: Math.round(rn() * 25000) }))
  const need = pick([420, 480, 510]), series = mkSeries(pick([0, 6, 20, 40]), 0.3)
  const P = pmc(series), f = { pain: pick(['', null, 0, 1, 1.5, 2, 3]), energy: pick(['', null, 1, 2, 3, 4, 5, 3.5]), sleepHR: pick(['', null, 60, 68, 70.5]), hrv: pick([undefined, 'reduced', 'balanced']), tibia: pick([undefined, true, false]) }
  const hrv = hrvState(health, date), rhr = rhrState(health, date), sleep = sleepState(health, date, need), prog = distanceProgression(acts, date), mono = monotonyStrain(series)
  const inp = { phase: pick(PH), hard: rn() < 0.5, sleepHR: pick([null, 64, 69]), muscleMax: pick([null, 0, 1.25, 2.5, 3.5]), aerobic: pick([null, { z: 1.2, n: 5 }, { z: 2.4, n: 3 }, { z: 3.1, n: 2 }, { z: 2, n: 4 }, { z: null, n: 0 }]) }
  const rd = computeReadiness({ f, hrv, rhr, sleep, pmcPoint: P.at(-1) || null, monotony: mono, progression: prog, ...inp })
  out.health.push({ date, need, health, acts, series, f, ...inp, hrv, rhr, sleep, prog, readiness: rd })
}
fs.writeFileSync('lumpadd/internal/engine/testdata/vectors.json', JSON.stringify(out))
console.log('health/readiness cases:', out.health.length)

// ---- Phase 2-d: race-pace simulator, zone ranges, per-lap zone seconds, workout estimate
const P2 = await import('../src/lib/pacing.js'), Z = await import('../src/lib/zones.js')
let s3 = 5; const r3 = () => ((s3 = (s3 * 1664525 + 1013904223) % 4294967296) / 4294967296), pk = (a) => a[Math.floor(r3() * a.length)]
const COPS = [['COP 1', 10, '05:40'], ['COP 2', 21.1, '06:45'], ['COP 3', 30, '07:50'], ['Finish', 42.195, '09:00']]
out.pacing = { heat: [null, 0, 8, 8.1, 12, 20, 28, 40, 60].map((w) => ({ w, p: P2.heatPenalty(w) })), sims: [], hms: [0, 59.4, 59.5, 3599.5, 14399.4, 24783.2, 86399].map((s) => ({ s, f: P2.fmtHMS(s) })) }
for (let i = 0; i < 40; i++) {
  const inp = { runPace: pk([0, -1, 300, 341, 380.5, 420, 455]), walkPace: pk([0, 540, 600, 720.3]), runS: pk([0, 60, 240, 300, 600]), walkS: pk([0, 30, 60, 90]), wbgt: pk([0, 18, 24.5, 29, 33]), gunMin: pk([240, 270, 300]), cops: COPS.slice(0, pk([0, 2, 4])), goalS: pk([14400, 18000]) }
  out.pacing.sims.push({ inp, out: P2.simulate(inp) })
}
const cfgs = [{ lthr: 168, tpace: 356 }, { lthr: 172, tpace: 367 }, { lthr: 155.5, tpace: 301 }]
out.zones = cfgs.map((cfg) => {
  const laps = Array.from({ length: 30 }, () => ({ duration_s: pk([null, 0, 300, 365.4, 420]), avg_hr: pk([null, 0, 90, 109, 110, 140, 150, 151, 158, 160, 165, 171, 180]), avg_pace_s_km: pk([null, 0, 300, 330, 356, 380, 400, 460, 520, 600]) }))
  const steps = [[{ t: 'wu', sec: 600 }, { t: 'run', m: 3000, z: 2 }, { rep: 4, steps: [{ t: 'run', m: 1000, z: 4 }, { t: 'rec', sec: 120, z: 1 }] }, { t: 'cd', sec: 300 }],
    [{ t: 'free' , sec: 1800 }], [{ t: 'run', m: 10000, pace: [340, 350], z: 3 }, { t: 'run', m: 500 }, { t: 'rec', sec: 0, z: 1 }, { t: 'tt', m: 5000, z: 6 }],
    [{ rep: 3, steps: [{ t: 'run', sec: 480, z: 5 }, { t: 'rec', m: 400, z: 1 }] }]]
  return { cfg, ranges: [0, 1, 2, 3, 4, 5, 6, 7].map((z) => ({ z, hr: Z.hrRange(z, cfg), pace: Z.paceRange(z, cfg) })), laps, zs: Z.zoneSeconds(laps, cfg), steps: steps.map((s) => ({ s, est: Z.estimate(s, cfg), km: Z.stepKm(s) })) }
})
fs.writeFileSync('lumpadd/internal/engine/testdata/vectors.json', JSON.stringify(out))
console.log('pacing sims:', out.pacing.sims.length, 'zone cfgs:', out.zones.length)

// ---- Phase 2-f: statistics library and the correlation engine on a synthetic dataset
const ST = await import('../server/intel/stats.js'), CO = await import('../server/intel/corr.js')
let s4 = 3; const r4 = () => ((s4 = (s4 * 1664525 + 1013904223) % 4294967296) / 4294967296)
const R = ST.rng(12345), rngs = Array.from({ length: 20 }, () => R())
const a = Array.from({ length: 30 }, () => Math.round(r4() * 10)), b = a.map((x) => x * 0.7 + r4() * 5), Zs = a.map(() => [r4() * 100, Math.round(r4() * 4), r4()])
out.stats = { rng7: Array.from({ length: 5 }, ((g) => () => g())(ST.rng(7))), rngs, a, b, Z: Zs, rank: ST.rank(a), q: [0, 0.025, 0.5, 0.975, 1].map((q) => ST.quantile(b, q)), pearson: ST.pearson(a, b), spearman: ST.spearman(a, b),
  ols: ST.ols(Zs, b), partial: ST.partialSpearman(a, b, Zs), acf1: ST.acf1(b), neff: ST.nEff(30, b), shift: ST.shiftP(a, b), boot: ST.blockBootstrapCI(a, b, a.map((x, i) => 'w' + Math.floor(i / 4)), ST.spearman, 50, 7),
  bh: ST.bh([0.01, 0.04, 0.03, 0.2, 0.04, 0.9, 0.001]), weeks: ['2026-01-01', '2026-01-04', '2026-01-05', '2025-12-29', '2027-01-01', '2026-12-31', '2020-12-31', '2021-01-03'].map((d) => d) }
// synthetic sessions: a planted association (thr_min 4–7 d → pace_hr150) so some edges are significant
const keys = CO.EXPOSURES.flatMap((e) => (e.windows || CO.WINDOWS).map(([lo, hi]) => `${e.id}__${lo}_${hi}`))
const syn = Array.from({ length: 70 }, (_, i) => { const x = Object.fromEntries(keys.map((k) => [k, r4() < 0.05 ? null : Math.round(r4() * 50)])), thr = x['thr_min__4_7'] ?? 0
  return { date: new Date(Date.UTC(2026, 0, 1) + Math.floor(i * 2.5) * 864e5).toISOString().slice(0, 10), ctl: [330 + r4() * 60, 20 + r4() * 10, 30 + r4() * 90, 5 + r4() * 20],
    y: { gct_fade: r4() < 0.1 ? null : r4() * 20, drift: r4() * 8, ef_resid: r4() < 0.5 ? null : r4() - 0.5, run_share_long: r4() < 0.6 ? null : 0.7 + r4() * 0.3, stride_fade: r4() * 0.1, pace_hr150: 420 - thr * 0.8 + r4() * 10, gct_avg: 260 + r4() * 30 }, x } })
out.stats.weekLabels = out.stats.weeks.map((d) => { const t = new Date(d + 'T12:00:00Z'), day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3); const y = t.getUTCFullYear(), j = new Date(Date.UTC(y, 0, 4)); return `${y}-W${Math.round(((t - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7) + 1}` })
out.corr = { sessions: syn, result: CO.computeEdges(syn, { B: 60, seed: 7 }) }
fs.writeFileSync('lumpadd/internal/engine/testdata/vectors.json', JSON.stringify(out))
console.log('corr synthetic: tested', out.corr.result.tested, 'significant', out.corr.result.edges.filter((e) => e.status !== 'none').length)
