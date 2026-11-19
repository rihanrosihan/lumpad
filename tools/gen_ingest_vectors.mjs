// Synthetic payloads for the ingest validator (every reject / drop path) with Node's ingestOps output → Go test vectors (no personal data).
import fs from 'node:fs'
const { ingestOps } = await import('../server/ingest.js')
const lap = (o = {}) => ({ distance_m: 1000, duration_s: 360, avg_pace_s_km: 360, avg_hr: 150, cadence: 170, ...o })
const cases = [
  { health: [{ date: '2026-11-18', hrv_avg: 55, resting_hr: 47, hrv_status: 'Balanced', steps: 12000, sleep_total_min: 432, unknown: 5 }, { date: '2026-13-01', hrv_avg: 50 }, { date: '2019-01-01' },
    { date: '2026-11-17', resting_hr: 151 }, { date: '2026-11-16', hrv_status: 'x'.repeat(41) }, { date: '2026-11-15', hrv_avg: null, resting_hr: 46 }, { date: '2026-11-14', stress_avg: '30' }, { date: '2026-11-13', sleep_score: 100, load_ratio: 0 }] },
  { activities: [
    { source: 'coros', source_id: '481', date: '2026-11-18', sport: 'Run', name: 'Morning Run', distance_m: 10250, duration_s: 3723, avg_pace_s_km: 363, avg_hr: 148, gear_id: 'g29435791', laps: [lap(), lap({ avg_pace_s_km: 20 }), lap({ gct_ms: 10 }), lap({ stride_m: 0.82, vratio_pct: 7.5 })] },
    { source: 'strava', source_id: 'abc.def-1', date: '2026-11-17', avg_pace_s_km: 6000, adjusted_pace_s_km: 400, name: 'Ride 🚴'.repeat(10) },
    { source: 'garmin', source_id: '1', date: '2026-11-17' }, { source: 'coros', source_id: 'bad id', date: '2026-11-17' }, { source: 'coros', source_id: '2', date: '2026-11-17', avg_hr: 300 },
    { source: 'coros', source_id: '3', date: '2026-11-17', laps: Array.from({ length: 601 }, () => lap()) }, { source: 'coros', source_id: '4', date: '2026-11-17', laps: [] },
    { source: 'coros', source_id: '5', date: '2026-11-16', name: 'n'.repeat(200), location: 'GBK, Jakarta', training_load: 0, aerobic_te: 6 } ] },
  { gear: [{ id: 'g123', name: 'Hoka Mach X2', distance_m: 512000, retired: false }, { id: '456', name: 'Clifton', retired: true }, { id: 'bad/id' }, { id: '789', distance_m: -1 }, { id: '790', brand: 'b'.repeat(81) }] },
  { fitness: [{ date: '2026-11-18', vo2max: 47, threshold_pace_s_km: 356, pred_m_s: 16000 }, { date: '2026-11-17', vo2max: 101 }, { date: 'yesterday', vo2max: 40 }] },
]
fs.writeFileSync('lumpadd/internal/coros/testdata/ingest_vectors.json', JSON.stringify(cases.map((p) => ({ payload: p, out: ingestOps(p, 'NOW') }))))
console.log('ingest vectors:', cases.length)
