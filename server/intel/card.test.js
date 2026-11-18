import test from 'node:test'
import assert from 'node:assert/strict'
import { semanticTags, buildCard } from './card.js'

const base = { distance_m: 10000, elapsed_s: 4200, run_share: 0.97, run_pace: 420, run_hr: 141, ef: 0.95, gain_m: 20, bio_fade: { gct_ms: 4 }, drift_pahr: { value: 2.1 }, pacing: { split: 'negative', split_pct: -1.8, cv_pct: 2, score: 80, km: 8 }, z6: { hr_s: [0, 600, 2400, 600, 0, 0, 0], pace_s: [0, 300, 3000, 300, 0, 0, 0] }, lthr_pct: 84 }
test('semantic tags: disciplined easy run vs intensity creep (Z2 ceiling 148 at LTHR 168)', () => {
  const easy = semanticTags({ m: base, plan: { kind: 'easy' }, ctx7: { lower_72h: true, tsb: -10 }, shoe: { name: 'HOKA Clifton 10' } })
  assert.ok(easy.includes('#z2_disciplined') && easy.includes('#negative_split') && easy.includes('#gct_stable') && easy.includes('#leg_day_72h') && easy.includes('#shoe_hoka_clifton_10'))
  const hot = semanticTags({ m: { ...base, run_hr: 156, drift_pahr: { value: 7 }, bio_fade: { gct_ms: 14 } }, plan: { kind: 'easy' }, weather: { wbgt: 29 } })
  assert.ok(hot.includes('#intensity_creep') && hot.includes('#cardiac_drift_high') && hot.includes('#gct_drift') && hot.includes('#heat_wbgt_high'))
})
test('race and long-run tags; card carries zones, pacing, 7-day context and the tags line', () => {
  assert.ok(semanticTags({ m: { ...base, distance_m: 42500, run_share: 0.5 }, race: true }).includes('#race_fm'))
  const c = buildCard({ date: '2026-11-10', m: base, plan: { kind: 'easy' }, ctx7: { km7: 31.2, tsb: -12, ctl: 40, atl: 52, lower_72h: true, sleep_min: 410 } })
  assert.match(c, /HR zones/); assert.match(c, /Pacing: negative split/); assert.match(c, /7-day context: 31\.2 km run · TSB -12/); assert.match(c, /Semantic tags: .*#z2_disciplined/)
})
test('race fade: FM compares km 1–20 with km 30–42; HM km 1–10 with 15–21', async () => {
  const { raceFade } = await import('./matrices.js')
  const km = Array.from({ length: 42 }, (_, i) => ({ km: i + 1, pace: i < 20 ? 420 : i < 29 ? 480 : 600, gct: i < 20 ? 300 : 330, runShare: i < 29 ? 1 : 0.5 }))
  const f = raceFade(km, 42.2); assert.equal(f.pace_early_s, 420); assert.equal(f.pace_late_s, 600); assert.equal(f.pace_fade_pct, 42.9); assert.equal(f.gct_fade_ms, 30); assert.equal(f.run_share_late, 0.5)
  const h = raceFade(km.slice(0, 21), 21.1); assert.equal(h.early, 'km 1–10'); assert.equal(h.late, 'km 15–21')
})
