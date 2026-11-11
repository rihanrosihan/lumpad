// Dedicated COROS archive (server/data/coros.db): every COROS MCP read tool, 2025-01-01 → today, newest date first,
// pulled in daily-budgeted sessions until complete. Raw responses are stored verbatim (gzip); FIT files go to data/fit/.
// The app tables in lumpad.db are rebuilt from this archive by project.js — COROS is never asked twice for the same thing.
//
// Unit of work = a task (one tool call). Tasks are planned from the calendar and from what earlier calls returned
// (sport records → per-activity tasks; workout library → workout details), then run ORDER BY day DESC.
// Budget: a call cap per tool ("bucket") and in total per WIB day. COROS does not publish its quotas, so when a tool answers
// with a quota/limit error the bucket stops for the day and the cap is lowered to what actually went through ("learned");
// a learned cap grows back by 10% after each day that used it fully without hitting the limit.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { parseSportRecords } from './parse.js'

const DIR = process.env.DATA_DIR || path.resolve('server/data')
export const ARCHIVE_PATH = process.env.COROS_ARCHIVE_DB || path.join(DIR, 'coros.db')
export const FIT_DIR = process.env.COROS_FIT_DIR || path.join(DIR, 'fit')
export const FROM = process.env.COROS_ARCHIVE_FROM || '2025-01-01'
if (ARCHIVE_PATH !== ':memory:') fs.mkdirSync(path.dirname(ARCHIVE_PATH), { recursive: true })
export const adb = new DatabaseSync(ARCHIVE_PATH)
try { if (ARCHIVE_PATH !== ':memory:') fs.chmodSync(ARCHIVE_PATH, 0o600) } catch {}
adb.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS tasks (
  key TEXT PRIMARY KEY, tool TEXT NOT NULL, args TEXT NOT NULL, ver TEXT,
  day TEXT NOT NULL,                       -- newest date the call covers: the queue runs ORDER BY day DESC
  rank INTEGER NOT NULL,                   -- tie-break within a day (discovery before details)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | empty | failed | skipped
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, done_day TEXT, created_at TEXT NOT NULL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS tasks_queue ON tasks(status, day DESC, rank);
CREATE TABLE IF NOT EXISTS responses (key TEXT PRIMARY KEY, tool TEXT NOT NULL, args TEXT, day TEXT, body BLOB NOT NULL, bytes INTEGER, sha256 TEXT, fetched_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS responses_tool ON responses(tool, day);
CREATE TABLE IF NOT EXISTS activities (label_id TEXT PRIMARY KEY, sport_type INTEGER, date TEXT NOT NULL, start_ts INTEGER, end_ts INTEGER, rec TEXT NOT NULL, seen_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS activities_date ON activities(date);
CREATE TABLE IF NOT EXISTS fit_files (label_id TEXT PRIMARY KEY, sport_type INTEGER, date TEXT, path TEXT NOT NULL, bytes INTEGER, sha256 TEXT, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, bucket TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, bucket));
CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, learned_cap INTEGER, blocked_day TEXT, note TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);`)

// ---- dates (WIB calendar days, yyyy-mm-dd)
const D = (s) => new Date(s + 'T12:00:00Z')
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const diffDays = (a, b) => Math.round((D(a) - D(b)) / 864e5)
export const jakartaDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d)
const ymd = (s) => s.replace(/-/g, '')
const monthEnd = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)).toISOString().slice(0, 10)
const minD = (a, b) => (a < b ? a : b), maxD = (a, b) => (a > b ? a : b)

// ---- budget
export const BUCKET = { queryActivityFitFileDownloadUrls: 'fit', downloadActivityFitFiles: 'fit' }
export const bucketOf = (tool) => BUCKET[tool] || tool
// Calls per WIB day. Conservative: COROS publishes no numbers (only "a daily FIT file limit"). Override with
// COROS_BUDGET='{"fit":20,"total":300}' in .env. Learned caps (from real quota errors) take precedence when lower.
export const DEFAULT_BUDGET = {
  total: 600,
  querySportRecords: 40, getActivityDetail: 150, queryActivityLapData: 150, fit: 40, queryCustomActivityLapData: 60,
  queryDailyHealthData: 4, queryRestingHeartRate: 4, queryStressLevel: 4, queryTrainingLoadAssessment: 4,
  querySleepHrv: 60, querySleepOverview: 30, queryAvgHeartRate: 30, queryStressTimeSeries: 60, queryHealthCheckTimeSeries: 60,
  queryRecoveryStatus: 2, queryFitnessAssessmentOverview: 2, queryUserInfo: 2, queryDevices: 2, queryWorkoutLibrary: 2, queryWorkoutDetails: 40,
}
export function budget() { let o = {}; try { o = JSON.parse(process.env.COROS_BUDGET || '{}') } catch {} return { ...DEFAULT_BUDGET, ...o } }
const usedOn = (day, bucket) => adb.prepare('SELECT calls FROM usage WHERE day=? AND bucket=?').get(day, bucket)?.calls || 0
const usedTotal = (day) => adb.prepare('SELECT COALESCE(SUM(calls),0) n FROM usage WHERE day=?').get(day).n
const limitRow = (bucket) => adb.prepare('SELECT * FROM limits WHERE bucket=?').get(bucket)
export function capOf(bucket) { const b = budget()[bucket] ?? 20, l = limitRow(bucket)?.learned_cap; return l != null ? Math.min(b, l) : b }
const count = (day, bucket, err = 0) => adb.prepare('INSERT INTO usage (day, bucket, calls, errors) VALUES (?,?,1,?) ON CONFLICT(day, bucket) DO UPDATE SET calls=calls+1, errors=errors+excluded.errors').run(day, bucket, err)

// ---- tasks
const SNAPSHOT = ['queryRecoveryStatus', 'queryFitnessAssessmentOverview', 'queryUserInfo', 'queryDevices', 'queryWorkoutLibrary']
const DAYS_TOOLS = ['queryStressLevel', 'queryDailyHealthData', 'queryRestingHeartRate', 'queryTrainingLoadAssessment'] // take only "last N days"
const WINDOWED = { querySleepHrv: 7, queryStressTimeSeries: 7, querySleepOverview: 30, queryAvgHeartRate: 31 } // tool max window, days
const RANK = { querySportRecords: 1, getActivityDetail: 2, queryActivityLapData: 3, queryActivityFitFileDownloadUrls: 4, downloadActivityFitFiles: 4,
  querySleepHrv: 5, querySleepOverview: 5, queryAvgHeartRate: 5, queryStressTimeSeries: 6, queryCustomActivityLapData: 7, queryHealthCheckTimeSeries: 8, queryWorkoutDetails: 9 }
export const TOOLS = [...SNAPSHOT, ...DAYS_TOOLS, 'querySportRecords', 'getActivityDetail', 'queryActivityLapData', 'queryCustomActivityLapData',
  'queryActivityFitFileDownloadUrls', 'downloadActivityFitFiles', ...Object.keys(WINDOWED), 'queryHealthCheckTimeSeries', 'queryWorkoutDetails']

const nowIso = () => new Date().toISOString()
const getTask = (key) => adb.prepare('SELECT * FROM tasks WHERE key=?').get(key)
// Insert, or re-open an existing task when its arguments/version changed or it is "recent" and was last pulled before today.
function upsert(today, key, tool, args, day, { ver = null, refresh = false } = {}) {
  const a = JSON.stringify(args), cur = getTask(key)
  if (!cur) return adb.prepare('INSERT INTO tasks (key, tool, args, ver, day, rank, status, created_at) VALUES (?,?,?,?,?,?,?,?)').run(key, tool, a, ver, day, RANK[tool] ?? 0, 'pending', nowIso())
  const changed = cur.args !== a || (ver != null && cur.ver !== ver), stale = refresh && ['done', 'empty', 'failed'].includes(cur.status) && (cur.done_day || '') < today
  if (changed || stale) adb.prepare("UPDATE tasks SET args=?, ver=?, day=?, status='pending', attempts=0, error=NULL, updated_at=? WHERE key=?").run(a, ver, day, nowIso(), key)
}
const meta = (k, v) => (v === undefined ? adb.prepare('SELECT v FROM meta WHERE k=?').get(k)?.v : adb.prepare('INSERT INTO meta (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v)))
export const healthFrom = () => meta('health_from') || null

function planActivity(today, a) {
  const id = a.label_id, st = a.sport_type, args = { labelId: id, sportType: st }
  upsert(today, 'detail:' + id, 'getActivityDetail', args, a.date)
  upsert(today, 'laps:' + id, 'queryActivityLapData', args, a.date)
  if (!adb.prepare('SELECT 1 FROM fit_files WHERE label_id=?').get(id)) upsert(today, 'fit:' + id, 'queryActivityFitFileDownloadUrls', args, a.date)
  if (a.start_ts && a.end_ts && a.end_ts > a.start_ts) upsert(today, 'custom:' + id, 'queryCustomActivityLapData', { ...args, startTimestamp: a.start_ts, endTimestamp: a.end_ts }, a.date)
}

// Build/refresh the queue for `today`. Idempotent; cheap enough to call before every session.
export function plan(today) {
  const run = () => {
    // learned caps grow back after a day that used them fully without a quota error
    if (meta('grown_day') !== today) {
      const y = addDays(today, -1)
      for (const l of adb.prepare('SELECT * FROM limits WHERE learned_cap IS NOT NULL').all())
        if (l.blocked_day !== y && usedOn(y, l.bucket) >= l.learned_cap) {
          const n = l.learned_cap + Math.max(1, Math.round(l.learned_cap * 0.1))
          if (n >= (budget()[l.bucket] ?? 20)) adb.prepare('UPDATE limits SET learned_cap=NULL, updated_at=? WHERE bucket=?').run(nowIso(), l.bucket)
          else adb.prepare('UPDATE limits SET learned_cap=?, updated_at=? WHERE bucket=?').run(n, nowIso(), l.bucket)
        }
      meta('grown_day', today)
    }
    // "now" snapshots: one per day (a past day's snapshot can no longer be taken)
    adb.prepare("UPDATE tasks SET status='skipped', updated_at=? WHERE status='pending' AND tool IN (" + SNAPSHOT.map(() => '?').join(',') + ') AND day < ?').run(nowIso(), ...SNAPSHOT, today)
    for (const t of SNAPSHOT) upsert(today, `${t}:${today}`, t, {}, today)
    // "last N days" tools: one call covering FROM..today, re-pulled daily (newest values change). N may have been halved after failures.
    for (const t of DAYS_TOOLS) { const cap = +meta('days_cap:' + t) || 9999; upsert(today, t + ':all', t, { days: Math.min(cap, diffDays(today, FROM) + 1) }, today, { refresh: true }) }
    // activities, month by month (newest month first by day)
    for (let s = FROM.slice(0, 8) + '01'; s <= today; s = addDays(monthEnd(s), 1)) {
      const e = minD(monthEnd(s), today)
      if (!getTask('sport:' + s.slice(0, 7) + ':split')) upsert(today, 'sport:' + s.slice(0, 7), 'querySportRecords', { startDate: ymd(maxD(s, FROM)), endDate: ymd(e), limit: 100 }, e, { refresh: e >= addDays(today, -7) })
    }
    // daily health series: only from the first day the watch recorded health data (known after the "days" tools ran)
    const hf = healthFrom()
    if (hf) {
      const start = maxD(FROM, hf)
      for (const [tool, n] of Object.entries(WINDOWED))
        for (let s = FROM; s <= today; s = addDays(s, n)) { // windows anchored at FROM → stable keys
          const e = minD(addDays(s, n - 1), today); if (e < start) continue
          upsert(today, `${tool}:${s}`, tool, { startDate: ymd(maxD(s, start)), endDate: ymd(e) }, e, { refresh: e >= addDays(today, -3) })
        }
      for (let d = today; d >= start; d = addDays(d, -1)) upsert(today, 'hc:' + d, 'queryHealthCheckTimeSeries', { startDate: ymd(d), endDate: ymd(d) }, d, { refresh: d >= addDays(today, -1) })
    }
    for (const a of adb.prepare('SELECT label_id, sport_type, date, start_ts, end_ts FROM activities').all()) planActivity(today, a)
    // failed tasks get another round of 3 attempts after 3 days
    adb.prepare("UPDATE tasks SET status='pending', attempts=0, updated_at=? WHERE status='failed' AND done_day <= ? AND tool != 'queryActivityFitFileDownloadUrls'").run(nowIso(), addDays(today, -3))
  }
  adb.exec('BEGIN'); try { run(); adb.exec('COMMIT') } catch (e) { adb.exec('ROLLBACK'); throw e }
}

// buckets still allowed today
function openBuckets(today, blocked) {
  if (usedTotal(today) >= budget().total) return []
  return [...new Set(TOOLS.map(bucketOf))].filter((b) => !blocked.has(b) && limitRow(b)?.blocked_day !== today && usedOn(today, b) < capOf(b))
}
function nextTask(today, blocked, skip = new Set()) {
  const tools = TOOLS.filter((t) => openBuckets(today, blocked).includes(bucketOf(t))); if (!tools.length) return null
  const ex = [...skip] // tasks that failed in this session wait for the next one
  return adb.prepare(`SELECT * FROM tasks WHERE status='pending' AND tool IN (${tools.map(() => '?').join(',')})${ex.length ? ` AND key NOT IN (${ex.map(() => '?').join(',')})` : ''} ORDER BY day DESC, rank ASC LIMIT 1`).get(...tools, ...ex) || null
}
export function hasWork(today) { plan(today); return !!nextTask(today, new Set()) }

// ---- results
const ANOMALY_RE = /Tool call anomalies detected|session context pollution/i
const EMPTY_RE =/No (?:sleep |wellness |stress |heart rate )?(?:\w+ )?data found|\(0 records\)|Total workouts:\s*0\b/i
function saveResponse(t, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
  adb.prepare('INSERT INTO responses (key, tool, args, day, body, bytes, sha256, fetched_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET args=excluded.args, day=excluded.day, body=excluded.body, bytes=excluded.bytes, sha256=excluded.sha256, fetched_at=excluded.fetched_at')
    .run(t.key, t.tool, t.args, t.day, zlib.gzipSync(buf), buf.length, crypto.createHash('sha256').update(buf).digest('hex'), nowIso())
}
export function responseText(key) { const r = adb.prepare('SELECT body FROM responses WHERE key=?').get(key); return r ? zlib.gunzipSync(r.body).toString('utf8') : null }
export const responsesOf = (tool) => adb.prepare('SELECT key, day, body FROM responses WHERE tool=? ORDER BY day, key').all(tool).map((r) => ({ key: r.key, day: r.day, text: zlib.gunzipSync(r.body).toString('utf8') }))
const finish = (t, today, status, error = null) => adb.prepare('UPDATE tasks SET status=?, error=?, done_day=?, updated_at=? WHERE key=?').run(status, error, today, nowIso(), t.key)

function writeFit(labelId, sportType, date, buf) {
  if (!buf?.length) throw new Error('empty FIT file')
  if (buf.length < 12 || buf.toString('ascii', 8, 12) !== '.FIT') throw new Error('not a FIT file')
  const dir = path.join(FIT_DIR, (date || '0000').slice(0, 4)); fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, labelId + '.fit'); fs.writeFileSync(f + '.tmp', buf, { mode: 0o600 }); fs.renameSync(f + '.tmp', f)
  adb.prepare('INSERT INTO fit_files (label_id, sport_type, date, path, bytes, sha256, fetched_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(label_id) DO UPDATE SET path=excluded.path, bytes=excluded.bytes, sha256=excluded.sha256, fetched_at=excluded.fetched_at')
    .run(labelId, sportType, date, path.relative(path.dirname(ARCHIVE_PATH), f), buf.length, crypto.createHash('sha256').update(buf).digest('hex'), nowIso())
}

// Per-tool side effects after a successful call. Returns 'done' | 'empty'.
async function handle(t, args, text, { today, fetchFn, call }) {
  if (t.tool === 'downloadActivityFitFiles') {
    const content = await call.content(t.tool, args)
    const blob = content.map((c) => c.resource?.blob || (c.type === 'blob' && c.data) || null).find(Boolean)
    if (!blob) throw new Error('no FIT resource in response')
    writeFit(args.labelId, args.sportType, t.day, Buffer.from(blob, 'base64')); saveResponse(t, 'FIT resource saved'); return 'done'
  }
  saveResponse(t, text)
  if (t.tool === 'querySportRecords') {
    const list = parseSportRecords(text)
    for (const a of list) adb.prepare('INSERT INTO activities (label_id, sport_type, date, start_ts, end_ts, rec, seen_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(label_id) DO UPDATE SET sport_type=excluded.sport_type, date=excluded.date, start_ts=excluded.start_ts, end_ts=excluded.end_ts, rec=excluded.rec, seen_at=excluded.seen_at')
      .run(a.source_id, a.sport_code ?? null, a.date, a.start_ts ?? null, a.end_ts ?? null, JSON.stringify(a), nowIso())
    const s = `${args.startDate.slice(0, 4)}-${args.startDate.slice(4, 6)}-${args.startDate.slice(6)}`, e = `${args.endDate.slice(0, 4)}-${args.endDate.slice(4, 6)}-${args.endDate.slice(6)}`
    if (list.length >= args.limit && s < e) { // page full → split the window in two (children replace this task)
      const mid = addDays(s, Math.floor(diffDays(e, s) / 2))
      upsert(today, `sport:${s}..${mid}`, t.tool, { startDate: ymd(s), endDate: ymd(mid), limit: 100 }, mid)
      upsert(today, `sport:${addDays(mid, 1)}..${e}`, t.tool, { startDate: ymd(addDays(mid, 1)), endDate: ymd(e), limit: 100 }, e)
      if (/^sport:\d{4}-\d{2}$/.test(t.key)) upsert(today, t.key + ':split', 'querySportRecords', {}, '0000-00-00') // marker: planner stops recreating the month
      adb.prepare("UPDATE tasks SET status='skipped' WHERE key=? OR key=?").run(t.key + ':split', t.key)
      return 'done'
    }
    for (const a of adb.prepare('SELECT label_id, sport_type, date, start_ts, end_ts FROM activities WHERE date BETWEEN ? AND ?').all(s, e)) planActivity(today, a)
    return list.length ? 'done' : 'empty'
  }
  if (t.tool === 'queryStressLevel' || t.tool === 'queryDailyHealthData') { // first day with real health data → where daily series start
    const dates = t.tool === 'queryStressLevel' ? [...text.matchAll(/^(\d{4}-\d{2}-\d{2}):\s*\nAverage Stress:\s*[1-9]/gm)].map((m) => m[1])
      : [...text.matchAll(/^--- (\d{4})(\d{2})(\d{2}) ---\n(?!Steps: 0 \|[^\n]*\n\n)/gm)].map((m) => `${m[1]}-${m[2]}-${m[3]}`)
    const first = dates.sort()[0]
    if (first && (!healthFrom() || first < healthFrom())) meta('health_from', first)
  }
  if (t.tool === 'queryWorkoutLibrary') {
    for (const m of text.matchAll(/Workout ID:\s*(\d+)[\s\S]*?Updated:\s*(\d{4}-\d{2}-\d{2})[ \d:]*/g)) upsert(today, 'workout:' + m[1], 'queryWorkoutDetails', { workoutId: m[1] }, m[2], { ver: m[0].match(/Updated:\s*([\d-]+ [\d:]+)/)?.[1] || m[2] })
  }
  if (t.tool === 'queryActivityFitFileDownloadUrls') {
    const url = /https:\/\/[^\s"]+\.fit\b/i.exec(text)?.[0]; if (!url) throw new Error('no FIT URL in response')
    const r = await fetchFn(url); if (!r.ok) throw new Error(`FIT download ${r.status}`)
    writeFit(args.labelId, args.sportType, t.day, Buffer.from(await r.arrayBuffer()))
    return 'done'
  }
  return EMPTY_RE.test(text) && text.length < 400 ? 'empty' : 'done'
}

// One budgeted session. Never throws for a single bad call; stops early on quota errors (per bucket), on 5 failures in a row,
// or on a lost login. progress({stage, done, total, tool, day}).
export async function runArchive({ call, today = jakartaDate(), maxCalls = 200, maxMs = 25 * 60000, progress = () => {}, fetchFn = fetch, log = () => {} }) {
  plan(today)
  const t0 = Date.now(), blocked = new Set(), skip = new Set(), stats = { calls: 0, done: 0, empty: 0, failed: 0, retried: 0, quota: [], stopped: null }
  let streak = 0
  for (;;) {
    if (stats.calls >= maxCalls) { stats.stopped = 'session call limit'; break }
    if (Date.now() - t0 > maxMs) { stats.stopped = 'session time limit'; break }
    const t = nextTask(today, blocked, skip); if (!t) { stats.stopped = 'budget used or queue empty'; break }
    const b = bucketOf(t.tool), args = JSON.parse(t.args)
    progress({ stage: 'archive', done: stats.calls, total: maxCalls, tool: t.tool, day: t.day })
    stats.calls++; count(today, b)
    try {
      const text = t.tool === 'downloadActivityFitFiles' ? '' : await call(t.tool, args)
      // COROS sometimes answers a valid call with an "anomalies" notice instead of data (not flagged as an error) → retry later
      if (ANOMALY_RE.test(text.slice(0, 200))) throw new Error('COROS anomaly notice instead of data')
      if (t.tool === 'queryActivityLapData' && !/"lapGroups"/.test(text)) throw new Error('unreadable lap response')
      const st = await handle(t, args, text, { today, fetchFn, call })
      if (getTask(t.key)?.status === 'pending') finish(t, today, st)
      stats[st]++; streak = 0
      if (t.tool === 'querySportRecords' || DAYS_TOOLS.includes(t.tool)) plan(today) // new activities / health start date → new tasks
    } catch (e) {
      if (e.notConnected) { stats.stopped = 'COROS login: ' + e.message; break }
      adb.prepare('UPDATE usage SET errors=errors+1 WHERE day=? AND bucket=?').run(today, b)
      if (e.quota) { // today's allowance for this bucket is used up: remember how many went through
        const ok = Math.max(1, usedOn(today, b) - 1)
        adb.prepare('INSERT INTO limits (bucket, learned_cap, blocked_day, note, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(bucket) DO UPDATE SET learned_cap=MIN(COALESCE(learned_cap, excluded.learned_cap), excluded.learned_cap), blocked_day=excluded.blocked_day, note=excluded.note, updated_at=excluded.updated_at')
          .run(b, ok, today, String(e.message).slice(0, 200), nowIso())
        blocked.add(b); stats.quota.push(b); log(`quota ${b} after ${ok} calls`); continue
      }
      streak++
      const tries = t.attempts + 1, msg = String(e.message).slice(0, 300)
      if (DAYS_TOOLS.includes(t.tool) && args.days > 30) { meta('days_cap:' + t.tool, Math.floor(args.days / 2)); adb.prepare("UPDATE tasks SET args=?, attempts=?, error=? WHERE key=?").run(JSON.stringify({ days: Math.floor(args.days / 2) }), tries, msg, t.key); stats.retried++ }
      else if (tries >= 3) {
        finish(t, today, 'failed', msg); stats.failed++
        if (t.tool === 'queryActivityFitFileDownloadUrls') upsert(today, 'fitdl:' + args.labelId, 'downloadActivityFitFiles', { labelId: args.labelId, sportType: args.sportType }, t.day)
      } else { adb.prepare('UPDATE tasks SET attempts=?, error=?, updated_at=? WHERE key=?').run(tries, msg, nowIso(), t.key); stats.retried++; skip.add(t.key) }
      if (streak >= 5) { stats.stopped = '5 failures in a row: ' + msg; break }
    }
  }
  return stats
}

// ---- status for the UI / monitoring (counts, dates and budget only — no health values)
export function status(today = jakartaDate()) {
  const B = budget(), per = new Map()
  for (const r of adb.prepare("SELECT tool, status, COUNT(*) n, MIN(day) oldest, MAX(day) newest FROM tasks WHERE key NOT LIKE '%:split' GROUP BY tool, status").all()) {
    const o = per.get(r.tool) || { tool: r.tool, bucket: bucketOf(r.tool), pending: 0, done: 0, empty: 0, failed: 0, skipped: 0, oldest: null, newest: null }
    o[r.status] = r.n; if (r.status === 'done' || r.status === 'empty') { o.oldest = o.oldest ? minD(o.oldest, r.oldest) : r.oldest; o.newest = o.newest ? maxD(o.newest, r.newest) : r.newest }
    per.set(r.tool, o)
  }
  const tools = TOOLS.map((t) => per.get(t)).filter(Boolean)
  const buckets = [...new Set(TOOLS.map(bucketOf))].map((b) => {
    const pending = tools.filter((t) => t.bucket === b).reduce((s, t) => s + t.pending, 0), cap = capOf(b), l = limitRow(b)
    return { bucket: b, used: usedOn(today, b), cap, configured: B[b] ?? 20, learned: l?.learned_cap ?? null, blockedToday: l?.blocked_day === today, pending, etaDays: pending ? Math.ceil(pending / Math.max(1, cap)) : 0 }
  })
  const pending = buckets.reduce((s, b) => s + b.pending, 0)
  // backlog = history still to fetch (recurring refreshes of the last week don't count against "complete")
  const backlog = adb.prepare("SELECT COUNT(*) n FROM tasks WHERE status='pending' AND day < ?").get(addDays(today, -7)).n
  const size = (f) => { try { return fs.statSync(f).size } catch { return 0 } }
  return {
    from: FROM, today, healthFrom: healthFrom(), tools, buckets,
    total: { used: usedTotal(today), cap: B.total, pending, done: tools.reduce((s, t) => s + t.done + t.empty, 0) },
    etaDays: Math.max(0, ...buckets.map((b) => b.etaDays), Math.ceil(pending / Math.max(1, B.total))),
    backlog, complete: backlog === 0 && !!healthFrom() && tools.some((t) => t.tool === 'querySportRecords' && t.pending === 0),
    activities: adb.prepare('SELECT COUNT(*) n, MIN(date) first, MAX(date) last FROM activities').get(),
    fit: adb.prepare('SELECT COUNT(*) files, COALESCE(SUM(bytes),0) bytes FROM fit_files').get(),
    dbBytes: ARCHIVE_PATH === ':memory:' ? 0 : size(ARCHIVE_PATH) + size(ARCHIVE_PATH + '-wal'),
    usageLast7: adb.prepare('SELECT day, SUM(calls) calls, SUM(errors) errors FROM usage WHERE day >= ? GROUP BY day ORDER BY day').all(addDays(today, -6)),
  }
}
