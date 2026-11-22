// One-off: record the recommendations of recent successful coach answers in the advice ledger (runs before the ledger existed). Idempotent.
//   node --env-file=.env tools/advice_backfill.mjs [days=5]
import { mdb } from '../server/intel/db.js'
import { recordAdvice } from '../server/intel/advice.js'
const days = +process.argv[2] || 5, since = new Date(Date.now() - days * 864e5).toISOString()
let n = 0, runs = 0
for (const r of mdb.prepare("SELECT id, created_at, parsed FROM coach_run WHERE ok=1 AND provider != 'safety' AND parsed IS NOT NULL AND created_at >= ? ORDER BY id").all(since)) {
  let p; try { p = JSON.parse(r.parsed) } catch { continue }
  const asOf = new Date(Date.parse(r.created_at) + 7 * 3600e3).toISOString().slice(0, 10); n += recordAdvice(r.id, p, { asOf }); runs++
}
console.log(`advice ledger: ${n} recommendations recorded from ${runs} answers (last ${days} days)`)
