// Consistent snapshots of the live SQLite DBs for backups (copying a WAL-mode file mid-write is unsafe).
import fs from 'node:fs'
import path from 'node:path'
import { db, DB_PATH } from './store.js'
import { adb, ARCHIVE_PATH } from './coros/archive.js'
for (const [d, src, name] of [[db, DB_PATH, 'lumpad.snapshot.db'], [adb, ARCHIVE_PATH, 'coros.snapshot.db']]) {
  const out = path.join(path.dirname(src), name)
  fs.rmSync(out, { force: true })
  d.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
  console.log('snapshot', out)
}
