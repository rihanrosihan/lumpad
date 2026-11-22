// Retention (audit M13): candidates untouched for 60 days are archived; prompts older than 90 days are dropped from coach_run (hash, usage and parsed answer stay).
import { mdb } from './db.js'
import { audit } from './memory.js'
const iso = (ms) => new Date(ms).toISOString()
export function retentionJob(now = Date.now()) {
  const stale = mdb.prepare("SELECT id FROM memory WHERE status='candidate' AND locked=0 AND updated_at < ?").all(iso(now - 60 * 864e5))
  for (const r of stale) { mdb.prepare("UPDATE memory SET status='archived', valid_to=?, updated_at=? WHERE id=?").run(iso(now), iso(now), r.id); audit('retention:archived', r.id, { reason: 'candidate untouched 60 d' }) }
  const p = mdb.prepare("UPDATE coach_run SET request=NULL WHERE request IS NOT NULL AND created_at < ?").run(iso(now - 90 * 864e5))
  return { candidates_archived: stale.length, prompts_dropped: Number(p.changes) }
}
