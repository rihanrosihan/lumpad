// Phase 6: old-Lumpad context -> Neo4j Aura. Node-side writer (same pattern as server/garmin/graph.js). Hard rules, from the audit of lumpadd/internal/graph:
//  * The Go sync DELETES and rebuilds every ABOUT / PRECEDED / CONTRADICTS / RELATED_TO / SIMILAR_TO / IN_BAND / COMPARED_TO ... relationship and every Km / Lap / WeatherHour / Memory / Rule node.
//    So this layer uses labels the sync never touches (Episode, Stop, ChipSplit) and relationship types it never touches (DESCRIBES, NEXT_EPISODE, HAS_STOP, STOP_IN, HAS_CHIP_SPLIT,
//    CONFLICTS_WITH, REFINES_MEMORY), and keeps km_index as a PROPERTY (never an edge to Km, which is rebuilt every sync).
//  * Every node and edge carries era='old_lumpad' and src='olx' (never 'kbx', which the sync wipes). MERGE only; live nodes are never rewritten.
//  * Privacy: Aura is a cloud service. Titles are redacted; summaries only for S0/S1; S2 (health) nodes carry no summary text (the local memory row holds it and is referenced by memory_id).
import { cypher } from '../garmin/graph.js'
import { neoEnv, configured } from '../neo4j.js'
import { openRO } from './fence.js'
import { redactX } from './redact.js'
import { OLD_ERA, OLD_HORIZON, nowIso } from './db.js'

const RACEY = /\b(race|marathon|half marathon|10k|5k|7k|trail|finish|dnf|dns|jrf|jakim|milo|lps|total ?combat|guardian|century|qualif|balke)\b/i
const RUNNY = /\b(run|tempo|long run|treadmill|trail|recovery|interval|hill|reps?|jog|double)\b/i
const HEALTH = /\b(pain|nyeri|injur|cedera|plantar|shin|mtss|illness|fever|diare|diarrhea|overreach|flare|tender|physio|needling|medic)/i
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const clip = (s, n) => (s == null ? null : String(s).slice(0, n))
export const stopClass = (reason) => /urinat|toilet/i.test(reason) ? 'toilet' : /met wife|child|family/i.test(reason) ? 'family' : /medic|medical help/i.test(reason) ? 'medic' : /friend|talked/i.test(reason) ? 'social' : /release|spray|massage/i.test(reason) ? 'self_release' : /before finish/i.test(reason) ? 'finish' : 'other'
const toSec = (hms) => { const m = /^(\d+):(\d\d):(\d\d)$/.exec(hms || ''); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null }

