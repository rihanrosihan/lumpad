// Stage 6: Garmin history -> Neo4j Aura knowledge graph. Node-side (the Go projector cannot be rebuilt on this VPS, and its daily sync never prunes Session/Day nodes).
// Rules (blueprint 6.3 + project policy): training data ONLY (no health properties: NEO4J_SYNC_HEALTH is off and the Go sync strips sleep/hrv/rhr from every Day), no GPS,
// existing vocabulary only (Day, Session, HAS_SESSION, NEXT_DAY), every node/edge tagged era='garmin_hist', MERGE only (idempotent), live nodes never rewritten
// (only an additive `garmin_id` on the Session a Garmin FIT duplicates). Reversible: rollback() deletes by era.
import { neoEnv, configured } from '../neo4j.js'
import { openDb } from './db.js'
import { openIntel } from './fitsession.js'
import { CANON_CUTOFF } from './link.js'

const host = (uri) => uri.replace(/^(?:neo4j\+s|neo4j\+ssc|bolt\+s|bolt\+ssc|neo4j|bolt|https?):\/\//, '').split('/')[0]
export async function cypher(statement, parameters = {}, { env = neoEnv(), timeout = 25000, fetchFn = fetch } = {}) {
  const r = await fetchFn(`https://${host(env.uri)}/db/${encodeURIComponent(env.db)}/query/v2`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${env.user}:${env.pass}`).toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ statement, parameters }), signal: AbortSignal.timeout(timeout) })
  const j = await r.json().catch(() => ({})); if (!r.ok || j.errors?.length) throw new Error(`neo4j ${r.status}: ${JSON.stringify(j.errors || j).slice(0, 300)}`)
  return j?.data?.values || []
}
const rows = (a) => a.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)))
const dayRange = (a, b) => { const o = []; for (let d = new Date(a + 'T00:00:00Z'); d.toISOString().slice(0, 10) < b; d = new Date(d.getTime() + 864e5)) o.push(d.toISOString().slice(0, 10)); return o }
const r1 = (x, n = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : null)

// pure: what would be written
export function plan({ idb = openIntel(), gdb = openDb() } = {}) {
  const sess = idb.prepare('SELECT label_id, garmin_id, app_id, date, sport, distance_m, elapsed_s, ef, run_hr, run_share, hr800, gct_fade, stride_fade, dup_of FROM fit_session_hist ORDER BY date').all()
  const fresh = sess.filter((s) => !s.dup_of && s.date < CANON_CUTOFF), dups = sess.filter((s) => s.dup_of)
  const feat = new Map(idb.prepare('SELECT date, run_km, run_n, strength_n, tl_garmin FROM daily_feat_hist').all().map((d) => [d.date, d]))
  const days = dayRange('2024-09-01', CANON_CUTOFF)
  return { fresh: fresh.map((s) => ({ label_id: s.label_id, date: s.date, sport: s.sport, distance_m: r1(s.distance_m, 0), elapsed_s: r1(s.elapsed_s, 0), ef: r1(s.ef), run_hr: r1(s.run_hr, 1), run_share: r1(s.run_share, 2), hr800: r1(s.hr800, 1),
      gct_fade: r1(s.gct_fade, 2), stride_fade: r1(s.stride_fade), app_id: s.app_id, garmin_id: s.garmin_id })), dups: dups.map((s) => ({ label_id: s.dup_of, garmin_id: s.garmin_id })),
    days: days.map((d) => ({ date: d, run_km: feat.get(d)?.run_km ?? null, run_n: feat.get(d)?.run_n ?? null, g_tl: feat.get(d)?.tl_garmin ?? null })) }
}

const Q = {
  snapshot: 'MATCH (n) RETURN labels(n)[0] AS l, count(n) AS c, sum(CASE WHEN n.era = "garmin_hist" THEN 1 ELSE 0 END) AS h',
  edgesSnap: 'MATCH ()-[r]->() RETURN type(r) AS t, count(r) AS c, sum(CASE WHEN r.era = "garmin_hist" THEN 1 ELSE 0 END) AS h',
  days: 'UNWIND $rows AS r MERGE (d:Day {date: r.date}) ON CREATE SET d.era = "garmin_hist", d.source = "garmin", d.run_km = r.run_km, d.run_n = r.run_n, d.g_tl = r.g_tl',
  chain: 'UNWIND $rows AS r MATCH (a:Day {date: r.a}), (b:Day {date: r.b}) MERGE (a)-[x:NEXT_DAY]->(b) ON CREATE SET x.era = "garmin_hist"',
  sessions: `UNWIND $rows AS r MERGE (s:Session {label_id: r.label_id}) SET s += r, s.era = "garmin_hist", s.source = "garmin"
    WITH s, r MATCH (d:Day {date: r.date}) MERGE (d)-[x:HAS_SESSION]->(s) ON CREATE SET x.era = "garmin_hist"`,
  dups: 'UNWIND $rows AS r MATCH (s:Session {label_id: r.label_id}) WHERE s.era IS NULL SET s.garmin_id = r.garmin_id',
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

export async function snapshot(opts) { const n = await cypher(Q.snapshot, {}, opts), e = await cypher(Q.edgesSnap, {}, opts); return { nodes: Object.fromEntries(n.map(([l, c, h]) => [l, { total: c, hist: h }])), edges: Object.fromEntries(e.map(([t, c, h]) => [t, { total: c, hist: h }])) } }

export async function apply({ dry = true, opts = {}, db = openDb(), idb = openIntel() } = {}) {
  if (!configured(opts.env || neoEnv())) throw new Error('neo4j not configured')
  const P = plan({ idb, gdb: db }), before = await snapshot(opts), sum = (o) => Object.values(o).reduce((a, x) => a + x.total, 0)
  const rep = { dry, will_write: { day_nodes_max: P.days.length, session_nodes: P.fresh.length, existing_sessions_tagged_garmin_id: P.dups.length }, before_totals: { nodes: sum(before.nodes), edges: sum(before.edges) } }
  if (dry) return rep
  db.exec('CREATE TABLE IF NOT EXISTS graph_snapshot (at TEXT PRIMARY KEY, phase TEXT, body TEXT)'); db.prepare('INSERT OR REPLACE INTO graph_snapshot VALUES (?,?,?)').run(new Date().toISOString(), 'before', JSON.stringify(before))
  const log = {}
  for (const c of chunk(rows(P.days), 150)) await cypher(Q.days, { rows: c }, opts)
  const pairs = P.days.slice(0, -1).map((d, i) => ({ a: d.date, b: P.days[i + 1].date })); pairs.push({ a: P.days.at(-1).date, b: CANON_CUTOFF })
  for (const c of chunk(pairs, 200)) await cypher(Q.chain, { rows: c }, opts)
  for (const c of chunk(rows(P.fresh), 100)) await cypher(Q.sessions, { rows: c }, opts)
  for (const c of chunk(rows(P.dups), 100)) await cypher(Q.dups, { rows: c }, opts)
  const after = await snapshot(opts); db.prepare('INSERT OR REPLACE INTO graph_snapshot VALUES (?,?,?)').run(new Date().toISOString(), 'after', JSON.stringify(after))
  // live (non-era) nodes and edges must be unchanged in count
  const bad = []; for (const [l, v] of Object.entries(before.nodes)) if ((after.nodes[l]?.total ?? 0) - (after.nodes[l]?.hist ?? 0) !== v.total - v.hist) bad.push('node:' + l)
  for (const [t, v] of Object.entries(before.edges)) if ((after.edges[t]?.total ?? 0) - (after.edges[t]?.hist ?? 0) !== v.total - v.hist) bad.push('edge:' + t)
  return { ...rep, after_totals: { nodes: sum(after.nodes), edges: sum(after.edges) }, live_counts_unchanged: bad.length === 0, changed: bad, added: { nodes: Object.fromEntries(Object.entries(after.nodes).filter(([, v]) => v.hist).map(([l, v]) => [l, v.hist])), edges: Object.fromEntries(Object.entries(after.edges).filter(([, v]) => v.hist).map(([t, v]) => [t, v.hist])) } }
}

// full reversal of this stage
export async function rollback({ opts = {} } = {}) {
  await cypher('MATCH ()-[r {era: "garmin_hist"}]->() DELETE r', {}, opts)
  await cypher('MATCH (n {era: "garmin_hist"}) DETACH DELETE n', {}, opts)
  await cypher('MATCH (s:Session) WHERE s.garmin_id IS NOT NULL AND s.era IS NULL REMOVE s.garmin_id', {}, opts)
  return snapshot(opts)
}

// WORE edges for the historical sessions (shoe from Strava, see shoes.js). Existing Shoe nodes only; tagged era='garmin_hist'; MERGE (idempotent).
export async function wore({ dry = true, opts = {}, idb = openIntel() } = {}) {
  const rows = idb.prepare("SELECT label_id, shoe_id FROM fit_session_hist WHERE shoe_id IS NOT NULL AND dup_of IS NULL AND date < ?").all(CANON_CUTOFF).map((r) => ({ label_id: r.label_id, gear_id: String(r.shoe_id) }))
  const shoes = new Set((await cypher('MATCH (sh:Shoe) RETURN sh.gear_id', {}, opts)).map((x) => String(x[0]))), ok = rows.filter((r) => shoes.has(r.gear_id))
  const rep = { dry, candidates: rows.length, with_existing_shoe_node: ok.length, missing_shoe_nodes: [...new Set(rows.filter((r) => !shoes.has(r.gear_id)).map((r) => r.gear_id))] }
  if (dry) return rep
  for (const c of chunk(ok, 100)) await cypher('UNWIND $rows AS r MATCH (s:Session {label_id: r.label_id, era: "garmin_hist"}), (sh:Shoe {gear_id: r.gear_id}) MERGE (s)-[x:WORE]->(sh) ON CREATE SET x.era = "garmin_hist"', { rows: c }, opts)
  const n = await cypher('MATCH (:Session {era: "garmin_hist"})-[x:WORE]->(:Shoe) RETURN count(x)', {}, opts)
  return { ...rep, wore_edges_hist: n[0][0] }
}
