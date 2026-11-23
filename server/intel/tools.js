// Evidence tools for the coach: instead of one giant prompt, the model asks for exactly the evidence it needs and every number it then uses comes from a tool result.
// Read-only, bounded, local (SQLite): no tool needs Aura, Postgres or an outside call, so the coach keeps working when those are down. Each result carries ids
// (memory ids) so citations and the grounding check cover tool output exactly like prompt context.
import { idb, mdb } from './db.js'
import { db as app } from '../store.js'
import { load } from '../db.js'
import { filterSql } from './query.js'
import { ftsSearch, sortByEvidence } from './memory.js'
import { latestTwin } from './twin.js'
import { estimate, cfgOf } from '../../src/lib/zones.js'
import { PLAN } from '../plan/read.js'

const PLAN_BY = Object.fromEntries(PLAN.map((d) => [d.date, d]))
const r1 = (x, d = 1) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const need = (c, m) => { if (!c) throw Object.assign(new Error(m), { status: 400 }) }
const memIdOf = (label) => mdb.prepare("SELECT id FROM memory WHERE source='fit' AND source_ref=?").get(label)?.id ?? null
const clip = (t, n) => String(t || '').replace(/\s+/g, ' ').slice(0, n)

// ---- topics (same vocabulary as the knowledge graph: lumpadd/internal/graph/enrich.go topicDefs)
export const TOPICS = {
  heat: /\b(heat|panas|wbgt|humid\w*|hot|dehydrat\w*|acclimat\w*|flag protocol)\b/i, fueling: /\b(fuel\w*|gels?|carb\w*|nutrition|caffeine|hydrat\w*|salt|electrolyte\w*|stomach|breakfast)\b/i,
  recovery: /\b(hrv|sleep|recovery|readiness|resting heart|rhr)\b/i, durability: /\b(durab\w*|fade|run.?share|walk\w*|cadence|gct|stride|late.run|long run)\b/i,
  pacing: /\b(pacing|opening|negative split|marathon pace|run-walk|cut-?off|go\/no-go)\b/i, strength: /\b(gym|strength|squat\w*|calf|leg day|lower body|plyo\w*|unilateral)\b/i,
  injury: /\b(tibia\w*|mtss|plantar|achilles|vmo|injur\w*|pain)\b/i, shoes: /\b(shoe\w*|sepatu|foam|plated)\b/i, load: /\b(training load|ctl|atl|tsb|volume|mileage|weekly km|load guard|taper)\b/i, race: /\b(race|marathon|jakim|jrf|borobudur|bib|sub-?4|checkpoint)\b/i,
}

// ---- the tools
const SESSION_COLS = 's.label_id, s.date, s.distance_m, s.run_pace, s.run_hr, s.ef, s.run_share, s.onset_km, s.gct_fade, s.drift_pahr, s.tl, w.wbgt'
const shapeSession = (s) => ({ id: memIdOf(s.label_id), label_id: s.label_id, date: s.date, km: r1(s.distance_m / 1000), pace_s_km: s.run_pace ? Math.round(s.run_pace) : null, run_hr: r1(s.run_hr, 0), ef: r1(s.ef, 3), run_share: r1(s.run_share, 2), fade_onset_km: s.onset_km ?? null, gct_fade_ms: r1(s.gct_fade), pa_hr_drift_pct: r1(s.drift_pahr), load: r1(s.tl, 0), wbgt: r1(s.wbgt) })

