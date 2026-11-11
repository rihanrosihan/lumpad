// DEV ONLY: synthetic data (deterministic) posted to a local server so every screen can be exercised. Not your data.
const BASE = process.env.BASE || 'http://localhost:8787', TOKEN = process.env.INGEST_TOKEN, PLAN = (await import('node:fs')).readFileSync(new URL('../src/data/plan.json', import.meta.url), 'utf8')
const plan = JSON.parse(PLAN).filter((d) => d.date >= '2027-01-01' && d.date <= '2027-03-23')
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const health = [], acts = [], dayLoad = {}
for (const d of plan) {
  let km = d.km && !['rest', 'gym'].includes(d.kind) ? d.km : 0
  if (km && rnd() < 0.12) km = 0 // a skipped day
  else if (km) km = Math.round(km * (0.9 + rnd() * 0.15) * 10) / 10
  if (km) {
    const pace = d.kind === 'tt' ? 345 : d.kind === 'quality' ? 365 : d.kind === 'long' ? 430 : 440 + rnd() * 25, dur = Math.round(km * pace), tl = Math.round(km * (d.kind === 'quality' || d.kind === 'tt' ? 19 : 13) + rnd() * 10)
    const id = 'S' + d.date.replace(/-/g, ''), laps = Array.from({ length: Math.floor(km) }, (_, i) => ({ distance_m: 1000, duration_s: Math.round(pace + (rnd() - 0.4) * 14 - i * 1.2), avg_pace_s_km: Math.round(pace + (rnd() - 0.4) * 14 - i * 1.2), avg_hr: Math.round(148 + i * 2 + rnd() * 6), cadence: 164 + Math.round(rnd() * 6), power: 165 + Math.round(rnd() * 25), gct_ms: 300 + Math.round(rnd() * 15) }))
    const start = Math.floor(new Date(d.date + 'T05:00:00+07:00') / 1000)
    acts.push({ source: 'coros', source_id: id, date: d.date, sport: 'Run', name: 'Outdoor Run', distance_m: Math.round(km * 1000), duration_s: dur, avg_hr: Math.round(150 + rnd() * 16), avg_pace_s_km: Math.round(pace), calories: Math.round(km * 62), start_ts: start, cadence: 166, power: 175, training_load: tl, aerobic_te: Math.round((2.2 + rnd() * 1.8) * 10) / 10, anaerobic_te: Math.round(rnd() * 20) / 10, training_focus: d.kind === 'quality' ? 'Tempo' : 'Base', performance: 'Average', laps })
    acts.push({ source: 'strava', source_id: 'V' + id, date: d.date, sport: 'Run', name: d.label || 'Morning Run', distance_m: Math.round(km * 1000 - 3), duration_s: dur, gear_id: ['g1', 'g2', 'g3'][d.kind === 'quality' || d.kind === 'tt' ? 2 : d.kind === 'long' ? 1 : 0], temp_c: 24 + Math.round(rnd() * 4), humidity: 78 + Math.round(rnd() * 8), location: 'Bekasi' })
    dayLoad[d.date] = tl
  }
}
let s = 40, l = 55
for (const d of plan) { const tl = dayLoad[d.date] || 0; s = s + (tl - s) / 4; l = l + (tl - l) / 14; // simple smoothing stand-in for COROS's published numbers
  const bad = rnd() < 0.08, hrv = Math.round(80 + (rnd() - 0.5) * 30 - (bad ? 25 : 0))
  health.push({ date: d.date, sleep_hr_avg: bad ? 68 : Math.round(58 + rnd() * 6), sleep_hr_min: 44, sleep_hr_max: 85, sleep_total_min: Math.round(400 + rnd() * 80), sleep_deep_min: 70, sleep_light_min: 220, sleep_rem_min: 100, sleep_awake_min: 15, sleep_score: Math.round(65 + rnd() * 25), sleep_awake_count: Math.floor(rnd() * 3),
    hrv_avg: hrv, hrv_status: hrv < 58 ? 'Low' : 'Normal', hrv_range_lo: 55, hrv_range_hi: 105, hrv_baseline: 80, resting_hr: Math.round(56 + rnd() * 6),
    load_short: Math.round(s), load_long: Math.round(l), load_ratio: Math.round((s / l) * 100) / 100, load_comment: s / l > 1.3 ? 'Overreaching' : s / l < 0.8 ? 'Decreasing' : 'Maintaining' }) }
health.at(-1).recovery_pct = 82; health.at(-1).recovery_level = 'Fresh'
const gear = [['g1', 'ASICS', 'Novablast 5', 691816, false], ['g2', 'HOKA', 'Mach X2', 424806, false], ['g3', 'PUMA', 'Deviate Nitro Elite 2', 144309, false], ['g4', 'Nike', 'Downshifter 12', 94665, true]].map(([id, brand, model, d, r]) => ({ id, name: `${brand} ${model}`, brand, model, distance_m: d, retired: r }))
const body = { run: { trigger: 'manual', notes: ['DEV seed'] }, health, activities: acts, gear, fitness: [{ date: '2027-03-23', vo2max: 47, running_level: 66, threshold_pace_s_km: 356, pred_5k_s: 1720, pred_10k_s: 3633, pred_hm_s: 8233, pred_m_s: 17584 }] }
const r = await fetch(BASE + '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(body) })
console.log(r.status, await r.text())
