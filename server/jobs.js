// Job runner + daily scheduler. One job at a time; progress is persisted so the UI can show it.
import { db } from './store.js'
import { withCoros } from './coros/mcp.js'
import { status as oauthStatus } from './coros/oauth.js'
import { pullRange, addDays, jakartaDate } from './coros/pull.js'

let running = null
db.prepare("UPDATE sync_jobs SET status='interrupted', finished_at=? WHERE status='running'").run(new Date().toISOString()) // process restarted mid-job

const upd = (id, f) => { const keys = Object.keys(f); db.prepare(`UPDATE sync_jobs SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => (typeof f[k] === 'object' && f[k] !== null ? JSON.stringify(f[k]) : f[k])), id) }
export const isRunning = () => !!running
export const recentJobs = (n = 8) => db.prepare('SELECT id, kind, status, params, progress, error, started_at, finished_at FROM sync_jobs ORDER BY id DESC LIMIT ?').all(n)
  .map((j) => ({ ...j, params: JSON.parse(j.params || '{}'), progress: JSON.parse(j.progress || '{}') }))

// kind: 'daily' (last 4 days) | 'backfill' (from a date). `pull` is injectable for tests.
export function startJob(kind, { from } = {}, { pull = (args) => withCoros((call) => pullRange({ call, ...args })) } = {}) {
  if (running) throw Object.assign(new Error('a sync job is already running'), { status: 409 })
  const to = jakartaDate(), f = kind === 'backfill' ? (from || '2026-01-01') : addDays(to, -3)
  const id = Number(db.prepare('INSERT INTO sync_jobs (kind, status, params, progress, started_at, local_date) VALUES (?,?,?,?,?,?)').run(kind, 'running', JSON.stringify({ from: f, to }), '{}', new Date().toISOString(), to).lastInsertRowid)
  const notes = []
  running = pull({ from: f, to, trigger: kind === 'backfill' ? 'backfill' : 'daily', notes, progress: (p) => upd(id, { progress: p }) })
    .then((r) => upd(id, { status: 'done', progress: { stage: 'done', ...r }, finished_at: new Date().toISOString() }))
    .catch((e) => upd(id, { status: 'error', error: String(e.message).slice(0, 300), finished_at: new Date().toISOString() }))
    .finally(() => { running = null })
  return id
}
export const whenIdle = () => running || Promise.resolve()

// Daily at/after 07:50 WIB, once per day; up to 3 attempts, 30 min apart (e.g. watch not synced yet or COROS hiccup).
export function tick(now = new Date(), start = startJob) {
  if (running || !oauthStatus().connected) return null
  const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }).format(now) % 24
  const m = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', minute: '2-digit' }).format(now)
  if (h * 60 + m < 7 * 60 + 50) return null
  const day = jakartaDate(now)
  if (db.prepare("SELECT 1 FROM sync_jobs WHERE kind='daily' AND local_date=? AND status='done'").get(day)) return null
  const tries = db.prepare("SELECT COUNT(*) n, MAX(started_at) last FROM sync_jobs WHERE kind='daily' AND local_date=?").get(day)
  if (tries.n >= 3 || (tries.last && now - new Date(tries.last) < 30 * 60000)) return null
  return start('daily')
}
export const startScheduler = () => { setInterval(() => { try { tick() } catch (e) { console.error('scheduler', e.message) } }, 60000); setTimeout(() => { try { tick() } catch {} }, 15000) }
