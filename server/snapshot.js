// Consistent snapshots of the live SQLite DBs for backups (copying a WAL-mode file mid-write is unsafe).
import fs from 'node:fs'
import path from 'node:path'
import { db, DB_PATH } from './store.js'
import { adb, ARCHIVE_PATH } from './coros/archive.js'
import { idb, mdb } from './intel/db.js'
import { openPlanDb } from './plan/db.js'
const IDB = process.env.INTEL_DB || path.join(path.dirname(DB_PATH), 'intel.db'), MDB = process.env.MEMORY_DB || path.join(path.dirname(DB_PATH), 'memory.db')
const PDB = process.env.PLAN_DB || path.join(path.dirname(DB_PATH), 'plan.db')  // plan.db is not rebuildable; only snapshotted once it exists (created by `server/plan/cli.js import`)
const targets = [[db, DB_PATH, 'lumpad.snapshot.db'], [adb, ARCHIVE_PATH, 'coros.snapshot.db'], [idb, IDB, 'intel.snapshot.db'], [mdb, MDB, 'memory.snapshot.db']]
if (fs.existsSync(PDB)) targets.push([openPlanDb(PDB), PDB, 'plan.snapshot.db'])
for (const [d, src, name] of targets) {
  const out = path.join(path.dirname(src), name)
  fs.rmSync(out, { force: true })
  d.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
  fs.chmodSync(out, 0o600)   // snapshots hold health data and sealed OAuth blobs
  console.log('snapshot', out)
}
