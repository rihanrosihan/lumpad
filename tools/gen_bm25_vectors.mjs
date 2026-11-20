// Reference for the Go BM25 search: the REAL FTS5 bm25(memory_fts, 3.0, 1.0) scores and orderings from Node's memory.js ftsSearch over a synthetic corpus
// (accents, digits, hyphen / underscore / dot terms, unicode, empty bodies, several tiers and statuses). Regenerate: node tools/gen_bm25_vectors.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-bm25-vec-'))
const { mdb } = await import('../server/intel/db.js'), M = await import('../server/intel/memory.js')
let seed = 29; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296), pick = (a) => a[Math.floor(rnd() * a.length)]
const W = ['durability', 'fade', 'heat', 'long', 'run', 'share', 'stride', 'length', 'cadence', 'sleep', 'hrv', 'recovery', 'gym', 'leg', 'day', 'calf', 'raises', 'efficiency', 'pace', 'heart', 'rate', 'drift', 'race', 'opening', 'cap', 'shoe', 'mileage', 'wear', 'fueling', 'gel', 'carbohydrate', 'stomach', 'café', 'résumé', 'naïve', 'Straße', 'İstanbul', 'ΟΔΥΣΣΕΥΣ', 'EF-0.789', 'run_share', 'pa:hr', '8:00/km', 'GCT', '262ms', 'km', '36.92', 'Borobudur', 'Jakim', 'JRF', 'MP', 'z2', 'hr800', '🙂', '日本語', 'über', 'ångström']
const TIERS = ['episodic', 'semantic', 'procedural'], STAT = ['active', 'active', 'active', 'candidate', 'archived', 'proposal']
const sentence = (n) => Array.from({ length: n }, () => pick(W)).join(pick([' ', ' ', ' ', ', ', '. ', ' - ']))
const docs = Array.from({ length: 90 }, (_, i) => ({ tier: pick(TIERS), kind: 'k', title: sentence(1 + Math.floor(rnd() * 5)), body: i % 17 === 0 ? '' : sentence(Math.floor(rnd() * 40)), status: pick(STAT), valid_from: rnd() < 0.3 ? null : '2026-' + String(1 + Math.floor(rnd() * 11)).padStart(2, '0') + '-15', evidence_tag: 'KB', source: 'kb', created_by: 'system' }))
docs.forEach((d, i) => M.addMemory({ ...d, title: d.title + ' #' + i }))
const QS = ['durability fade heat', 'sleep hrv recovery quality', 'EF-0.789 efficiency', 'run_share durability', 'pa:hr drift', '8:00/km pace', 'café résumé', 'straße', 'istanbul', 'odysseus ΟΔΥΣΣΕΥΣ', 'GCT 262ms stride', '36.92 km', 'Borobudur Jakim JRF', 'MP z2 hr800', 'über ångström', '日本語 🙂', 'nonexistentterm', 'durability', 'x y', 'heat heat heat heat', 'long run share durability fade heat stride cadence sleep hrv recovery gym leg day calf raises efficiency pace heart rate drift race opening cap shoe mileage wear fueling gel', 'readiness sleep HR HRV pain gate load session today heat recovery', 'why did my HR at 8:00/km rise this week', '']
const cases = []
for (const q of QS) for (const [tiers, statuses, limit, since] of [[['semantic'], ['active'], 30, undefined], [['episodic'], ['active'], 12, '2026-06-01'], [['semantic', 'episodic', 'procedural'], ['active'], 20, undefined], [['semantic'], ['candidate', 'active', 'proposal'], 5, undefined], [['episodic', 'semantic'], ['active', 'archived'], 200, undefined]]) {
  const rows = M.ftsSearch(q, { tiers, statuses, limit, since }); const ids = rows.map((r) => r.id)
  const scored = ids.length ? mdb.prepare(`SELECT rowid AS id, bm25(memory_fts, 3.0, 1.0) AS score FROM memory_fts WHERE memory_fts MATCH ? AND rowid IN (${ids.map(() => '?').join(',')})`).all(M.ftsQuery(q), ...ids) : []
  const sc = Object.fromEntries(scored.map((r) => [r.id, r.score])); cases.push({ q, tiers, statuses, limit, since: since ?? null, ids, scores: ids.map((i) => sc[i]) })
}
const all = mdb.prepare('SELECT id, tier, kind, title, body, status, valid_from, evidence_tag, source FROM memory ORDER BY id').all().map((r) => ({ ...r }))
fs.writeFileSync('lumpadd/internal/coach/testdata/bm25_vectors.json', JSON.stringify({ docs: all, cases }))
console.log('bm25 vectors:', all.length, 'docs,', cases.length, 'searches,', cases.filter((c) => c.ids.length).length, 'with hits; max hits', Math.max(...cases.map((c) => c.ids.length)))
