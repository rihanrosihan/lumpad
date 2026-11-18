// Athlete baseline (Digital Twin seed). One source for the zones (client), the FIT metrics, the twin and the coach (server).
// Values the athlete set on COROS win over estimates; the threshold pace is the COROS fitness assessment pulled on 18 Nov 2026
// (5:56/km — the blueprint's 6:07/km is the earlier value and is kept as history). LTHR / HRmax / RHR are COROS settings from the
// athlete's blueprint; COROS does not expose them over its API, so change them here or in Profile › Training zones.
export const ATHLETE = {
  sex: 'male', born: '1995-01-19', height_cm: 178, weight_kg: 75.3, weight_src: 'COROS profile 18 Nov 2026',
  lthr: 168, hrmax: 189, rhr: 47, tpace_s: 356,
  src: { lthr: 'COROS setting (athlete blueprint)', hrmax: 'COROS setting (athlete blueprint)', rhr: 'COROS setting (athlete blueprint)', tpace: 'COROS fitness assessment 18 Nov 2026 (earlier: 6:07/km)' },
  vo2max_coros: 47,
  devices: ['COROS Apex 4 (42 mm)', 'COROS Pod 2 (GCT, stride, vertical ratio, power)', 'Garmin Forerunner 265S', 'Magene H303 chest-strap HRM (when worn; otherwise wrist optical HR)'],
  methodology: ['block periodization', 'Norwegian-style double-threshold days', 'road (TMII, GBK), trail (Sentul) and treadmill (Bodimax) running',
    'gym: single-leg calf raises, step-ups, hack squats, lying leg curls, core stability'],
  pbs: { '400m': '1:58', '1K': '5:07', mile: '8:27', '5K': '31:42', '10K': '1:00:55 (26 Jul 2026)', '15K': '1:55:56', HM: '2:54:11' },
  races: [
    { date: '2025-06-15', name: 'LPS Half Marathon', km: 21.1 },
    { date: '2025-08-17', name: 'Semarak 17 Agustus Fun Trail 17K, Sentul (+1780 m)', km: 17 },
    { date: '2025-10-25', name: 'JRF Half Marathon 2025', km: 21.1 },
    { date: '2025-11-16', name: 'Borobudur Marathon 2025 (FM)', km: 42.2 },
    { date: '2026-06-14', name: 'Jakim 2026 (FM) — 6:53:03 official', km: 42.2 },
    { date: '2026-10-25', name: 'JRF 2026 (FM) — DNF km 9.16', km: 42.2 },
    { date: '2026-11-15', name: 'Borobudur Marathon 2026 (FM) — black-flag DNF ~35 km', km: 42.2 },
  ],
}
// Zone 2 upper limit used to flag intensity creep on easy runs (≈ 88 % of LTHR → 148 bpm at LTHR 168)
export const Z2_CEILING = Math.round(ATHLETE.lthr * 0.88)
