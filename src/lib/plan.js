// Plan data transcribed from Running Calendar 2027 v4.5 (poster) + app description.
// Full 52-week session list is NOT extracted yet: needs plan.py JSON (open item). Template + 20 CP only.
export const TARGET = { goal: 'Sub-4:00 FM · JRF Min 24 Okt 2027 (tanggal belum resmi)', mp: '5:41', vdotRace: 37.9, vdotNeeded: 39.9, baseline: 31.7 }

export const TEMPLATE = {
  1: { run: 'Rest kaki', goal: 'Pemulihan jaringan', strength: 'Upper (3×8–12, RIR 2)' },
  2: { run: 'Quality utama (I / T / sub-T / TT)', goal: 'VO2 / threshold / tes — satu tujuan', strength: 'Lower bilateral PM (tibialis posisi 1) · Plyo setelah warm-up', quality: true, note: 'AM, ≥6 jam sebelum Lower; pace = slot benchmark terbaru' },
  3: { run: 'Easy', goal: 'Aerobic base', strength: '—', note: 'Fasted hanya easy ≤45 menit / 5–6 km' },
  4: { run: 'Strides / hills (◇ tempo bila gate lolos)', goal: 'Neuromuscular', strength: 'Lower unilateral PM (tibialis posisi 1)', note: 'Setelah TT Selasa = easy' },
  5: { run: 'Easy', goal: 'Buffer sebelum LR', strength: '—' },
  6: { run: 'Long run (maks 32 km; blok MP 3→14 km)', goal: 'Durability + specificity race', strength: 'Full body PM', long: true, note: '≤110% run terpanjang 30 hari; 5 km terakhir blok MP easy' },
  0: { run: 'Social run / race / TT / easy', goal: 'Volume aerobik atau tes', strength: 'Full body hanya bila tidak dikerjakan Sabtu' },
}

// [id, date, name, kind, line(VDOT), note]
export const CHECKPOINTS = [
  [1, '2027-01-16', '5K TT · baseline B0 (post-injury)', 'tt', 31.7, 'Pain ≥2/10 atau HRV reduced → tunda 1 minggu; Birthday Run ≤12 km'],
  [2, '2027-02-02', '5K TT · pre-Ramadan', 'tt', 32.0, 'Merah → pace B0 selama Ramadan'],
  [3, '2027-03-23', 'Anchor 5K TT', 'tt', 33.0, 'Sets B1. Kuning/merah → pace tetap B0'],
  [4, '2027-04-13', '10K TT', 'tt', 33.7, 'Sets B2. Merah pertama yang dihitung kill gate'],
  [5, '2027-05-01', '24 km long run proof', 'lr', null, 'Fuel 30–60 g/jam; nyeri 0/10'],
  [6, '2027-05-04', '5K TT · W18 cutback', 'tt', 34.4, 'Sets B3'],
  [7, '2027-05-29', '28 km · race-fueling + head-cooling rehearsal', 'lr', null, 'Fueling + sodium, race start time'],
  [8, '2027-06-01', '10K TT', 'tt', 35.4, 'Sets B4 (Pancasila Day)'],
  [9, '2027-06-13', 'Jakim FM (C-race) + G-MJM gate Rab 16 Jun', 'race', null, 'Run-walk <6:00, finish-first. Bukan tes VDOT'],
  [10, '2027-07-13', '5K TT (post-June return)', 'tt', 36.8, 'Sets B5; ukur biaya dua FM dalam 7 hari'],
  [11, '2027-08-01', 'HM TT · ratio gate', 'ratio', 35.5, 'Rasio ≥0.90 lolos; <0.85 → re-target'],
  [12, '2027-08-19', '5K TT · W33 cutback', 'tt', 38.0, 'Sets B8'],
  [13, '2027-08-28', '30 km LR · 10 km @MP', 'lr', null, 'MP block tetap 10 km bila merah'],
  [14, '2027-09-04', '32 km LR · 12 km @MP', 'lr', null, 'Fuel 60 g/jam; merah → tier 4:15'],
  [15, '2027-09-14', '5K TT · final benchmark B9', 'tt', 38.9, 'Race pace dari B9 tier'],
  [16, '2027-09-25', '32 km LR · 14 km @MP · dress rehearsal', 'lr', null, 'Fuel plan dikunci 60 g/jam'],
  [17, '2027-10-14', 'M-reps 3×3 km', 'lr', null, 'Rep terakhir ≤5 s/km dari yang pertama'],
  [18, '2027-10-21', 'FM go/no-go gate', 'gate', null, 'Nyeri 0/10, Sleep HR ≤67 ×3 malam, HRV normal, soreness ≤2/10; nyeri ≥2/10 = DNS'],
  [19, '2027-10-24', 'JRF Full · A-race · sub-4:00', 'race', null, '0.7 km GI-flush; 90 menit buffer; 5 km pertama by HR cap'],
  [20, '2027-11-07', 'Return gate (2 minggu setelah FM)', 'gate', null, 'Easy + mobility'],
].map(([id, date, name, kind, line, note]) => ({ id, date, name, kind, line, note }))

// Garis hijau = line −0.5 VDOT, merah = line −1.5 VDOT (kuning di antaranya)
export function tone(vdot, line) {
  const d = vdot - line
  return d >= -0.5 ? 'green' : d > -1.5 ? 'yellow' : 'red'
}
export const fitnessLine = (id) => CHECKPOINTS.find((c) => c.id === id)?.line

// Kill gate: dua TT merah berturut-turut mulai CP4, atau rasio CP11 < 0.85
export function killGate(results) {
  const tts = CHECKPOINTS.filter((c) => c.kind === 'tt' && c.id >= 4 && results[c.id]?.vdot != null)
  let streak = 0
  for (const c of tts) {
    streak = tone(results[c.id].vdot, c.line) === 'red' ? streak + 1 : 0
    if (streak >= 2) return { fired: true, why: `Dua TT merah berturut-turut (sampai CP${c.id})` }
  }
  const r = results[11]?.ratio
  if (r != null && r < 0.85) return { fired: true, why: `Rasio CP11 ${r.toFixed(2)} < 0.85` }
  return { fired: false }
}

// Distance of a time-trial checkpoint, and green/red time thresholds derived from the line (G = line−0.5, R = line−1.5 VDOT)
export const cpDistance = (c) => (/HM/.test(c.name) ? 21097.5 : /10K/.test(c.name) ? 10000 : /5K/.test(c.name) ? 5000 : null)
