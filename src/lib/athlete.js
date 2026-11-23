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
  // Strava all-time best efforts (they can start anywhere in a run, so some sit inside a longer run): 400m/1K/mile = Balke test 8 Feb 2026; 2 mile/5K/10K = MILO 10K 13 Sep 2026;
  // 15K–HM = Urbana qualifier time trial 30 Aug 2026 (not a race); 30K = Borobudur 15 Nov 2026; marathon = Jakim 14 Jun 2026 (6:53:03 official). Official 10K: 1:00:55 (H&S, 26 Jul 2026). Refresh from Profile → Performance → "Update from Strava".
  pbs: { '400m': '1:58', '1/2 mile': '4:04', '1K': '5:07', mile: '8:27', '2 mile': '18:42', '5K': '29:21', '10K': '59:48 (best effort; official 1:00:55, 26 Jul 2026)', '15K': '1:51:45', '10 mile': '2:02:18', '20K': '2:36:55', HM: '2:45:24 (qualifier time trial 30 Aug 2026; best official HM 3:05:30)', '30K': '4:19:28', marathon: '6:42:18 best effort (Jakim 2026 official 6:53:03)' },
  // the race ledger (doc 04.1, 17 Nov 2026, "counted" races only: 20 = 17 finishes + 3 DNF); 16 Nov 2025 was the Century Run 4.3K, NOT a Borobudur marathon
  races: [
    { date: '2024-12-08', name: 'Milo ACTIV 2024 10K', km: 10.13 },
    { date: '2025-01-12', name: 'Soekarno Run 10K', km: 10 },
    { date: '2025-03-09', name: 'Run to Iftar 5K', km: 5 },
    { date: '2025-05-25', name: 'Bogor City Trail Run', km: 11.5 },
    { date: '2025-06-15', name: 'LPS Monas Half Marathon', km: 21.5 },
    { date: '2025-08-03', name: 'UI Trail Run', km: 6.15 },
    { date: '2025-08-10', name: 'Made in Indonesia Run 5K', km: 5 },
    { date: '2025-08-17', name: 'Sentul Ultra 17K (+1780 m) — DNF (fell)', km: 17 },
    { date: '2025-08-24', name: 'Total Combat Run 7K', km: 7 },
    { date: '2025-09-21', name: 'Guardian Run 10K', km: 10 },
    { date: '2025-10-25', name: 'JRF Half Marathon 2025 — net 3:05:30', km: 21.65 },
    { date: '2025-11-16', name: 'Century Run 4.3K (forgot to press start)', km: 4.3 },
    { date: '2025-12-07', name: 'Milo Active Race 10K', km: 10 },
    { date: '2026-05-24', name: 'Starbucks 5K', km: 5.68 },
    { date: '2026-06-14', name: 'Jakim 2026 (FM) — 6:53:03 official', km: 42.2 },
    { date: '2026-07-26', name: 'Head & Shoulders Super Cool Run 10K — net 1:00:55 (10K PB, official)', km: 10 },
    { date: '2026-09-13', name: 'MILO ACTIV Indonesia Race 10K', km: 10 },
    { date: '2026-10-24', name: 'JRF Half Marathon 2026 (run-walk)', km: 21.1 },
    { date: '2026-10-25', name: 'JRF 2026 (FM) — DNF km 9.16', km: 42.2 },
    { date: '2026-11-15', name: 'Borobudur Marathon 2026 (FM) — black-flag DNF ~35 km', km: 42.2 },
  ],
}
// Zone 2 upper limit used to flag intensity creep on easy runs (≈ 88 % of LTHR → 148 bpm at LTHR 168)
export const Z2_CEILING = Math.round(ATHLETE.lthr * 0.88)
