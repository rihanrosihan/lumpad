// Reference results for the Go retrieval helpers (redesign Phase 4-e): the REAL Node query decomposition, rank fusion, diversification,
// redaction, fingerprint maths and twin compaction on eval questions + randomised inputs. Synthetic only. Regenerate: node tools/gen_retrieval_vectors.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-ret-vec-'))
const Q = await import('../server/intel/query.js'), M = await import('../server/intel/memory.js'), C = await import('../server/intel/context.js'), K = await import('../server/intel/card.js'), P = await import('../server/intel/prompt.js')
const X = await import('../server/intel/eval/scenarios.js')
let seed = 17; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296), pick = (a) => a[Math.floor(rnd() * a.length)]

// ---- query decomposition
const TODAY = '2026-11-18', GEAR = [{ id: '21515804', name: 'ASICS Novablast 5' }, { id: '27142777', name: 'HOKA Mach X2' }, { id: '29435791', name: 'HOKA Clifton 10' }, { id: '32277471', name: 'Adidas Adizero SL2' }, { id: '5', name: 'Nike Downshifter 1' }]
const FR = ['why did my HR at 8:00/km rise this week', 'how did leg day affect my GCT', 'compare Borobudur 2025 and Jakim', 'runs above 160 bpm last month', 'what about my HOKA shoes', 'tempo or threshold sessions in October', 'kemarin lari berapa km', 'bulan lalu long run saya', 'the 10k I ran in july 2026', 'half marathon vs full', 'easy runs below 140', 'treadmill runs on 2026-10-05', 'last 3 weeks of mileage', '2 months ago', '5 minggu terakhir', 'X2 vs Clifton', 'heat and WBGT on the long run', 'sleep and HRV before races', 'JRF 2026 splits', 'on 12 oct what happened', 'since august volume', 'may I run a marathon pace session', 'in may', 'during juni 2026 sepatu', 'Sentul trail 17k', 'durability fade after km 20', 'drift decoupling', 'stride length langkah', 'strength beban squat calf', 'efficiency economy ef', 'lomba race effort', 'above 175', 'under 120 bpm', 'past 90 days', 'today', 'yesterday', 'minggu lalu', '21k', '42,2 km', '0.5k', 'LPS half 2025', 'ground contact kontak', 'jalan kaki walk', 'weekly volume', 'ambang double day', 'how did the SL2 feel', 'mach vs sl2 and novablast', 'downshifter mileage']
const qs = [...X.SAFETY.map((s) => s.text), ...FR, ...Array.from({ length: 160 }, () => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(FR)).join(pick([' ', ' and ', ', ', '. '])))]
const decompose = qs.map((q) => { const d = Q.decompose(q, { today: TODAY, gear: GEAR }), sq = d.has_filters ? Q.filterSql(d.filters) : { where: '', params: [] }; return { q, out: d, sql: sq } })
const decomposeToday = ['2027-01-05', '2026-03-02', '2026-12-31'].flatMap((today) => ['in may', 'since march', 'during jan', 'bulan des', 'last week', 'yesterday', '3 months ago'].map((q) => ({ today, q, out: Q.decompose(q, { today, gear: GEAR }) })))

// ---- rrf / mmr / evidence order
const rrfCases = Array.from({ length: 40 }, () => { const lists = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => Array.from({ length: Math.floor(rnd() * 8) }, () => 1 + Math.floor(rnd() * 12))); return { lists, out: M.rrf(lists) } })
const WORDS = ['durability fade heat long run share', 'stride length shortens late', 'sleep hrv recovery quality', 'gym leg day calf raises', 'efficiency pace heart rate drift', 'race opening cap pacing', 'shoe mileage wear economy', 'fueling gel carbohydrate stomach']
const TAGS = ['VALIDATED', 'MEASURED', 'CALCULATED', 'CLINICIAN', 'KB', 'REPORTED', 'LITERATURE', 'HYPOTHESIS', 'WEIRD', undefined]
const mmrCases = Array.from({ length: 40 }, () => { const n = Math.floor(rnd() * 14), items = Array.from({ length: n }, (_, i) => ({ id: i + 1, title: pick(WORDS), body: pick(WORDS) + ' ' + pick(WORDS), fused: rnd() < 0.1 ? undefined : +(rnd() * 0.05).toFixed(6), evidence_tag: pick(TAGS) })), k = pick([3, 5, 12])
  const out = M.mmr(items, k).map((x) => x.id), sorted = [...M.mmr(items, k)].sort(M.sortByEvidence).map((x) => x.id); return { items, k, out, sorted } })

// ---- redaction
const RED = ['Rihan Rosihan ran 10 km', 'rihan and ROSIHAN', 'works at Pizza Hut Indonesia and pizza hut', 'mail rihan@example.com now', 'see https://claude.ai/x?y=1 ok', 'key sk-abcdefghijklmnop1234 and pk-ABCDEFGHIJKLMNOP9999', 'hash 0123456789abcdef0123456789abcdef0123 end', 'call 08123456789012 or +628111222333 or 0812345', 'nothing to hide here', 'Rihanna is not Rihan?']
const redact = RED.map((t) => ({ t, out: P.redact(t) }))

// ---- fingerprints
const feat = () => Object.fromEntries(K.FEATURES.map((k) => [k, rnd() < 0.15 ? null : +((rnd() - 0.3) * 50).toFixed(3)]))
const fp = Array.from({ length: 12 }, () => { const rows = Array.from({ length: 1 + Math.floor(rnd() * 20) }, feat), Z = K.zMatrix(rows); return { rows, mean: Z.mean, sd: Z.sd, z: rows.map((r) => Z.z(r)), cos: rows.length > 1 ? K.cosine(Z.z(rows[0]), Z.z(rows[1])) : 0 } })
fp.push({ rows: [], mean: K.zMatrix([]).mean, sd: K.zMatrix([]).sd, z: [], cos: 0 })

// ---- twin compaction and token estimate
const twin = (i) => ({ schema: 'twin/1', fade_curves: { fm: { n: 1 } }, durability: { long_runs_90d: 6, run_share_by_km: [{ km: 1 }] }, races: i % 3 === 0 ? undefined : { baseline_vdot: 31.7, fm_attempts: Array.from({ length: i % 6 }, (_, j) => ({ date: '2026-0' + (j + 1) + '-01' })) },
  shoes: i % 4 === 0 ? undefined : Array.from({ length: i % 9 }, (_, j) => ({ name: 's' + j, n: j % 3 === 0 ? 0 : j, retired: j % 2 === 0 })), load: { ctl: 34.2 } })
const compact = Array.from({ length: 24 }, (_, i) => ({ in: JSON.parse(JSON.stringify(twin(i))), out: C.compactTwin(twin(i)) }))
const EST = ['', 'abc', 'x'.repeat(36), 'x'.repeat(37), '{"a":"é🙂"}', '日本語のテキスト'.repeat(5), JSON.stringify(twin(2))].map((s) => ({ s, out: C.EST(s) }))

fs.writeFileSync('lumpadd/internal/coach/testdata/retrieval_vectors.json', JSON.stringify({ today: TODAY, gear: GEAR, decompose, decomposeToday, rrfCases, mmrCases, redact, fp, compact, EST }))
console.log('retrieval vectors:', { decompose: decompose.length, withFilters: decompose.filter((d) => d.out.has_filters).length, topics: decompose.filter((d) => d.out.topics.length).length, rrf: rrfCases.length, mmr: mmrCases.length, fp: fp.length, compact: compact.length })
