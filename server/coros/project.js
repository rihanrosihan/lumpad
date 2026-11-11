// Rebuilds the app tables (lumpad.db: health_daily, fitness_daily, activities, laps) from the COROS archive (coros.db).
// Pure local work — no COROS calls. Idempotent (applyIngest upserts; fields that cannot be read are never written as null).
import { adb, responsesOf, responseText, FROM } from './archive.js'
import { parseDailyHealth, parseSleepHrv, parseResting, parseTrainingLoad, parseSleepOverview, parseRecovery, parseFitness, parseActivityDetail, parseLaps } from './parse.js'
import { applyIngest } from '../ingest.js'

const RUN = new Set([100, 101, 102, 103])

export function projectAll({ from = FROM } = {}) {
  const rows = new Map(), get = (d) => rows.get(d) || rows.set(d, { date: d }).get(d)
  const put = (list) => { for (const r of list) if (r.date >= from) Object.assign(get(r.date), r) }
  // order matters: the broad "last N days" summaries first, then the per-window official values on top
  for (const r of responsesOf('queryDailyHealthData')) put(parseDailyHealth(r.text).filter((h) => Object.keys(h).some((k) => k !== 'date' && k !== 'steps') || h.steps > 0))
  for (const r of responsesOf('queryRestingHeartRate')) put(parseResting(r.text))
  for (const r of responsesOf('queryTrainingLoadAssessment')) put(parseTrainingLoad(r.text))
  for (const r of responsesOf('querySleepHrv')) put(parseSleepHrv(r.text))
  for (const r of responsesOf('querySleepOverview')) put(parseSleepOverview(r.text))
  for (const r of responsesOf('queryRecoveryStatus')) { const v = parseRecovery(r.text); if (Object.keys(v).length) Object.assign(get(r.day), v) } // snapshot → its pull day
  const fitness = responsesOf('queryFitnessAssessmentOverview').map((r) => ({ date: r.day, ...parseFitness(r.text) })).filter((f) => Object.keys(f).length > 1)

  const health = [...rows.values()].filter((r) => Object.keys(r).length > 1).sort((a, b) => a.date.localeCompare(b.date))
  const acts = adb.prepare('SELECT label_id, sport_type, rec FROM activities WHERE date >= ? ORDER BY date').all(from).map((row) => {
    const a = JSON.parse(row.rec); delete a.sport_code; delete a.end_ts
    const d = responseText('detail:' + row.label_id); if (d) Object.assign(a, parseActivityDetail(d))
    const l = RUN.has(row.sport_type) && responseText('laps:' + row.label_id), p = l && parseLaps(l)
    if (p?.laps?.length) { a.laps = p.laps; a.cadence ??= p.cadence; a.power ??= p.power; a.max_hr ??= p.max_hr }
    return a
  })

  const out = { health: 0, fitness: 0, activities: 0, laps: 0, rejected: 0 }
  const ingest = (body) => { const r = applyIngest({ run: { trigger: 'backfill', started_at: new Date().toISOString(), notes: ['COROS archive projection'] }, ...body }); for (const k of ['health', 'activities', 'laps', 'fitness']) out[k] += r.counts[k] || 0; out.rejected += r.rejected.length }
  for (let i = 0; i < health.length; i += 700) ingest({ health: health.slice(i, i + 700) })
  for (let i = 0; i < fitness.length; i += 300) ingest({ fitness: fitness.slice(i, i + 300) })
  for (let i = 0; i < acts.length; i += 300) ingest({ activities: acts.slice(i, i + 300) })
  return out
}
