// retrieveRunnerContext(): SQL filters + FTS5 + numeric-fingerprint kNN + correlation edges → ONE structured payload (schema context/1).
// The `stable` block (rules, athlete summary, definitions) is byte-identical between calls so provider prefix caching works; everything that changes is in `volatile`.
import { idb, mdb } from './db.js'
import { ftsSearch, rrf, mmr, sortByEvidence, getMemory } from './memory.js'
import { latestTwin } from './twin.js'
import { listEdges } from './corr.js'
import { zMatrix, cosine, FEATURES } from './card.js'
import { RACE_CALENDAR, RACE_CALENDAR_TEXT } from './racecal.js'
import { ATHLETE, Z2_CEILING } from '../../src/lib/athlete.js'
import { decompose, filterSql } from './query.js'
import { db as app } from '../store.js'
import { load } from '../db.js'

export const SCHEMA = 'context/1', EST = (s) => Math.ceil(String(s).length / 3.6)
const wibDate = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// privacy: nothing that identifies the athlete leaves the VPS (names, employer, e-mail, phone, URLs, tokens, family details)
export function redact(t) {
  return String(t).replace(/\bRihan(?:\s+Rosihan)?\b/gi, 'the athlete').replace(/\bRosihan\b/gi, 'the athlete').replace(/Pizza Hut(?: Indonesia)?/gi, 'the employer').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/https?:\/\/\S+/g, '[url]').replace(/\b(?:sk|pk)-[A-Za-z0-9]{16,}\b/g, '[secret]').replace(/\b[0-9a-f]{32,}\b/gi, '[secret]').replace(/\b(?:\+?62|0)8\d{8,11}\b/g, '[phone]')
}
const STABLE_ATHLETE = {
  race_calendar_2027: RACE_CALENDAR,
  race_calendar_note: 'Authoritative and current: older knowledge-base notes about the Jakim race class or pacing (for example C-race, run-walk from km 1, < 6:00/km) are superseded. The G-MJM jog is a gate, not a race. JRF half marathon: cancelled.',
  goal: 'Sub-4:00 marathon at JRF (Jakarta) on 24 Oct 2027 (MP 5:41/km). Needs fitness VDOT ≈ 39.9 at realization ratio 0.95; baseline VDOT 31.7 (10K 1:00:55, Jul 2026).',
  facts: [`Male, 31 y, ${ATHLETE.height_cm} cm, ${ATHLETE.weight_kg} kg; Jakarta-area tropical heat; pre-dawn running; devices: ${ATHLETE.devices.join('; ')}`,
    `Thresholds: LTHR ${ATHLETE.lthr} bpm, HRmax ${ATHLETE.hrmax}, resting HR setting ${ATHLETE.rhr}, threshold pace ${Math.floor(ATHLETE.tpace_s / 60)}:${String(ATHLETE.tpace_s % 60).padStart(2, '0')}/km (COROS 18 Nov 2026; earlier 6:07), COROS VO2max ${ATHLETE.vo2max_coros}. Judge every intensity against LTHR ${ATHLETE.lthr} and that threshold pace; an easy run averaging > ${Z2_CEILING} bpm = intensity creep (grey zone)`,
    'Training methodology: ' + ATHLETE.methodology.join('; '),
    'Personal bests: ' + Object.entries(ATHLETE.pbs).map(([k, v]) => `${k} ${v}`).join(', '),
    'Race history: ' + ATHLETE.races.map((r) => `${r.date} ${r.name}`).join('; '), 'HR at 8:00/km baseline 143.1 ± 5.0 bpm (Jan–Sep 2026, n=26); pace at HR≈150 ≈ 7:56',
    'Marathon history: Jakim 14 Jun 2026 6:53:03 (realization ratio 0.59, n=1); JRF FM 25 Oct 2026 DNF km 9.16 (pain 2/10); Borobudur FM 15 Nov 2026 DNF by black flag at ~35 km (heat), run-walk from km 5, nausea from km 25', 'Injury sites: left VMO (Oct 2026), Achilles (Oct 2026), plantar (Jakim 2026), tibia/MTSS history', 'Main limiter found in the data: DURABILITY (share of time spent running after km 20), not running economy; opening too hot; heat; GI trouble in heat; poor readiness before races'],
}
const DEFINITIONS = { run_share: 'share of elapsed time spent running (moving and cadence ≥ 125 spm); stop = distance did not advance; walk = moving at cadence < 125', ef: 'efficiency factor = run-phase speed (m/min) ÷ HR', 'drift_pahr': 'Pa:HR drift = EF loss first→second half of a STEADY ≥ 45 min effort; null when not steady', fade: 'last vs first quarter of running seconds', hr_at_800: 'HR at 8:00/km on steady blocks, slope-corrected', evidence_tags: 'VALIDATED > MEASURED > CALCULATED > CLINICIAN > KB > REPORTED > LITERATURE > HYPOTHESIS', rules: 'locked rules always win over any analysis' }
const INTENT_QUERY = { daily_brief: 'readiness sleep HR HRV pain gate load session today heat recovery', session_review: 'long run durability fade pacing HR cap mechanical trigger', weekly_review: 'weekly volume load progression long run durability recovery injury',
  race_plan: 'race plan pacing HR cap fueling heat cut-off COP opening', question: '' }

