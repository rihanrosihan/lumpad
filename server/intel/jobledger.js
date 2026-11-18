// Retry ledger for scheduled coach runs. A failing run used to be retried every 5 minutes without limit (67 paid calls for one session review).
// Rule: at most MAX_ATTEMPTS per job key per day, waits grow 30 min → 2 h, then the job is parked as 'gave_up' until the next day's key.
import { mdb } from './db.js'

export const MAX_ATTEMPTS = 2, BACKOFF_MIN = [30, 120]
const iso = (ms) => new Date(ms).toISOString()
export const jobKey = (intent, target, day) => `${intent}|${target || '-'}|${day}`

// → { run: true } or { run: false, why }
export function canRun(key, now = Date.now()) {
  const j = mdb.prepare('SELECT * FROM coach_job WHERE key=?').get(key)
  if (!j) return { run: true }
  if (j.status === 'done') return { run: false, why: 'done' }
  if (j.attempts >= MAX_ATTEMPTS) return { run: false, why: 'gave_up' }
  if (j.next_try && Date.parse(j.next_try) > now) return { run: false, why: 'backoff', next_try: j.next_try }
  return { run: true }
}
export function recordFailure(key, intent, error, now = Date.now()) {
  const j = mdb.prepare('SELECT attempts FROM coach_job WHERE key=?').get(key), attempts = (j?.attempts || 0) + 1
  const status = attempts >= MAX_ATTEMPTS ? 'gave_up' : 'pending', next = iso(now + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60000)
  mdb.prepare(`INSERT INTO coach_job (key, intent, attempts, next_try, last_error, status, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts, next_try=excluded.next_try, last_error=excluded.last_error, status=excluded.status, updated_at=excluded.updated_at`)
    .run(key, intent, attempts, next, String(error || '').slice(0, 300), status, iso(now))
  return { attempts, status, next_try: next }
}
export function recordSuccess(key, intent, now = Date.now()) {
  mdb.prepare(`INSERT INTO coach_job (key, intent, attempts, status, updated_at) VALUES (?,?,1,'done',?) ON CONFLICT(key) DO UPDATE SET status='done', last_error=NULL, updated_at=excluded.updated_at`).run(key, intent, iso(now))
}
export const recentJobs = (n = 20) => mdb.prepare('SELECT key, intent, attempts, status, next_try, last_error, updated_at FROM coach_job ORDER BY updated_at DESC LIMIT ?').all(n)
