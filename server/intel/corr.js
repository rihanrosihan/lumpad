// CorrelationEdge job. Exposures are lagged with SQL window functions over daily_feat (one row per calendar day): the window [lo, hi] means
// "days lo..hi BEFORE the run" (lo ≥ 1, so the run day itself is never counted). Statistics: Spearman + partial (controls: pace, temperature/WBGT, duration),
// circular-shift permutation p (keeps outcome autocorrelation), block bootstrap by ISO week, n_eff from lag-1 autocorrelation, Benjamini–Hochberg FDR, split-half stability.
// Edges are ASSOCIATIONS in one athlete's observational data, never causal claims.
import { idb, tx } from './db.js'
import { spearman, partialSpearman, shiftP, blockBootstrapCI, bh, nEff, ols, rank } from './stats.js'

export const WINDOWS = [[1, 3], [4, 7], [8, 14], [15, 28]]
// agg: SUM for counts/loads, AVG for state variables
export const EXPOSURES = [
  { id: 'strength_lower', col: 'strength_lower', agg: 'SUM', label: 'lower-body strength sessions' }, { id: 'strength_upper', col: 'strength_upper', agg: 'SUM', label: 'upper-body strength sessions' },
  { id: 'strength_tl', col: 'strength_tl', agg: 'SUM', label: 'strength training load' }, { id: 'thr_min', col: 'thr_min', agg: 'SUM', label: 'threshold-zone minutes' },
  { id: 'quality_sessions', col: 'quality', agg: 'SUM', label: 'quality sessions' }, { id: 'double_days', col: 'double_day', agg: 'SUM', label: 'double-run quality days' },
  { id: 'run_km', col: 'run_km', agg: 'SUM', label: 'running km' }, { id: 'run_tl', col: 'run_tl', agg: 'SUM', label: 'running training load' },
  { id: 'sleep_min', col: 'sleep_min', agg: 'AVG', label: 'sleep minutes (mean)' }, { id: 'hrv_dev', col: 'hrv_dev', agg: 'AVG', label: 'HRV deviation from baseline (mean)' },
]
export const OUTCOMES = [
  { id: 'gct_fade', label: 'late-run GCT fade (ms)', min: 25 }, { id: 'drift', label: 'Pa:HR / run-phase drift (%)', min: 25 }, { id: 'ef_resid', label: 'EF residual (pace/temp/duration adjusted)', min: 30 },
  { id: 'run_share_long', label: 'run share on long runs ≥ 16 km', min: 15 }, { id: 'stride_fade', label: 'late-run stride change (m)', min: 25 },
]

// SQL: for every date, every exposure×window as a column
export function lagSql() {
  const cols = []
  for (const e of EXPOSURES) for (const [lo, hi] of WINDOWS) cols.push(`${e.agg}(${e.col}) OVER (ORDER BY date ROWS BETWEEN ${hi} PRECEDING AND ${lo} PRECEDING) AS ${e.id}__${lo}_${hi}`)
  return `SELECT date, ${cols.join(', ')} FROM daily_feat ORDER BY date`
}
export const lagRows = () => Object.fromEntries(idb.prepare(lagSql()).all().map((r) => [r.date, r]))

const isoWeek = (d) => { const t = new Date(d + 'T12:00:00Z'), day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3); const y = t.getUTCFullYear(), j = new Date(Date.UTC(y, 0, 4)); return `${y}-W${Math.round(((t - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7) + 1}` }
const finite = (...v) => v.every((x) => x != null && Number.isFinite(x))

// pure: sessions = [{date, y:{outcome:value}, ctl:[pace,temp,dur,dist], x:{ 'exposure__lo_hi': value }}]
export function computeEdges(sessions, { B = 300, seed = 7, minN = null } = {}) {
  const tests = []
  for (const o of OUTCOMES) {
    const S = sessions.filter((s) => finite(s.y[o.id]) && s.ctl.every(Number.isFinite)).sort((a, b) => a.date.localeCompare(b.date)); if (S.length < (minN ?? o.min)) continue
    for (const e of EXPOSURES) for (const [lo, hi] of WINDOWS) {
      const key = `${e.id}__${lo}_${hi}`, rows = S.filter((s) => finite(s.x[key])), n = rows.length; if (n < (minN ?? o.min)) continue
      const x = rows.map((s) => s.x[key]), y = rows.map((s) => s.y[o.id]); if (new Set(x).size < 4) continue   // no variation in the exposure → nothing to test
      const Z = rows.map((s) => s.ctl), rho = spearman(x, y), prho = partialSpearman(x, y, Z)
      tests.push({ exposure: e.id, outcome: o.id, lo, hi, n, n_eff: nEff(n, y), rho, partial_rho: prho, x, y, Z, weeks: rows.map((s) => isoWeek(s.date)), dates: rows.map((s) => s.date) })
    }
  }
  const ps = tests.map((t) => shiftP(t.x, t.y, (a, b) => partialSpearman(a, b, t.Z)))
  const qs = bh(ps)
  const edges = tests.map((t, i) => {
    const [lo, hi] = blockBootstrapCI(t.x, t.y, t.weeks, (a, b) => spearman(a, b), t.n_eff < 20 ? 100 : B, seed), h = t.n >> 1
    const r1 = partialSpearman(t.x.slice(0, h), t.y.slice(0, h), t.Z.slice(0, h)), r2 = partialSpearman(t.x.slice(h), t.y.slice(h), t.Z.slice(h))
    const stable = Math.sign(r1) === Math.sign(r2) && Math.abs(r1) >= 0.2 && Math.abs(r2) >= 0.2 ? 1 : 0
    const sig = qs[i] < 0.10, supported = sig && stable && Math.abs(t.partial_rho) >= 0.3 && t.n_eff >= 20
    return { exposure: t.exposure, outcome: t.outcome, lag_lo: t.lo, lag_hi: t.hi, n: t.n, n_eff: +t.n_eff.toFixed(1), rho: +t.rho.toFixed(3), partial_rho: +t.partial_rho.toFixed(3), ci_lo: +lo.toFixed(3), ci_hi: +hi.toFixed(3), p: +ps[i].toFixed(4), q: +qs[i].toFixed(4), stable,
      status: supported ? 'supported' : sig ? 'candidate' : 'none', note: `halves ρ ${r1.toFixed(2)} / ${r2.toFixed(2)}` }
  })
  return { tested: tests.length, edges }
}

