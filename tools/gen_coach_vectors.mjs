// Test vectors for the Go coach layer (redesign Phase 4): the CURRENT Node safety / verification / validation / guard code run on the eval
// scenarios plus randomised inputs. Synthetic only (no personal data). Regenerate: node tools/gen_coach_vectors.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-coach-vec-'))
const S = await import('../server/intel/safety.js'), W = await import('../server/intel/writeback.js'), { validate, OUTPUT_SCHEMA, normalize } = await import('../server/intel/schema.js'), L = await import('../server/intel/llm.js')
const X = await import('../server/intel/eval/scenarios.js')
let seed = 21; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296), pick = (a) => a[Math.floor(rnd() * a.length)]

// ---- red flags: scenarios + random sentences built from fragments (negations, Indonesian, accents, emoji, look-alikes)
const FRAG = ['I felt chest pain', 'no chest pain', 'without any chest pressure', 'nyeri dada', 'tidak nyeri dada', 'heart was racing', 'my pulse keeps skipping', 'the pain in my shin is getting worse', 'sharp pain', 'pain is severe',
  'I nearly fainted', 'hampir pingsan', 'never passed out', 'fever and sore throat and ache', 'tidak demam', 'demam', 'flu season', 'confused at km 30', 'bingung', 'stopped sweating', 'numbness in my arm', 'mati rasa',
  'calf swelling', 'bengkak', 'stress fracture worry', 'sesak napas', "can't breathe", 'may I run a marathon pace session', 'café run 🙂 était dur', 'Jakarta çalışma', 'legs are heavy', 'easy 8k tomorrow', 'sakit kepala hebat',
  'bukan nyeri dada', 'tanpa demam', 'bukan demam tapi nyeri dada', 'denies chest pain', 'not any fever', 'covid test negative', 'temperature of 38', 'pain gets worse at night', 'unbearable', 'kolaps']
const sentences = [...X.SAFETY.map((s) => s.text), ...Array.from({ length: 220 }, () => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(FRAG)).join(pick([', ', '. ', ' and ', ' — ', ' ']))), '', 'x', '   ']
const flagsCases = sentences.map((t) => ({ text: t, out: S.redFlags(t) }))

// ---- structured check-in flags + referral answers
const checkin = []
for (let i = 0; i < 150; i++) checkin.push((() => { const c = {}; if (rnd() < 0.6) c.pain = pick([0, 1, 3, 3.5, 4, 5, 9.5]); if (rnd() < 0.3) c.painTrend = pick(['rising', 'falling', 'flat']); if (rnd() < 0.5) c.symptoms = Object.fromEntries(['chest', 'faint', 'palpitations', 'breath', 'fever', 'swelling', 'numbness', 'other'].filter(() => rnd() < 0.3).map((k) => [k, rnd() < 0.85]))
  if (rnd() < 0.4) c.bp = pick([{ sys: 185, dia: 115 }, { sys: 119, dia: 78 }, { sys: 150, dia: 125 }, { sys: 180 }, { dia: 120 }, {}]); return { in: c, out: S.checkinFlags(c) } })())
checkin.push({ in: {}, out: S.checkinFlags({}) }, ...X.BP.map((b) => ({ in: { bp: b.bp }, out: S.checkinFlags({ bp: b.bp }) })))
const referral = [[], ...flagsCases.filter((c) => c.out.length).slice(0, 40).map((c) => c.out), ...checkin.filter((c) => c.out.length).slice(0, 20).map((c) => c.out)].map((f) => ({ in: f, out: S.referralFor(f) }))

