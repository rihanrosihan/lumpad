// Lagged cross-correlation explorer: does `x` (exposure, e.g. daily training load) at day t-lag line up with `y` (outcome, e.g. overnight HRV) at day t?
// Exploratory only: many lags are tested at once, so nothing here is confirmatory (the server's correlation edges use FDR control).
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
export function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
// x, y: { [date]: number }. → { lag, r, n, lo, hi } with a 95% Fisher-z interval; null r when fewer than minN overlapping days
export function lagged(x, y, lag, minN = 20) {
  const xs = [], ys = []
  for (const [d, yv] of Object.entries(y)) { const xv = x[addDays(d, -lag)]; if (xv != null && yv != null) { xs.push(xv); ys.push(yv) } }
  const r = xs.length >= minN ? pearson(xs, ys) : null
  if (r == null) return { lag, r: null, n: xs.length, lo: null, hi: null }
  const z = Math.atanh(Math.max(-0.999, Math.min(0.999, r))), se = 1 / Math.sqrt(Math.max(1, xs.length - 3))
  return { lag, r: Math.round(r * 1000) / 1000, n: xs.length, lo: Math.round(Math.tanh(z - 1.96 * se) * 1000) / 1000, hi: Math.round(Math.tanh(z + 1.96 * se) * 1000) / 1000 }
}
export const scan = (x, y, from = 1, to = 28, minN = 20) => Array.from({ length: to - from + 1 }, (_, i) => lagged(x, y, from + i, minN))
export const strongest = (rows) => rows.filter((r) => r.r != null).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0] || null
