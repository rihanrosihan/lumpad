// Golden fixture check: when fixtures exist (tools/export_golden.mjs), they must still match what the current engine computes for the same FIT files.
// Skipped when no fixtures / no FIT files are present (CI, fresh clone). Run `node tools/export_golden.mjs` on a machine with the data to create them.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('tools/golden/out'), have = fs.existsSync(path.join(dir, 'sessions.json'))
test('golden fixtures are internally consistent (checksums)', { skip: !have && 'no golden fixtures present' }, async () => {
  const crypto = await import('node:crypto'), lines = fs.readFileSync(path.join(dir, 'fixtures.sha256'), 'utf8').trim().split('\n')
  for (const l of lines) { const [sum, name] = l.split(/\s+/); assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex'), sum, name) }
})
test('golden sessions: re-parsing the FIT files reproduces every stored metric', { skip: !have && 'no golden fixtures present' }, async () => {
  const G = JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8')), fitDir = process.env.GOLDEN_FIT_DIR
  if (!fitDir) return assert.ok(G.length > 0)
  const { parseFitFile, toSeries } = await import('../../server/intel/fit.js'), { sessionMetrics } = await import('../../server/intel/metrics.js')
  const round = (v) => (typeof v === 'number' ? (Math.round(v * 1e6) / 1e6) + 0 : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v)
  let n = 0
  for (const s of G) { const f = path.join(fitDir, String(s.date).slice(0, 4), `${s.label_id}.fit`); if (!fs.existsSync(f)) continue; assert.deepEqual(round(sessionMetrics(toSeries(await parseFitFile(f)))), s.metrics, s.label_id); n++ }
  assert.ok(n > 0, 'no FIT files matched')
})
