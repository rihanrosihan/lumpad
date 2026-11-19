// Reference for the Go archive projection + ingest validation: buildProjection() over coros.db and ingestOps() of each batch,
// exactly as projectAll() batches them. Personal data → gitignored golden folder. Usage: DATA_DIR=… node tools/export_projection.mjs [out]
import fs from 'node:fs'
const out = process.argv[2] || 'tools/golden/out/projection.json'
const { buildProjection } = await import('../server/coros/project.js'), { ingestOps } = await import('../server/ingest.js')
const P = buildProjection(), NOW = 'NOW', batches = []
for (let i = 0; i < P.health.length; i += 700) batches.push({ health: P.health.slice(i, i + 700) })
for (let i = 0; i < P.fitness.length; i += 300) batches.push({ fitness: P.fitness.slice(i, i + 300) })
for (let i = 0; i < P.acts.length; i += 300) batches.push({ activities: P.acts.slice(i, i + 300) })
fs.writeFileSync(out, JSON.stringify({ projection: P, ops: batches.map((b) => ingestOps(b, NOW)) }))
console.log(`projection: ${P.health.length} health days, ${P.fitness.length} fitness, ${P.acts.length} activities, ${batches.length} batches →`, out)
