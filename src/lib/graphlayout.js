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