export const TOOLS = {
  find_sessions: {
    description: 'Find this athlete\'s past runs (with measured metrics) by date range, distance, heart rate or indoor/outdoor. Newest first, at most 8.',
    parameters: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, min_km: { type: 'number' }, max_km: { type: 'number' }, hr_min: { type: 'number', description: 'average running heart rate at least' }, hr_max: { type: 'number' }, indoor: { type: 'boolean' }, limit: { type: 'integer' } } },
    run: (a) => {
      for (const k of ['from', 'to']) if (a[k] != null) need(DATE.test(a[k]), k + ' must be YYYY-MM-DD')
      const f = { from: a.from, to: a.to, hr_min: a.hr_min, hr_max: a.hr_max, indoor: a.indoor === true || undefined }
      if (a.min_km != null || a.max_km != null) f.dist_km = [a.min_km ?? 0, a.max_km ?? 100]
      const { where, params } = filterSql(f), rows = idb.prepare(`SELECT ${SESSION_COLS} FROM fit_session s LEFT JOIN run_weather w ON w.label_id = s.label_id ${where} ORDER BY s.date DESC LIMIT ?`).all(...params, Math.min(8, Math.max(1, a.limit || 6)))
      return { sessions: rows.map(shapeSession), count: rows.length }
    },
  },
  session_detail: {
    description: 'Kilometre-by-kilometre splits (pace, heart rate, cadence, ground contact, share of time running) for ONE run, by label_id or date.',
    parameters: { type: 'object', properties: { label_id: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD (the longest run that day)' } } },
    run: (a) => {
      need(a.label_id || DATE.test(a.date || ''), 'give label_id or date')
      const s = a.label_id ? idb.prepare('SELECT label_id, date, distance_m, km FROM fit_session WHERE label_id=?').get(String(a.label_id)) : idb.prepare('SELECT label_id, date, distance_m, km FROM fit_session WHERE date=? ORDER BY distance_m DESC LIMIT 1').get(a.date)
      need(s, 'no analysed run found (the FIT file may not be imported yet)')
      const km = JSON.parse(s.km || '[]'), step = Math.max(1, Math.ceil(km.length / 24))
      return { id: memIdOf(s.label_id), label_id: s.label_id, date: s.date, km_total: r1(s.distance_m / 1000), columns: 'km, pace s/km, heart rate, cadence spm, ground contact ms, run share', splits: km.filter((_, i) => i % step === 0).map((k) => [k.km, k.pace, k.hr, k.cad, k.gct, k.runShare]) }
    },
  },
  memory_search: {
    description: 'Search the athlete\'s notes: coach findings, past session cards and the sports-science knowledge base. Returns the best matches with ids you can cite.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
    run: (a) => { need(typeof a.query === 'string' && a.query.trim().length >= 3, 'query too short')
      const hits = ftsSearch(a.query, { tiers: ['semantic', 'episodic', 'procedural'], limit: Math.min(6, Math.max(1, a.limit || 5)) * 2 }).sort(sortByEvidence).slice(0, Math.min(6, a.limit || 5))
      return { notes: hits.map((m) => ({ id: m.id, tier: m.tier, title: clip(m.title, 90), text: clip(m.body, 420), evidence: m.evidence_tag })) } },
  },
  topic_context: {
    description: 'Everything the system knows about one topic: the most relevant notes plus recent runs that belong to it. Topics: heat, fueling, recovery, durability, pacing, strength, injury, shoes, load, race.',
    parameters: { type: 'object', properties: { topic: { type: 'string', enum: Object.keys(TOPICS) } }, required: ['topic'] },
    run: (a) => { need(TOPICS[a.topic], 'unknown topic')
      const rows = mdb.prepare("SELECT id, tier, kind, title, body, evidence_tag, source FROM memory WHERE status='active' AND source <> 'fit'").all().map((m) => ({ ...m, hits: (`${m.title} ${m.body}`.match(new RegExp(TOPICS[a.topic].source, 'gi')) || []).length })).filter((m) => m.hits > 0)
      rows.sort((x, y) => (x.source === 'coach' ? 0 : 1) - (y.source === 'coach' ? 0 : 1) || y.hits - x.hits).splice(8)
      const runs = a.topic === 'heat' ? idb.prepare(`SELECT ${SESSION_COLS} FROM fit_session s JOIN run_weather w ON w.label_id = s.label_id WHERE w.wbgt >= 25.7 AND w.indoor = 0 ORDER BY s.date DESC LIMIT 5`).all()
        : a.topic === 'durability' ? idb.prepare(`SELECT ${SESSION_COLS} FROM fit_session s LEFT JOIN run_weather w ON w.label_id = s.label_id WHERE s.distance_m >= 16000 ORDER BY s.date DESC LIMIT 5`).all() : []
      return { topic: a.topic, notes: rows.map((m) => ({ id: m.id, title: clip(m.title, 90), text: clip(m.body, 380), evidence: m.evidence_tag })), recent_runs: runs.map(shapeSession) } },
  },
  gym_to_run: {
    description: 'How runs look after strength sessions: runs that started within 72 hours after a gym session versus all other runs (efficiency, late ground-contact fade, stride fade, share of time running), with the individual pairs.',
    parameters: { type: 'object', properties: { since: { type: 'string', description: 'YYYY-MM-DD, default 2025-01-01' } } },
    run: (a) => {
      const since = DATE.test(a.since || '') ? a.since : '2025-01-01'
      const gyms = app.prepare("SELECT id, date, start_ts, name FROM activities WHERE source='coros' AND sport IN ('Strength','WeightTraining') AND start_ts IS NOT NULL AND date >= ?").all(since)
      const runs = idb.prepare('SELECT label_id, date, start_ms, distance_m, ef, gct_fade, stride_fade, run_share FROM fit_session WHERE date >= ? AND start_ms IS NOT NULL AND distance_m >= 3000').all(since), pairs = [], after = new Set()
      for (const g of gyms) for (const s of runs) { const h = (s.start_ms / 1000 - g.start_ts) / 3600; if (h > 0 && h <= 72) { after.add(s.label_id); pairs.push({ gym_date: g.date, gym: clip(g.name, 30), run_date: s.date, hours_after: r1(h, 0), km: r1(s.distance_m / 1000), gct_fade_ms: r1(s.gct_fade), ef: r1(s.ef, 3) }) } }
      const avg = (L, k) => { const v = L.map((x) => x[k]).filter((x) => x != null && isFinite(x)); return v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length, k === 'ef' ? 3 : 1) : null }
      const grp = (L) => ({ n: L.length, ef: avg(L, 'ef'), gct_fade_ms: avg(L, 'gct_fade'), stride_fade: avg(L, 'stride_fade'), run_share: avg(L, 'run_share') })
      return { after_gym_72h: grp(runs.filter((s) => after.has(s.label_id))), other_runs: grp(runs.filter((s) => !after.has(s.label_id))), pairs: pairs.sort((x, y) => (y.run_date > x.run_date ? 1 : -1)).slice(0, 6), note: 'an association in one athlete, not proof of cause; small groups are noisy' }
    },
  },
  plan_day: {
    description: 'The planned session for a date (from the season plan) and what was actually done that day.',
    parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    run: (a) => { need(DATE.test(a.date || ''), 'date must be YYYY-MM-DD'); const p = PLAN_BY[a.date], acts = app.prepare("SELECT sport, round(distance_m/1000.0,1) km, round(duration_s/60.0) min, avg_hr, training_load FROM activities WHERE source='coros' AND date=? AND (distance_m > 0 OR training_load > 0)").all(a.date)
      return { date: a.date, planned: p ? { kind: p.kind, label: p.label || null, km: p.km, planned_load: p.tl ?? null, phase: p.phase } : null, done: acts } },
  },
  whatif_session: {
    description: 'Estimate what a run would cost: training load and the form (fitness minus fatigue) the athlete would carry into the next day, using the current load state.',
    parameters: { type: 'object', properties: { km: { type: 'number' }, zone: { type: 'integer', description: 'heart-rate zone 1-5 (default 2 = easy)' } }, required: ['km'] },
    run: (a) => { need(typeof a.km === 'number' && a.km > 0 && a.km <= 60, 'km must be 0-60'); const z = Math.min(5, Math.max(1, Math.round(a.zone || 2)))
      const tw = latestTwin()?.state?.load; need(tw && tw.ctl != null, 'no load state yet')
      const cfg = cfgOf(load('kv', {})['lumpad.settings']?.value || {}), e = estimate([{ t: 'run', m: a.km * 1000, z }], cfg)
      const ctl = tw.ctl + (e.tl - tw.ctl) / 42, atl = tw.atl + (e.tl - tw.atl) / 7
      return { km: a.km, zone: z, estimated_minutes: Math.round(e.sec / 60), estimated_load: e.tl, form_now: r1(tw.ctl - tw.atl), form_next_day: r1(ctl - atl), note: 'an estimate from the zone model; below -30 means deep fatigue' } },
  },
}
export const toolSpecs = () => Object.entries(TOOLS).map(([name, t]) => ({ type: 'function', function: { name, description: t.description, parameters: t.parameters } }))

