// Builds src/data/routes/jakim.json from tools/data/jakim-2026.gpx (official BTN Jakim 2026 marathon track).
// The GPX has no elevation and is 42.82 km as drawn (GPS-style polyline); distances are scaled to the certified 42.195 km.
// Street names/segments are read from the official 2027 course map; km ranges come from the track. Usage: node tools/build_route.mjs
import fs from 'node:fs'

const U = (p) => new URL(p, import.meta.url), OFFICIAL = 42195
const txt = fs.readFileSync(U('./data/jakim-2026.gpx'), 'utf8')
let pts = [...txt.matchAll(/lat="([-\d.]+)" lon="([-\d.]+)"/g)].map((m) => [+m[1], +m[2]])
pts = pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]) // the file repeats points
const R = 6371008.8, rad = (x) => (x * Math.PI) / 180
const hv = (a, b) => { const dp = rad(b[0] - a[0]), dl = rad(b[1] - a[1]), h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hv(pts[i - 1], pts[i]))
const trackM = cum.at(-1), scale = OFFICIAL / trackM, kmOf = (i) => (cum[i] * scale) / 1000

// Ramer–Douglas–Peucker on a local flat projection (metres)
const k0 = Math.cos(rad(pts[0][0])), xy = (p) => [p[1] * 111320 * k0, p[0] * 110540]
const perp = (p, a, b) => { const [px, py] = xy(p), [ax, ay] = xy(a), [bx, by] = xy(b), dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; if (!l) return Math.hypot(px - ax, py - ay); const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)); return Math.hypot(px - ax - t * dx, py - ay - t * dy) }
function rdp(lo, hi, eps, keep) { let mx = 0, at = -1; for (let i = lo + 1; i < hi; i++) { const d = perp(pts[i], pts[lo], pts[hi]); if (d > mx) { mx = d; at = i } } if (mx > eps) { keep.add(at); rdp(lo, at, eps, keep); rdp(at, hi, eps, keep) } }
const keep = new Set([0, pts.length - 1]); rdp(0, pts.length - 1, 6, keep)
const line = [...keep].sort((a, b) => a - b).map((i) => [+pts[i][0].toFixed(5), +pts[i][1].toFixed(5), +kmOf(i).toFixed(3)])

const at = (km) => { const m = (km * 1000) / scale; let i = cum.findIndex((c) => c >= m); if (i < 1) i = 1; const f = (m - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]); return [+(pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0])).toFixed(5), +(pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])).toFixed(5)] }
const marks = Array.from({ length: 42 }, (_, i) => ({ km: i + 1, ll: at(i + 1) }))
// corners from the full track: resample every 20 m, signed heading change between the 60 m behind and the 60 m ahead
const rs = []; { let m = 0; const posAt = (d) => { let i = cum.findIndex((c) => c >= d); if (i < 1) i = 1; const f = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]); return [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])] }; for (m = 0; m <= trackM; m += 20) rs.push({ m, p: posAt(m) }) }
const brg = (a, b) => (Math.atan2((b[1] - a[1]) * Math.cos(rad(a[0])), b[0] - a[0]) * 180) / Math.PI
const turnAt = (i, w = 3) => { if (i < w || i + w >= rs.length) return 0; const h1 = brg(rs[i - w].p, rs[i].p), h2 = brg(rs[i].p, rs[i + w].p); return ((h2 - h1 + 540) % 360) - 180 }
const corners = []; { let i = 3; while (i < rs.length - 3) { const t = turnAt(i); if (Math.abs(t) >= 55) { let best = i, j = i; while (j < rs.length - 3 && Math.abs(turnAt(j)) >= 40) { if (Math.abs(turnAt(j)) > Math.abs(turnAt(best))) best = j; j++ } const a = turnAt(best); corners.push({ km: +((rs[best].m * scale) / 1000).toFixed(2), dir: a > 0 ? 'R' : 'L', deg: Math.round(Math.abs(a)), ll: [+rs[best].p[0].toFixed(5), +rs[best].p[1].toFixed(5)] }); i = j + 2 } else i++ } }
const headingAt = (km) => { const m = (km * 1000) / scale, i = Math.min(rs.length - 4, Math.max(0, Math.round(m / 20))); const h = (brg(rs[i].p, rs[i + 3].p) + 360) % 360; return Math.round(h) }
const kmHeadings = Array.from({ length: 43 }, (_, i) => headingAt(Math.min(i + 0.5, 42.1)))
const lat = pts.map((p) => p[0]), lon = pts.map((p) => p[1])