// ---- gate from the twin
const gateTwin = []
for (let i = 0; i < 160; i++) {
  const t = {}
  if (rnd() < 0.9) t.readiness = { caps: pick([[], [], ['Sleep HR 72 > 67'], ['Pain 2/10 ≥ 2', 'HRV Reduced + hard session']]), tier: pick(['prime', 'optimal', 'compromised', 'depleted', null]) }
  if (rnd() < 0.9) t.load = pick([{}, { km_vs_4wk_avg_pct: 258 }, { km_vs_4wk_avg_pct: 30 }, { km_vs_4wk_avg_pct: 31.5 }, { km_vs_4wk_avg_pct: null }, { km_vs_4wk_avg_pct: -10 }])
  if (rnd() < 0.7) t.injury = { sites: Object.fromEntries(['tibia', 'calf', 'all'].filter(() => rnd() < 0.6).map((k) => [k, pick([{ last_pain_date: '2026-11-15', last_pain: 2, pain_free_days: 3 }, { last_pain_date: '2026-11-15', last_pain: 3, pain_free_days: 7 }, { last_pain_date: null, last_pain: 0, pain_free_days: null },
    { last_pain_date: '2026-11-17', last_pain: 1, pain_free_days: 1 }, { last_pain_date: '2026-11-17', pain_free_days: 2 }, { last_pain_date: '2026-11-17', last_pain: null, pain_free_days: 2 }, { last_pain_date: '2026-11-10', last_pain: 4, pain_free_days: 6 }])])) }
  gateTwin.push({ twin: i === 0 ? null : t, out: S.gateFromTwin(i === 0 ? null : t) })
}

// ---- gate check over recommendation phrases
const REC = ['Run the Thursday tempo as planned: 3 × 3 km at 6:00/km', 'Easy 6 km at HR ≤ 148', 'Do the 22 km long run on Sunday', 'Include 6 km at marathon pace', 'Skip the tempo and swap it for an easy 5 km', 'Avoid the long run this weekend',
  'Mobility 20 min', 'Do not do the intervals, swap to strides', 'Replace the threshold session with easy running', 'Hold off on the long run until Friday', 'Jangan lari lomba minggu ini', 'Lari panjang 20 km hari Minggu', 'Intervals 6 × 800 m', 'Strides session after the easy run',
  'Time trial 5K on Saturday', 'MP block of 8 km', 'Race effort at JRF', 'Easy run with café stop 🙂 then tempo', 'Rest day', 'Hill repeats on the treadmill', 'VO2 session', 'After the rest day: tempo']
const gateCheck = []
for (let i = 0; i < 140; i++) {
  const gate = pick([{ active: true, reasons: ['Sleep HR 72 > 67', 'HRV Reduced'] }, { active: true, reasons: ['a', 'b', 'c', 'd'] }, { active: false, reasons: [] }, { active: true, reasons: ['x'.repeat(200), 'y'.repeat(200)] }])
  const recs = Array.from({ length: Math.floor(rnd() * 5) }, () => ({ action: pick(REC), why: 'because', priority: 'now' }))
  if (rnd() < 0.05) recs.push({ why: 'no action', priority: 'now' })
  const parsed = rnd() < 0.05 ? null : { summary: 's', recommendations: recs, ...(rnd() < 0.5 ? { flags: [{ type: 'load', text: 'existing' }] } : {}) }
  gateCheck.push({ parsed, gate, out: S.gateCheck(parsed, gate) })
}
for (const sc of X.GATE) { const parsed = { summary: 's', recommendations: sc.recs, flags: [] }; gateCheck.push({ parsed, gate: sc.gate, out: S.gateCheck(parsed, sc.gate) }) }

// ---- diagnosis wording
const DX = ['You have a stress fracture in the left tibia, rest 6 weeks.', 'You are cleared to run the race on Sunday.', 'The pattern is consistent with load stress; ask a physio to assess the tibia.', 'this is definitely a tendinitis', 'This is certainly an overuse injury',
  'you are safe to train', 'medically cleared', "you're diagnosed with it", 'You have hypertension', 'You have a cold', 'You have plantar fasciitis in the right foot', 'See a clinician about the calf.']
const wording = []
for (let i = 0; i < 100; i++) {
  const p = {}; if (rnd() < 0.9) p.summary = pick(DX); if (rnd() < 0.7) p.analysis_md = pick(DX) + ' ' + pick(DX); if (rnd() < 0.8) p.recommendations = Array.from({ length: Math.floor(rnd() * 3) }, () => pick([{ action: pick(DX), why: pick(DX) }, { action: 'Easy run' }, { why: pick(DX) }, { action: null, why: 'x' }, {}]))
  wording.push({ parsed: p, out: S.diagnosisWording(p) })
}
for (const sc of X.DIAGNOSIS) wording.push({ parsed: { summary: sc.text }, out: S.diagnosisWording({ summary: sc.text }) })

