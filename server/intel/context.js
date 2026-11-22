// retrieveRunnerContext(): SQL filters + FTS5 + numeric-fingerprint kNN + correlation edges → ONE structured payload (schema context/1).
// The `stable` block (rules, athlete summary, definitions) is byte-identical between calls so provider prefix caching works; everything that changes is in `volatile`.
import { idb, mdb } from './db.js'
import { ftsSearch, rrf, mmr, sortByEvidence, getMemory } from './memory.js'
import { latestTwin } from './twin.js'
import { listEdges } from './corr.js'
import { OUTPUT_SCHEMA } from './schema.js'
import { zMatrix, cosine, FEATURES } from './card.js'
import { RACE_CALENDAR_TEXT } from './racecal.js'
import { todayActivity } from './today.js'
import { adviceSummary } from './advice.js'
import PLAN from '../../src/data/plan.json' with { type: 'json' }
import { redact, STABLE_ATHLETE, DEFINITIONS, INTENT_QUERY, TASKS, renderPromptPure } from './prompt.js'
import { decompose, filterSql } from './query.js'
import { db as app } from '../store.js'
import { load } from '../db.js'

export const SCHEMA = 'context/1', EST = (s) => Math.ceil(String(s).length / 3.6)
const wibDate = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export { redact, STABLE_ATHLETE, DEFINITIONS, INTENT_QUERY, TASKS } from './prompt.js'
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
  // 4b) what the athlete has already done today (+ load after it): the brief must not read as if the day had not started
  let todayAct; try { const rows = app.prepare("SELECT id, name, sport, distance_m, duration_s, avg_hr, avg_pace_s_km, training_load FROM activities WHERE source='coros' AND date=? ORDER BY start_ts").all(date)
    todayAct = todayActivity(rows.map((a) => ({ ...a, fit: !!idb.prepare('SELECT 1 FROM fit_session WHERE activity_id=?').get(a.id) })), twinRow, date, PLAN.find((d) => d.date === addDays(date, 1)) || null) } catch {}
  let adviceHist; try { const a = adviceSummary({ today: date }); if (a.resolved) adviceHist = { last_days: a.days, checked: a.resolved, by_kind: a.by_kind, recent: a.recent } } catch {}
  const twin = compactTwin(twinRow.state), stable = { schema: SCHEMA, athlete: STABLE_ATHLETE, definitions: DEFINITIONS, rules }, list = [...items.values()]
  let volatile, tokens
  for (;;) {
    volatile = { as_of: date, intent, question: redact(question), query: { filters: { ...dq.filters, shoes: dq.filters.shoes?.map((x) => x.name) }, topics: dq.topics }, twin_version: twinRow.version, twin, episodes: list.filter((i) => i.tier === 'episodic'), facts: list.filter((i) => i.tier !== 'episodic'), correlation_edges: edges, telemetry, focus_label: focus || null, today_activity: todayAct, advice_history: adviceHist }
    tokens = EST(JSON.stringify(stable)) + EST(JSON.stringify(volatile)); if (tokens <= tokenBudget || list.length === 0) break
    if (telemetry.length > 1) { telemetry.pop(); continue }
    const drop = list.map((i, k) => [i, k]).filter(([i]) => i.why === 'text match').pop() || list.map((i, k) => [i, k]).filter(([i]) => i.why === 'recent').pop() || [list.at(-1), list.length - 1]; list.splice(drop[1], 1)
  }
  return { schema: SCHEMA, stable, volatile, item_ids: list.map((i) => i.id), tokens_est: tokens }
}

// ---- prompt + output contract (coach/1)
export { OUTPUT_SCHEMA } from './schema.js'
export const coachLang = () => { try { return load('kv', {})['lumpad.coach.lang']?.value === 'id' ? 'id' : 'en' } catch { return 'en' } }
export const renderPrompt = (ctx, task, { lang = coachLang() } = {}) => renderPromptPure(ctx, task, lang)
