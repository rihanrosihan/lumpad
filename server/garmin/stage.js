// Stage 2: typed staging tables (garmin.db) rebuilt from raw_record. Pure local work, idempotent (INSERT OR REPLACE on natural keys), re-runnable
// whenever a parser is fixed. SI units, source units documented in the blueprint (section 1.2 / 12). Vendor-computed metrics keep a g_ prefix and are
// never written into COROS-owned columns (blueprint 4.3).
import zlib from 'node:zlib'
import { openDb } from './db.js'

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS g_activity (
  activity_id INTEGER PRIMARY KEY, start_ms INTEGER NOT NULL, date_local TEXT NOT NULL, sport TEXT, sport_type TEXT, name TEXT, tz_id INTEGER, location TEXT,
  distance_m REAL, duration_s REAL, elapsed_s REAL, moving_s REAL, avg_speed_ms REAL, max_speed_ms REAL, avg_hr REAL, max_hr REAL, min_hr REAL,
  avg_power REAL, max_power REAL, norm_power REAL, cadence_spm REAL, max_cadence_spm REAL, steps REAL, calories REAL, bmr_calories REAL,
  elev_gain_m REAL, elev_loss_m REAL, min_elev_m REAL, max_elev_m REAL, aerobic_te REAL, anaerobic_te REAL, te_label TEXT, training_load REAL, vo2max REAL,
  gct_ms REAL, vo_cm REAL, stride_m REAL, vratio REAL, temp_min_c REAL, temp_max_c REAL, start_lat REAL, start_lon REAL, lap_count INTEGER,
  hr_zone_s TEXT, power_zone_s TEXT, body_battery_diff REAL, feel REAL, rpe REAL, stress_start REAL, stress_end REAL, stress_avg REAL, resp_avg REAL,
  sweat_ml REAL, workout_id INTEGER, device_id INTEGER, is_pr INTEGER, is_parent INTEGER, total_sets REAL, total_reps REAL,
  splits_json TEXT, split_summaries_json TEXT, exercise_sets_json TEXT, fit_id TEXT, rec_sha TEXT);
CREATE INDEX IF NOT EXISTS ix_gact_date ON g_activity(date_local);
CREATE TABLE IF NOT EXISTS g_sleep (date TEXT PRIMARY KEY, start_gmt TEXT, end_gmt TEXT, deep_s REAL, light_s REAL, rem_s REAL, awake_s REAL, total_s REAL,
  score REAL, score_quality REAL, score_duration REAL, score_recovery REAL, score_deep REAL, score_rem REAL, score_light REAL, score_restful REAL, feedback TEXT, insight TEXT,
  awake_count REAL, restless_count REAL, avg_stress REAL, resp_avg REAL, resp_low REAL, resp_high REAL, spo2_avg REAL, spo2_low REAL, hr_avg REAL, breathing_disruption TEXT, confirmation TEXT);
CREATE TABLE IF NOT EXISTS g_uds_day (date TEXT PRIMARY KEY, steps REAL, step_goal REAL, distance_m REAL, kcal_total REAL, kcal_active REAL, kcal_bmr REAL, mod_min REAL, vig_min REAL,
  active_s REAL, highly_active_s REAL, floors_up_m REAL, rhr REAL, min_hr REAL, max_hr REAL, stress_avg REAL, stress_max REAL, stress_rest_s REAL, stress_low_s REAL, stress_med_s REAL, stress_high_s REAL,
  bb_start REAL, bb_end REAL, bb_high REAL, bb_low REAL, bb_sleep_start REAL, bb_sleep_end REAL, bb_charged REAL, bb_drained REAL, resp_avg REAL, resp_high REAL, resp_low REAL, altitude_m REAL);
