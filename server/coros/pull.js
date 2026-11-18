// Staged pull from COROS → normalised rows → applyIngest (idempotent). `call(tool,args)` is injected (real MCP or a test double).
import { parseDailyHealth, parseSleepHrv, parseResting, parseSportRecords, parseLaps, parseTrainingLoad, parseRecovery, parseSleepOverview, parseActivityDetail, parseFitness, parseDevices } from './parse.js'
import { pullSchedule } from './plan.js'
import { load as kvLoad, save as kvSave } from '../db.js'
import { applyIngest } from '../ingest.js'
import { db } from '../store.js'

const D = (s) => new Date(s + 'T12:00:00Z')
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const diffDays = (a, b) => Math.round((D(a) - D(b)) / 864e5)
const ymd = (s) => s.replace(/-/g, '')
export const jakartaDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d)
const RUN = new Set([100, 101, 102, 103])

async function retry(fn, tries, note, what) {
  for (let i = 1; ; i++) { try { return await fn() } catch (e) { if (i >= tries) { note(`${what}: ${String(e.message).slice(0, 120)}`); return null } } }
}

// Pull [from..to] and write it. progress({stage, done, total}) is called after every step.
export async function pullRange({ call, from, to, trigger, progress = () => {}, notes = [] }) {
  const note = (m) => { if (notes.length < 40) notes.push(m) }
  const rows = new Map(), get = (d) => rows.get(d) || rows.set(d, { date: d }).get(d)
  const keep = (d) => d >= from && d <= to
  const days = Math.min(400, diffDays(to, from) + 1)
  const stats = { health: 0, hrv: 0, resting: 0, activities: 0, laps: 0, lapsMissing: 0 }

  // 1. daily health (the tool takes only "last N days" → one call, halve on failure)
  progress({ stage: 'health', done: 0, total: 1 })
  for (let n = Math.max(days, 7); n >= 7; n = Math.floor(n / 2)) {
    const t = await retry(() => call('queryDailyHealthData', { days: n }), 2, note, `daily health (${n} days)`)
    if (t != null) { for (const r of parseDailyHealth(t)) if (keep(r.date)) Object.assign(get(r.date), r); stats.health = rows.size; if (n < days) note(`daily health only reached back ${n} days`); break }
  }
  // 2. sleep HRV in 7-day windows (tool maximum)
  const wins = []; for (let s = from; s <= to; s = addDays(s, 7)) wins.push([s, addDays(s, 6) > to ? to : addDays(s, 6)])
  for (const [i, [s, e]] of wins.entries()) {
    progress({ stage: 'hrv', done: i, total: wins.length })
    const t = await retry(() => call('querySleepHrv', { startDate: ymd(s), endDate: ymd(e) }), 2, note, `HRV ${s}..${e}`)
    if (t != null) for (const r of parseSleepHrv(t)) if (keep(r.date)) { Object.assign(get(r.date), r); stats.hrv++ }
  }
  // 3. resting HR
  progress({ stage: 'resting', done: 0, total: 1 })
  const rt = await retry(() => call('queryRestingHeartRate', { days: Math.min(days, 90) }), 2, note, 'resting HR')
  if (rt != null) for (const r of parseResting(rt)) if (keep(r.date)) { Object.assign(get(r.date), r); stats.resting++ }

  // 3b. training load (acute / chronic / ratio per day) — one call, halve on failure like daily health
  progress({ stage: 'load', done: 0, total: 1 })
  for (let n = Math.max(Math.min(days, 400), 7); n >= 7; n = Math.floor(n / 2)) {
    const t = await retry(() => call('queryTrainingLoadAssessment', { days: n }), 2, note, `training load (${n} days)`)
    if (t != null) { for (const r of parseTrainingLoad(t)) if (keep(r.date)) { Object.assign(get(r.date), r); stats.load = (stats.load || 0) + 1 } if (n < days) note(`training load only reached back ${n} days`); break }
  }
  // 3c. sleep score in 30-day windows
  const sw = []; for (let s = from; s <= to; s = addDays(s, 30)) sw.push([s, addDays(s, 29) > to ? to : addDays(s, 29)])
  for (const [i, [s, e]] of sw.entries()) {
    progress({ stage: 'sleep', done: i, total: sw.length })
    const t = await retry(() => call('querySleepOverview', { startDate: ymd(s), endDate: ymd(e) }), 2, note, `sleep score ${s}..${e}`)
    if (t != null) for (const r of parseSleepOverview(t)) if (keep(r.date)) Object.assign(get(r.date), r)
  }
  // 3d. "now" snapshots: recovery % and fitness assessment (COROS only exposes the current value; stored under today's date)
  progress({ stage: 'snapshot', done: 0, total: 2 })
  const rec = await retry(() => call('queryRecoveryStatus', {}), 2, note, 'recovery status'); if (rec != null) Object.assign(get(to), parseRecovery(rec))
  const fit = await retry(() => call('queryFitnessAssessmentOverview', {}), 2, note, 'fitness overview'); const fitness = fit != null ? parseFitness(fit) : {}
  const dev = await retry(() => call('queryDevices', {}), 1, () => {}, '')
  if (dev != null) { const kv = kvLoad('kv', {}); kv['lumpad.devices'] = { value: { devices: parseDevices(dev), at: new Date().toISOString() }, updatedAt: new Date().toISOString() }; kvSave('kv', kv) }

  // 3e. the COROS training schedule (watch plan): Nov 2026 → end of 2027, refreshed at most every 6 h; an empty answer never overwrites a good copy
  progress({ stage: 'plan', done: 0, total: 1 })
  try {
    const prev = kvLoad('coros_plan', null)
    if (!prev?.at || Date.now() - Date.parse(prev.at) > 6 * 3600e3) {
      const rows = await pullSchedule(call, '2026-11-01', '2027-12-31', addDays)
      if (rows.length) kvSave('coros_plan', { rows, at: new Date().toISOString() }); else if (!prev) note('training plan: COROS returned no scheduled workouts')
    }
  } catch (e) { note(`training plan: ${String(e.message).slice(0, 120)}`) }

  // 4. activities, month by month (split a window if the page is full)
  const acts = []
  const fetchActs = async (s, e, depth = 0) => {
    const t = await retry(() => call('querySportRecords', { startDate: ymd(s), endDate: ymd(e), limit: 100 }), 2, note, `activities ${s}..${e}`)
    if (t == null) return
    const list = parseSportRecords(t)
    if (list.length >= 100 && depth < 3 && s < e) { const mid = addDays(s, Math.floor(diffDays(e, s) / 2)); await fetchActs(s, mid, depth + 1); await fetchActs(addDays(mid, 1), e, depth + 1) } else acts.push(...list)
  }
  const months = []; for (let s = from; s <= to; ) { const e = addDays(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)).toISOString().slice(0, 10), 0); months.push([s, e > to ? to : e]); s = addDays(e, 1) }
  for (const [i, [s, e]] of months.entries()) { progress({ stage: 'activities', done: i, total: months.length }); await fetchActs(s, e) }
  const uniq = [...new Map(acts.map((a) => [a.source_id, a])).values()]

  // 5. laps for runs that don't have them yet (the lap tool is flaky: 3 tries, then move on)
  const runs = uniq.filter((a) => RUN.has(a.sport_code) && !db.prepare('SELECT 1 FROM laps WHERE activity_id = ? LIMIT 1').get('coros:' + a.source_id))
  for (const [i, a] of runs.entries()) {
    progress({ stage: 'laps', done: i, total: runs.length })
    const t = await retry(async () => { const r = await call('queryActivityLapData', { labelId: a.source_id, sportType: a.sport_code }); if (!parseLaps(r)) throw new Error('unreadable laps response'); return r }, 3, () => {}, '')
    const p = t && parseLaps(t)
    if (p?.laps.length) { a.laps = p.laps; a.cadence ??= p.cadence; a.power ??= p.power; a.max_hr ??= p.max_hr; stats.laps += p.laps.length } else { stats.lapsMissing++; note(`laps missing for run ${a.date} (${a.source_id})`) }
  }
  // 5b. per-activity training load / TE / focus (runs + strength) where we don't have it yet
  const need = uniq.filter((a) => (RUN.has(a.sport_code) || a.sport_code === 402) && db.prepare('SELECT training_load FROM activities WHERE id = ?').get('coros:' + a.source_id)?.training_load == null)
  for (const [i, a] of need.entries()) {
    progress({ stage: 'details', done: i, total: need.length })
    const t = await retry(() => call('getActivityDetail', { labelId: a.source_id, sportType: a.sport_code }), 2, () => {}, '')
    const d = t && parseActivityDetail(t); if (d && Object.keys(d).length) Object.assign(a, d)
  }
  uniq.forEach((a) => { delete a.sport_code; stats.activities++ })

  // 6. write (idempotent)
  progress({ stage: 'saving', done: 0, total: 1 })
  const health = [...rows.values()].filter((r) => Object.keys(r).length > 1).sort((a, b) => a.date.localeCompare(b.date))
  let res = { counts: { health: 0, activities: 0, laps: 0 }, rejected: [] }
  for (let i = 0; i < Math.max(1, Math.ceil(uniq.length / 300)); i++) {
    const r = applyIngest({ run: { trigger, started_at: new Date().toISOString(), notes: i === 0 ? notes.slice(0, 30) : [] }, health: i === 0 ? health : [], fitness: i === 0 && Object.keys(fitness).length ? [{ date: to, ...fitness }] : [], activities: uniq.slice(i * 300, (i + 1) * 300) })
    for (const k of ['health', 'activities', 'laps']) res.counts[k] += r.counts[k]; res.counts.fitness = (res.counts.fitness || 0) + (r.counts.fitness || 0); res.rejected.push(...r.rejected)
  }
  return { stats, counts: res.counts, rejected: res.rejected.length, notes }
}
