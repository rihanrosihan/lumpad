// CorrelationEdge job. Exposures are lagged with SQL window functions over daily_feat (one row per calendar day): the window [lo, hi] means
// "days lo..hi BEFORE the run" (lo ≥ 1, so the run day itself is never counted). Statistics: Spearman + partial (controls: pace, temperature/WBGT, duration),
// circular-shift permutation p (keeps outcome autocorrelation), block bootstrap by ISO week, n_eff from lag-1 autocorrelation, Benjamini–Hochberg FDR, split-half stability.
// Edges are ASSOCIATIONS in one athlete's observational data, never causal claims.
import { idb, mdb, tx } from './db.js'
import { spearman, partialSpearman, shiftP, blockBootstrapCI, bh, nEff, ols, rank } from './stats.js'

export const WINDOWS = [[1, 3], [4, 7], [8, 14], [15, 28]]
// agg: SUM for counts/loads, AVG for state variables
export const EXPOSURES = [
  // gym → stride (blueprint matrix 1): also the single days +24 h, +48 h, +72 h before the run
  { id: 'strength_lower', col: 'strength_lower', agg: 'SUM', label: 'lower-body strength sessions', windows: [[1, 1], [2, 2], [3, 3], [1, 3], [4, 7]] }, { id: 'strength_upper', col: 'strength_upper', agg: 'SUM', label: 'upper-body strength sessions' },
  { id: 'strength_tl', col: 'strength_tl', agg: 'SUM', label: 'strength training load' }, { id: 'thr_min', col: 'thr_min', agg: 'SUM', label: 'threshold-zone minutes' },
  { id: 'quality_sessions', col: 'quality', agg: 'SUM', label: 'quality sessions' }, { id: 'double_days', col: 'double_day', agg: 'SUM', label: 'double-run quality days' },
  { id: 'run_km', col: 'run_km', agg: 'SUM', label: 'running km' }, { id: 'run_tl', col: 'run_tl', agg: 'SUM', label: 'running training load' },
  { id: 'sleep_min', col: 'sleep_min', agg: 'AVG', label: 'sleep minutes (mean)' }, { id: 'hrv_dev', col: 'hrv_dev', agg: 'AVG', label: 'HRV deviation from baseline (mean)' },
]
export const OUTCOMES = [
  { id: 'gct_fade', label: 'late-run GCT fade (ms)', min: 25 }, { id: 'drift', label: 'Pa:HR / run-phase drift (%)', min: 25 }, { id: 'ef_resid', label: 'EF residual (pace/temp/duration adjusted)', min: 30 },
  { id: 'run_share_long', label: 'run share on long runs ≥ 16 km', min: 15 }, { id: 'stride_fade', label: 'late-run stride change (m)', min: 25 },
  // double-threshold adaptation (blueprint matrix 3) and the plain GCT level (matrix 1)
  { id: 'pace_hr150', label: 'pace at HR ≈ 150 (s/km; lower = fitter)', min: 20 }, { id: 'gct_avg', label: 'average running GCT (ms)', min: 25 },
]

// SQL: for every date, every exposure×window as a column
export function lagSql() {
  const cols = []
  for (const e of EXPOSURES) for (const [lo, hi] of (e.windows || WINDOWS)) cols.push(`${e.agg}(${e.col}) OVER (ORDER BY date ROWS BETWEEN ${hi} PRECEDING AND ${lo} PRECEDING) AS ${e.id}__${lo}_${hi}`)
  return `SELECT date, ${cols.join(', ')} FROM daily_feat ORDER BY date`
}
// SQLite computes moving-window SUM/AVG incrementally (add + subtract), which leaves float noise (10.000000000000002) that splits genuine rank
// ties; values are rounded to 1e-6 so equal exposures stay equal (and so the Postgres port, which recomputes each window, agrees)
const r6 = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)
export const lagRows = () => Object.fromEntries(idb.prepare(lagSql()).all().map((r) => [r.date, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'date' ? v : r6(v)]))]))

