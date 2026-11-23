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
// save the parsed records; dates and names of the activities are filled in from the Strava API when it is connected (best effort, never blocks the save)
export async function savePRs(text, { activityFn } = {}) {
  const prs = parseStravaPRs(text); if (!prs.length) throw Object.assign(new Error('No Strava best efforts found in that text. Paste the "Best Efforts" block from your Strava profile.'), { status: 400 })
  const info = new Map(), act = activityFn || (await import('../strava.js')).activity
  for (const id of new Set(prs.map((p) => p.activity_id).filter(Boolean))) { try { const a = await act(id); info.set(id, { date: String(a.start_date_local || a.start_date || '').slice(0, 10) || null, name: a.name || null }) } catch { /* not connected / rate limited: keep going */ } }
  const full = prs.map((p) => ({ ...p, date: info.get(p.activity_id)?.date || null, activity_name: info.get(p.activity_id)?.name || null }))
  const doc = { updated: new Date().toISOString(), source: 'strava', prs: full }
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 }); fs.writeFileSync(PRS_FILE(), JSON.stringify(doc, null, 1), { mode: 0o640 })
  return doc
}