// pure: what would be written, given the staging DB, the live races and the live sessions per date
export function plan({ db, races, sessionsByDate }) {
  const claims = db.prepare("SELECT c.*, d.doc_date FROM ol_claim c JOIN ol_doc d ON d.doc_id=c.doc_id WHERE c.qa_status='pass' AND c.promoted_memory_id IS NOT NULL AND c.kind IN ('episode','lesson','decision','hypothesis')").all()
  const events = db.prepare('SELECT * FROM ol_event').all(), raceByDate = new Map(races.map((r) => [r.date, r.race_id]))
  const episodes = [], links = [], pairs = [], memLinks = []
  const longest = (d) => sessionsByDate.get(d)?.[0] || null
  for (const c of claims) {
    const text = c.title + ' ' + c.text + ' ' + (c.subject_key || ''), date = c.event_date || null, health = c.sensitivity === 'S2' && HEALTH.test(text)
    const kind = health ? (/diare|illness|fever/i.test(text) ? 'illness' : /overreach/i.test(text) ? 'overreach' : 'injury') : c.kind === 'episode' || c.kind === 'decision' ? (RACEY.test(text) ? 'race_reflection' : 'run_context') : c.kind
    const id = 'olx:' + c.claim_id
    episodes.push({ id, props: { kind, date_from: c.valid_from, date_to: c.valid_to, title: clip(redactX(c.title), 120), summary: c.sensitivity === 'S2' ? null : clip(redactX(c.text), 240), subject: clip(redactX(c.subject_key || ''), 60) || null,
      sensitivity: c.sensitivity, confidence: c.confidence, memory_id: c.promoted_memory_id, novelty: c.novelty, doc: c.doc_id.replace(/^ol\//, '').split('/').pop().slice(0, 40), batch_id: c.batch_id } })
    if (date) {
      if (RACEY.test(text) && raceByDate.has(date)) { links.push({ id, to: 'Race', key: raceByDate.get(date) }); episodes.at(-1).props.race_id = raceByDate.get(date) }
      const s = (RACEY.test(text) && raceByDate.has(date)) || RUNNY.test(text) ? longest(date) : null; if (s) links.push({ id, to: 'Session', key: s })
      links.push({ id, to: 'Day', key: date })
    }
    if (c.matched_memory_id && c.novelty === 'contradicts') memLinks.push({ id, mid: c.matched_memory_id, rel: 'CONFLICTS_WITH' })
    if (c.matched_memory_id && c.novelty === 'refines') memLinks.push({ id, mid: c.matched_memory_id, rel: 'REFINES_MEMORY' })
  }
  for (const e of events) {   // per-run notes and check-ins become coarse Episodes too
    const p = JSON.parse(e.payload)
    if (e.kind === 'run_context') { const health = HEALTH.test(p.reason || '')
      episodes.push({ id: 'olx:ev:' + e.event_id, props: { kind: 'run_context', date_from: e.event_date, date_to: e.event_date, title: clip(redactX(`Run context · ${p.activity}`), 120), summary: health ? null : clip(redactX(p.reason), 240), subject: clip(redactX(p.activity), 60), sensitivity: health ? 'S2' : 'S1', confidence: null, memory_id: null, novelty: 'event', doc: 'context-enrichment', batch_id: e.batch_id } })
      if (e.label_id) links.push({ id: 'olx:ev:' + e.event_id, to: 'Session', key: e.label_id }); links.push({ id: 'olx:ev:' + e.event_id, to: 'Day', key: e.event_date }) }
    if (e.kind === 'checkin') { episodes.push({ id: 'olx:ev:' + e.event_id, props: { kind: 'checkin', date_from: e.event_date, date_to: e.event_date, title: `Post-run check-in ${e.event_date}`, summary: null, subject: null, sensitivity: 'S2', fatigue: p.scores?.fatigue ?? null, soreness: p.scores?.soreness ?? null, stress: p.scores?.stress ?? null, pain: p.scores?.pain ?? null, confidence: null, memory_id: null, novelty: 'event', doc: 'decision-card', batch_id: e.batch_id } })
      links.push({ id: 'olx:ev:' + e.event_id, to: 'Day', key: e.event_date }) }
  }
  // chains: health episodes and race reflections each form a dated chain
  for (const group of [(e) => ['injury', 'illness', 'overreach'].includes(e.props.kind), (e) => e.props.kind === 'race_reflection']) {
    const g = episodes.filter(group).sort((a, b) => a.props.date_from.localeCompare(b.props.date_from) || a.id.localeCompare(b.id)); for (let i = 1; i < g.length; i++) pairs.push({ a: g[i - 1].id, b: g[i].id })
  }
  // Jakim stops and official chip splits (structured, deterministic)
  const stops = [], chips = []
  for (const e of events.filter((x) => x.kind === 'jakim_stop_labelled')) {
    const p = JSON.parse(e.payload), km = parseFloat(String(p.km).split('-')[0]), cls = stopClass(p.reason || '')
    stops.push({ id: 'olx:stop:' + e.event_id, label_id: e.label_id, race_id: raceByDate.get(e.event_date) || null, props: { clock: p.time, km, km_index: Math.ceil(km), duration_s: +p.duration_s, class: cls, intentional: cls === 'family', reason: clip(redactX(p.reason), 200), date: e.event_date } })
  }
  const watch = new Map(events.filter((x) => x.kind === 'jakim_checkpoint').map((x) => { const p = JSON.parse(x.payload); return [String(p.split_order), p] }))
  for (const e of events.filter((x) => x.kind === 'jakim_official_split')) {
    const p = JSON.parse(e.payload), w = watch.get(String(p.split_order))
    chips.push({ id: 'olx:chip:' + e.event_id, race_id: raceByDate.get(e.event_date) || null, props: { order: +p.split_order, km: +p.km, segment_km: +p.segment_km, split_s: toSec(p.official_split_time), cumulative_s: toSec(p.official_cumulative), pace: p.official_split_pace_calc, watch_minus_official_s: w ? +w.watch_minus_official_s : null, date: e.event_date } })
  }
  const fieldBands = []
  { const rows = db.prepare('SELECT event, scope, band, metric, value, n FROM ol_field_stat').all(), by = new Map(), dateOf = { 'jakim-2026': '2026-06-14', 'milo-2025': '2025-12-07', 'guardian-2025': '2025-09-21' }
    for (const r of rows) { const k = r.event + '|' + r.scope + '|' + r.band; if (!by.has(k)) by.set(k, { event: r.event, scope: r.scope, band: r.band, m: {} }); by.get(k).m[r.metric] = r.value }
    const ath = new Map(rows.filter((r) => r.band === 'athlete' && r.metric === 'finish_s').map((r) => [r.event, r.value])), bands = { FM: [['<4h', 0, 14400], ['4-5h', 14400, 18000], ['5-6h', 18000, 21600], ['6-7h', 21600, 25200], ['>=7h', 25200, 1e9]], '10K': [['<50m', 0, 3000], ['50-60m', 3000, 3600], ['60-75m', 3600, 4500], ['75-90m', 4500, 5400], ['>=90m', 5400, 1e9]] }
    for (const b of by.values()) {
      if (['all', 'athlete'].includes(b.band)) continue
      const kms = Object.keys(b.m).filter((m) => m.startsWith('seg_pace_s@km')).map((m) => ({ m, km: parseFloat(m.slice(13)) })).sort((x, y) => x.km - y.km); if (!kms.length) continue
      const first = kms.find((x) => x.km >= 10) || kms[0], last = kms.at(-1), a = ath.get(b.event), bd = bands[b.scope].find(([n]) => n === b.band)
      fieldBands.push({ id: `olx:field:${b.event}:${b.band}`, race_id: raceByDate.get(dateOf[b.event]) || null, props: { event: b.event, scope: b.scope, band: b.band, finishers: b.m.finishers, pace_early_s: first.km === last.km ? null : b.m[first.m], pace_late_s: b.m[last.m], early_km: first.km, late_km: last.km,
        decay_pct: first.km === last.km ? null : Math.round((b.m[last.m] / b.m[first.m] - 1) * 1000) / 10, athlete_in_band: a != null && bd ? a >= bd[1] && a < bd[2] : false, date: dateOf[b.event] } })
    }
  }
  return { episodes, links, pairs, memLinks, stops, chips, fieldBands }
}
export const clean = (rows) => rows.map((r) => ({ ...r, props: r.props && Object.fromEntries(Object.entries(r.props).filter(([, v]) => v !== undefined && v !== null)) }))

const TAG = ', x.era = "old_lumpad", x.src = "olx"'
const Q = {
  snapshot: 'MATCH (n) RETURN labels(n)[0] AS l, count(n) AS c, sum(CASE WHEN n.era = "old_lumpad" THEN 1 ELSE 0 END) AS h',
  edgesSnap: 'MATCH ()-[r]->() RETURN type(r) AS t, count(r) AS c, sum(CASE WHEN r.era = "old_lumpad" THEN 1 ELSE 0 END) AS h',
  episodes: 'UNWIND $rows AS r MERGE (x:Episode {id: r.id}) SET x += r.props' + TAG,
  Race: 'UNWIND $rows AS r MATCH (e:Episode {id: r.id}) MATCH (t:Race {race_id: r.key}) MERGE (e)-[l:DESCRIBES]->(t) SET l.era = "old_lumpad"',
  Session: 'UNWIND $rows AS r MATCH (e:Episode {id: r.id}) MATCH (t:Session {label_id: r.key}) MERGE (e)-[l:DESCRIBES]->(t) SET l.era = "old_lumpad"',
  Day: 'UNWIND $rows AS r MATCH (e:Episode {id: r.id}) MATCH (t:Day {date: r.key}) MERGE (e)-[l:DESCRIBES]->(t) SET l.era = "old_lumpad"',
  chain: 'UNWIND $rows AS r MATCH (a:Episode {id: r.a}), (b:Episode {id: r.b}) MERGE (a)-[l:NEXT_EPISODE]->(b) SET l.era = "old_lumpad"',
  CONFLICTS_WITH: 'UNWIND $rows AS r MATCH (e:Episode {id: r.id}) MATCH (m:Memory {id: r.mid}) MERGE (e)-[l:CONFLICTS_WITH]->(m) SET l.era = "old_lumpad"',
  REFINES_MEMORY: 'UNWIND $rows AS r MATCH (e:Episode {id: r.id}) MATCH (m:Memory {id: r.mid}) MERGE (e)-[l:REFINES_MEMORY]->(m) SET l.era = "old_lumpad"',
  stops: 'UNWIND $rows AS r MERGE (x:Stop {id: r.id}) SET x += r.props' + TAG + ' WITH x, r MATCH (s:Session {label_id: r.label_id}) MERGE (s)-[l:HAS_STOP]->(x) SET l.era = "old_lumpad"',
  stopRace: 'UNWIND $rows AS r MATCH (x:Stop {id: r.id}) MATCH (t:Race {race_id: r.race_id}) MERGE (x)-[l:STOP_IN]->(t) SET l.era = "old_lumpad"',
  field: 'UNWIND $rows AS r MERGE (x:FieldBand {id: r.id}) SET x += r.props, x.race_id = r.race_id' + TAG + ' WITH x, r WHERE r.race_id IS NOT NULL MATCH (t:Race {race_id: r.race_id}) MERGE (t)-[l:HAS_FIELD_BAND]->(x) SET l.era = "old_lumpad"',
  chips: 'UNWIND $rows AS r MERGE (x:ChipSplit {id: r.id}) SET x += r.props' + TAG + ' WITH x, r MATCH (t:Race {race_id: r.race_id}) MERGE (t)-[l:HAS_CHIP_SPLIT]->(x) SET l.era = "old_lumpad"',
}
export async function snapshot(opts) { const n = await cypher(Q.snapshot, {}, opts), e = await cypher(Q.edgesSnap, {}, opts); return { nodes: Object.fromEntries(n.map(([l, c, h]) => [l, { total: c, hist: h }])), edges: Object.fromEntries(e.map(([t, c, h]) => [t, { total: c, hist: h }])) } }
export async function liveContext(opts) {
  const races = (await cypher('MATCH (r:Race) WHERE r.date IS NOT NULL RETURN r.race_id, r.date', {}, opts)).map(([race_id, date]) => ({ race_id, date }))
  const idb = openRO('intel'), sessionsByDate = new Map()
  for (const r of idb.prepare("SELECT date, label_id FROM fit_session WHERE distance_m >= 2000 ORDER BY date, distance_m DESC").all()) { if (!sessionsByDate.has(r.date)) sessionsByDate.set(r.date, []); sessionsByDate.get(r.date).push(r.label_id) }
  idb.close(); return { races, sessionsByDate }
}
export async function apply({ db, dry = true, opts = {} }) {
  if (!configured(opts.env || neoEnv())) throw new Error('neo4j not configured')
  const ctx = await liveContext(opts), P = plan({ db, ...ctx }), before = await snapshot(opts), sum = (o) => Object.values(o).reduce((a, x) => a + x.total, 0)
  const byTo = (t) => P.links.filter((l) => l.to === t).map((l) => ({ id: l.id, key: l.key }))
  const rep = { dry, will_write: { episodes: P.episodes.length, stops: P.stops.length, chip_splits: P.chips.length, field_bands: P.fieldBands.length, describes: { Race: byTo('Race').length, Session: byTo('Session').length, Day: byTo('Day').length }, next_episode: P.pairs.length, conflicts_with: P.memLinks.filter((m) => m.rel === 'CONFLICTS_WITH').length, refines_memory: P.memLinks.filter((m) => m.rel === 'REFINES_MEMORY').length }, before_totals: { nodes: sum(before.nodes), edges: sum(before.edges) } }
  if (dry) return rep
  db.prepare('INSERT OR REPLACE INTO ol_kv VALUES (?,?)').run('graph_before_' + nowIso(), JSON.stringify(before))
  for (const c of chunk(clean(P.episodes), 80)) await cypher(Q.episodes, { rows: c }, opts)
  for (const t of ['Race', 'Session', 'Day']) for (const c of chunk(byTo(t), 150)) await cypher(Q[t], { rows: c }, opts)
  for (const c of chunk(P.pairs, 150)) await cypher(Q.chain, { rows: c }, opts)
  for (const rel of ['CONFLICTS_WITH', 'REFINES_MEMORY']) { const rows = P.memLinks.filter((m) => m.rel === rel); for (const c of chunk(rows, 150)) await cypher(Q[rel], { rows: c }, opts) }
  for (const c of chunk(clean(P.stops).map((s) => ({ id: s.id, label_id: s.label_id, props: s.props })), 40)) await cypher(Q.stops, { rows: c }, opts)
  for (const c of chunk(P.stops.filter((s) => s.race_id).map((s) => ({ id: s.id, race_id: s.race_id })), 40)) await cypher(Q.stopRace, { rows: c }, opts)
  for (const c of chunk(clean(P.chips).filter((x) => x.race_id), 40)) await cypher(Q.chips, { rows: c.map((x) => ({ id: x.id, race_id: x.race_id, props: x.props })) }, opts)
  for (const c of chunk(clean(P.fieldBands).map((x) => ({ id: x.id, race_id: x.race_id, props: x.props })), 40)) await cypher(Q.field, { rows: c }, opts)
  await relink({ opts })
  const after = await snapshot(opts), bad = []
  for (const [l, v] of Object.entries(before.nodes)) if ((after.nodes[l]?.total ?? 0) - (after.nodes[l]?.hist ?? 0) !== v.total - v.hist) bad.push('node:' + l)
  for (const [t, v] of Object.entries(before.edges)) if ((after.edges[t]?.total ?? 0) - (after.edges[t]?.hist ?? 0) !== v.total - v.hist) bad.push('edge:' + t)
  db.prepare('INSERT OR REPLACE INTO ol_kv VALUES (?,?)').run('graph_after_' + nowIso(), JSON.stringify(after))
  return { ...rep, after_totals: { nodes: sum(after.nodes), edges: sum(after.edges) }, live_unchanged: bad.length === 0, drift: bad, new_nodes: Object.fromEntries(Object.entries(after.nodes).filter(([, v]) => v.hist).map(([l, v]) => [l, v.hist])), new_edges: Object.fromEntries(Object.entries(after.edges).filter(([, v]) => v.hist).map(([t, v]) => [t, v.hist])) }
}
// The sync wipes and recreates the Race nodes it sources from the KB ({src:'kbx'}), which orphans our DESCRIBES edges to them. Episodes keep race_id, so this restores the edges (idempotent MERGE).
export async function relink({ opts = {} } = {}) {
  const before = (await cypher('MATCH (:Episode {src:"olx"})-[d:DESCRIBES]->(:Race) RETURN count(d)', {}, opts))[0][0]
  await cypher('MATCH (e:Episode {src: "olx"}) WHERE e.race_id IS NOT NULL MATCH (r:Race {race_id: e.race_id}) MERGE (e)-[l:DESCRIBES]->(r) SET l.era = "old_lumpad"', {}, opts)
  await cypher('MATCH (f:FieldBand {src: "olx"}) WHERE f.race_id IS NOT NULL MATCH (r:Race {race_id: f.race_id}) MERGE (r)-[l:HAS_FIELD_BAND]->(f) SET l.era = "old_lumpad"', {}, opts)
  const after = (await cypher('MATCH (:Episode {src:"olx"})-[d:DESCRIBES]->(:Race) RETURN count(d)', {}, opts))[0][0]
  return { race_edges_before: before, race_edges_after: after }
}
export async function rollback({ opts = {} } = {}) {
  const before = await snapshot(opts)
  await cypher('MATCH (n {era: "old_lumpad"}) DETACH DELETE n', {}, opts)
  await cypher('MATCH ()-[r {era: "old_lumpad"}]->() DELETE r', {}, opts)
  const after = await snapshot(opts); return { removed_nodes: Object.values(before.nodes).reduce((a, x) => a + x.hist, 0) - Object.values(after.nodes).reduce((a, x) => a + x.hist, 0), remaining_old_nodes: Object.values(after.nodes).reduce((a, x) => a + x.hist, 0) }
}
