// Structured workouts. COROS plan A courses rebuilt exactly from their course JSON (queryTrainingPlanDetails, 18 Nov 2026):
//   P10540 / P10594  WU 5′ · D km Z2 · CD 5′                               (easy / long, HR zone 2)
//   P10541 / P10545  WU 5′ · 3 km Z2 · (D−3) km Z3 · CD 5′                  (steady / long with an aerobic-power block)
//   P10547           WU 5′ · n × (r m Z2 + 3 km Z4) · CD 5′                (threshold cruise intervals)
//   P10544           WU 5′ · n × (1.6 km Z2 + 1.6 or 3 km Z3) · CD 5′       (aerobic-power alternations)
//   P10546           free-mode run · P10543 race-distance placeholder
const WU = { t: 'wu', sec: 300 }, CD = { t: 'cd', sec: 300 }, run = (m, z) => ({ t: 'run', m: Math.round(m), z })
const near = (a, b) => Math.abs(a - b) < 0.01

export function fromCoros(code, km) {
  const m = km * 1000
  switch (code) {
    case 'P10540': return { kind: 'easy', name: 'Aerobic Endurance Run', steps: [WU, run(m, 2), CD] }
    case 'P10594': return { kind: 'long', name: 'Long Run', steps: [WU, run(m, 2), CD] }
    case 'P10541': return { kind: 'quality', name: 'Steady Run · Aerobic Power', steps: [WU, run(3000, 2), run(m - 3000, 3), CD] }
    case 'P10545': return { kind: 'long', name: 'Long Run · Aerobic Power finish', steps: [WU, run(3000, 2), run(m - 3000, 3), CD] }
    case 'P10547': {
      const opt = [[1600, 4.6], [800, 3.8], [500, 3.5], [3000, 6]].find(([, per]) => near(km / per, Math.round(km / per)))
      const [r, per] = opt || [1600, 4.6], n = Math.max(1, Math.round(km / per))
      return { kind: 'quality', name: `Threshold Intervals ${n}×3 km`, steps: [WU, { rep: n, steps: [run(r, 2), run(3000, 4)] }, CD] }
    }
    case 'P10544': {
      const per = near(km / 3.2, Math.round(km / 3.2)) ? 1600 : 3000, n = Math.round(km / ((1600 + per) / 1000))
      return { kind: 'quality', name: `Aerobic Power Alternations ${n}×${per / 1000} km`, steps: [WU, { rep: n, steps: [run(1600, 2), run(per, 3)] }, CD] }
    }
    case 'P10546': return { kind: 'easy', name: 'Free Run (by feel)', steps: [{ t: 'free', z: 2, note: 'COROS free mode: run easy, end with the lap button' }] }
    default: return { kind: 'easy', name: 'Aerobic Endurance Run', steps: [WU, run(m, 2), CD] }
  }
}
export const easy = (km, name = 'Aerobic Endurance Run', z = 2) => ({ kind: 'easy', name, steps: [WU, run(km * 1000, z), CD] })
export const recovery = (km) => ({ kind: 'easy', name: 'Recovery Run', steps: [{ t: 'run', m: km * 1000, z: 1 }] })
// time trials: warm-up 2 km + strides, all-out distance, cool-down 2 km. Target pace = the checkpoint's green line.
export const timeTrial = (dist, pace) => ({ kind: 'tt', name: `${dist === 5000 ? '5K' : dist === 10000 ? '10K' : 'Half-marathon'} Time Trial`,
  steps: [{ t: 'wu', m: 2000, z: 2, note: 'finish with 4 × 20 s strides' }, { t: 'tt', m: dist, z: dist > 10000 ? 4 : 5, pace: pace ? [pace - 5, pace + 5] : undefined, note: 'even effort, all out over the last km' }, { t: 'cd', m: 2000, z: 1 }] })
export const race = (pace, note, z = 3) => ({ kind: 'race', name: 'Marathon', steps: [{ t: 'race', m: 42200, z, pace, note }] })
