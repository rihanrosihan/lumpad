// Staged pull from COROS → normalised rows → applyIngest (idempotent). `call(tool,args)` is injected (real MCP or a test double).
import { parseDailyHealth, parseSleepHrv, parseResting, parseSportRecords, parseLaps } from './parse.js'
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
  for (let n = days; n >= 7; n = Math.floor(n / 2)) {
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
    if (p?.laps.length) { a.laps = p.laps; a.cadence ??= p.cadence; a.power ??= p.power; stats.laps += p.laps.length } else { stats.lapsMissing++; note(`laps missing for run ${a.date} (${a.source_id})`) }
  }
  uniq.forEach((a) => { delete a.sport_code; stats.activities++ })

  // 6. write (idempotent)
  progress({ stage: 'saving', done: 0, total: 1 })
  const health = [...rows.values()].filter((r) => Object.keys(r).length > 1).sort((a, b) => a.date.localeCompare(b.date))
  let res = { counts: { health: 0, activities: 0, laps: 0 }, rejected: [] }
  for (let i = 0; i < Math.max(1, Math.ceil(uniq.length / 300)); i++) {
    const r = applyIngest({ run: { trigger, started_at: new Date().toISOString(), notes: i === 0 ? notes.slice(0, 30) : [] }, health: i === 0 ? health : [], activities: uniq.slice(i * 300, (i + 1) * 300) })
    for (const k of ['health', 'activities', 'laps']) res.counts[k] += r.counts[k]; res.rejected.push(...r.rejected)
  }
  return { stats, counts: res.counts, rejected: res.rejected.length, notes }
}