// ---- number verification, dedupe helpers
const TXT = ['EF 0.789 and run share 48 % on 36.92 km', 'finished in 5:12:00', '36.92 km in 5:30:52', 'on 2026-11-18 at 07:30 with 164 bpm', 'ref [12] says 0,75 and 3.5', 'pace 5:41/km, HR 168, -4 °C', 'range 5-6 km and 2027', 'VDOT 39.9 needs 37.9', 'EF fell to 0.612', 'weekly +258 % (12 km)', 'no numbers here', '1,234 steps', 'cadence 172 spm 🙂 GCT 250 ms', '0.05', '13', '12', '2024', '2031', '10.5 km easy then 6:00 pace']
const nums = [], ver = []
for (const t of TXT) nums.push({ text: t, numbers: W.numbersOf(t), times: W.timesOf(t) })
for (let i = 0; i < 160; i++) { const text = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(TXT)).join('. '), corpus = Array.from({ length: Math.floor(rnd() * 4) }, () => pick(TXT)).join(' · '); ver.push({ text, corpus, out: W.unverified(text, corpus) }) }
// tolerance boundaries of the number match: abs 0.051 or 1.1 % of the evidence value
for (const [corpus, text] of [['3.5 km', '3.55 km'], ['3.5 km', '3.56 km'], ['3.5 km', '3.449 km'], ['100 km', '101.1 km'], ['100 km', '101.2 km'], ['100 km', '98.9 km'], ['100 km', '98.8 km'], ['164 bpm', '165.8 bpm'], ['164 bpm', '166 bpm'],
  ['0.789', '0.8'], ['0.789', '0.84'], ['50 km', '50.5 km'], ['50 km', '50.6 km'], ['1000 m', '1011 m'], ['1000 m', '1012 m'], ['25 km', '25.3 km'], ['25 km', '25.4 km']]) ver.push({ text, corpus, out: W.unverified(text, corpus) })
for (const sc of X.VERIFIER) ver.push({ text: sc.text, corpus: sc.corpus, out: W.unverified(sc.text, sc.corpus) })
const SENT = ['Long run durability fade GCT in heat', 'Stride length shortens late in long runs', 'café déjà vu naïve résumé', 'EF improved 0.789 to 0.801', 'zzz yyy www', '', 'Run share 48 % on 36.92 km', 'İstanbul çalışma sırasında', 'the the the a an of', 'ΟΔΥΣΣΕΥΣ Σίσυφος ΑΣ', 'ΚΑΛΗΜΕΡΑ ΑΘΛΗΤΗΣ ΤΡΕΧΕΙ', 'I\u0307stanbul İSTANBUL ıspanak', 'ǅungla ǈubljana', 'STRASSE straße ẞ']
const dedupe = []
for (let i = 0; i < 80; i++) { const a = pick(SENT) + ' ' + pick(SENT), b = pick(SENT) + ' ' + pick(SENT); dedupe.push({ a, b, ta: [...W.tokens(a)].sort(), tb: [...W.tokens(b)].sort(), j: W.jaccard(W.tokens(a), W.tokens(b)) }) }

