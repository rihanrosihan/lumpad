// Small, dependency-free statistics used by the twin and the CorrelationEdge job. Everything is deterministic given a seed.
export function rng(seed = 12345) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
export const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1)
export const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)) }
export const quantile = (a, q) => { const v = [...a].sort((x, y) => x - y); if (!v.length) return NaN; const i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo) }
export function rank(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1 } return r }
export function pearson(x, y) { const mx = mean(x), my = mean(y); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2 } return sx && sy ? sxy / Math.sqrt(sx * sy) : 0 }
export const spearman = (x, y) => pearson(rank(x), rank(y))

// ordinary least squares y ~ 1 + X (X: n×p array of rows). Returns coef (intercept first) and residuals.
export function ols(X, y) {
  const n = y.length, p = (X[0]?.length || 0) + 1, A = Array.from({ length: p }, () => new Array(p + 1).fill(0))
  for (let i = 0; i < n; i++) { const row = [1, ...X[i]]; for (let a = 0; a < p; a++) { for (let b = 0; b < p; b++) A[a][b] += row[a] * row[b]; A[a][p] += row[a] * y[i] } }
  for (let c = 0; c < p; c++) { // Gaussian elimination with partial pivoting + tiny ridge for stability
    A[c][c] += 1e-9; let m = c; for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r; [A[c], A[m]] = [A[m], A[c]]
    for (let r = 0; r < p; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k] }
  }
  const coef = A.map((row, i) => row[p] / row[i]), res = y.map((v, i) => v - coef[0] - X[i].reduce((s, x, j) => s + coef[j + 1] * x, 0))
  return { coef, res }
}
// partial Spearman: rank-transform everything, remove the linear effect of the controls from both, correlate the residuals
export function partialSpearman(x, y, Z) {
  if (!Z.length || !Z[0].length) return spearman(x, y)
  const cols = Z[0].map((_, j) => rank(Z.map((r) => r[j]))), Zr = x.map((_, i) => cols.map((c) => c[i]))
  return pearson(ols(Zr, rank(x)).res, ols(Zr, rank(y)).res)
}
export function acf1(v) { const m = mean(v); let a = 0, b = 0; for (let i = 0; i < v.length; i++) { b += (v[i] - m) ** 2; if (i) a += (v[i] - m) * (v[i - 1] - m) } return b ? a / b : 0 }
export const nEff = (n, series) => { const r = Math.max(0, Math.min(0.95, acf1(series))); return Math.max(3, Math.min(n, (n * (1 - r)) / (1 + r))) }

// circular-shift permutation p-value (keeps the autocorrelation of the outcome); two-sided on |ρ|
export function shiftP(x, y, stat = spearman) {
  const n = y.length, obs = Math.abs(stat(x, y)); let ge = 1, tot = 1
  for (let k = 1; k < n; k++) { const ys = y.map((_, i) => y[(i + k) % n]); tot++; if (Math.abs(stat(x, ys)) >= obs - 1e-12) ge++ }
  return ge / tot
}
// block bootstrap by group id (e.g. ISO week): resample whole groups, keeps within-week dependence
export function blockBootstrapCI(x, y, groups, stat = spearman, B = 400, seed = 7) {
  const R = rng(seed), by = new Map(); groups.forEach((g, i) => (by.get(g) || by.set(g, []).get(g)).push(i)); const keys = [...by.keys()], out = []
  for (let b = 0; b < B; b++) { const xi = [], yi = []; for (let k = 0; k < keys.length; k++) for (const i of by.get(keys[Math.floor(R() * keys.length)])) { xi.push(x[i]); yi.push(y[i]) } if (xi.length >= 5) out.push(stat(xi, yi)) }
  return out.length ? [quantile(out, 0.025), quantile(out, 0.975)] : [NaN, NaN]
}
// Benjamini–Hochberg q-values
export function bh(ps) {
  const m = ps.length, idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), q = new Array(m); let min = 1
  for (let k = m - 1; k >= 0; k--) { min = Math.min(min, (idx[k][0] * m) / (k + 1)); q[idx[k][1]] = min }
  return q
}
