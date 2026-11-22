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