// ---- answer validation: mutate a valid answer
const rec = (o = {}) => ({ action: 'Easy 6 km', why: 'HR', priority: 'now', ...o })
const base = () => ({ summary: 'ok', analysis_md: '## a', recommendations: [rec()], flags: [{ type: 'load', text: 't' }], memory_writes: [{ tier: 'semantic', title: 't', body: 'b', cites: [1] }], cited_ids: [1, 2], twin_state_patch: { current_ef_baseline: 0.78 } })
const mutate = (a) => {
  const m = rnd()
  if (m < 0.08) delete a[pick(['summary', 'analysis_md', 'recommendations', 'flags', 'memory_writes', 'cited_ids'])]
  else if (m < 0.16) a.summary = pick([5, null, true, ['x'], { a: 1 }, 'x'.repeat(901)])
  else if (m < 0.24) a.recommendations = pick([{}, 'x', null, [], Array.from({ length: 9 }, () => rec()), [rec({ priority: 'soon' })], [{ action: 1 }], [rec({ action: 'x'.repeat(401) })], [rec({ evidence_ids: ['a'] })], [null]])
  else if (m < 0.32) a.flags = pick([[{ type: 'weird', text: 't' }], [{ type: 'gate' }], Array.from({ length: 9 }, () => ({ type: 'load', text: 't' })), [{ type: 'rule', text: 5 }]])
  else if (m < 0.42) a.memory_writes = pick([[{ tier: 'bad', title: 't', body: 'b', cites: [1] }], [{ tier: 'episodic', title: 't', body: 'b' }], Array.from({ length: 6 }, () => ({ tier: 'semantic', title: 't', body: 'b', cites: [1] })), [{ tier: 'semantic', title: 't', body: 'b', cites: ['x'], confidence: 'high' }], [{ tier: 'semantic', title: 't', body: 'b', cites: [1.5] }]])
  else if (m < 0.5) a.cited_ids = pick([[1.5], ['1'], 7, [1, null], []])
  else if (m < 0.58) a.twin_state_patch = pick([{ current_ef_baseline: 'x' }, { shoe_alert: 'x'.repeat(301) }, [], null, { readiness_modifier: 5 }])
  else if (m < 0.62) a.analysis_md = 'é'.repeat(3001) + '🙂'.repeat(1500)
  else if (m < 0.66) return pick([null, 5, 'x', [], [1]])
  return a
}
const validation = []
for (let i = 0; i < 260; i++) { let a = base(); const n = 1 + Math.floor(rnd() * 3); for (let k = 0; k < n && a && typeof a === 'object' && !Array.isArray(a); k++) a = mutate(a); validation.push({ answer: a, errors: validate(a, OUTPUT_SCHEMA) }) }
validation.push({ answer: base(), errors: validate(base(), OUTPUT_SCHEMA) })
const norm = []
for (let i = 0; i < 40; i++) { const a = base(); a.flags = Array.from({ length: Math.floor(rnd() * 4) }, () => pick([{ type: 'gate', text: 'x' }, { type: 'weird', text: 'x' }, { text: 'x' }, { type: 5, text: 'x' }, null, 'str'])); const before = JSON.parse(JSON.stringify(a)); norm.push({ in: before, out: normalize(a) }) }

// ---- spend guard grid
const guard = []
for (const intent of ['daily_brief', 'question', 'session_review', 'weekly_review', 'race_plan']) for (const spend of [0, 5, 11.9, 12, 12.1, 14.5, 15, 16]) for (const maxCall of [0, 0.4, 3]) guard.push({ in: { intent, spend, cap: 15, maxCall }, out: L.guardDecision({ intent, spend, cap: 15, maxCall }) })
guard.push({ in: { intent: 'question', spend: 0.1234, cap: 0.5, maxCall: 0.4 }, out: L.guardDecision({ intent: 'question', spend: 0.1234, cap: 0.5, maxCall: 0.4 }) })

fs.mkdirSync('lumpadd/internal/coach/testdata', { recursive: true })
fs.writeFileSync('lumpadd/internal/coach/testdata/vectors.json', JSON.stringify({ flags: flagsCases, checkin, referral, gateTwin, gateCheck, wording, nums, ver, dedupe, validation, norm, guard }))
console.log('coach vectors:', Object.fromEntries(Object.entries({ flags: flagsCases, checkin, referral, gateTwin, gateCheck, wording, nums, ver, dedupe, validation, norm, guard }).map(([k, v]) => [k, v.length])))
const n = validation.filter((v) => v.errors.length).length; console.log('validation: invalid', n, 'valid', validation.length - n, '| flags with hits', flagsCases.filter((c) => c.out.length).length, '| gate removed', gateCheck.filter((c) => c.out.removed.length).length)
