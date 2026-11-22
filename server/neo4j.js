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

// ---- live graph for the Knowledge Graph screen: a bounded sample of the REAL graph, from fixed queries (the browser only picks a view name).
// Each node is flattened to (label, key, name) with the key property of its label; health-derived labels exist only when NEO4J_SYNC_HEALTH=1 on the Go side.
const KEY = "coalesce(toString(n.label_id), toString(n.date), toString(n.gear_id), toString(n.race_id), toString(n.id), toString(n.site))"
const NAME = "coalesce(n.title, n.model, n.name, toString(n.date), toString(n.label_id), toString(n.id))"
const nk = (v) => KEY.replaceAll('n.', v + '.'), nn = (v) => NAME.replaceAll('n.', v + '.')
const REL = "['HAS_SESSION','WORE','IN_WEATHER','ATTEMPT_OF','PRODUCED','SIMILAR_TO','CONTRADICTS','SUPERSEDES','NEXT_DAY','LOGGED_PAIN']"
export const LIVE_MAX = { nodes: 160, edges: 420 }
export const LIVE_VIEWS = {
  // newest 30 sessions with everything one hop away
  sessions: `MATCH (a:Session) WITH a ORDER BY a.date DESC LIMIT 30 MATCH (a)-[r]-(n) WHERE type(r) IN ${REL} RETURN labels(a)[0], ${nk('a')}, ${nn('a')}, type(r), startNode(r) = a, labels(n)[0], ${nk('n')}, ${nn('n')} LIMIT ${LIVE_MAX.edges}`,
  // the newest 60 active memories and how they connect (what produced them, what they supersede or contradict)
  memory: `MATCH (a:Memory) WHERE a.status = 'active' AND a.source <> 'kb' WITH a ORDER BY a.valid_from DESC LIMIT 60 OPTIONAL MATCH (a)-[r:PRODUCED|SUPERSEDES|CONTRADICTS]-(n) RETURN labels(a)[0], ${nk('a')}, ${nn('a')}, type(r), startNode(r) = a, labels(n)[0], ${nk('n')}, ${nn('n')} LIMIT ${LIVE_MAX.edges}`,
  // the last 3 weeks as a chain of days with their sessions
  days: `MATCH (a:Day) WITH a ORDER BY a.date DESC LIMIT 21 OPTIONAL MATCH (a)-[r:NEXT_DAY|HAS_SESSION|LOGGED_PAIN]-(n) RETURN labels(a)[0], ${nk('a')}, ${nn('a')}, type(r), startNode(r) = a, labels(n)[0], ${nk('n')}, ${nn('n')} LIMIT ${LIVE_MAX.edges}`,
  // races, rules and shoes with their sessions
  context: `MATCH (a) WHERE a:Race OR a:Rule OR a:Shoe WITH a LIMIT 40 OPTIONAL MATCH (a)-[r:ATTEMPT_OF|WORE|SUPERSEDES]-(n) RETURN labels(a)[0], ${nk('a')}, ${nn('a')}, type(r), startNode(r) = a, labels(n)[0], ${nk('n')}, ${nn('n')} LIMIT ${LIVE_MAX.edges}`,
}
// rows → { nodes, edges, truncated }; pure so it can be tested without a database
export function toGraph(rows) {
  const nodes = new Map(), edges = [], seen = new Set(), add = (label, key, name) => { if (key == null || label == null) return null; const id = `${label}:${key}`; if (!nodes.has(id) && nodes.size < LIVE_MAX.nodes) nodes.set(id, { id, label, name: String(name ?? key).slice(0, 80) }); return nodes.has(id) ? id : null }
  for (const [al, ak, an, rt, out, bl, bk, bn] of rows || []) {
    const a = add(al, ak, an); if (!a) continue
    if (rt == null) continue
    const b = add(bl, bk, bn); if (!b) continue
    const [from, to] = out ? [a, b] : [b, a], k = `${from}|${rt}|${to}`
    if (!seen.has(k)) { seen.add(k); edges.push({ from, to, type: rt }) }
  }
  return { nodes: [...nodes.values()], edges, truncated: rows?.length >= LIVE_MAX.edges || nodes.size >= LIVE_MAX.nodes }
}
export async function live(view, opts = {}) {
  const env = opts.env || neoEnv(); if (!configured(env)) return { connected: false, nodes: [], edges: [] }
  const v = Object.hasOwn(LIVE_VIEWS, view) ? view : 'sessions'
  try { const j = await run(LIVE_VIEWS[v], { ...opts, env, timeout: 8000 }); return { connected: true, view: v, ...toGraph(j?.data?.values) } }
  catch (err) { return { connected: false, view: v, error: err.message, nodes: [], edges: [] } }
}
