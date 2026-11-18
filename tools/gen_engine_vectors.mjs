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
