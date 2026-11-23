// Per-kilometre anomalies of ONE run, so the athlete can say what happened at km X instead of describing the whole session.
// Rules (the athlete's): an even pace is not an anomaly; a gradual heart-rate rise is not an anomaly; a heart-rate SPIKE is checked first against elevation gain and
// against a faster pace, and only an unexplained spike needs context. Pure function over the km rows of fit_session.km, no database.
const med = (a) => { const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
export const T = { pauseS: 30, walkS: 45, slowS: 30, slowPct: 0.08, firstKmSlowS: 60, fastS: 25, fastPct: 0.07, hrSpike: 8, hrStep: 7, climbM: 12, sectionKm: 5, majorBreakS: 120, fasterS: 12 }

export function detectAnomalies(km, { distance_m } = {}) {
  const rows = (km || []).filter((r) => r && r.km > 0), n = rows.length
  if (!n) return { base_pace_s_km: null, anomalies: [], series: [] }
  const frac = distance_m ? distance_m / 1000 - Math.floor(distance_m / 1000) : 0, partialLast = frac > 0 && frac < 0.5 // a few hundred metres at the end are not a kilometre
  const isRun = (r) => (r.runShare ?? 1) >= 0.8, base = med(rows.filter(isRun).map((r) => r.runPace || r.pace)) || med(rows.map((r) => r.pace))
  const perKm = []
  for (const [i, r] of rows.entries()) {
    const last = partialLast && i === n - 1, stop = r.stop || 0, walk = r.walk || 0, rp = r.runPace || r.pace; let kind = null, detail = null
    if (stop >= T.pauseS) { kind = 'pause'; detail = `stopped ${mmss(stop)}` }
    else if (walk >= T.walkS) { kind = 'walk'; detail = `walking ${Math.round(walk)} s${r.sec ? ` of ${Math.round(r.sec)} s (${Math.round((100 * walk) / r.sec)}%)` : ''}` }
    else if (!last && isRun(r) && base && rp - base >= Math.max(i === 0 ? T.firstKmSlowS : T.slowS, T.slowPct * base)) { kind = 'slow'; detail = `${mmss(rp)}/km vs usual ${mmss(base)}/km` }
    else if (!last && isRun(r) && base && base - rp >= Math.max(T.fastS, T.fastPct * base)) { kind = 'fast'; detail = `${mmss(rp)}/km vs usual ${mmss(base)}/km` }
    perKm.push({ km: r.km, kind, detail, stop_s: stop || undefined, walk_s: walk || undefined, major: stop + walk >= T.majorBreakS || (r.runShare ?? 1) < 0.5 })
  }
  // heart-rate spikes: against the previous running kilometres (the walking kilometres before it are naturally lower), then checked against climb and pace
  const spikes = [], runIdx = []
  for (const [i, r] of rows.entries()) {
    if (!isRun(r) || !r.hr) continue
    const prev = runIdx.slice(-3).map((j) => rows[j].hr).filter(Boolean), prevPace = runIdx.length ? rows[runIdx.at(-1)].runPace || rows[runIdx.at(-1)].pace : null
    if (prev.length >= 2 && !(partialLast && i === n - 1)) { // needs two earlier running kilometres: the first one or two are warm-up
      const jump = r.hr - med(prev), lastJump = r.hr - rows[runIdx.at(-1)].hr
      if (jump >= T.hrSpike && lastJump >= T.hrStep) {
        const climb = (r.gain || 0) >= T.climbM, faster = prevPace != null && prevPace - (r.runPace || r.pace) >= T.fasterS, by = climb ? 'climb' : faster ? 'faster pace' : null
        spikes.push({ kind: 'hr_spike', km_from: r.km, km_to: r.km, detail: `heart rate ${r.hr} (+${Math.round(jump)} vs the kilometres before)${climb ? `; climbed ${r.gain} m in this km` : ''}${faster ? `; pace ${mmss(r.runPace || r.pace)}/km, ${Math.round(prevPace - (r.runPace || r.pace))} s faster` : ''}`, explained_by: by, needs_context: !by, hr: r.hr, gain_m: r.gain ?? null })
      }
    }
    runIdx.push(i)
  }
  // walking and stopping are one story: adjacent walk / pause kilometres become one section (at most sectionKm long, so a run-walk race is a handful of questions, not forty)
  const out = []
  for (const k of perKm) {
    if (!k.kind) continue
    const L = out.at(-1), brk = k.kind === 'walk' || k.kind === 'pause'
    // a small stop is not folded into a long walk, or the other way round
    if (L && (L.kind === 'walk' || L.kind === 'pause') && brk && k.km === L.km_to + 1 && k.km - L.km_from < T.sectionKm && k.major === L.major) { L.km_to = k.km; L.stop_s = (L.stop_s || 0) + (k.stop_s || 0) || undefined; L.walk_s = (L.walk_s || 0) + (k.walk_s || 0) || undefined }
    else if (L && L.kind === k.kind && !brk && k.km === L.km_to + 1) L.km_to = k.km
    else out.push({ kind: k.kind, km_from: k.km, km_to: k.km, detail: k.detail, stop_s: k.stop_s, walk_s: k.walk_s, major: k.major, needs_context: true })
  }
  for (const L of out) if (L.kind === 'walk' || L.kind === 'pause') { const w = Math.round(L.walk_s || 0), st = Math.round(L.stop_s || 0); L.kind = st > w ? 'pause' : 'walk'; L.detail = `${w ? `walking ${mmss(w)}` : ''}${w && st ? ', ' : ''}${st ? `stopped ${mmss(st)}` : ''} over ${L.km_to > L.km_from ? `km ${L.km_from}–${L.km_to}` : `km ${L.km_from}`}` }
  const all = [...out.map(({ major, ...a }) => a), ...spikes].sort((a, b) => a.km_from - b.km_from || (a.kind < b.kind ? -1 : 1)).map((a) => ({ ...a, stop_s: a.stop_s ? Math.round(a.stop_s) : undefined, walk_s: a.walk_s ? Math.round(a.walk_s) : undefined }))
  const flag = new Map(); for (const a of all) for (let k = a.km_from; k <= a.km_to; k++) if (!flag.has(k) || a.needs_context) flag.set(k, a.kind)
  return { base_pace_s_km: base ? Math.round(base) : null, anomalies: all, series: rows.map((r) => ({ km: r.km, pace: r.pace ?? null, hr: r.hr ?? null, gain: r.gain ?? null, run_share: r.runShare ?? null, flag: flag.get(r.km) || null })) }
}