// run one tool call: arguments arrive as a JSON string from the model; a bad call becomes an error RESULT the model can recover from, never an exception
export function runTool(name, rawArgs, { maxChars = 3600 } = {}) {
  const t = TOOLS[name]; if (!t) return { ok: false, text: JSON.stringify({ error: `unknown tool ${name}` }) }
  let args; try { args = rawArgs ? JSON.parse(rawArgs) : {} } catch { return { ok: false, text: JSON.stringify({ error: 'arguments must be valid JSON' }) } }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, text: JSON.stringify({ error: 'arguments must be an object' }) }
  try { const out = t.run(args); let text = JSON.stringify(out); if (text.length > maxChars) text = JSON.stringify({ truncated: true, partial: text.slice(0, maxChars - 60) }); return { ok: true, text, out } }
  catch (e) { return { ok: false, text: JSON.stringify({ error: String(e.message).slice(0, 200) }) } }
}
// memory ids that appear in a tool result (what the model may cite)
export function idsIn(out, acc = new Set()) { if (Array.isArray(out)) out.forEach((x) => idsIn(x, acc)); else if (out && typeof out === 'object') { if (Number.isInteger(out.id)) acc.add(out.id); for (const v of Object.values(out)) if (v && typeof v === 'object') idsIn(v, acc) } return acc }