function compactTwin(state) {
  const t = JSON.parse(JSON.stringify(state)); delete t.fade_curves; if (t.durability) delete t.durability.run_share_by_km; if (t.races) t.races.fm_attempts = (t.races.fm_attempts || []).slice(-3)
  t.shoes = (t.shoes || []).filter((s) => s.n > 0 || !s.retired).slice(0, 6); return t
}
const nearestSessions = (labelId, k = 3) => {
  const rows = idb.prepare('SELECT label_id, date, distance_m, ef, features FROM fit_session').all(); const Z = zMatrix(rows.map((r) => JSON.parse(r.features || '{}')))
  const me = rows.find((r) => r.label_id === labelId); if (!me) return []; const v = Z.z(JSON.parse(me.features || '{}'))
  return rows.filter((r) => r.label_id !== labelId && r.date < me.date && r.distance_m > 3000).map((r) => ({ label_id: r.label_id, sim: cosine(v, Z.z(JSON.parse(r.features || '{}'))) })).sort((a, b) => b.sim - a.sim).slice(0, k).map((x) => x.label_id)
}
// "runs like this one" for the Run Analysis page: 16-D fingerprint cosine over all earlier sessions
export function similarSessions(labelId, k = 5) {
  const rows = idb.prepare('SELECT label_id, activity_id, date, distance_m, ef, run_share, onset_km, hr800, features FROM fit_session').all(), Z = zMatrix(rows.map((r) => JSON.parse(r.features || '{}')))
  const me = rows.find((r) => r.label_id === labelId); if (!me) return []
  const v = Z.z(JSON.parse(me.features || '{}'))
  return rows.filter((r) => r.label_id !== labelId && r.date < me.date && r.distance_m > 3000).map((r) => ({ label_id: r.label_id, activity_id: r.activity_id, date: r.date, distance_m: r.distance_m, ef: r.ef, run_share: r.run_share, onset_km: r.onset_km, hr800: r.hr800, sim: Math.round(cosine(v, Z.z(JSON.parse(r.features || '{}'))) * 1000) / 1000 }))
    .sort((a, b) => b.sim - a.sim).slice(0, k)
}
const epiByLabel = (ids) => ids.map((l) => mdb.prepare("SELECT id, title, body, valid_from FROM memory WHERE source='fit' AND source_ref=?").get(l)).filter(Boolean)

