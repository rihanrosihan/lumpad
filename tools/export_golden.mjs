// Golden fixtures for the Go port (redesign Phase 2, gate G2): freezes what the CURRENT engine computes so the new engine can be diffed against it.
// Usage: DATA_DIR=<server data dir> node tools/export_golden.mjs [outDir]   (default outDir: tools/golden/out — gitignored, contains your health data)
// Writes: sessions.json (every FIT session: inputs' identity + all derived metrics), twin.json (latest twin), matrices.json, edges.json, fixtures.sha256
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const out = path.resolve(process.argv[2] || 'tools/golden/out'); fs.mkdirSync(out, { recursive: true })
const { sessionDataset, computeEdges } = await import('../server/intel/corr.js')
const { idb } = await import('../server/intel/db.js'), { latestTwin } = await import('../server/intel/twin.js'), { matrices } = await import('../server/intel/matrices.js'), { listEdges } = await import('../server/intel/corr.js')
const round = (v) => (typeof v === 'number' ? (Math.round(v * 1e6) / 1e6) + 0 : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v)
const sessions = idb.prepare('SELECT * FROM fit_session ORDER BY date, label_id').all().map((s) => { const { card, features, processed_at, ...rest } = s; return round({ ...rest, metrics: JSON.parse(rest.metrics), km: JSON.parse(rest.km), features: features ? JSON.parse(features) : null }) })
// correlation engine on the real data: the dataset and every tested edge (status 'none' included), B = 100 for speed
const ds = sessionDataset(), corr = { dataset: ds, result: computeEdges(ds, { B: 100, seed: 7 }) }
const files = { 'corr.json': corr, 'sessions.json': sessions, 'twin.json': round(latestTwin()?.state ?? null), 'matrices.json': round(matrices()), 'edges.json': round(listEdges()) }
const sums = []
for (const [name, data] of Object.entries(files)) { const body = JSON.stringify(data, null, 1); fs.writeFileSync(path.join(out, name), body); sums.push(`${crypto.createHash('sha256').update(body).digest('hex')}  ${name}`) }
fs.writeFileSync(path.join(out, 'fixtures.sha256'), sums.join('\n') + '\n')
console.log(`golden fixtures → ${out}: ${sessions.length} sessions, twin v${latestTwin()?.version ?? '-'}, ${files['edges.json'].length} edges`)
