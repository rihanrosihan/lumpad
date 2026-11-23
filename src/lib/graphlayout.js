// Small deterministic force layout for the live knowledge graph (≤ ~160 nodes): repulsion between all nodes, springs along edges, gentle gravity, cooling.
// Pure: same input → same positions, so the picture does not jump between renders.
export function layout(nodes, edges, { W = 760, H = 420, pad = 18, iters = 160 } = {}) {
  const n = nodes.length; if (!n) return {}
  const idx = new Map(nodes.map((d, i) => [d.id, i])), E = edges.map((e) => [idx.get(e.from), idx.get(e.to)]).filter(([a, b]) => a != null && b != null && a !== b)
  const x = new Float64Array(n), y = new Float64Array(n), dx = new Float64Array(n), dy = new Float64Array(n)
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI, r = Math.min(W, H) * (0.18 + 0.22 * ((i * 7919) % 13) / 13); x[i] = W / 2 + r * Math.cos(a); y[i] = H / 2 + r * Math.sin(a) }
  const k = Math.sqrt((W * H) / (n + 4)) * 0.62
  for (let it = 0; it < iters; it++) {
    dx.fill(0); dy.fill(0); const t = 1 - it / iters
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { let ux = x[i] - x[j], uy = y[i] - y[j], d2 = ux * ux + uy * uy; if (d2 < 0.01) { ux = (i - j) * 0.1; uy = 0.1; d2 = ux * ux + uy * uy } const d = Math.sqrt(d2), f = (k * k) / d; dx[i] += (ux / d) * f; dy[i] += (uy / d) * f; dx[j] -= (ux / d) * f; dy[j] -= (uy / d) * f }
    for (const [a, b] of E) { const ux = x[a] - x[b], uy = y[a] - y[b], d = Math.sqrt(ux * ux + uy * uy) || 0.01, f = (d * d) / k; dx[a] -= (ux / d) * f; dy[a] -= (uy / d) * f; dx[b] += (ux / d) * f; dy[b] += (uy / d) * f }
    for (let i = 0; i < n; i++) {
      dx[i] += (W / 2 - x[i]) * 0.06; dy[i] += (H / 2 - y[i]) * 0.06
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 0.01, m = Math.min(d, 38 * t + 2); x[i] += (dx[i] / d) * m; y[i] += (dy[i] / d) * m
      x[i] = Math.max(pad, Math.min(W - pad, x[i])); y[i] = Math.max(pad, Math.min(H - pad, y[i]))
    }
  }
  return Object.fromEntries(nodes.map((d, i) => [d.id, { x: Math.round(x[i] * 10) / 10, y: Math.round(y[i] * 10) / 10 }]))
}
export const degrees = (nodes, edges) => { const d = Object.fromEntries(nodes.map((n) => [n.id, 0])); for (const e of edges) { if (e.from in d) d[e.from]++; if (e.to in d) d[e.to]++ } return d }

// ---- view helpers for the live graph (pure, tested)
// ego network: the node and its direct neighbours, with the edges among them
export function egoGraph(g, id) {
  if (!g || !id) return g
  const keep = new Set([id]); for (const e of g.edges) { if (e.from === id) keep.add(e.to); if (e.to === id) keep.add(e.from) }
  return { ...g, nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) }
}
// ids matching a search text (name, type or date); empty text matches nothing (= no highlight)
export const matchIds = (nodes, q) => { const t = String(q || '').trim().toLowerCase(); return t ? new Set(nodes.filter((n) => `${n.name} ${n.label} ${n.date || ''}`.toLowerCase().includes(t)).map((n) => n.id)) : null }
export const dateRange = (nodes) => { const d = nodes.map((n) => n.date).filter(Boolean).sort(); return d.length ? [d[0], d.at(-1)] : null }
export const MEASURES = { recency: { label: 'Recency', get: (n) => (n.date ? Date.parse(n.date) / 864e5 : null) }, efficiency: { label: 'Running efficiency', get: (n) => n.ef }, load: { label: 'Training load', get: (n) => n.tl }, heat: { label: 'Heat (WBGT)', get: (n) => n.wbgt } }
// blue (low) → red (high) over the observed range; null = no value
export function colorScale(nodes, measure) {
  const m = MEASURES[measure]; if (!m) return () => null
  const v = nodes.map(m.get).filter((x) => x != null && isFinite(x)); if (!v.length) return () => null
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1
  return (n) => { const x = m.get(n); return x == null || !isFinite(x) ? null : `hsl(${Math.round(220 - ((x - lo) / span) * 220)} 75% 50%)` }
}

