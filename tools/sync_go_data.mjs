// Copies the athlete baseline (src/lib/athlete.js), the season plan (src/data/plan.json) and the targets + checkpoints (src/lib/plan.js) into the Go module, which embeds them.
// Run after changing either: node tools/sync_go_data.mjs   (src/lib/godata.test.js fails while the copies are stale)
import fs from 'node:fs'
import { ATHLETE, Z2_CEILING } from '../src/lib/athlete.js'
import { TARGET, CHECKPOINTS } from '../src/lib/plan.js'
export const goData = () => ({ 'athlete.json': JSON.stringify({ ...ATHLETE, z2_ceiling: Z2_CEILING }, null, 1) + '\n', 'plan.json': fs.readFileSync('src/data/plan.json', 'utf8'), 'plan_meta.json': JSON.stringify({ target: TARGET, checkpoints: CHECKPOINTS }, null, 1) + '\n' })
if (import.meta.url === `file://${process.argv[1]}`) for (const [f, body] of Object.entries(goData())) { fs.writeFileSync(`lumpadd/internal/athlete/data/${f}`, body); console.log('wrote', f) }
