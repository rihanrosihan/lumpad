// Personal records as Strava shows them ("All-Time PRs / Best Efforts" on the athlete page). Strava's best efforts can start anywhere in a run, which a km-by-km table cannot reproduce, so
// THESE are the official PRs; the FIT-derived bests stay as a cross-check. Paste the block into the Performance panel (or POST /api/perf/prs) to refresh it. The file is also read by the Go
// graph sync, which turns each record into a :PB node.
import fs from 'node:fs'
import path from 'node:path'
import { vdotFromRace } from '../../src/lib/vdot.js'

const dir = () => process.env.DATA_DIR || path.resolve('server/data')
export const PRS_FILE = () => path.join(dir(), 'strava_prs.json')
const MI = 1609.344
export const DISTANCES = { '400m': 400, '1/2 mile': MI / 2, '1k': 1000, '1 mile': MI, '2 mile': 2 * MI, '5k': 5000, '10k': 10000, '15k': 15000, '10 mile': 10 * MI, '20k': 20000, 'half-marathon': 21097.5, 'half marathon': 21097.5, '30k': 30000, 'marathon': 42195 }
export const toSeconds = (t) => { const p = String(t).trim().split(':').map(Number); if (p.some((x) => !Number.isFinite(x)) || !p.length || p.length > 3) return null; return p.reduce((a, x) => a * 60 + x, 0) }
// "5K    29:21 https://www.strava.com/activities/20150551990/best-efforts" → one record per line; lines that are not a known distance are ignored
export function parseStravaPRs(text) {
  const out = [], seen = new Set()
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(400m|1\/2 mile|1k|1 mile|2 mile|5k|10k|15k|10 mile|20k|half[- ]marathon|30k|marathon)\s+(\d{1,2}(?::\d{2}){1,2})\b(?:\s*(?:->|→)?\s*(https?:\/\/\S+))?/i.exec(raw); if (!m) continue
    const key = m[1].toLowerCase().replace('half marathon', 'half-marathon'), meters = DISTANCES[key], secs = toSeconds(m[2]); if (!meters || !secs || seen.has(key)) continue; seen.add(key)
    const url = m[3] || null, act = url && /activities\/(\d+)/.exec(url)
    out.push({ label: key === 'half-marathon' ? 'Half-Marathon' : key === '1/2 mile' ? '1/2 mile' : m[1].toUpperCase() === m[1] ? m[1] : m[1][0].toUpperCase() + m[1].slice(1), meters: Math.round(meters), time_s: secs, pace_s_km: +(secs / (meters / 1000)).toFixed(1), vdot: +vdotFromRace(meters, secs).toFixed(1), activity_id: act ? act[1] : null, url })
  }
  return out.sort((a, b) => a.meters - b.meters)
}
export const loadPRs = () => { try { return JSON.parse(fs.readFileSync(PRS_FILE(), 'utf8')) } catch { return { updated: null, prs: [] } } }
// the useful parts of a Strava activity (no GPS, no free text): what it was, how it went, the best efforts inside it and its km splits
export function activityDetail(a) {
  if (!a || !a.id) return null
  return {
    id: String(a.id), name: a.name || null, date: String(a.start_date_local || a.start_date || '').slice(0, 10) || null, start_local: a.start_date_local || null, type: a.sport_type || a.type || null, workout_type: a.workout_type ?? null,
    distance_m: a.distance ?? null, moving_s: a.moving_time ?? null, elapsed_s: a.elapsed_time ?? null, elevation_m: a.total_elevation_gain ?? null, avg_speed_ms: a.average_speed ?? null, max_speed_ms: a.max_speed ?? null,
    avg_hr: a.average_heartrate ?? null, max_hr: a.max_heartrate ?? null, avg_cadence: a.average_cadence ?? null, avg_temp_c: a.average_temp ?? null, calories: a.calories ?? null, suffer_score: a.suffer_score ?? null,
    pr_count: a.pr_count ?? null, achievement_count: a.achievement_count ?? null, gear: a.gear?.name || null, device: a.device_name || null, url: `https://www.strava.com/activities/${a.id}`,
    best_efforts: (a.best_efforts || []).map((e) => ({ name: e.name, time_s: e.elapsed_time ?? e.moving_time, distance_m: e.distance, pr_rank: e.pr_rank ?? null })),
    splits: (a.splits_metric || []).map((x) => ({ km: x.split, dist_m: x.distance, time_s: x.moving_time ?? x.elapsed_time, pace_s: x.distance > 0 ? +((x.moving_time ?? x.elapsed_time) / (x.distance / 1000)).toFixed(1) : null, hr: x.average_heartrate ?? null, elev_m: x.elevation_difference ?? null })),
  }
}
// save the parsed records; dates and names of the activities are filled in from the Strava API when it is connected (best effort, never blocks the save)
export async function savePRs(text, { activityFn } = {}) {
  const prs = parseStravaPRs(text); if (!prs.length) throw Object.assign(new Error('No Strava best efforts found in that text. Paste the "Best Efforts" block from your Strava profile.'), { status: 400 })
  const info = new Map(), acts = {}, act = activityFn || (await import('../strava.js')).activity
  for (const id of new Set(prs.map((p) => p.activity_id).filter(Boolean))) { try { const d = activityDetail(await act(id)); if (d) { info.set(id, { date: d.date, name: d.name }); acts[id] = d } } catch { /* not connected / rate limited: keep going */ } }
  const full = prs.map((p) => ({ ...p, date: info.get(p.activity_id)?.date || null, activity_name: info.get(p.activity_id)?.name || null }))
  const doc = { updated: new Date().toISOString(), source: 'strava', prs: full, activities: acts }
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 }); fs.writeFileSync(PRS_FILE(), JSON.stringify(doc, null, 1), { mode: 0o640 })
  return doc
}

// re-read every activity the saved records point at (e.g. after the Strava connection was fixed); the records themselves are kept
export async function refreshActivities({ activityFn } = {}) {
  const doc = loadPRs(); if (!doc.prs.length) throw Object.assign(new Error('No saved records to refresh'), { status: 400 })
  const act = activityFn || (await import('../strava.js')).activity, acts = { ...(doc.activities || {}) }; let ok = 0, failed = 0
  for (const id of new Set(doc.prs.map((p) => p.activity_id).filter(Boolean))) { try { const d = activityDetail(await act(id)); if (d) { acts[id] = d; ok++ } } catch { failed++ } }
  const prs = doc.prs.map((p) => ({ ...p, date: acts[p.activity_id]?.date || p.date || null, activity_name: acts[p.activity_id]?.name || p.activity_name || null }))
  const out = { ...doc, prs, activities: acts, updated: new Date().toISOString() }
  fs.writeFileSync(PRS_FILE(), JSON.stringify(out, null, 1), { mode: 0o640 }); return { ok, failed, activities: Object.keys(acts).length }
}
