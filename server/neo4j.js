// Read-only views of the Neo4j AuraDB knowledge graph for the UI. One place that reads the connection settings (process env first, then NEO4J_* in
// /opt/lumpad/.env.v2, cached for a minute) and one fixed list of queries: the browser can only pick a name from that list, never send Cypher.
import fs from 'node:fs'

let cache = null
export function neoEnv({ file = process.env.LUMPAD_ENV_V2 || '/opt/lumpad/.env.v2', now = Date.now() } = {}) {
  if (cache && now - cache.at < 60e3 && cache.file === file) return cache.v
  const v = { uri: process.env.NEO4J_URI, user: process.env.NEO4J_USER, pass: process.env.NEO4J_PASSWORD, db: process.env.NEO4J_DATABASE || 'neo4j' }
  if (!(v.uri && v.user && v.pass)) {
    let raw = ''; try { raw = fs.readFileSync(file, 'utf8') } catch {}
    for (const l of raw.split(/\r?\n/)) {
      const m = /^(NEO4J_(?:URI|USER|PASSWORD|DATABASE))=(.*)$/.exec(l.trim()); if (!m) continue
      const x = m[2].trim().replace(/^["']|["']$/g, '')
      if (m[1] === 'NEO4J_URI') v.uri = x; else if (m[1] === 'NEO4J_USER') v.user = x; else if (m[1] === 'NEO4J_PASSWORD') v.pass = x; else v.db = x || 'neo4j'
    }
  }
  cache = { at: now, file, v }; return v
}
export const resetEnvCache = () => { cache = null }
export const configured = (e = neoEnv()) => !!(e.uri && e.user && e.pass)
const hostOf = (uri) => uri.replace(/^(?:neo4j\+s|neo4j\+ssc|bolt\+s|bolt\+ssc|neo4j|bolt|https?):\/\//, '').split('/')[0]

export async function run(statement, { fetchFn = fetch, env = neoEnv(), timeout = 1500 } = {}) {
  const r = await fetchFn(`https://${hostOf(env.uri)}/db/${encodeURIComponent(env.db)}/query/v2`, {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${env.user}:${env.pass}`).toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ statement }), signal: AbortSignal.timeout(timeout) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

// pain / health views are not offered: that data is only in the graph when NEO4J_SYNC_HEALTH=1 on the Go side
export const QUERIES = {
  races: 'MATCH (r:Race)<-[:ATTEMPT_OF]-(s:Session) RETURN r.name, r.date, round(s.run_share*100), s.onset_km, r.status ORDER BY r.date DESC LIMIT 6',
  shoes: 'MATCH (s:Session)-[:WORE]->(sh:Shoe) RETURN sh.model, count(s), round(avg(s.ef)*1000)/1000, round(avg(s.run_share)*100) ORDER BY count(s) DESC LIMIT 6',
  rules: 'MATCH (rl:Rule) RETURN rl.id, rl.title, rl.locked ORDER BY rl.locked DESC, rl.id LIMIT 8',
  pain: 'MATCH (d:Day)-[p:LOGGED_PAIN]->(ps:PainSite) RETURN d.date, ps.site, p.score ORDER BY d.date DESC LIMIT 6',
}
export async function node(kind, opts = {}) {
  const env = opts.env || neoEnv(); if (!configured(env)) return { connected: false, rows: [] }
  const k = Object.hasOwn(QUERIES, kind) ? kind : 'races'
  try { const j = await run(QUERIES[k], { ...opts, env }); return { connected: true, kind: k, fields: j?.data?.fields || [], rows: j?.data?.values || [] } }
  catch (err) { return { connected: false, kind: k, error: err.message, rows: [] } }
}
export async function overview(opts = {}) {
  const env = opts.env || neoEnv(); const empty = { nodes: {}, edges: {}, total_nodes: 0, total_edges: 0 }
  if (!configured(env)) return { configured: false, connected: false, ...empty }
  try {
    const [rn, re] = await Promise.all([run('MATCH (n) RETURN labels(n)[0] AS lbl, count(n) AS cnt', { ...opts, env }), run('MATCH ()-[r]->() RETURN type(r) AS rel, count(r) AS cnt', { ...opts, env })])
    const nodes = {}, edges = {}; let total_nodes = 0, total_edges = 0
    for (const [k, v] of rn?.data?.values || []) if (k) { nodes[k] = Number(v) || 0; total_nodes += nodes[k] }
    for (const [k, v] of re?.data?.values || []) if (k) { edges[k] = Number(v) || 0; total_edges += edges[k] }
    return { configured: true, connected: true, nodes, edges, total_nodes, total_edges }
  } catch (err) { return { configured: true, connected: false, error: err.message, ...empty } }
}

// ---- live graph for the Knowledge Graph screen: a bounded sample of the REAL graph, from fixed read-only queries (the browser only picks a view name).
// Each endpoint is flattened to (label, key, name, date, ef, tl, wbgt): the properties the page can colour by. Health-derived labels exist only when NEO4J_SYNC_HEALTH=1 on the Go side.
const P = (v) => `labels(${v})[0], coalesce(toString(${v}.label_id), toString(${v}.date), toString(${v}.gear_id), toString(${v}.race_id), toString(${v}.id), toString(${v}.site), toString(${v}.name)), coalesce(${v}.intent + ' · ' + ${v}.day, ${v}.title, ${v}.model, ${v}.name, ${v}.label, toString(${v}.date), toString(${v}.label_id), toString(${v}.id)), coalesce(${v}.date, ${v}.day, ${v}.valid_from), ${v}.ef, coalesce(${v}.tl, ${v}.planned_tl), ${v}.wbgt`
const ROW = (a, n) => `RETURN ${P(a)}, type(r), startNode(r) = ${a}, ${P(n)}`
const REL = "['HAS_SESSION','WORE','IN_WEATHER','IN_BAND','ATTEMPT_OF','PRODUCED','SIMILAR_TO','CONTRADICTS','SUPERSEDES','NEXT_DAY','LOGGED_PAIN','ABOUT','HAS_WORKOUT','PRECEDED','RETRIEVED','CITED','WRITTEN_BY','REVIEWED','PLANS','EXECUTED_AS']"
export const LIVE_MAX = { nodes: 160, edges: 420 }
export const LIVE_VIEWS = {
  // newest 30 sessions with everything one hop away
  sessions: `MATCH (a:Session) WITH a ORDER BY a.date DESC LIMIT 30 MATCH (a)-[r]-(n) WHERE type(r) IN ${REL} ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // the vocabulary that ties the knowledge base to your training: topics with their newest memories and sessions
  topics: `MATCH (a:Topic) CALL { WITH a MATCH (a)<-[r:ABOUT]-(n) RETURN r, n ORDER BY coalesce(n.date, n.valid_from) DESC LIMIT 12 } ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // strength sessions in the 72 h before a run, with the run they preceded (hours on the edge)
  chains: `MATCH (a:Workout {strength: true})-[r:PRECEDED]->(n:Session) WITH a, r, n ORDER BY n.date DESC LIMIT 70 ${ROW('a', 'n')}`,
  // what the coach used: the newest runs and the memories / sessions they retrieved, cited, wrote or reviewed
  trace: `MATCH (a:CoachRun) WITH a ORDER BY a.day DESC LIMIT 6 CALL { WITH a MATCH (a)-[r]-(n) WHERE type(r) IN ['CITED','REVIEWED','WRITTEN_BY','RETRIEVED'] RETURN r, n ORDER BY CASE type(r) WHEN 'CITED' THEN 0 WHEN 'REVIEWED' THEN 1 WHEN 'WRITTEN_BY' THEN 2 ELSE 3 END LIMIT 24 } ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // planned days against what was done
  plan: `MATCH (a:PlanDay) WITH a ORDER BY a.date DESC LIMIT 28 OPTIONAL MATCH (a)-[r:EXECUTED_AS|PLANS]->(n) ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // the newest 60 active memories and how they connect
  memory: `MATCH (a:Memory) WHERE a.status = 'active' AND a.source <> 'kb' WITH a ORDER BY a.valid_from DESC LIMIT 60 OPTIONAL MATCH (a)-[r:PRODUCED|SUPERSEDES|CONTRADICTS|ABOUT|WRITTEN_BY]-(n) ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // the last 3 weeks that have training, as a chain of days with their sessions and workouts (future plan days have none)
  days: `MATCH (a:Day) WHERE EXISTS { (a)-[:HAS_SESSION|HAS_WORKOUT]->() } WITH a ORDER BY a.date DESC LIMIT 21 OPTIONAL MATCH (a)-[r:NEXT_DAY|HAS_SESSION|HAS_WORKOUT|LOGGED_PAIN]-(n) ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // races, rules and shoes (races first) with a few of their sessions each, so no single shoe floods the picture
  context: `MATCH (a) WHERE a:Race OR a:Rule OR a:Shoe WITH a ORDER BY CASE WHEN a:Race THEN 0 WHEN a:Rule THEN 1 ELSE 2 END LIMIT 40 CALL { WITH a OPTIONAL MATCH (a)-[r:ATTEMPT_OF|WORE|SUPERSEDES]-(n) RETURN r, n ORDER BY n.date DESC LIMIT 6 } ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
}
// rows → { nodes, edges, truncated }; pure so it can be tested without a database. Row = [label, key, name, date, ef, tl, wbgt, relType, outgoing, label, key, name, date, ef, tl, wbgt]
export function toGraph(rows) {
  const nodes = new Map(), edges = [], seen = new Set()
  const add = (label, key, name, date, ef, tl, wbgt) => { if (key == null || label == null) return null; const id = `${label}:${key}`
    if (!nodes.has(id) && nodes.size < LIVE_MAX.nodes) nodes.set(id, { id, label, name: String(name ?? key).slice(0, 80), date: date ? String(date).slice(0, 10) : null, ef: ef ?? null, tl: tl ?? null, wbgt: wbgt ?? null })
    return nodes.has(id) ? id : null }
  for (const r of rows || []) {
    const a = add(r[0], r[1], r[2], r[3], r[4], r[5], r[6]); if (!a) continue
    const rt = r[7]; if (rt == null) continue
    const b = add(r[9], r[10], r[11], r[12], r[13], r[14], r[15]); if (!b) continue
    const [from, to] = r[8] ? [a, b] : [b, a], k = `${from}|${rt}|${to}`
    if (!seen.has(k)) { seen.add(k); edges.push({ from, to, type: rt }) }
  }
  return { nodes: [...nodes.values()], edges, truncated: (rows?.length || 0) >= LIVE_MAX.edges || nodes.size >= LIVE_MAX.nodes }
}
export async function live(view, opts = {}) {
  const env = opts.env || neoEnv(); if (!configured(env)) return { connected: false, nodes: [], edges: [] }
  const v = Object.hasOwn(LIVE_VIEWS, view) ? view : 'sessions'
  try { const j = await run(LIVE_VIEWS[v], { ...opts, env, timeout: 8000 }); return { connected: true, view: v, ...toGraph(j?.data?.values) } }
  catch (err) { return { connected: false, view: v, error: err.message, nodes: [], edges: [] } }
}
