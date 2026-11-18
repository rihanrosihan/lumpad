// Plan data transcribed from Running Calendar 2027 v4.5 (poster) + app description.
// Full 52-week session list is NOT extracted yet: needs plan.py JSON (open item). Template + 20 CP only.
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

// [id, date, name, kind, line(VDOT), note]
export const CHECKPOINTS = [
  [1, '2027-01-16', '5K TT · baseline B0 (post-injury)', 'tt', 31.7, 'Pain ≥2/10 or HRV reduced → postpone 1 week; Birthday Run ≤12 km'],
  [2, '2027-02-02', '5K TT · pre-Ramadan', 'tt', 32.0, 'Red → keep B0 pace through Ramadan'],
  [3, '2027-03-23', 'Anchor 5K TT', 'tt', 33.0, 'Sets B1. Yellow/red → pace stays at B0'],
  [4, '2027-04-13', '10K TT', 'tt', 33.7, 'Sets B2. First red that counts toward the kill gate'],
  [5, '2027-05-01', '24 km long run proof', 'lr', null, 'Fuel 30–60 g/h; pain 0/10'],
  [6, '2027-05-04', '5K TT · W18 cutback', 'tt', 34.4, 'Sets B3'],
  [7, '2027-05-29', '28 km · race-fueling + head-cooling rehearsal', 'lr', null, 'Fueling + sodium, race start time'],
  [8, '2027-06-01', '10K TT', 'tt', 35.4, 'Sets B4 (Pancasila Day)'],
  [9, '2027-06-13', 'Jakim FM (C-race) + G-MJM gate Rab 16 Jun', 'race', null, 'Run-walk <6:00, finish-first. Not a VDOT test'],
  [10, '2027-07-13', '5K TT (post-June return)', 'tt', 36.8, 'Sets B5; measure the cost of two FMs in 7 days'],
  [11, '2027-08-01', 'HM TT · ratio gate', 'ratio', 35.5, 'Ratio ≥0.90 passes; <0.85 → re-target'],
  [12, '2027-08-19', '5K TT · W33 cutback', 'tt', 38.0, 'Sets B8'],
  [13, '2027-08-28', '30 km LR · 10 km @MP', 'lr', null, 'MP block stays at 10 km if red'],
  [14, '2027-09-04', '32 km LR · 12 km @MP', 'lr', null, 'Fuel 60 g/h; red → 4:15 tier'],
  [15, '2027-09-14', '5K TT · final benchmark B9', 'tt', 38.9, 'Race pace from the B9 tier'],
  [16, '2027-09-25', '32 km LR · 14 km @MP · dress rehearsal', 'lr', null, 'Fuel plan locked at 60 g/h'],
  [17, '2027-10-14', 'M-reps 3×3 km', 'lr', null, 'Last rep within 5 s/km of the first'],
  [18, '2027-10-21', 'FM go/no-go gate', 'gate', null, 'Pain 0/10, Sleep HR ≤67 ×3 nights, HRV normal, soreness ≤2/10; pain ≥2/10 = DNS'],
  [19, '2027-10-24', 'JRF Full · A-race · sub-4:00', 'race', null, '0.7 km GI flush; 90 min buffer; first 5 km by HR cap'],
  [20, '2027-11-07', 'Return gate (2 weeks after FM)', 'gate', null, 'Easy + mobility'],
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
