// Shoe degradation vs efficiency: for each shoe, regress EF (efficiency factor) of its easy/steady runs on the shoe's cumulative km at the time of the run.
// A negative slope can hint at midsole wear but is confounded by fitness, weather and pacing; shown only with n >= minRuns and always as a hint.
export function linreg(xs, ys) {
  const n = xs.length; if (n < 3) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 }
  if (!sxx) return null
  const slope = sxy / sxx, r = syy ? sxy / Math.sqrt(sxx * syy) : 0
  const sse = ys.reduce((s, y, i) => s + (y - (my + slope * (xs[i] - mx))) ** 2, 0), se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : null
  return { slope, r, se, n }
}
// runs: [{ date, gear_id, distance_m, ef }] sorted or not; returns { [gear_id]: { n, kmSpan, slopePer100, r, se100, flag } }
export function shoeEfFit(runs, minRuns = 8) {
  const by = {}
  for (const a of [...runs].sort((x, y) => x.date.localeCompare(y.date))) {
    if (!a.gear_id) continue
    const g = (by[a.gear_id] ||= { cum: 0, pts: [] }); g.cum += (a.distance_m || 0) / 1000
    if (a.ef != null) g.pts.push([g.cum, a.ef])
  }
  const out = {}
  for (const [id, g] of Object.entries(by)) {
    const reg = g.pts.length >= minRuns ? linreg(g.pts.map((p) => p[0]), g.pts.map((p) => p[1])) : null
    out[id] = { n: g.pts.length, kmSpan: Math.round(g.cum), slopePer100: reg ? Math.round(reg.slope * 100 * 10000) / 10000 : null, r: reg ? Math.round(reg.r * 100) / 100 : null, se100: reg?.se != null ? Math.round(reg.se * 100 * 10000) / 10000 : null,
      flag: !reg ? `needs ≥ ${minRuns} runs with EF` : reg.slope < 0 && Math.abs(reg.slope) > 2 * reg.se ? 'EF falls with mileage (hint)' : 'no clear trend' }
  }
  return out
}
