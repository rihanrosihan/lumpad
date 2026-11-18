// Targets, weekly template notes and the 20 checkpoints. The day-by-day season lives in src/data/plan.json (tools/build_season.mjs).
export const TARGET = { goal: 'Sub-4:00 FM · JRF Sun 24 Oct 2027 (official date)', mp: '5:41', vdotRace: 37.9, vdotNeeded: 39.9, baseline: 31.7 }

export const TEMPLATE = {
  1: { run: 'Rest legs', goal: 'Tissue recovery', strength: 'Upper (3×8–12, RIR 2)' },
  2: { run: 'Main quality (I / T / sub-T / TT)', goal: 'VO2 / threshold / test — one purpose', strength: 'Bilateral Lower PM (tibialis position 1) · Plyo after warm-up', quality: true, note: 'AM, ≥6 h before Lower; pace = latest benchmark slot' },
  3: { run: 'Easy', goal: 'Aerobic base', strength: '—', note: 'Fasted only for easy ≤45 min / 5–6 km' },
  4: { run: 'Strides / hills (◇ tempo if the gate passes)', goal: 'Neuromuscular', strength: 'Unilateral Lower PM (tibialis position 1)', note: 'After Tuesday TT = easy' },
  5: { run: 'Easy', goal: 'Buffer before the long run', strength: '—' },
  6: { run: 'Long run (max 32 km; MP block 3→14 km)', goal: 'Durability + race specificity', strength: 'Full body PM', long: true, note: '≤110% of the longest run in 30 days; last 5 km of the MP block easy' },
  0: { run: 'Social run / race / TT / easy', goal: 'Aerobic volume or a test', strength: 'Full body only if not done on Saturday' },
}

// [id, date, name, kind, line(VDOT), note]. Dates re-timed to the COROS-based season (Nov 2026): time trials sit on the Saturday of
// cutback weeks (replacing that week's steady run), long-run checkpoints on the COROS long runs, gates on the Thursday of race week.
export const CHECKPOINTS = [
  [1, '2026-12-19', '5K TT · baseline B0', 'tt', 31.7, 'Cutback week 4. Pain ≥2/10 or HRV reduced → postpone 1 week'],
  [2, '2027-01-16', '5K TT · pre-Ramadan', 'tt', 32.0, 'Red → keep B0 paces through Ramadan'],
  [3, '2027-03-13', 'Anchor 5K TT · after Eid', 'tt', 33.0, 'Sets B1. Yellow/red → paces stay at B0'],
  [4, '2027-04-17', '10K TT', 'tt', 33.7, 'Sets B2. First red that counts toward the kill gate'],
  [5, '2027-04-25', '24 km long run proof', 'lr', null, 'Fuel 30–60 g/h; pain 0/10'],
  [6, '2027-05-15', '5K TT · cutback week', 'tt', 34.4, 'Sets B3'],
  [7, '2027-05-30', '27 km (24 km in Z3) · race-fueling + head-cooling rehearsal', 'lr', null, 'Fueling + sodium, race start time'],
  [8, '2027-06-03', '10K TT · Jakim pace check', 'tt', 35.4, 'Sets B4 and the Jakim pacing (sub-5:00 needs ≤7:06/km)'],
  [9, '2027-06-13', 'Jakim FM (B-race, target sub-5:00) + G-MJM gate Wed 16 Jun', 'race', null, 'Target sub-5:00 (7:06/km). Not a VDOT test'],
  [10, '2027-07-31', '5K TT · post-June return', 'tt', 36.8, 'Sets B5; measures the cost of two FMs in 7 days'],
  [11, '2027-08-28', 'HM TT · ratio gate', 'ratio', 35.5, 'Ratio ≥0.90 passes; <0.85 → re-target'],
  [12, '2027-09-12', '26 km long run · fuel 60 g/h', 'lr', null, 'Pain 0/10; drift ≤5% in the last hour'],
  [13, '2027-09-19', '27 km long run', 'lr', null, 'Longest Z2 run of the JRF cycle'],
  [14, '2027-09-25', '5K TT · final benchmark B9', 'tt', 38.9, 'Race pace for JRF from the B9 tier'],
  [15, '2027-10-03', '24 km with 21 km in Z3 · marathon-effort block', 'lr', null, 'Red → JRF on the 4:15 tier'],
  [16, '2027-10-10', '27 km with 24 km in Z3 · dress rehearsal', 'lr', null, 'Fuel plan locked at 60 g/h, race kit, race start time'],
  [17, '2027-10-14', 'Marathon-effort reps 2×3 km', 'lr', null, 'Last rep within 5 s/km of the first'],
  [18, '2027-10-21', 'FM go/no-go gate', 'gate', null, 'Pain 0/10, Sleep HR ≤67 ×3 nights, HRV normal, soreness ≤2/10; pain ≥2/10 = DNS'],
  [19, '2027-10-24', 'JRF Full · A-race · sub-4:00', 'race', null, '0.7 km GI flush; 90 min buffer; first 5 km by HR cap'],
  [20, '2027-11-11', 'Bormar go/no-go gate (C-race)', 'gate', null, 'Pain 0/10, soreness ≤2/10, HRV normal; otherwise DNS'],
].map(([id, date, name, kind, line, note]) => ({ id, date, name, kind, line, note }))

// Green line = line −0.5 VDOT, red = line −1.5 VDOT (yellow in between)
export function tone(vdot, line) {
  const d = vdot - line
  return d >= -0.5 ? 'green' : d > -1.5 ? 'yellow' : 'red'
}
export const fitnessLine = (id) => CHECKPOINTS.find((c) => c.id === id)?.line

// Kill gate: two consecutive red TTs from CP4, or CP11 ratio < 0.85
export function killGate(results) {
  const tts = CHECKPOINTS.filter((c) => c.kind === 'tt' && c.id >= 4 && results[c.id]?.vdot != null)
  let streak = 0
  for (const c of tts) {
    streak = tone(results[c.id].vdot, c.line) === 'red' ? streak + 1 : 0
    if (streak >= 2) return { fired: true, why: `Two consecutive red TTs (through CP${c.id})` }
  }
  const r = results[11]?.ratio
  if (r != null && r < 0.85) return { fired: true, why: `CP11 ratio ${r.toFixed(2)} < 0.85` }
  return { fired: false }
}

// Distance of a time-trial checkpoint, and green/red time thresholds derived from the line (G = line−0.5, R = line−1.5 VDOT)
export const cpDistance = (c) => (/HM/.test(c.name) ? 21097.5 : /10K/.test(c.name) ? 10000 : /5K/.test(c.name) ? 5000 : null)