// ---- radial layout around the PERFORMANCE hub (pure, deterministic). Hub in the centre, the domains on the first ring, and everything that informs a domain in that domain's sector,
// one ring per hop (a crowded hop continues outward, so hops never overlap). Nodes that do not reach the hub are left out (reported in `lost`) unless showUnlinked asks for them on an
// outer ring. `limit` caps the evidence drawn per domain: races, personal bests and sessions come first, then the newest; whatever hangs only off a hidden node is hidden too (`hidden`).
const DOMAIN_ORDER = ['PerfDomain:vdot', 'PerfDomain:running_fitness', 'PerfDomain:cardio', 'PerfDomain:durability', 'PerfDomain:speed', 'PerfDomain:load']
const RANK = { Race: 0, PB: 1, Session: 2, StravaActivity: 3, Shoe: 4, Effort: 5, PerfPoint: 6 }
export function radialLayout(nodes, edges, hubId, { W = 760, H = 520, pad = 24, showUnlinked = false, limit = Infinity } = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n])); if (!byId.has(hubId)) return { pos: {}, depth: {}, domainOf: {}, rings: [], sectors: [], lost: nodes.map((n) => n.id), hidden: [] }
  const adj = new Map(nodes.map((n) => [n.id, []])); for (const e of edges) { adj.get(e.from)?.push(e.to); adj.get(e.to)?.push(e.from) }
  for (const a of adj.values()) a.sort()
  const depth = { [hubId]: 0 }, parent = {}, domainOf = {}, q = [hubId]
  while (q.length) { const x = q.shift(); for (const y of adj.get(x) || []) if (!(y in depth)) { depth[y] = depth[x] + 1; parent[y] = x; domainOf[y] = depth[x] === 0 ? y : domainOf[x]; q.push(y) } }
  const lost = nodes.filter((n) => !(n.id in depth)).map((n) => n.id)
  // per domain: keep the `limit` most informative evidence nodes (and the chain to the hub that each needs)
  const hidden = new Set(), groups = new Map()
  for (const n of nodes) if (n.id in depth && n.id !== hubId) (groups.get(domainOf[n.id]) || groups.set(domainOf[n.id], []).get(domainOf[n.id])).push(n)
  if (limit < Infinity) for (const [k, list] of groups) {
    const ev = list.filter((n) => n.id !== k).sort((a, b) => (RANK[a.label] ?? 7) - (RANK[b.label] ?? 7) || (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id)), keep = new Set([k])
    for (const n of ev) { if (keep.size - 1 >= limit) break; const chain = []; for (let x = n.id; x && x !== k && !keep.has(x); x = parent[x]) chain.push(x); if (keep.size - 1 + chain.length > limit && keep.size > 1) continue; chain.forEach((c) => keep.add(c)) }
    for (const n of list) if (!keep.has(n.id)) hidden.add(n.id)
  }
  const vis = (n) => n.id in depth && !hidden.has(n.id)
  for (const k of [...groups.keys()]) groups.set(k, groups.get(k).filter(vis))
  const keys = [...DOMAIN_ORDER.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !DOMAIN_ORDER.includes(k)).sort()]
  const weights = keys.map((k) => Math.sqrt(groups.get(k).length)), total = weights.reduce((a, b) => a + b, 0) || 1
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - pad - (showUnlinked ? 26 : 0), sx = (W / 2 - pad - (showUnlinked ? 26 : 0)) / R
  const first = R * 0.26, step = 15
  // radii are stacked per domain (depth 2 first, then depth 3 beyond it ...), then every radius is scaled so the outermost one fits the frame
  const raw = {}, sector = []; let maxR = first
  keys.forEach((k, i) => {
    const span = (2 * Math.PI * weights[i]) / total, arc = span * 0.9, rest = groups.get(k).filter((n) => n.id !== k), byDepth = new Map(); for (const n of rest) (byDepth.get(depth[n.id]) || byDepth.set(depth[n.id], []).get(depth[n.id])).push(n)
    let r = first + step; sector.push({ k, span })
    for (const [, list] of [...byDepth.entries()].sort((x, y) => x[0] - y[0])) {
      list.sort((x, y) => (x.date || '').localeCompare(y.date || '') || x.id.localeCompare(y.id)); let i2 = 0
      while (i2 < list.length) { const cap = Math.max(1, Math.floor((r * arc) / 15)), take = list.slice(i2, i2 + cap); take.forEach((n, j) => { raw[n.id] = { r, a: j, of: take.length, k } }); maxR = Math.max(maxR, r); i2 += take.length; r += step }
    }
  })
  const scale = maxR > R ? (R - first) / (maxR - first) : 1, rr = (r) => (r <= first ? r : first + (r - first) * scale)
  const pos = { [hubId]: { x: cx, y: cy } }, sectors = []; let a0 = -Math.PI / 2
  const put = (id, r, a) => { pos[id] = { x: Math.round((cx + r * sx * Math.cos(a)) * 10) / 10, y: Math.round((cy + r * Math.sin(a)) * 10) / 10 } }
  keys.forEach((k, i) => {
    const span = sector[i].span, mid = a0 + span / 2, arc = span * 0.9; sectors.push({ id: k, mid, span, r: first }); put(k, first, mid)
    for (const [id, p] of Object.entries(raw)) if (p.k === k) put(id, rr(p.r), mid - arc / 2 + (arc * (p.a + 0.5)) / p.of)
    a0 += span
  })
  if (showUnlinked && lost.length) lost.forEach((id, j) => put(id, R + 16, -Math.PI / 2 + (2 * Math.PI * (j + 0.5)) / lost.length))
  const maxD = Math.max(1, ...Object.values(depth))
  return { pos, depth, domainOf, rings: [first, rr(maxR)].filter((v, i, a) => a.indexOf(v) === i), sectors, lost, hidden: [...hidden], sx, maxD }
}
