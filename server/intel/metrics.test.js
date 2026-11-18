import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
process.env.DATA_DIR = '/tmp/lumpad-test-data'
const { toSeries, parseFitFile } = await import('./fit.js')
const M = await import('./metrics.js')

// synthetic 1 Hz series: speed m/s, cadence spm, hr; distance integrates speed
function synth(secs, fn) {
  const n = secs, f = () => new Float64Array(n).fill(NaN), S = { n, t0: 0, speed: f(), dist: f(), hr: f(), cad: f(), power: f(), gct: f(), vo: f(), vr: f(), step: f(), alt: f(), effort: f(), paused: new Uint8Array(n), session: { sport: 'running', ascent: 0 } }
  let d = 0
  for (let i = 0; i < n; i++) { const x = fn(i); d += x.speed; Object.assign({}, x); S.speed[i] = x.speed; S.dist[i] = d; S.hr[i] = x.hr; S.cad[i] = x.cad; S.power[i] = x.power ?? 170; S.gct[i] = x.gct ?? 300 + (x.gctDrift || 0); S.step[i] = x.step ?? 0.9; S.vr[i] = 9; S.vo[i] = 80; S.alt[i] = 100; S.effort[i] = x.speed }
  return S
}
test('steady run: run share ~1, no stops, EF = speed/HR, drift ≈ 0', () => {
  const S = synth(4000, () => ({ speed: 2.5, hr: 150, cad: 170 })), m = M.sessionMetrics(S)
  assert.ok(m.run_share > 0.99); assert.equal(m.stop_s, 0)
  assert.ok(Math.abs(m.ef - (2.5 * 60) / 150) < 0.005)
  assert.ok(Math.abs(m.drift_pahr.value) < 0.5)
})
test('cardiac drift: HR rising 8 % in the second half gives ≈ 8 % drift', () => {
  const S = synth(4000, (i) => ({ speed: 2.5, hr: i < 2000 ? 150 : 162, cad: 170 })), m = M.sessionMetrics(S)
  assert.ok(m.drift_pahr.value > 4 && m.drift_pahr.value < 9, String(m.drift_pahr.value))
})
test('drift is null (with a reason) for intervals / run-walk — never a fake number', () => {
  const S = synth(4000, (i) => ({ speed: i % 600 < 300 ? 3.5 : 1.5, hr: 150, cad: i % 600 < 300 ? 172 : 100 }))
  const m = M.sessionMetrics(S); assert.equal(m.drift_pahr.value, null); assert.match(m.drift_pahr.why, /run share|CV/)
})
test('walk breaks (cadence < 125) are separated from running; stops from distance not advancing', () => {
  const S = synth(1200, (i) => (i < 400 ? { speed: 2.5, hr: 150, cad: 170 } : i < 800 ? { speed: 1.4, hr: 130, cad: 100 } : { speed: 0, hr: 120, cad: 0 }))
  const m = M.sessionMetrics(S); assert.ok(Math.abs(m.run_s - 400) <= 2 && Math.abs(m.walk_s - 400) <= 2 && Math.abs(m.stop_s - 400) <= 2, JSON.stringify([m.run_s, m.walk_s, m.stop_s]))
})
test('fade: GCT +30 ms and stride −0.04 m late in a long run are measured; onset km found when run share collapses', () => {
  const S = synth(7200, (i) => ({ speed: 2.5, hr: 150, cad: i > 5400 ? 150 : 170, gct: i > 5400 ? 335 : 305, step: i > 5400 ? 0.85 : 0.9 }))
  const m = M.sessionMetrics(S); assert.ok(m.bio_fade.gct_ms > 15 && m.bio_fade.stride_m < -0.02, JSON.stringify(m.bio_fade))
  const S2 = synth(8000, (i) => (i < 2500 ? { speed: 2.5, hr: 150, cad: 170 } : { speed: 1.6, hr: 140, cad: 100 })); const m2 = M.sessionMetrics(S2)
  assert.equal(m2.fade_onset.trigger, 'run_share<85%'); assert.ok(m2.fade_onset.km >= 5 && m2.fade_onset.km <= 8, String(m2.fade_onset.km))
})
test('HR@8:00 uses steady blocks only and corrects to exactly 8:00 with the pooled slope', () => {
  const S = synth(3000, () => ({ speed: 1000 / 470, hr: 140, cad: 165 })), m = M.sessionMetrics(S) // pace 7:50 → HR@8:00 = 140 + (−0.073)(480−470) = 139.27
  assert.ok(Math.abs(m.hr_at_800 - 139.3) < 0.2, String(m.hr_at_800))
})

// --- golden: numbers the KB (04.9 §5D) validated for Borobudur FM 15 Nov 2026 — runs only when the private FIT is on disk
const GOLD = '/opt/lumpad/server/data/fit/2026/481762580755415341.fit'
test('GOLDEN Borobudur 0–35 km from the start line = KB 04.9 §5D', { skip: !fs.existsSync(GOLD) }, async () => {
  const S = toSeries(await parseFitFile(GOLD)), cls = M.classify(S)
  const i0 = Math.round((Date.parse('2026-11-14T21:30:08Z') - S.t0) / 1000), d0 = S.dist[i0], [a, b] = M.distRange(S, d0, d0 + 35000), w = M.window(S, cls, a, b)
  assert.equal(w.elapsed, 5 * 3600 + 12 * 60 + 39)   // 5:12:39
  assert.equal(w.stop, 10 * 60 + 14)                  // 10:14
  assert.ok(Math.abs(w.run - (2 * 3600 + 31 * 60 + 6)) <= 2)    // run 2:31:06
  assert.ok(Math.abs(w.walk - (2 * 3600 + 31 * 60 + 19)) <= 2)  // walk 2:31:19
  assert.ok(Math.abs(w.economy - 77.7) < 0.15 && Math.abs(w.ef - 0.787) < 0.002 && Math.abs(w.beatsKm - 1271) < 3 && Math.abs(w.runHr - 169.4) < 0.1)
})
test('GOLDEN 10 Nov 2026 HR@8:00 ≈ 160.5 (KB 04.8) and Borobudur km-5 run-walk onset', { skip: !fs.existsSync(GOLD) }, async () => {
  const m = M.sessionMetrics(toSeries(await parseFitFile(GOLD)))
  assert.equal(m.fade_onset.km, 5); assert.equal(m.mech_abs_km, 2)
  const f10 = '/opt/lumpad/server/data/fit/2026/481644044223545447.fit'
  if (fs.existsSync(f10)) { const m10 = M.sessionMetrics(toSeries(await parseFitFile(f10))); assert.ok(Math.abs(m10.hr_at_800 - 160.5) < 2, String(m10.hr_at_800)) }
})