const isoWeek = (d) => { const t = new Date(d + 'T12:00:00Z'), day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3); const y = t.getUTCFullYear(), j = new Date(Date.UTC(y, 0, 4)); return `${y}-W${Math.round(((t - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7) + 1}` }
const finite = (...v) => v.every((x) => x != null && Number.isFinite(x))

// pure: sessions = [{date, y:{outcome:value}, ctl:[pace,temp,dur,dist], x:{ 'exposure__lo_hi': value }}]
export function computeEdges(sessions, { B = 300, seed = 7, minN = null } = {}) {
  const tests = []
  for (const o of OUTCOMES) {
    const S = sessions.filter((s) => finite(s.y[o.id]) && s.ctl.every(Number.isFinite)).sort((a, b) => a.date.localeCompare(b.date)); if (S.length < (minN ?? o.min)) continue
    for (const e of EXPOSURES) for (const [lo, hi] of (e.windows || WINDOWS)) {
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
  const lags = lagRows(), rows = idb.prepare('SELECT s.*, w.wbgt, w.temp_c AS wx FROM fit_session s LEFT JOIN run_weather w ON w.label_id=s.label_id WHERE s.run_pace IS NOT NULL ORDER BY s.date, s.start_ms, s.label_id').all() // chronological; ties made deterministic (the Go port must match)
  const temp = (s) => s.wbgt ?? s.wx ?? s.temp_device_c, steady = rows.filter((s) => s.run_share >= 0.85 && s.distance_m >= 3000 && s.distance_m <= 21000 && s.ef != null && temp(s) != null)
  const fit = steady.length >= 20 ? ols(steady.map((s) => [s.run_pace, temp(s), s.elapsed_s / 60]), steady.map((s) => s.ef)) : null
  const efRes = (s) => (fit && s.ef != null && temp(s) != null && s.run_share >= 0.85 && s.distance_m >= 3000 ? s.ef - (fit.coef[0] + fit.coef[1] * s.run_pace + fit.coef[2] * temp(s) + fit.coef[3] * (s.elapsed_s / 60)) : null)
  // sessions the athlete says were not a fitness test (walking by choice at an event, with a partner ...) are left out, exactly as in the twin: their run share is not an endurance signal
  let skip = new Set(); try { skip = new Set(mdb.prepare('SELECT date FROM session_context WHERE counts_for_fitness=0 AND km_from IS NULL').all().map((r) => r.date)) } catch {}
  return rows.filter((s) => lags[s.date] && !skip.has(s.date)).map((s) => ({
    date: s.date, ctl: [s.run_pace, temp(s) ?? NaN, s.elapsed_s / 60, s.distance_m / 1000],
    y: { gct_fade: s.gct_fade, drift: s.drift_pahr ?? s.run_drift, ef_resid: efRes(s), run_share_long: s.distance_m >= 16000 ? s.run_share : null, stride_fade: s.stride_fade, pace_hr150: s.pace_hr150, gct_avg: JSON.parse(s.metrics || '{}').run_gct ?? null },
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
  // the strongest tests that did not pass the gate are kept apart as exploratory hypotheses for the graph (never read by the coach)
  const explore = out.edges.filter((e) => e.status === 'none' && e.n_eff >= 10 && Number.isFinite(e.partial_rho)).sort((a, b) => Math.abs(b.partial_rho) - Math.abs(a.partial_rho) || a.q - b.q).slice(0, EXPLORE_MAX)
  tx(idb, () => { idb.prepare('DELETE FROM corr_explore').run(); for (const e of explore) idb.prepare('INSERT INTO corr_explore (run_at, exposure, outcome, lag_lo, lag_hi, n, n_eff, rho, partial_rho, ci_lo, ci_hi, p, q, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(now, e.exposure, e.outcome, e.lag_lo, e.lag_hi, e.n, e.n_eff, e.rho, e.partial_rho, e.ci_lo, e.ci_hi, e.p, e.q, e.note) })
  return { sessions: ds.length, tested: out.tested, supported: keep.filter((e) => e.status === 'supported').length, candidates: keep.filter((e) => e.status === 'candidate').length, exploratory: explore.length }
}
export const EXPLORE_MAX = 30
export const listExplore = () => { try { return idb.prepare('SELECT * FROM corr_explore ORDER BY ABS(partial_rho) DESC').all() } catch { return [] } }

// ---- the Correlations view of the live graph: PERFORMANCE in the centre, its domains, the outcomes each domain is measured by, and the factors that associate with them.
// Three tiers, never mixed up: supported and candidate (passed the gate) and exploratory (tested but NOT significant after multiple-testing correction: a hypothesis, nothing more).
const HUB = 'PerfDomain:performance'
const DOMAINS = [['vdot', 'VDOT (race-equivalent fitness)'], ['running_fitness', 'COROS running fitness'], ['cardio', 'Cardiovascular efficiency'], ['durability', 'Durability'], ['speed', 'Speed & personal bests'], ['load', 'Training load']]
export const OUTCOME_DOMAIN = { gct_fade: 'durability', stride_fade: 'durability', gct_avg: 'durability', run_share_long: 'durability', drift: 'cardio', ef_resid: 'cardio', pace_hr150: 'cardio' }
const TIER_RANK = { supported: 0, candidate: 1, exploratory: 2 }
export function correlationGraph(gated = [], explore = []) {
  const best = new Map()
  for (const e of [...gated.map((x) => ({ ...x, tier: x.status })), ...explore.map((x) => ({ ...x, tier: 'exploratory' }))]) {
    if (!(e.outcome in OUTCOME_DOMAIN) || !Number.isFinite(e.partial_rho)) continue
    const k = `${e.exposure}|${e.outcome}`, cur = best.get(k)
    if (!cur || TIER_RANK[e.tier] < TIER_RANK[cur.tier] || (e.tier === cur.tier && Math.abs(e.partial_rho) > Math.abs(cur.partial_rho))) best.set(k, e)
  }
  const pairs = [...best.values()], expo = new Map(EXPOSURES.map((x) => [x.id, x.label])), outc = new Map(OUTCOMES.map((x) => [x.id, x.label]))
  const nodes = [{ id: HUB, label: 'PerfDomain', name: 'PERFORMANCE', date: null, ef: null, tl: null, wbgt: null }], edges = [], have = new Set([HUB])
  const add = (id, label, name) => { if (!have.has(id)) { have.add(id); nodes.push({ id, label, name, date: null, ef: null, tl: null, wbgt: null }) } return id }
  for (const [k, name] of DOMAINS) { add(`PerfDomain:${k}`, 'PerfDomain', name); edges.push({ from: `PerfDomain:${k}`, to: HUB, type: 'PART_OF' }) }
  for (const o of new Set(pairs.map((e) => e.outcome))) edges.push({ from: add(`Outcome:${o}`, 'Outcome', outc.get(o) || o), to: `PerfDomain:${OUTCOME_DOMAIN[o]}`, type: 'MEASURES' })
  for (const e of pairs) edges.push({ from: add(`Factor:${e.exposure}`, 'Factor', expo.get(e.exposure) || e.exposure), to: `Outcome:${e.outcome}`, type: 'CORRELATES', tier: e.tier, rho: e.rho, partial_rho: e.partial_rho, p: e.p, q: e.q, n: e.n, n_eff: e.n_eff, lag: [e.lag_lo, e.lag_hi], ci: [e.ci_lo, e.ci_hi] })
  const count = (t) => pairs.filter((e) => e.tier === t).length
  return { connected: true, view: 'correlations', nodes, edges, hub: HUB, unlinked: [], truncated: false, kind: 'correlations', counts: { supported: count('supported'), candidate: count('candidate'), exploratory: count('exploratory') } }
}
export const listEdges = (status) => idb.prepare(`SELECT * FROM corr_edge ${status ? 'WHERE status = ?' : ''} ORDER BY (status='supported') DESC, q, ABS(partial_rho) DESC`).all(...(status ? [status] : []))