export function retrieveRunnerContext({ intent = 'daily_brief', question = '', date = wibDate(), activityId = null, tokenBudget = 24000, sinceDays = 400 } = {}) {
  const twinRow = latestTwin(); if (!twinRow) throw Object.assign(new Error('twin not built yet — run the intelligence job first'), { status: 409 })
  const items = new Map()   // id → {kind, text}: every retrievable item the model may cite
  const add = (m, why) => { if (!m || items.has(m.id)) return; items.set(m.id, { id: m.id, tier: m.tier, kind: m.kind, title: redact(m.title), body: redact(m.body), tag: m.evidence_tag, why, date: m.valid_from || null }) }
  // 1) pinned: locked + active procedural rules
  const rules = mdb.prepare("SELECT * FROM memory WHERE tier='procedural' AND status='active' ORDER BY locked DESC, id").all().map((r) => ({ id: r.id, title: r.title, rule: redact(r.body), locked: !!r.locked, tag: r.evidence_tag }))
  // 2) episodic: focus session + its fingerprint neighbours, otherwise the most recent sessions for the intent
  const focus = activityId ? idb.prepare('SELECT label_id FROM fit_session WHERE activity_id=? OR label_id=?').get(activityId, String(activityId).replace(/^coros:/, ''))?.label_id : null
  let epis = []
  if (focus) epis = epiByLabel([focus, ...nearestSessions(focus, 3)])
  else { const n = intent === 'weekly_review' ? 10 : intent === 'race_plan' ? 6 : 5; epis = mdb.prepare("SELECT id, title, body, valid_from FROM memory WHERE tier='episodic' AND status='active' AND valid_from IS NOT NULL ORDER BY valid_from DESC LIMIT ?").all(n) }
  for (const e of epis) add({ ...e, tier: 'episodic', kind: 'session', evidence_tag: 'MEASURED' }, focus ? 'focus/similar' : 'recent')
  // 2b) query decomposition → SQL metric filters over fit_session; matched sessions join the context with their exact km splits
  let gear = []; try { gear = app.prepare('SELECT id, name FROM gear').all() } catch {}
  const dq = decompose(question, { today: date, gear }), telemetry = []
  const splits = (h) => ({ label_id: h.label_id, date: h.date, km_total: Math.round(h.distance_m / 100) / 10, cols: 'km, pace s/km (elapsed), HR, cadence spm, GCT ms, run share', km: JSON.parse(h.km || '[]').map((k) => [k.km, k.pace, k.hr, k.cad, k.gct, k.runShare]) })
  if (dq.has_filters) {
    const { where, params } = filterSql(dq.filters)
    const hit = idb.prepare(`SELECT s.label_id, s.date, s.distance_m, s.km FROM fit_session s LEFT JOIN run_weather w ON w.label_id = s.label_id ${where} ORDER BY s.date DESC LIMIT 6`).all(...params)
    for (const e of epiByLabel(hit.map((h) => h.label_id))) add({ ...e, tier: 'episodic', kind: 'session', evidence_tag: 'MEASURED' }, 'sql filter')
    telemetry.push(...hit.slice(0, 3).map(splits))
  }
  if (dq.filters.race_date) { // a named race is always brought in with its splits, even when the question also sets another date range
    const h = idb.prepare('SELECT label_id, date, distance_m, km FROM fit_session WHERE date = ? ORDER BY distance_m DESC LIMIT 1').get(dq.filters.race_date)
    if (h) { for (const e of epiByLabel([h.label_id])) add({ ...e, tier: 'episodic', kind: 'session', evidence_tag: 'MEASURED' }, 'named race'); if (!telemetry.some((t) => t.label_id === h.label_id)) telemetry.push(splits(h)) }
  }
  if (focus && !telemetry.some((t) => t.label_id === focus)) { const h = idb.prepare('SELECT label_id, date, distance_m, km FROM fit_session WHERE label_id=?').get(focus); if (h) telemetry.unshift(splits(h)) }
  // 3) text retrieval (FTS5 BM25) over semantic + episodic, fused with RRF, diversified with MMR
  const q = [question, INTENT_QUERY[intent] || '', focus ? 'durability fade pacing' : ''].join(' ').trim()
  const since = addDays(date, -sinceDays)
  const bySem = ftsSearch(q, { tiers: ['semantic'], limit: 30 }), byEpi = ftsSearch(q, { tiers: ['episodic'], limit: 12, since }), fused = rrf([bySem.map((x) => x.id), byEpi.map((x) => x.id)])
  const pool = new Map([...bySem, ...byEpi].map((x) => [x.id, x])), ranked = fused.map((f) => ({ ...pool.get(f.id), fused: f.score })).filter((x) => x.id)
  for (const x of mmr(ranked, 12).sort(sortByEvidence).slice(0, 12)) add(x, 'text match')
  // 4) correlation edges (supported; top candidates marked tentative)
  const rel = (e) => (dq.topics.includes(e.exposure) ? 1 : 0) + (dq.topics.includes(e.outcome) ? 1 : 0)
  const edges = listEdges().filter((e) => e.status === 'supported' || e.status === 'candidate').sort((a, b) => rel(b) - rel(a)).slice(0, 8).map((e) => ({ exposure: e.exposure, outcome: e.outcome, window_days_before: [e.lag_lo, e.lag_hi], partial_rho: e.partial_rho, ci: [e.ci_lo, e.ci_hi], n: e.n, n_eff: e.n_eff, q: e.q, status: e.status, caveat: 'association in one athlete, not causal' }))
  // 5) budget: drop from the bottom (text matches → older episodes → edges), never the rules or the twin
  const twin = compactTwin(twinRow.state), stable = { schema: SCHEMA, athlete: STABLE_ATHLETE, definitions: DEFINITIONS, rules }, list = [...items.values()]
  let volatile, tokens
  for (;;) {
    volatile = { as_of: date, intent, question: redact(question), query: { filters: { ...dq.filters, shoes: dq.filters.shoes?.map((x) => x.name) }, topics: dq.topics }, twin_version: twinRow.version, twin, episodes: list.filter((i) => i.tier === 'episodic'), facts: list.filter((i) => i.tier !== 'episodic'), correlation_edges: edges, telemetry, focus_label: focus || null }
    tokens = EST(JSON.stringify(stable)) + EST(JSON.stringify(volatile)); if (tokens <= tokenBudget || list.length === 0) break
    if (telemetry.length > 1) { telemetry.pop(); continue }
    const drop = list.map((i, k) => [i, k]).filter(([i]) => i.why === 'text match').pop() || list.map((i, k) => [i, k]).filter(([i]) => i.why === 'recent').pop() || [list.at(-1), list.length - 1]; list.splice(drop[1], 1)
  }
  return { schema: SCHEMA, stable, volatile, item_ids: list.map((i) => i.id), tokens_est: tokens }
}

