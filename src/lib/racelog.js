// A past race recorded by the watch: 1 km laps (watch distance) → numbers on the official distance. Pure → unit-tested.
export function makeLog(r) {
  const f = r.officialKm / r.gpsKm, laps = r.laps, kmOf = (i) => (i < laps.length - 1 ? 1 : r.lastLapKm) // GPS km of lap i
  const cumT = [], cumKm = []; let t = 0, k = 0
  laps.forEach((l, i) => { t += l.t; k += kmOf(i); cumT.push(t); cumKm.push(k) })
  // clock (s) at official km x: interpolate on the watch distance x / f
  const clockAt = (x) => { const d = Math.max(0, Math.min(cumKm.at(-1), x / f)); let i = cumKm.findIndex((c) => c >= d); if (i < 0) i = laps.length - 1; const a = i ? cumKm[i - 1] : 0, ta = i ? cumT[i - 1] : 0; return ta + ((d - a) / (cumKm[i] - a)) * (cumT[i] - ta) }
  const paceOf = (i) => laps[i].t / (kmOf(i) * f) // s per official km
  const per = laps.map((l, i) => ({ i, km: cumKm[i] * f, pace: paceOf(i), hr: l.hr, cad: l.cad, t: l.t, partial: i === laps.length - 1 }))
  const avgHr = (a, b) => { const xs = per.filter((p) => !p.partial && p.km > a && p.km - 0.975 < b).map((p) => p.hr); return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null }
  const avgPace = (a, b) => (clockAt(b) - clockAt(a)) / (b - a)
  return { f, per, cumT, cumKm, clockAt, avgHr, avgPace, total: cumT.at(-1), moving: r.movingS, stopped: r.elapsedS - r.movingS, slow: (th) => per.filter((p) => !p.partial && p.pace > th).length }
}
