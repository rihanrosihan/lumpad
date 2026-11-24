// Rollback drill helper: prints a content hash of every memory / session_context row that is NOT from the old-notes import, plus the old-row counts.
// Usage (on COPIES only):  node server/oldlumpad/drill.mjs <dir-with-memory.db> <label>
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'

const dir = process.argv[2], label = process.argv[3] || '', m = new DatabaseSync(dir + '/memory.db', { readOnly: true })
const h = (sql) => { const x = crypto.createHash('sha256'); let n = 0; for (const r of m.prepare(sql).iterate()) { x.update(JSON.stringify(r)); n++ } return n + ':' + x.digest('hex').slice(0, 16) }
const c = (sql) => m.prepare(sql).get().c
console.log(JSON.stringify({
  phase: label,
  non_old_memory: h("SELECT * FROM memory WHERE COALESCE(source,'') <> 'old_lumpad' ORDER BY id"),
  non_old_session_context: h("SELECT * FROM session_context WHERE COALESCE(kind,'') <> 'old_lumpad' ORDER BY id"),
  old_memory: c("SELECT count(*) c FROM memory WHERE source='old_lumpad'"),
  old_session_context: c("SELECT count(*) c FROM session_context WHERE kind='old_lumpad'"),
  old_rows_still_in_fts: c("SELECT count(*) c FROM memory_fts WHERE rowid IN (SELECT id FROM memory WHERE source='old_lumpad')"),
}))
