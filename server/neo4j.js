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

export async function run(statement, { fetchFn = fetch, env = neoEnv() } = {}) {
  const r = await fetchFn(`https://${hostOf(env.uri)}/db/${encodeURIComponent(env.db)}/query/v2`, {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${env.user}:${env.pass}`).toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ statement }), signal: AbortSignal.timeout(1500) })
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