// real data: build the per-session dataset from intel.db and run
export function sessionDataset() {
  const lags = lagRows(), rows = idb.prepare('SELECT s.*, w.wbgt, w.temp_c AS wx FROM fit_session s LEFT JOIN run_weather w ON w.label_id=s.label_id WHERE s.run_pace IS NOT NULL ORDER BY s.date').all()
  const temp = (s) => s.wbgt ?? s.wx ?? s.temp_device_c, steady = rows.filter((s) => s.run_share >= 0.85 && s.distance_m >= 3000 && s.distance_m <= 21000 && s.ef != null && temp(s) != null)
  const fit = steady.length >= 20 ? ols(steady.map((s) => [s.run_pace, temp(s), s.elapsed_s / 60]), steady.map((s) => s.ef)) : null
  const efRes = (s) => (fit && s.ef != null && temp(s) != null && s.run_share >= 0.85 && s.distance_m >= 3000 ? s.ef - (fit.coef[0] + fit.coef[1] * s.run_pace + fit.coef[2] * temp(s) + fit.coef[3] * (s.elapsed_s / 60)) : null)
  return rows.filter((s) => lags[s.date]).map((s) => ({
    date: s.date, ctl: [s.run_pace, temp(s) ?? NaN, s.elapsed_s / 60, s.distance_m / 1000],
    y: { gct_fade: s.gct_fade, drift: s.drift_pahr ?? s.run_drift, ef_resid: efRes(s), run_share_long: s.distance_m >= 16000 ? s.run_share : null, stride_fade: s.stride_fade },
    x: Object.fromEntries(Object.entries(lags[s.date]).filter(([k]) => k !== 'date')),
  }))
}
export function corrJob() {
  const ds = sessionDataset(), out = computeEdges(ds), now = new Date().toISOString(), keep = out.edges.filter((e) => e.status !== 'none')
  tx(idb, () => {
    const prev = idb.prepare("SELECT * FROM corr_edge WHERE status IN ('supported','candidate')").all()
    idb.prepare("DELETE FROM corr_edge WHERE status IN ('supported','candidate')").run()
    idb.prepare("DELETE FROM corr_edge WHERE status='expired' AND run_at < ?").run(new Date(Date.now() - 90 * 864e5).toISOString())
    for (const e of keep) idb.prepare('INSERT INTO corr_edge (run_at, exposure, outcome, lag_lo, lag_hi, n, n_eff, rho, partial_rho, ci_lo, ci_hi, p, q, stable, status, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(now, e.exposure, e.outcome, e.lag_lo, e.lag_hi, e.n, e.n_eff, e.rho, e.partial_rho, e.ci_lo, e.ci_hi, e.p, e.q, e.stable, e.status, e.note)
    for (const p of prev) if (p.status === 'supported' && !keep.some((e) => e.exposure === p.exposure && e.outcome === p.outcome && e.lag_lo === p.lag_lo)) idb.prepare("INSERT INTO corr_edge (run_at, exposure, outcome, lag_lo, lag_hi, n, n_eff, rho, partial_rho, ci_lo, ci_hi, p, q, stable, status, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'expired','not reconfirmed')").run(p.run_at, p.exposure, p.outcome, p.lag_lo, p.lag_hi, p.n, p.n_eff, p.rho, p.partial_rho, p.ci_lo, p.ci_hi, p.p, p.q, p.stable)
  })
  return { sessions: ds.length, tested: out.tested, supported: keep.filter((e) => e.status === 'supported').length, candidates: keep.filter((e) => e.status === 'candidate').length }
}
export const listEdges = (status) => idb.prepare(`SELECT * FROM corr_edge ${status ? 'WHERE status = ?' : ''} ORDER BY (status='supported') DESC, q, ABS(partial_rho) DESC`).all(...(status ? [status] : []))
