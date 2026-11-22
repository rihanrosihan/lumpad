// Downsampled per-second streams + the real GPS route of one FIT file, for the activity page (map, HR / pace / GAP / altitude charts).
// Same series as the pipeline (toSeries: 1 Hz, HR artefacts removed, speed/altitude from enhanced_* when needed), plus latitude/longitude for every second,
// which toSeries drops. Cached (LRU) because parsing a long run takes ~100 ms.
import path from 'node:path'
import fs from 'node:fs'
import { parseFitFile, toSeries } from './fit.js'
import { gradeSeries, gapSpeed } from './metrics.js'

const MAX_POINTS = 420, MAX_ROUTE = 700
const SEMI = 180 / 2147483648
const r = (x, d) => (Number.isFinite(x) ? +x.toFixed(d) : null)
const paceOf = (v) => (v > 0.7 ? 1000 / v : null) // s/km, standing still = no pace

// mean of the finite values in [a, b) of arr
const winMean = (arr, a, b) => { let s = 0, k = 0; for (let i = a; i < b; i++) { const x = arr[i]; if (Number.isFinite(x)) { s += x; k++ } } return k ? s / k : NaN }

export function buildStream(d) {
  const S = toSeries(d), grade = gradeSeries(S), n = S.n
  // route: position of every record, by the same 1 s index toSeries uses; gaps stay empty and are skipped
  const lat = new Float64Array(n).fill(NaN), lon = new Float64Array(n).fill(NaN)
  for (const rec of d.records || []) {
    if (!(rec.timestamp instanceof Date)) continue
    const i = Math.round((rec.timestamp.getTime() - S.t0) / 1000); if (i < 0 || i >= n) continue
    const la = rec.position_lat, lo = rec.position_long
    if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) { lat[i] = la; lon[i] = lo }
  }
  const step = Math.max(1, Math.ceil(n / MAX_POINTS)), out = { n_s: n, step_s: step, t: [], km: [], hr: [], pace: [], gap: [], cad: [], alt: [], power: [] }
  for (let a = 0; a < n; a += step) {
    const b = Math.min(n, a + step), v = winMean(S.speed, a, b), g = winMean(grade, a, b)
    out.t.push(a); out.km.push(r(S.dist[Math.min(n - 1, b - 1)] / 1000, 3)); out.hr.push(r(winMean(S.hr, a, b), 0)); out.pace.push(r(paceOf(v), 1))
    out.gap.push(r(paceOf(gapSpeed(v, Number.isFinite(g) ? g : 0)), 1)); out.cad.push(r(winMean(S.cad, a, b), 0)); out.alt.push(r(winMean(S.alt, a, b), 1)); out.power.push(r(winMean(S.power, a, b), 0))
  }
  const pts = []; for (let i = 0; i < n; i++) if (Number.isFinite(lat[i])) pts.push([lat[i], lon[i]])
  const rs = Math.max(1, Math.ceil(pts.length / MAX_ROUTE))
  // positions are semicircles in raw FIT; fit-file-parser already returns degrees, but keep a guard for files that give semicircle integers
  const deg = (v) => (Math.abs(v) > 180 ? v * SEMI : v)
  out.route = pts.filter((_, i) => i % rs === 0 || i === pts.length - 1).map(([la, lo]) => [r(deg(la), 5), r(deg(lo), 5)])
  // seconds at each whole bpm over every second with an HR reading (what COROS counts for time in zone); zone-independent, so any zone edges can be applied
  const hist = {}; for (let i = 0; i < n; i++) { const h = S.hr[i]; if (h > 0) { const k = Math.round(h); hist[k] = (hist[k] || 0) + 1 } }
  out.hr_hist = hist
  out.has_alt = out.alt.some((x) => x != null); out.has_power = out.power.some((x) => x != null && x > 0)
  return out
}

const cache = new Map() // path:mtime → result, insertion-ordered LRU
export async function streamFor(file) {
  const st = fs.statSync(file), k = file + ':' + st.mtimeMs
  if (cache.has(k)) { const v = cache.get(k); cache.delete(k); cache.set(k, v); return v }
  const v = buildStream(await parseFitFile(file)); cache.set(k, v)
  while (cache.size > 12) cache.delete(cache.keys().next().value)
  return v
}
export const fitPath = (relPath, dataDir = process.env.DATA_DIR || path.resolve('server/data')) => {
  const f = path.resolve(dataDir, relPath), base = path.resolve(dataDir) + path.sep
  if (!f.startsWith(base)) throw Object.assign(new Error('bad path'), { status: 400 }) // a stored path can never point outside the data dir
  return f
}
