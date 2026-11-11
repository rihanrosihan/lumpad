// Consistent snapshot of the live SQLite DB for backups (copying a WAL-mode file mid-write is unsafe).
import fs from 'node:fs'
import path from 'node:path'
import { db, DB_PATH } from './store.js'
const out = path.join(path.dirname(DB_PATH), 'lumpad.snapshot.db')
fs.rmSync(out, { force: true })
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
console.log('snapshot', out)
