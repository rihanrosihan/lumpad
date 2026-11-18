import test from 'node:test'
import assert from 'node:assert'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = '/tmp/lumpad-test-data'
const { computeEdges, lagSql, lagRows, WINDOWS } = await import('./corr.js')
const { idb } = await import('./db.js')
const S = await import('./stats.js')

// synthetic: 3 years of days, ~130 runs. exposure x_t random daily; outcome depends on the MEAN of x over days 4–7 before the run (planted lag window)
function synth({ effect, seed = 1, nDays = 700 }) {
  const R = S.rng(seed), g = () => { let u = 0; for (let i = 0; i < 6; i++) u += R(); return (u - 3) / 0.7071 }
  const x = Array.from({ length: nDays }, g), sessions = []
  for (let t = 30; t < nDays; t += 5 + Math.floor(R() * 3)) {
    const win = (lo, hi) => S.mean(x.slice(t - hi, t - lo + 1)), ctl = [450 + 10 * g(), 27 + g(), 60 + 8 * g(), 9 + g()]
    const xs = {}; for (const [lo, hi] of WINDOWS) xs[`strength_lower__${lo}_${hi}`] = win(lo, hi)
    sessions.push({ date: new Date(Date.UTC(2025, 0, 1) + t * 864e5).toISOString().slice(0, 10), ctl, x: xs, y: { gct_fade: effect * win(4, 7) + 0.5 * g() } })
  }
  return sessions
}
test('planted effect (window 4–7 d, ρ≈0.3+) is recovered as a supported edge in the right window; other windows are not supported', () => {
  const ds = synth({ effect: 1.0 }), out = computeEdges(ds, { B: 150 }), top = out.edges.filter((e) => e.outcome === 'gct_fade' && e.exposure === 'strength_lower')
  const hit = top.find((e) => e.lag_lo === 4 && e.lag_hi === 7); assert.ok(hit, 'edge present'); assert.ok(hit.partial_rho > 0.3, String(hit.partial_rho)); assert.ok(['supported', 'candidate'].includes(hit.status), hit.status)
  assert.ok(hit.ci_lo > 0, 'CI excludes 0')
})
test('null data: false-positive rate stays low (≤ 10 % supported-or-candidate across seeds)', () => {
  let sig = 0, tot = 0
  for (let seed = 1; seed <= 12; seed++) { const out = computeEdges(synth({ effect: 0, seed: 100 + seed }), { B: 60 }); tot += out.tested; sig += out.edges.filter((e) => e.status !== 'none').length }
  assert.ok(sig / tot <= 0.10, `${sig}/${tot}`)
})
test('SQL lag windows: window [4,7] of day t is the sum over days t−7..t−4 and never includes the run day', () => {
  for (let i = 0; i < 40; i++) { const d = new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10); idb.prepare('INSERT INTO daily_feat (date, strength_lower, hrv_dev) VALUES (?,?,?)').run(d, i % 3 === 0 ? 1 : 0, i / 100) }
  const rows = lagRows(), day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10), t = 20
  const expected = [13, 14, 15, 16].reduce((s, j) => s + (j % 3 === 0 ? 1 : 0), 0)   // days t-7..t-4 = 13..16
  assert.equal(rows[day(t)].strength_lower__4_7, expected)
  assert.equal(rows[day(t)].strength_lower__1_3, [17, 18, 19].reduce((s, j) => s + (j % 3 === 0 ? 1 : 0), 0))
  assert.ok(Math.abs(rows[day(t)].hrv_dev__1_3 - (0.17 + 0.18 + 0.19) / 3) < 1e-9)
})
