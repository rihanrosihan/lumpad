// Elevation profile maths for a course. ele = metres every `step` km (index i ↔ km i·step, last sample = finish). Pure → unit-tested.
// the terrain model is a surface model: roofs and flyovers show up as spikes (e.g. the GBK stadium at the finish). A sample that is more than
// `tol` m away from the median of its neighbours (±10 samples = ±500 m) is replaced by that median.
export const despike = (a, w = 10, tol = 8) => a.map((v, i) => { const lo = Math.max(0, i - w), hi = Math.min(a.length - 1, i + w), m = [...a.slice(lo, hi + 1)].sort((x, y) => x - y)[Math.floor((hi - lo) / 2)]; return Math.abs(v - m) > tol ? m : v })
export const smooth = (a, w) => a.map((_, i) => { const lo = Math.max(0, i - w), hi = Math.min(a.length - 1, i + w); let s = 0; for (let j = lo; j <= hi; j++) s += a[j]; return s / (hi - lo + 1) })
export const kmAt = (i, n, step, total) => (i >= n - 1 ? total : i * step)
export function makeProfile(ele, step = 0.05, total = 42.195, win = 10) {
  const n = ele.length, km = ele.map((_, i) => kmAt(i, n, step, total)), clean = despike(ele), s = smooth(clean, win)
  const idx = (k) => { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; km[m] <= k ? lo = m : hi = m } return lo }
  const at = (k) => { k = Math.max(0, Math.min(total, k)); const i = idx(k), j = Math.min(n - 1, i + 1), f = km[j] > km[i] ? (k - km[i]) / (km[j] - km[i]) : 0; return s[i] + f * (s[j] - s[i]) }
  // average grade (%) over a window of `m` metres centred on km k
  const grade = (k, m = 300) => { const h = m / 2000, a = Math.max(0, k - h), b = Math.min(total, k + h); return b > a ? ((at(b) - at(a)) / ((b - a) * 1000)) * 100 : 0 }
  // gain / loss / min / max / average grade / steepest 300 m between two km marks
  const stats = (a, b) => {
    let gain = 0, loss = 0, lo = Infinity, hi = -Infinity, up = 0, down = 0
    for (let k = a; k < b; k += 0.05) { const e0 = at(k), e1 = at(Math.min(b, k + 0.05)); gain += Math.max(0, e1 - e0); loss += Math.max(0, e0 - e1); lo = Math.min(lo, e0); hi = Math.max(hi, e0) }
    for (let k = a; k <= b; k += 0.1) { const g = grade(Math.max(a, Math.min(b, k))); up = Math.max(up, g); down = Math.min(down, g) }
    return { gain, loss, min: lo === Infinity ? at(a) : lo, max: hi === -Infinity ? at(a) : hi, avg: b > a ? ((at(b) - at(a)) / ((b - a) * 1000)) * 100 : 0, steepUp: up, steepDown: down, len: b - a }
  }
  // main climbs: valley → peak rises of at least `minGain` m. Zig-zag with hysteresis `rev` (a reversal needs a drop/rise of that many metres),
  // so a small wiggle on the way up does not split one climb in two.
  const climbs = (minGain = 8, rev = 4) => {
    const piv = [{ i: 0, v: s[0] }]; let dir = 0, cand = { i: 0, v: s[0] }
    for (let i = 1; i < n; i++) {
      if (dir === 0) { if (s[i] - s[0] >= rev) { dir = 1; cand = { i, v: s[i] } } else if (s[0] - s[i] >= rev) { dir = -1; cand = { i, v: s[i] } } }
      else if (dir === 1) { if (s[i] > cand.v) cand = { i, v: s[i] }; else if (cand.v - s[i] >= rev) { piv.push(cand); dir = -1; cand = { i, v: s[i] } } }
      else { if (s[i] < cand.v) cand = { i, v: s[i] }; else if (s[i] - cand.v >= rev) { piv.push(cand); dir = 1; cand = { i, v: s[i] } } }
    }
    piv.push(cand.i > piv.at(-1).i ? cand : { i: n - 1, v: s[n - 1] })
    const out = []; for (let x = 0; x < piv.length - 1; x++) { const a = piv[x], b = piv[x + 1], g = b.v - a.v; if (g >= minGain) out.push({ a: km[a.i], b: km[b.i], gain: g, len: km[b.i] - km[a.i], avg: (g / ((km[b.i] - km[a.i]) * 1000)) * 100, top: b.v, base: a.v }) }
    return out.map((c, i) => ({ ...c, id: 'T' + (i + 1) }))
  }
  // share of distance by grade class (300 m window)
  const CLASSES = [['down', 'Downhill', (g) => g <= -0.5], ['flat', 'Flat', (g) => g > -0.5 && g < 0.5], ['gentle', 'Gentle rise', (g) => g >= 0.5 && g < 1.5], ['rise', 'Rise', (g) => g >= 1.5]]
  const classOf = (g) => CLASSES.find(([, , f]) => f(g))[0]
  const composition = () => { const t = { down: 0, flat: 0, gentle: 0, rise: 0 }; for (let k = 0.025; k < total; k += 0.05) t[classOf(grade(k))] += 0.05; return CLASSES.map(([id, label]) => ({ id, label, km: t[id], pct: (t[id] / total) * 100 })) }
  const perKm = () => Array.from({ length: 43 }, (_, j) => { const a = j, b = Math.min(total, j + 1); return a >= total ? null : { km: j + 1, ...stats(a, b) } }).filter(Boolean)
  return { n, km, s, raw: ele, clean, total, at, grade, stats, climbs, composition, classOf, perKm, CLASSES }
}
