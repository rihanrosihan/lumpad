// Starts the intelligence scheduler: nightly full job, quick job after each COROS job, and (optional) scheduled coach runs.
// Coach schedule (DeepSeek, capped at DEEPSEEK_MONTHLY_CAP_CNY): daily brief ≥ 08:00 WIB once the daily sync is done · session review for a new run ≥ 16 km · weekly review Sunday ≥ 19:00 WIB.
import { db } from '../store.js'
import { idb, mdb } from './db.js'
import { intelTick, isBusy } from './run.js'
import { runCoach } from './coach.js'
import { guard } from './llm.js'
import { canRun, jobKey, recordFailure, recordSuccess } from './jobledger.js'

const wibNow = () => new Date(Date.now() + 7 * 3600e3)
const today = () => wibNow().toISOString().slice(0, 10)
let coaching = false
// A new run was processed AFTER today's last brief was written (and no brief for it exists yet): the brief is out of date, so write a post-run one.
// Pure over the two databases so it can be tested. Returns the question (stable per run: one post-run brief per run) or null.
export function postRunTarget(day, i = idb, m = mdb) {
  const last = m.prepare("SELECT created_at FROM coach_run WHERE intent='daily_brief' AND ok=1 AND substr(datetime(created_at, '+7 hours'),1,10) = ? ORDER BY id DESC LIMIT 1").get(day)
  if (!last) return null   // no brief yet today: the normal brief already includes the run
  for (const s of i.prepare('SELECT label_id FROM fit_session WHERE date=? AND processed_at > ? ORDER BY start_ms DESC').all(day, last.created_at)) {
    const q = 'after-run ' + s.label_id
    if (!m.prepare("SELECT 1 FROM coach_run WHERE intent='daily_brief' AND ok=1 AND question=?").get(q)) return q
  }
  return null
}
export async function coachTick() {
  if (coaching || isBusy() || process.env.COACH_SCHEDULE === 'off' || !process.env.DEEPSEEK_API_KEY) return null
  const w = wibNow(), hm = w.getUTCHours() * 60 + w.getUTCMinutes(), day = today()
  // "done today" = created on the current WIB calendar day (the old now-20h UTC window let yesterday's brief count as today's)
  const done = (intent, q) => mdb.prepare("SELECT 1 FROM coach_run WHERE intent=? AND ok=1 AND substr(datetime(created_at, '+7 hours'),1,10) = ? AND (? IS NULL OR question=?)").get(intent, day, q ?? null, q ?? null)
  let job = null
  if (hm >= 480 && db.prepare("SELECT 1 FROM sync_jobs WHERE kind='daily' AND local_date=? AND status='done'").get(day) && !done('daily_brief')) job = { intent: 'daily_brief' }
  else if (hm >= 480 && postRunTarget(day)) job = { intent: 'daily_brief', question: postRunTarget(day) }
  else if (w.getUTCDay() === 0 && hm >= 19 * 60 && !done('weekly_review')) job = { intent: 'weekly_review' }
  else {
    const s = idb.prepare("SELECT label_id, activity_id, date FROM fit_session WHERE distance_m >= 16000 AND date >= ? ORDER BY date DESC").all(new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)).find((x) => !mdb.prepare("SELECT 1 FROM coach_run WHERE intent='session_review' AND ok=1 AND question=?").get('session ' + x.label_id))
    if (s) job = { intent: 'session_review', activityId: s.activity_id || s.label_id, question: 'session ' + s.label_id }
  }
  if (!job || !guard(job.intent).ok) return null
  // one ledger key per job and day: failures are retried at most twice, 30 min then 2 h apart, then left alone until tomorrow
  const key = jobKey(job.intent, job.question, day), gate = canRun(key)
  if (!gate.run) return null
  coaching = true
  try { const r = await runCoach(job); if (r?.ok === false) recordFailure(key, job.intent, (r.errors || ['invalid answer'])[0]); else recordSuccess(key, job.intent); return r }
  catch (e) { console.error('coach', job.intent, e.message); recordFailure(key, job.intent, e.message) } finally { coaching = false }
}
export function startIntelScheduler() {
  const safe = (f) => { try { Promise.resolve(f()).catch((e) => console.error('intel scheduler', e.message)) } catch (e) { console.error('intel scheduler', e.message) } }
  setInterval(() => { safe(intelTick); safe(coachTick) }, 5 * 60000)
  setTimeout(() => safe(intelTick), 60000)
}
