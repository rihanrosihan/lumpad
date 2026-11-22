// Replays STORED coach answers through the quality scorer, so a prompt change can be judged on real history:
//   node server/intel/snapshot.js (or any copy of memory.db)  then  node server/intel/eval/replay.js [path/to/memory.db] [--since 2026-11-22T09:00:00Z]
// Prints pass rates per check before and after the cut-off. Read-only.
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { scoreAnswer, summarize } from './quality.js'

export function load(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  return db.prepare("SELECT id, created_at, intent, parsed FROM coach_run WHERE ok=1 AND provider != 'safety' AND parsed IS NOT NULL ORDER BY id").all()
    .map((r) => { let p; try { p = JSON.parse(r.parsed) } catch { return null } return p && p.summary ? { id: r.id, at: r.created_at, intent: r.intent, quality: scoreAnswer(p, { intent: r.intent }) } : null }).filter(Boolean)
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—')
export function report(rows, since) {
  const eras = since ? [['before ' + since.slice(0, 16), rows.filter((r) => r.at < since)], ['since ' + since.slice(0, 16), rows.filter((r) => r.at >= since)]] : [['all', rows]]
  const out = []
  for (const [name, rs] of eras) {
    const s = summarize(rs); out.push(`\n== ${name}: ${rs.length} answers, ${pct(rs.filter((r) => r.quality.pass).length, rs.length)} pass every check`)
    for (const [intent, b] of Object.entries(s)) out.push(`  ${intent.padEnd(15)} n=${String(b.n).padEnd(3)} all-pass ${pct(b.pass, b.n).padEnd(5)} ` + Object.entries(b.checks).map(([c, v]) => `${c} ${pct(v.pass, v.n)}`).join(' · '))
  }
  return out.join('\n')
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), i = args.indexOf('--since'), since = i >= 0 ? args[i + 1] : null, p = args.find((a, j) => !a.startsWith('--') && j !== i + 1) || path.join(process.env.DATA_DIR || 'server/data', 'memory.snapshot.db')
  console.log(report(load(p), since))
}