// segments: street names from the official map, km from the track
const segments = [
  { from: 0, to: 2.1, what: 'Start at Monas (National Monument), loop out along the east side' },
  { from: 2.1, to: 4, what: 'Turn at Monas, back west to Jl. MH Thamrin' },
  { from: 4, to: 5.5, what: 'Jl. MH Thamrin south to Bundaran HI (about km 5.4)' },
  { from: 5.5, to: 6.8, what: 'Jl. Imam Bonjol' },
  { from: 6.8, to: 9.5, what: 'Jl. Rasuna Said south' },
  { from: 9.5, to: 12.4, what: 'Jl. Mampang south' },
  { from: 12.4, to: 15.5, what: 'U-turn at the southern end of Jl. Mampang, back north' },
  { from: 15.5, to: 19.5, what: 'Jl. Rasuna Said and Jl. Imam Bonjol north, back towards Bundaran HI' },
  { from: 19.5, to: 22, what: 'Jl. Jend. Sudirman south' },
  { from: 22, to: 26, what: 'Spur east along Jl. Prof. Dr. Satrio, U-turn at about km 23.8, back to Sudirman' },
  { from: 26, to: 28.5, what: 'Jl. Jend. Sudirman south-west' },
  { from: 28.5, to: 32.2, what: 'South towards Jl. Prapanca Raya (km 29–32)' },
  { from: 32.2, to: 36, what: 'U-turn on Jl. Prapanca Raya, back north' },
  { from: 36, to: 38, what: 'Jl. Sisingamangaraja out and back, U-turn at about km 36.9' },
  { from: 38, to: 39, what: 'Jl. Jend. Sudirman towards Gelora Bung Karno' },
  { from: 39, to: 42.195, what: 'Around GBK, finish inside the Stadion Utama complex' },
]
const turns = [[2.1, 'Monas east turn'], [12.4, 'Mampang U-turn (southernmost point)'], [23.8, 'Satrio U-turn'], [28.7, 'Hairpin at the Sudirman / Senayan junction'], [32.2, 'Prapanca Raya U-turn'], [36.9, 'Sisingamangaraja U-turn (westernmost point)'], [39.7, 'Hairpin inside the GBK complex']].map(([km, name]) => ({ km, name, ll: at(km) }))
// elevation: tools/fetch_elevation.py (the official GPX has none) → samples every 50 m of official distance, whole metres
let elevation = null
if (fs.existsSync(U('./data/jakim-elev.json'))) { const e = JSON.parse(fs.readFileSync(U('./data/jakim-elev.json'), 'utf8')); elevation = { source: e.source, stepKm: 0.05, ele: e.ele } }
// elevation measured by the watch at Jakim 2026 (barometric altitude, Strava stream of the COROS recording): resampled to the same 50 m steps of official distance
if (elevation && fs.existsSync(U('./data/jakim-2026-altitude.json'))) {
  const w = JSON.parse(fs.readFileSync(U('./data/jakim-2026-altitude.json'), 'utf8')), n = elevation.ele.length, N = w.alt.length
  const at = (f) => { const x = Math.max(0, Math.min(N - 1, f * (N - 1))), i = Math.floor(x), j = Math.min(N - 1, i + 1); return w.alt[i] + (w.alt[j] - w.alt[i]) * (x - i) }
  const raw = elevation.ele.map((_, i) => at((i === n - 1 ? 42.195 : i * 0.05) / 42.195))
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, shift = mean(elevation.ele) - mean(raw) // barometer offset that day: the two curves are aligned on average, only their shape and gain are compared
  elevation.watch = { source: w.source, shiftM: +shift.toFixed(1), ele: raw.map((x) => +(x + shift).toFixed(1)) }
}
const out = { id: 'jakim', name: 'Jakarta International Marathon · BTN Jakim', source: 'Official BTN Jakim 2026 marathon GPX; the 2027 course map shows the same route.', trackKm: +(trackM / 1000).toFixed(2), officialKm: 42.195,
  elevation, corners, kmHeadings, bbox: [Math.min(...lat), Math.min(...lon), Math.max(...lat), Math.max(...lon)].map((x) => +x.toFixed(5)), start: at(0), finish: at(42.195), line, marks, turns, segments, gpx: 'routes/jakim-2026.gpx' }
fs.writeFileSync(U('../src/data/routes/jakim.json'), JSON.stringify(out) + '\n')
console.log(`${pts.length} points → ${line.length}; track ${out.trackKm} km scaled to 42.195; ${marks.length} km marks; ${turns.length} turns; ${corners.length} corners; ${(fs.statSync(U('../src/data/routes/jakim.json')).size / 1024).toFixed(1)} KB`)