// ---- prompt + output contract (coach/1)
export const OUTPUT_SCHEMA = {
  type: 'object', required: ['summary', 'analysis_md', 'recommendations', 'flags', 'memory_writes', 'cited_ids'],
  properties: {
    summary: { type: 'string', maxLength: 900 }, analysis_md: { type: 'string', maxLength: 6000 },
    recommendations: { type: 'array', maxItems: 8, items: { type: 'object', required: ['action', 'why', 'priority'], properties: { action: { type: 'string', maxLength: 400 }, why: { type: 'string', maxLength: 500 }, priority: { type: 'string', enum: ['now', 'this_week', 'later'] }, evidence_ids: { type: 'array', items: { type: 'integer' } }, needs_athlete_ok: { type: 'boolean' } } } },
    flags: { type: 'array', maxItems: 8, items: { type: 'object', required: ['type', 'text'], properties: { type: { type: 'string', enum: ['gate', 'injury', 'load', 'heat', 'data_gap', 'rule', 'other'] }, text: { type: 'string', maxLength: 300 } } } },
    memory_writes: { type: 'array', maxItems: 5, items: { type: 'object', required: ['tier', 'title', 'body', 'cites'], properties: { tier: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] }, kind: { type: 'string', maxLength: 30 }, title: { type: 'string', maxLength: 140 }, body: { type: 'string', maxLength: 900 }, cites: { type: 'array', minItems: 1, items: { type: 'integer' } }, tags: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 40 } }, confidence: { type: 'number' } } } },
    cited_ids: { type: 'array', items: { type: 'integer' } },
    // optional (blueprint §4.3): suggested twin changes — shown to the athlete, never applied automatically
    twin_state_patch: { type: 'object', properties: { current_ef_baseline: { type: 'number' }, shoe_alert: { type: 'string', maxLength: 300 }, readiness_modifier: { type: 'string', maxLength: 300 } } },
  },
}
export const coachLang = () => { try { return load('kv', {})['lumpad.coach.lang']?.value === 'id' ? 'id' : 'en' } catch { return 'en' } }
export function renderPrompt(ctx, task, { lang = coachLang() } = {}) {
  const s = ctx.stable, system = [
    'You are the running coach inside Lumpad for ONE athlete aiming at a sub-4:00 marathon on 24 Oct 2027. Be direct, specific and honest about uncertainty; the athlete asked for evidence-based reality checks, not reassurance.',
    'RULES OF EVIDENCE: use only the numbers in the context; if something is missing say "belum ditarik" (not pulled) instead of guessing; never present a hypothesis as fact; correlation edges are associations, not causes; the P(sub-4) scenarios are illustrative models.',
    'LOCKED RULES (always win over any analysis; never contradict, never propose editing them):', ...s.rules.filter((r) => r.locked).map((r) => `- [${r.id}] ${r.title}: ${r.rule}`),
    'OTHER ACTIVE RULES:', ...s.rules.filter((r) => !r.locked).map((r) => `- [${r.id}] ${r.title}: ${r.rule}`),
    'ATHLETE: ' + s.athlete.goal, ...s.athlete.facts.map((f) => '- ' + f), 'DEFINITIONS: ' + JSON.stringify(s.definitions),
    'OUTPUT: reply with ONE JSON object only, exactly these keys: summary (≤120 words), analysis_md (markdown), recommendations[{action,why,priority: exactly one of now|this_week|later,evidence_ids,needs_athlete_ok}], flags[{type: one of gate|injury|load|heat|data_gap|rule|other, text}], memory_writes[{tier,kind,title,body,cites}], cited_ids[]. Reply in the language of the question (Indonesian or English).',
    'ANALYSIS STRUCTURE (analysis_md, markdown headings in this order): ## Twin snapshot & anomaly check — compare with twin.baselines (30-day vs 90-day: EF, HR@8:00, pace@HR150, cadence, GCT, stride, vertical ratio) and twin.intensity; ## Multi-variable correlations — internal load (HR, % LTHR, zones), Pod 2 biomechanics (GCT, cadence, stride, vertical ratio), cumulative load (CTL/ATL/TSB, readiness) and external factors (shoe, elevation, heat, gym in the 72 h before) — use correlation_edges and twin.strength_to_run_transfer, as associations; ## Historical mirroring — the most similar past sessions/races from episodes and telemetry, with exact deltas, and what worked or failed then; ## Precise prescription — the next session: target pace per km, HR ceiling in bpm, a shoe from the active rotation, any gym change.',
    'Check every session: if Pa:HR drift > 5 % or late GCT rises > 10 ms, say whether the likely trigger is local muscle fatigue (gym 1–3 days before), heat/dehydration, or shoe wear — and say when the data cannot tell.',
    'twin_state_patch (optional): {current_ef_baseline, shoe_alert, readiness_modifier} — only when the context supports it; it is shown to the athlete as a suggestion, never applied automatically.',
    'memory_writes: at most 5; only durable, non-obvious findings that are directly supported by the cited items; every body number must appear in a cited item; cites = item ids from the context. They are stored as unconfirmed hypotheses.',
    lang === 'id' ? 'LANGUAGE: write summary, analysis_md, recommendations and flags in Bahasa Indonesia (sharp, data-driven, direct); keep metric names (EF, Pa:HR, GCT, TSB) and JSON keys in English.' : 'LANGUAGE: English.',
  ].join('\n')
  const v = ctx.volatile, user = [`TASK (${v.intent}, as of ${v.as_of}): ${task}`, v.question ? `QUESTION: ${v.question}` : '', 'CONTEXT JSON:', JSON.stringify({ query: v.query, twin: v.twin, correlation_edges: v.correlation_edges, episodes: v.episodes, facts: v.facts, telemetry: v.telemetry }), 'Cite item ids ([id]) for every claim drawn from episodes/facts.'].filter(Boolean).join('\n')
  return { system, user }
}
export const TASKS = { daily_brief: 'Give today\'s brief: can the athlete run, what to run (given gates/load/readiness), the one thing to watch, and any data gap that matters. Keep it short.', session_review: 'Review the focus session: what happened, how it compares with similar sessions, what it says about durability/heat/pacing, and what to change.',
  weekly_review: 'Review the last week: load vs the guard rules, durability progress, injury state, readiness trend, and the plan for the next week.', race_plan: 'Build or critique the race plan: opening cap, pacing by segment, heat and fuelling protocol, go/no-go gates.', question: 'Answer the question using the context.' }