CREATE TABLE IF NOT EXISTS g_readiness (date TEXT NOT NULL, ts TEXT NOT NULL, level TEXT, score REAL, feedback_short TEXT, feedback_long TEXT, context TEXT, recovery_h REAL, sleep_pct REAL, recovery_pct REAL, acwr_pct REAL,
  stress_pct REAL, hrv_pct REAL, sleep_hist_pct REAL, hrv_weekly_avg REAL, acute_load REAL, valid_sleep INTEGER, PRIMARY KEY (date, ts));
CREATE TABLE IF NOT EXISTS g_acwr (date TEXT NOT NULL, ts INTEGER NOT NULL, acute REAL, chronic REAL, ratio REAL, pct REAL, status TEXT, PRIMARY KEY (date, ts));
CREATE TABLE IF NOT EXISTS g_training_status (date TEXT NOT NULL, ts TEXT NOT NULL, sport TEXT, status TEXT, trend TEXT, feedback TEXT, PRIMARY KEY (date, ts, sport));
CREATE TABLE IF NOT EXISTS g_race_pred (date TEXT NOT NULL, ts TEXT NOT NULL, t5k_s REAL, t10k_s REAL, thalf_s REAL, tmar_s REAL, PRIMARY KEY (date, ts));
CREATE TABLE IF NOT EXISTS g_maxmet (date TEXT NOT NULL, sport TEXT NOT NULL, vo2max REAL, maxmet REAL, category TEXT, PRIMARY KEY (date, sport));
CREATE TABLE IF NOT EXISTS g_health_status (date TEXT NOT NULL, metric TEXT NOT NULL, value REAL, lo REAL, hi REAL, status TEXT, pct REAL, PRIMARY KEY (date, metric));
CREATE TABLE IF NOT EXISTS g_hydration (rec_key TEXT PRIMARY KEY, date TEXT, source TEXT, intake_ml REAL, sweat_ml REAL, activity_id INTEGER, duration_s REAL);
CREATE TABLE IF NOT EXISTS g_bp (ts TEXT PRIMARY KEY, systolic REAL, diastolic REAL, pulse REAL);
CREATE TABLE IF NOT EXISTS g_weight (ts TEXT PRIMARY KEY, weight_kg REAL, source TEXT);
CREATE TABLE IF NOT EXISTS g_fitness_age (date TEXT PRIMARY KEY, age REAL, bio_age REAL, bmi REAL, rhr REAL, vo2max REAL, vigorous_min REAL, vigorous_days REAL);
CREATE TABLE IF NOT EXISTS g_gear (gear_id INTEGER PRIMARY KEY, name TEXT, type TEXT, status TEXT, date_begin TEXT, max_m REAL);
CREATE TABLE IF NOT EXISTS g_pr (pr_id INTEGER PRIMARY KEY, type TEXT, value REAL, activity_id INTEGER, at TEXT, is_current INTEGER);
CREATE TABLE IF NOT EXISTS g_nap (start_gmt TEXT PRIMARY KEY, end_gmt TEXT, date TEXT, seconds REAL);
CREATE TABLE IF NOT EXISTS g_hr_event (ts TEXT PRIMARY KEY, date TEXT, threshold REAL, value REAL);`

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const r2 = (x, n = 1) => (num(x) == null ? null : Math.round(x * 10 ** n) / 10 ** n)
const dayOf = (ms) => (num(ms) == null ? null : new Date(ms).toISOString().slice(0, 10))
const cd = (v) => (Array.isArray(v) ? `${v[0]}-${String(v[1]).padStart(2, '0')}-${String(v[2]).padStart(2, '0')}` : typeof v === 'number' && v > 1e11 ? dayOf(v) : typeof v === 'string' ? v.slice(0, 10) : null)
const sec = (ms) => (num(ms) == null ? null : ms / 1000)
const cm = (v) => (num(v) == null ? null : v / 100)

export function activityRow(a) {
  const zones = (p, n) => JSON.stringify(Array.from({ length: n }, (_, i) => (num(a[`${p}${i}`]) == null ? null : Math.round(a[`${p}${i}`] / 1000))))
  const j = (x) => (x && (Array.isArray(x) ? x.length : Object.keys(x).length) ? JSON.stringify(x) : null)
  return {
    activity_id: a.activityId, start_ms: a.startTimeGmt, date_local: dayOf(a.startTimeLocal ?? a.startTimeGmt), sport: a.activityType, sport_type: a.sportType, name: a.name ?? null, tz_id: num(a.timeZoneId), location: a.locationName ?? null,
    distance_m: cm(a.distance), duration_s: sec(a.duration), elapsed_s: sec(a.elapsedDuration), moving_s: sec(a.movingDuration),
    avg_speed_ms: r2(a.avgSpeed * 10, 3), max_speed_ms: r2(a.maxSpeed * 10, 3), // source unit is m/s ÷ 10 (verified against FIT)
    avg_hr: num(a.avgHr), max_hr: num(a.maxHr), min_hr: num(a.minHr), avg_power: num(a.avgPower), max_power: num(a.maxPower), norm_power: num(a.normPower),
    cadence_spm: num(a.avgDoubleCadence) ?? (num(a.avgRunCadence) == null ? null : a.avgRunCadence * 2), max_cadence_spm: num(a.maxDoubleCadence), steps: num(a.steps), calories: r2(a.calories), bmr_calories: r2(a.bmrCalories),
    elev_gain_m: cm(a.elevationGain), elev_loss_m: cm(a.elevationLoss), min_elev_m: cm(a.minElevation), max_elev_m: cm(a.maxElevation),
    aerobic_te: r2(a.aerobicTrainingEffect), anaerobic_te: r2(a.anaerobicTrainingEffect), te_label: a.trainingEffectLabel ?? null, training_load: r2(a.activityTrainingLoad), vo2max: num(a.vO2MaxValue),
    gct_ms: r2(a.avgGroundContactTime), vo_cm: r2(a.avgVerticalOscillation, 2), stride_m: cm(a.avgStrideLength), vratio: r2(a.avgVerticalRatio, 2),
    temp_min_c: num(a.minTemperature), temp_max_c: num(a.maxTemperature), start_lat: num(a.startLatitude), start_lon: num(a.startLongitude), lap_count: num(a.lapCount),
    hr_zone_s: zones('hrTimeInZone_', 7), power_zone_s: a.powerTimeInZone_0 == null ? null : zones('powerTimeInZone_', 6),
    body_battery_diff: num(a.differenceBodyBattery), feel: num(a.workoutFeel), rpe: num(a.workoutRpe), stress_start: num(a.startStress), stress_end: num(a.endStress), stress_avg: num(a.avgStress), resp_avg: num(a.avgRespirationRate),
    sweat_ml: num(a.waterEstimated), workout_id: num(a.workoutId), device_id: num(a.deviceId), is_pr: a.pr ? 1 : 0, is_parent: a.parent ? 1 : 0, total_sets: num(a.totalSets), total_reps: num(a.totalReps),
    splits_json: j(a.splits), split_summaries_json: j(a.splitSummaries), exercise_sets_json: j(a.summarizedExerciseSets), fit_id: null, rec_sha: null }
}

const stat = (list, t) => list?.find((e) => e.bodyBatteryStatType === t)?.statsValue ?? null
export function udsRow(u) {
  const tot = u.allDayStress?.aggregatorList?.find((x) => x.type === 'TOTAL') || {}, bb = u.bodyBattery?.bodyBatteryStatList, rs = u.respiration || {}
  return { date: u.calendarDate, steps: num(u.totalSteps), step_goal: num(u.dailyStepGoal), distance_m: num(u.totalDistanceMeters), kcal_total: num(u.totalKilocalories), kcal_active: num(u.activeKilocalories), kcal_bmr: num(u.bmrKilocalories),
    mod_min: num(u.moderateIntensityMinutes), vig_min: num(u.vigorousIntensityMinutes), active_s: num(u.activeSeconds), highly_active_s: num(u.highlyActiveSeconds), floors_up_m: num(u.floorsAscendedInMeters),
    rhr: num(u.restingHeartRate), min_hr: num(u.minHeartRate), max_hr: num(u.maxHeartRate), stress_avg: num(tot.averageStressLevel) >= 0 ? tot.averageStressLevel : null, stress_max: num(tot.maxStressLevel) >= 0 ? tot.maxStressLevel : null, stress_rest_s: num(tot.restDuration),
    stress_low_s: num(tot.lowDuration), stress_med_s: num(tot.mediumDuration), stress_high_s: num(tot.highDuration),
    bb_start: stat(bb, 'STARTOFDAY'), bb_end: stat(bb, 'ENDOFDAY'), bb_high: stat(bb, 'HIGHEST'), bb_low: stat(bb, 'LOWEST'), bb_sleep_start: stat(bb, 'SLEEPSTART'), bb_sleep_end: stat(bb, 'SLEEPEND'),
    bb_charged: num(u.bodyBattery?.chargedValue), bb_drained: num(u.bodyBattery?.drainedValue), resp_avg: num(rs.avgWakingRespirationValue), resp_high: num(rs.highestRespirationValue), resp_low: num(rs.lowestRespirationValue),
    altitude_m: num(u.averageMonitoringEnvironmentAltitude) }
}

export function sleepRow(s) {
  const sc = s.sleepScores || {}, sp = s.spo2SleepSummary || {}, tot = ['deepSleepSeconds', 'lightSleepSeconds', 'remSleepSeconds'].reduce((a, k) => a + (num(s[k]) || 0), 0)
  return { date: s.calendarDate, start_gmt: s.sleepStartTimestampGMT, end_gmt: s.sleepEndTimestampGMT, deep_s: num(s.deepSleepSeconds), light_s: num(s.lightSleepSeconds), rem_s: num(s.remSleepSeconds), awake_s: num(s.awakeSleepSeconds), total_s: tot || null,
    score: num(sc.overallScore), score_quality: num(sc.qualityScore), score_duration: num(sc.durationScore), score_recovery: num(sc.recoveryScore), score_deep: num(sc.deepScore), score_rem: num(sc.remScore), score_light: num(sc.lightScore), score_restful: num(sc.restfulnessScore),
    feedback: sc.feedback ?? null, insight: sc.insight ?? null, awake_count: num(s.awakeCount), restless_count: num(s.restlessMomentCount), avg_stress: r2(s.avgSleepStress, 2), resp_avg: num(s.averageRespiration), resp_low: num(s.lowestRespiration), resp_high: num(s.highestRespiration),
    spo2_avg: num(sp.averageSPO2), spo2_low: num(sp.lowestSpO2 ?? sp.lowestSPO2), hr_avg: num(sp.averageHR), breathing_disruption: s.breathingDisruptionSeverity ?? null, confirmation: s.sleepWindowConfirmationType ?? null }
}

const KEYN = { g_readiness: 2, g_acwr: 2, g_training_status: 2, g_race_pred: 2, g_maxmet: 2, g_health_status: 2 }
// dataset -> { table, rows(record) -> array of row objects }
export const MAPPERS = {
  'Fitness/summarizedActivities': { table: 'g_activity', rows: (r) => [activityRow(r)] },
  'Aggregator/UDSFile': { table: 'g_uds_day', rows: (r) => [udsRow(r)] },
  'Wellness/sleepData': { table: 'g_sleep', rows: (r) => (r.calendarDate && r.sleepStartTimestampGMT ? [sleepRow(r)] : []) },
  'Wellness/sleepData#nap': { dataset: 'Wellness/sleepData', table: 'g_nap', rows: (r) => (r.napList || []).map((n) => ({ start_gmt: n.napStartTimestampGMT, end_gmt: n.napEndTimestampGMT, date: n.calendarDate, seconds: num(n.napTimeSec) })) },
  'Metrics/TrainingReadinessDTO': { table: 'g_readiness', rows: (r) => [{ date: cd(r.calendarDate), ts: r.timestamp, level: r.level, score: num(r.score), feedback_short: r.feedbackShort, feedback_long: r.feedbackLong, context: r.inputContext, recovery_h: num(r.recoveryTime),
    sleep_pct: num(r.sleepScoreFactorPercent), recovery_pct: num(r.recoveryTimeFactorPercent), acwr_pct: num(r.acwrFactorPercent), stress_pct: num(r.stressHistoryFactorPercent), hrv_pct: num(r.hrvFactorPercent), sleep_hist_pct: num(r.sleepHistoryFactorPercent),
    hrv_weekly_avg: num(r.hrvWeeklyAverage), acute_load: num(r.acuteLoad), valid_sleep: r.validSleep ? 1 : 0 }] },
  'Metrics/MetricsAcuteTrainingLoad': { table: 'g_acwr', rows: (r) => [{ date: cd(r.calendarDate), ts: r.timestamp, acute: num(r.dailyTrainingLoadAcute), chronic: num(r.dailyTrainingLoadChronic), ratio: num(r.dailyAcuteChronicWorkloadRatio), pct: num(r.acwrPercent), status: r.acwrStatus ?? null }] },
  'Metrics/TrainingHistory': { table: 'g_training_status', rows: (r) => [{ date: cd(r.calendarDate), ts: r.timestamp, sport: r.sport ?? '', status: r.trainingStatus ?? null, trend: r.fitnessLevelTrend ?? null, feedback: r.trainingStatus2FeedbackPhrase ?? null }] },
  'Metrics/RunRacePredictions': { table: 'g_race_pred', rows: (r) => [{ date: cd(r.calendarDate), ts: r.timestamp, t5k_s: num(r.raceTime5K), t10k_s: num(r.raceTime10K), thalf_s: num(r.raceTimeHalf), tmar_s: num(r.raceTimeMarathon) }] },
  'Metrics/MetricsMaxMetData': { table: 'g_maxmet', rows: (r) => [{ date: cd(r.calendarDate), sport: r.sport ?? '', vo2max: num(r.vo2MaxValue), maxmet: r2(r.maxMet, 2), category: r.maxMetCategory ?? null }] },
  'Wellness/healthStatusData': { table: 'g_health_status', rows: (r) => (r.metrics || []).map((m) => ({ date: cd(r.calendarDate), metric: m.type, value: num(m.value), lo: num(m.baselineLowerLimit), hi: num(m.baselineUpperLimit), status: m.status ?? null, pct: num(m.percentage) })) },
  'Aggregator/HydrationLogFile': { table: 'g_hydration', rows: (r, k) => [{ rec_key: k, date: cd(r.calendarDate), source: r.hydrationSource ?? null, intake_ml: num(r.valueInML), sweat_ml: num(r.estimatedSweatLossInML), activity_id: num(r.activityId), duration_s: r2(r.duration) }] },
  'Wellness/BloodPressureFile': { table: 'g_bp', rows: (r) => (r.bloodPressure ? [{ ts: Array.isArray(r.metaData?.calendarDate) ? r.metaData.calendarDate.slice(0, 6).join('-') : String(r.metaData?.calendarDate), systolic: num(r.bloodPressure.systolic), diastolic: num(r.bloodPressure.diastolic), pulse: num(r.bloodPressure.pulse) }] : []) },
  'Wellness/userBioMetrics': { table: 'g_weight', rows: (r) => (r.weight?.weight ? [{ ts: r.weight.timestampGMT, weight_kg: r.weight.weight / 1000, source: r.weight.sourceType ?? null }] : []) }, // source unit: grams
  'Wellness/fitnessAgeData': { table: 'g_fitness_age', rows: (r) => [{ date: cd(r.asOfDateGmt), age: num(r.chronologicalAge), bio_age: r2(r.currentBioAge, 2), bmi: r2(r.bmi, 2), rhr: num(r.rhr), vo2max: r2(r.biometricVo2Max, 2), vigorous_min: num(r.totalVigorousIMs), vigorous_days: num(r.totalVigorousDays) }] },
  'Fitness/gear': { table: 'g_gear', rows: (r) => [{ gear_id: r.gearPk, name: r.customMakeModel ?? null, type: r.gearTypeName ?? null, status: r.gearStatusName ?? null, date_begin: r.dateBegin ?? null, max_m: num(r.maximumMeters) }] },
  'Fitness/personalRecord': { table: 'g_pr', rows: (r) => [{ pr_id: r.personalRecordId, type: r.personalRecordType, value: num(r.value), activity_id: num(r.activityId), at: r.prStartTimeGMT ?? null, is_current: r.current ? 1 : 0 }] },
  'Wellness/AbnormalHrEvents': { table: 'g_hr_event', rows: (r) => [{ ts: r.abnormalHrEventGMT, date: r.calendarDate, threshold: num(r.abnormalHrThresholdValue), value: num(r.abnormalHrValue) }] },
}

// One-to-one nearest-start matching, tolerance 120 s (file_id.time_created can trail the session start by 1-50 s). Exact matches win first.
export function linkFits(db, tolMs = 120e3) {
  const acts = db.prepare('SELECT activity_id, start_ms FROM g_activity').all(), fits = db.prepare('SELECT fit_id, time_created_ms t FROM raw_fit WHERE fit_type=4 AND time_created_ms IS NOT NULL').all()
  const pairs = []
  for (const a of acts) for (const f of fits) { const d = Math.abs(f.t - a.start_ms); if (d <= tolMs) pairs.push({ a: a.activity_id, f: f.fit_id, d }) }
  pairs.sort((x, y) => x.d - y.d || x.a - y.a)
  const ua = new Set(), uf = new Set(), set = db.prepare('UPDATE g_activity SET fit_id=? WHERE activity_id=?'); db.prepare('UPDATE g_activity SET fit_id=NULL').run()
  for (const p of pairs) if (!ua.has(p.a) && !uf.has(p.f)) { ua.add(p.a); uf.add(p.f); set.run(p.f, p.a) }
}

// Rebuild all mapped tables from raw_record. Link activities to their FIT by exact start time (verified: Δ0 s). Returns row counts + skipped.
export function stageAll(db = openDb()) {
  db.exec(SCHEMA); const out = {}, bad = {}
  db.exec('BEGIN')
  try {
    for (const [key, m] of Object.entries(MAPPERS)) {
      const ds = m.dataset || key; db.prepare(`DELETE FROM ${m.table}`).run()
      let ins = null, n = 0
      for (const row of db.prepare('SELECT rec_key, body, sha256 FROM raw_record WHERE dataset=?').iterate(ds)) {
        const rec = JSON.parse(zlib.gunzipSync(row.body))
        for (const o of m.rows(rec, row.rec_key)) {
          if (Object.values(o).slice(0, KEYN[m.table] || 1).some((v) => v == null || v === '')) { bad[ds] = (bad[ds] || 0) + 1; continue } // key columns missing
          if (m.table === 'g_activity') o.rec_sha = row.sha256
          ins ||= db.prepare(`INSERT OR REPLACE INTO ${m.table} (${Object.keys(o).join(',')}) VALUES (${Object.keys(o).map(() => '?').join(',')})`)
          ins.run(...Object.values(o).map((v) => (v === undefined ? null : v))); n++
        }
      }
      out[m.table] = (out[m.table] || 0) + n
    }
    linkFits(db)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  out.activities_with_fit = db.prepare('SELECT COUNT(*) n FROM g_activity WHERE fit_id IS NOT NULL').get().n
  return { rows: out, skipped_missing_key: bad }
}
