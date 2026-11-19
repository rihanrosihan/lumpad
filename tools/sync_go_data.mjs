// Copies the coach output schema (server/intel/schema.js) and the athlete baseline (src/lib/athlete.js), the season plan (src/data/plan.json) and the targets + checkpoints (src/lib/plan.js) into the Go module, which embeds them.
// Run after changing either: node tools/sync_go_data.mjs   (src/lib/godata.test.js fails while the copies are stale)
import fs from 'node:fs'
import { ATHLETE, Z2_CEILING } from '../src/lib/athlete.js'
import { TARGET, CHECKPOINTS } from '../src/lib/plan.js'
import { OUTPUT_SCHEMA } from '../server/intel/schema.js'
import { STABLE_ATHLETE, DEFINITIONS, TASKS, INTENT_QUERY } from '../server/intel/prompt.js'
import { probe } from './prompt_probe.mjs'
export const goData = () => ({ 'athlete/data/athlete.json': JSON.stringify({ ...ATHLETE, z2_ceiling: Z2_CEILING }, null, 1) + '\n', 'athlete/data/plan.json': fs.readFileSync('src/data/plan.json', 'utf8'), 'athlete/data/plan_meta.json': JSON.stringify({ target: TARGET, checkpoints: CHECKPOINTS }, null, 1) + '\n', 'coach/data/output_schema.json': JSON.stringify(OUTPUT_SCHEMA, null, 1) + '\n', 'coach/data/stable.json': JSON.stringify({ athlete: STABLE_ATHLETE, definitions: DEFINITIONS, tasks: TASKS, intent_query: INTENT_QUERY }, null, 1) + '\n', 'coach/data/prompt_probe.json': JSON.stringify(probe(), null, 1) + '\n' })
if (import.meta.url === `file://${process.argv[1]}`) for (const [f, body] of Object.entries(goData())) { fs.mkdirSync(`lumpadd/internal/${f.split('/').slice(0, -1).join('/')}`, { recursive: true }); fs.writeFileSync(`lumpadd/internal/${f}`, body); console.log('wrote', f) }
