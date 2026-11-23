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

export async function run(statement, { fetchFn = fetch, env = neoEnv(), timeout = 1500, params } = {}) {
  const r = await fetchFn(`https://${hostOf(env.uri)}/db/${encodeURIComponent(env.db)}/query/v2`, {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${env.user}:${env.pass}`).toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params ? { statement, parameters: params } : { statement }), signal: AbortSignal.timeout(timeout) })
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
const KEY = (v) => `coalesce(CASE WHEN ${v}.metric IS NOT NULL OR ${v}.is_pb IS NOT NULL OR ${v}.url IS NOT NULL OR ${v}.pr_rank IS NOT NULL THEN toString(${v}.id) END, toString(${v}.label_id), toString(${v}.date), toString(${v}.gear_id), toString(${v}.race_id), toString(${v}.id), toString(${v}.site), toString(${v}.name))`
const P = (v) => `labels(${v})[0], ${KEY(v)}, coalesce(CASE WHEN ${v}.metric IS NOT NULL THEN ${v}.metric + ' ' + toString(${v}.value) END, CASE WHEN ${v}.is_pb IS NOT NULL THEN ${v}.label END, ${v}.intent + ' · ' + ${v}.day, ${v}.title, ${v}.model, ${v}.name, ${v}.label, toString(${v}.date), toString(${v}.label_id), toString(${v}.id)), coalesce(${v}.date, ${v}.day, ${v}.valid_from), ${v}.ef, coalesce(${v}.tl, ${v}.planned_tl), ${v}.wbgt`
const ROW = (a, n) => `RETURN ${P(a)}, type(r), startNode(r) = ${a}, ${P(n)}`
const REL = "['HAS_SESSION','WORE','IN_WEATHER','IN_BAND','ATTEMPT_OF','PRODUCED','SIMILAR_TO','CONTRADICTS','SUPERSEDES','NEXT_DAY','LOGGED_PAIN','ABOUT','HAS_WORKOUT','PRECEDED','RETRIEVED','CITED','WRITTEN_BY','REVIEWED','PLANS','EXECUTED_AS','RELATED_TO']"
export const LIVE_MAX = { nodes: 220, edges: 460 }
// the default views always carry EVERY race (with the session that was run), so the picture is not limited to the races of the newest runs
export const RACES_ALWAYS = `MATCH (a:Race) OPTIONAL MATCH (a)-[r:ATTEMPT_OF]-(n:Session) ${'RETURN '}${P('a')}, type(r), startNode(r) = a, ${P('n')} LIMIT 120`
const PERF_EXTRA = [
  `MATCH (a:PerfDomain)-[r:PART_OF]->(n:PerfDomain) ${ROW('a', 'n')}`,
  `MATCH (a:PB)-[r:ACHIEVED_IN]->(n:Session) ${ROW('a', 'n')} LIMIT 50`,
  `MATCH (a:PB {source: 'strava'})-[r:SET_IN]->(n:Race) ${ROW('a', 'n')} LIMIT 20`,
  `MATCH (a:PB {source: 'strava'})-[r:FROM_ACTIVITY]->(n:StravaActivity) ${ROW('a', 'n')} LIMIT 20`,
  `MATCH (a:StravaActivity)-[r:SAME_RUN_AS|RACE_DAY|WORE]->(n) ${ROW('a', 'n')} LIMIT 30`,
  `MATCH (a:Effort)-[r:BEST_OF]->(n:StravaActivity) ${ROW('a', 'n')} LIMIT 60`,
  `MATCH (a:PerfPoint {metric: 'vdot_line'})-[r:OF_DOMAIN]->(n:PerfDomain) ${ROW('a', 'n')} LIMIT 24`,
  `MATCH (a:Race)-[r:IMPLIES]->(n:PerfPoint) ${ROW('a', 'n')} LIMIT 30`,
  `MATCH (a:PerfDomain)-[r:TARGETS]->(n:Entity) ${ROW('a', 'n')}`,
  // enrichment (each is bounded; anchorGraph ties what is returned to the domain it informs)
  `MATCH (a:Session)-[r:WORE]->(n:Shoe) ${ROW('a', 'n')} LIMIT 24`,
  `MATCH (a:Weather)-[r:IN_BAND]->(n:HeatBand) ${ROW('a', 'n')} LIMIT 16`,
  `MATCH (a:Topic) OPTIONAL MATCH (a)-[r:NO_SUCH_LINK]-(n) ${ROW('a', 'n')} LIMIT 30`,   // every topic as a node of its own
  `MATCH (a:Topic) CALL { WITH a MATCH (a)<-[r:ABOUT]-(n:Memory) WHERE n.status = 'active' RETURN r, n ORDER BY n.valid_from DESC LIMIT 2 } ${ROW('a', 'n')} LIMIT 40`,
  `MATCH (a:Rule) WHERE a.locked = true OPTIONAL MATCH (a)-[r:SUPERSEDES]-(n) ${ROW('a', 'n')} LIMIT 20`,
  `MATCH (a:Checkpoint)-[r]-(n:Race) ${ROW('a', 'n')} LIMIT 20`,
]
// the hub and its six domains, so any view that shows races, personal bests or sessions can be tied to PERFORMANCE
const SKELETON = `MATCH (a:PerfDomain)-[r:PART_OF]->(n:PerfDomain) ${ROW('a', 'n')}`
const EXTRA = { sessions: [RACES_ALWAYS], days: [RACES_ALWAYS], performance: PERF_EXTRA, races: [SKELETON], context: [SKELETON] }
const CAPS = { performance: { Memory: 10, Effort: 12, PerfPoint: 48, Weather: 8, Session: 26, PB: 24, Km: 0, Lap: 0 } }
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
  memory: `MATCH (a:Memory) WHERE a.status = 'active' AND a.source <> 'kb' WITH a ORDER BY a.valid_from DESC LIMIT 60 OPTIONAL MATCH (a)-[r:PRODUCED|SUPERSEDES|CONTRADICTS|RELATED_TO|ABOUT|WRITTEN_BY]-(n) ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // the last 3 weeks that have training, as a chain of days with their sessions and workouts (future plan days have none)
  days: `MATCH (a:Day) WHERE EXISTS { (a)-[:HAS_SESSION|HAS_WORKOUT]->() } WITH a ORDER BY a.date DESC LIMIT 21 OPTIONAL MATCH (a)-[r:NEXT_DAY|HAS_SESSION|HAS_WORKOUT|LOGGED_PAIN]-(n) ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // PERFORMANCE (the main focus): the hub, its six domains, the newest observations of each (VDOT, COROS fitness, cardio, durability, speed, load) and where they connect
  performance: `MATCH (a:PerfDomain) CALL { WITH a MATCH (a)<-[r:OF_DOMAIN]-(n) WHERE n.date IS NULL OR n.date <= toString(date()) RETURN r, n ORDER BY n.date DESC LIMIT 12 } ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // EVERY race: the canonical races and every ledger entry (04.1), with the session that was run, the event, the ledger link and the next race
  races: `MATCH (a) WHERE a:Race OR a:RaceEntry WITH a ORDER BY a.date DESC LIMIT 80 OPTIONAL MATCH (a)-[r:ATTEMPT_OF|LEDGER_OF|DONE_AS|OF_EVENT|NEXT_RACE]-(n) ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
  // races, rules and shoes (races first) with a few of their sessions each, so no single shoe floods the picture
  context: `MATCH (a) WHERE a:Race OR a:Rule OR a:Shoe WITH a ORDER BY CASE WHEN a:Race THEN 0 WHEN a:Rule THEN 1 ELSE 2 END LIMIT 40 CALL { WITH a OPTIONAL MATCH (a)-[r:ATTEMPT_OF|WORE|SUPERSEDES]-(n) RETURN r, n ORDER BY n.date DESC LIMIT 6 } ${ROW('a', 'n')} LIMIT ${LIVE_MAX.edges}`,
}
// rows → { nodes, edges, truncated }; pure so it can be tested without a database. Row = [label, key, name, date, ef, tl, wbgt, relType, outgoing, label, key, name, date, ef, tl, wbgt]
// `caps` = most nodes one label may add ({Memory: 12}), so a label with thousands of rows cannot crowd the others out of the node budget
export function toGraph(rows, { caps = {} } = {}) {
  const nodes = new Map(), edges = [], seen = new Set(), used = {}
  const add = (label, key, name, date, ef, tl, wbgt) => { if (key == null || label == null) return null; const id = `${label}:${key}`
    if (!nodes.has(id) && nodes.size < LIVE_MAX.nodes && (used[label] || 0) < (caps[label] ?? Infinity)) used[label] = (used[label] || 0) + 1
    else if (!nodes.has(id)) return null
    if (!nodes.has(id)) nodes.set(id, { id, label, name: String(name ?? key).slice(0, 80), date: date ? String(date).slice(0, 10) : null, ef: ef ?? null, tl: tl ?? null, wbgt: wbgt ?? null })
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
// ---- anchoring to the performance hub (pure). The stored graph links a race to performance only when it implies a VDOT, so DNFs, 5Ks, trail runs and ultras float free, and most
// personal bests and sessions sit several hops away. For every node that does not reach the hub, add ONE derived link to the domain it informs. Derived links are marked
// (derived: true, with the reason) so the page can draw them differently; they are rules over the name / metrics, never stored in Neo4j. Nodes that still cannot be tied
// to performance are listed in `unlinked` so the page can hide them instead of drawing stray dots.
export const HUB = 'PerfDomain:performance'
const ENRICHABLE = new Set(['Race', 'PB', 'Session', 'Shoe', 'Weather', 'HeatBand', 'WeatherHour', 'PlanDay', 'TrainWeek', 'Week', 'Workout', 'Checkpoint', 'Topic', 'Rule'])
// only the views where performance IS the point: the session / day / memory views are about something else and keep their own layout
export const ANCHORED_VIEWS = new Set(['performance', 'races', 'context'])
const DOMAIN = { vdot: 'PerfDomain:vdot', fitness: 'PerfDomain:running_fitness', cardio: 'PerfDomain:cardio', durability: 'PerfDomain:durability', speed: 'PerfDomain:speed', load: 'PerfDomain:load' }
export function raceDomain(name) {
  const n = String(name || ''), half = /\b(HM|half)\b/i.test(n), full = /\b(FM|marathon)\b/i.test(n) && !half, km = /\b(\d{1,3}(?:\.\d)?)\s?K\b/i.exec(n), long = half || full || /ultra|trail/i.test(n) || (km && +km[1] > 10.5)
  return long ? { to: DOMAIN.durability, why: 'a long race (half, full, ultra or trail) tests durability' } : { to: DOMAIN.speed, why: 'a short race (10K or less) tests speed' }
}
// words in a topic / rule / week name → the domain it informs (first match wins; no match = not tied, reported as unlinked)
const NAME_DOMAIN = [[/vdot|goal|target|sub-?4|race pred/i, 'vdot'], [/fade|gct|stride|durab|long run|fuel|cramp|walk/i, 'durability'], [/hrv|rhr|resting|heart|\bef\b|efficien|heat|wbgt|weather|humid|sleep|cardiac|drift/i, 'cardio'],
  [/pace|speed|interval|tempo|threshold|thr_|sprint|vo2/i, 'speed'], [/ctl|fitness|taper|peak/i, 'fitness'], [/load|volume|\btl\b|km|week|strength|gym|plan|injur|pain|shoe|rest|recover/i, 'load']]
const nameDomain = (name) => { for (const [re, k] of NAME_DOMAIN) if (re.test(String(name || ''))) return k; return null }
export function enrichDomain(n) {
  switch (n.label) {
    case 'Race': return raceDomain(n.name)
    case 'PB': return { to: DOMAIN.speed, why: 'a personal best is a speed result' }
    case 'Session': return n.ef != null ? { to: DOMAIN.cardio, why: 'the session carries a running-efficiency reading' } : n.tl != null ? { to: DOMAIN.load, why: 'the session carries a training load' } : null
    case 'Shoe': return { to: DOMAIN.load, why: 'shoe mileage is the load a pair has carried' }
    case 'Weather': case 'HeatBand': case 'WeatherHour': return { to: DOMAIN.cardio, why: 'heat and humidity raise heart rate and lower running efficiency' }
    case 'PlanDay': case 'TrainWeek': case 'Week': case 'Workout': return { to: DOMAIN.load, why: 'planned and done training is the load input' }
    case 'Checkpoint': return { to: DOMAIN.durability, why: 'a race checkpoint shows how the pace held over distance' }
    case 'Topic': case 'Rule': { const k = nameDomain(n.name); return k ? { to: DOMAIN[k], why: `the ${n.label.toLowerCase()} is about ${k === 'fitness' ? 'running fitness' : k}` } : null }
    default: return null
  }
}
// the domains themselves feed each other: load builds fitness, and a race or best effort sets the VDOT
const DOMAIN_LINKS = [[DOMAIN.load, DOMAIN.fitness, 'training load builds running fitness'], [DOMAIN.speed, DOMAIN.vdot, 'race and best-effort results set the VDOT']]
export function anchorGraph(g) {
  if (!g?.nodes?.some((n) => ENRICHABLE.has(n.label)) || !g.nodes.some((n) => n.id === HUB)) return { ...g, hub: null, unlinked: [] }
  const ids = new Set(g.nodes.map((n) => n.id)), reach = (edges) => { const adj = new Map(); for (const e of edges) { (adj.get(e.from) || adj.set(e.from, []).get(e.from)).push(e.to); (adj.get(e.to) || adj.set(e.to, []).get(e.to)).push(e.from) }
    const seen = new Set([HUB]), q = [HUB]; while (q.length) { const x = q.shift(); for (const y of adj.get(x) || []) if (!seen.has(y)) { seen.add(y); q.push(y) } } return seen }
  const before = reach(g.edges), edges = [...g.edges]
  for (const n of g.nodes) {
    if (before.has(n.id)) continue
    const d = enrichDomain(n)
    if (d && ids.has(d.to)) edges.push({ from: n.id, to: d.to, type: 'INFORMS', derived: true, why: d.why })
  }
  for (const [a, b, why] of DOMAIN_LINKS) if (ids.has(a) && ids.has(b) && !edges.some((e) => e.from === a && e.to === b)) edges.push({ from: a, to: b, type: 'INFORMS', derived: true, why })
  const after = reach(edges)
  return { ...g, edges, hub: HUB, unlinked: g.nodes.filter((n) => !after.has(n.id)).map((n) => n.id) }
}
export async function live(view, opts = {}) {
  const env = opts.env || neoEnv(); if (!configured(env)) return { connected: false, nodes: [], edges: [] }
  const v = Object.hasOwn(LIVE_VIEWS, view) ? view : 'performance'
  try {
    const [j, ...extra] = await Promise.all([run(LIVE_VIEWS[v], { ...opts, env, timeout: 8000 }), ...(EXTRA[v] || []).map((q) => run(q, { ...opts, env, timeout: 8000 }).catch(() => null))])
    const g = toGraph([...extra.flatMap((x) => x?.data?.values || []), ...(j?.data?.values || [])], { caps: CAPS[v] })
    return { connected: true, view: v, ...(ANCHORED_VIEWS.has(v) ? anchorGraph(g) : g) }
  }
  catch (err) { return { connected: false, view: v, error: err.message, nodes: [], edges: [] } }
}

// ---- expand one node: its direct neighbours (bounded), read-only, with the node chosen by label + key as PARAMETERS (never spliced into the Cypher).
// New nodes are tied to the performance domains with the same derived links as anchorGraph, so an expanded node never floats loose.
export async function expand(label, key, opts = {}) {
  const env = opts.env || neoEnv(); if (!configured(env)) return { connected: false, nodes: [], edges: [] }
  if (!/^[A-Za-z]{2,24}$/.test(String(label || '')) || !String(key ?? '').length || String(key).length > 120) return { connected: true, nodes: [], edges: [], error: 'bad node id' }
  try {
    const j = await run(`MATCH (a) WHERE labels(a)[0] = $label AND ${KEY('a')} = $key MATCH (a)-[r]-(n) WHERE type(r) IN ${REL} ${ROW('a', 'n')} LIMIT 60`, { ...opts, env, timeout: 8000, params: { label, key: String(key) } })
    const g = toGraph(j?.data?.values || []), have = new Set(g.nodes.map((n) => n.id)), edges = [...g.edges]
    for (const n of g.nodes) { const d = enrichDomain(n); if (d && n.label !== 'PerfDomain') edges.push({ from: n.id, to: d.to, type: 'INFORMS', derived: true, why: d.why }) }
    return { connected: true, center: `${label}:${key}`, nodes: g.nodes, edges: edges.filter((e) => have.has(e.from) || have.has(e.to)), truncated: g.truncated }
  } catch (err) { return { connected: false, error: err.message, nodes: [], edges: [] } }
}
