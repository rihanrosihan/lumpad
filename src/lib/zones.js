// Training zones (6 zones, threshold model — the same zone numbers COROS uses on the watch).
// HR zones are % of lactate-threshold HR; pace zones are % of threshold pace (time per km, so >100% = slower).
// Defaults come from the athlete baseline (lib/athlete.js): threshold pace 5:56/km = COROS fitness assessment (18 Nov 2026); LTHR 168 bpm = COROS setting.
import { ATHLETE } from './athlete.js'
// Both are editable in Profile › Training zones — copy the values from the COROS app (Profile › Zones) when they differ.
export const ZONE_DEFAULTS = { lthr: ATHLETE.lthr, tpace: ATHLETE.tpace_s, src: { lthr: ATHLETE.src.lthr, tpace: ATHLETE.src.tpace } }
export const ZONES = [
  null,
  { z: 1, name: 'Recovery', hr: [0, 0.84], pace: [1.3, 1.45] },
  { z: 2, name: 'Aerobic Endurance', hr: [0.85, 0.89], pace: [1.14, 1.29] },
  { z: 3, name: 'Aerobic Power', hr: [0.9, 0.94], pace: [1.06, 1.13] },
  { z: 4, name: 'Threshold', hr: [0.95, 0.99], pace: [1.01, 1.05] },
  { z: 5, name: 'Anaerobic Endurance', hr: [1.0, 1.02], pace: [0.97, 1.0] },
  { z: 6, name: 'Anaerobic Power', hr: [1.03, 1.06], pace: [0.9, 0.96] },
]
// pace COROS uses for its time estimates (fits its own estimates for this plan within ~2%) and training load per minute
const EST = { 1: 1.36, 2: 1.28, 3: 1.12, 4: 1.025, 5: 0.985, 6: 0.93 }
const TL_MIN = { 0: 0, 1: 1.2, 2: 1.68, 3: 2.74, 4: 3.86, 5: 5.0, 6: 6.0 }

// Upper bound (bpm, inclusive) of HR zones Z1..Z5; Z6 is everything above. Copied from the COROS app (Zones page): <136, 136–153, 154–162, 163–173, 174–180, >180.
// Lumpad's own percentage-of-LTHR model only applies when no explicit ends are set (engine metrics use that model and are unchanged).
export const HR_ENDS_DEFAULT = [135, 153, 162, 173, 180]
export const validEnds = (a) => Array.isArray(a) && a.length === 5 && a.every((x, i) => Number.isFinite(+x) && +x > 0 && (i === 0 || +x > +a[i - 1]))
export const cfgOf = (settings = {}) => ({ lthr: +settings.lthr || ZONE_DEFAULTS.lthr, tpace: +settings.tpace || ZONE_DEFAULTS.tpace, hrEnds: validEnds(settings.hrEnds) ? settings.hrEnds.map(Number) : HR_ENDS_DEFAULT })
// seconds per HR zone Z1..Z6 (6 values) from a { bpm: seconds } histogram
export function zonesFromHist(hist, ends = HR_ENDS_DEFAULT) {
  const z = Array(6).fill(0)
  for (const [bpm, sec] of Object.entries(hist || {})) { let k = 0; while (k < 5 && +bpm > ends[k]) k++; z[k] += sec }
  return z
}
export const hrRange = (z, cfg = ZONE_DEFAULTS) => { const Z = ZONES[z]; if (cfg.hrEnds && Z) return [z === 1 ? 0 : cfg.hrEnds[z - 2] + 1, z === 6 ? 999 : cfg.hrEnds[z - 1]]; return Z ? [z === 1 ? Math.round(cfg.lthr * 0.65) : Math.round(cfg.lthr * Z.hr[0]), Math.round(cfg.lthr * Z.hr[1])] : null }
export const paceRange = (z, cfg = ZONE_DEFAULTS) => { const Z = ZONES[z]; return Z ? [Math.round(cfg.tpace * Z.pace[0]), Math.round(cfg.tpace * Z.pace[1])] : null } // [fast, slow] s/km
export const fmtPace = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
export const fmtDur = (s) => { if (s == null) return '—'; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}` }

// Steps: { t: 'wu'|'cd'|'run'|'rec'|'tt'|'race'|'free', sec?, m?, z?, pace?: [fast, slow] s/km, note? } or { rep, steps: [...] }
export const flat = (steps) => steps.flatMap((s) => (s.rep ? Array.from({ length: s.rep }, () => s.steps).flat() : [s]))
export const stepKm = (steps) => Math.round(flat(steps).reduce((a, s) => a + (s.m || 0), 0) / 10) / 100 // distance sections only (COROS counts warm-up/cool-down time separately)
const secOf = (s, cfg) => s.sec ?? (s.m ? (s.m / 1000) * (s.pace ? (s.pace[0] + s.pace[1]) / 2 : cfg.tpace * (EST[s.z || 2])) : 0)
// estimated duration and COROS-style training load (calibrated on the COROS estimates of this plan)
export function estimate(steps, cfg = ZONE_DEFAULTS) {
  let sec = 0, tl = 0
  for (const s of flat(steps)) { const d = secOf(s, cfg); sec += d; if (s.t !== 'wu' && s.t !== 'cd') tl += (d / 60) * TL_MIN[s.z ?? (s.t === 'free' ? 2 : 0)] }
  return { sec: Math.round(sec), tl: Math.round(tl) }
}
// one line per step for the UI: { what, dose, z, hr: [lo,hi], pace: [fast,slow], note }
export function describe(steps, cfg = ZONE_DEFAULTS) {
  const one = (s) => {
    const what = { wu: 'Warm-up', cd: 'Cool-down', run: s.z ? ZONES[s.z].name : 'Run', rec: 'Recovery', tt: 'Time trial', race: 'Race', free: 'Free run' }[s.t]
    const dose = s.m ? (s.m >= 1000 ? `${+(s.m / 1000).toFixed(2)} km` : `${s.m} m`) : s.sec ? fmtDur(s.sec) : 'open (lap button)'
    return { what, dose, z: s.z || null, hr: s.hr || (s.z ? hrRange(s.z, cfg) : null), pace: s.pace || (s.z ? paceRange(s.z, cfg) : null), note: s.note || null }
  }
  return steps.map((s) => (s.rep ? { rep: s.rep, steps: s.steps.map(one) } : one(s)))
}
// compact one-liner: "WU 5′ · 3 km Z2 · 10 km Z3 · CD 5′"
export function summary(steps) {
  const one = (s) => s.t === 'wu' ? `WU ${s.sec ? Math.round(s.sec / 60) + '′' : (s.m / 1000) + ' km'}` : s.t === 'cd' ? `CD ${s.sec ? Math.round(s.sec / 60) + '′' : (s.m / 1000) + ' km'}`
    : s.t === 'free' ? 'free run' : `${s.m ? (s.m >= 1000 ? +(s.m / 1000).toFixed(2) + ' km' : s.m + ' m') : Math.round(s.sec / 60) + '′'}${s.pace ? ' @' + fmtPace((s.pace[0] + s.pace[1]) / 2) : s.z ? ' Z' + s.z : ''}`
  return steps.map((s) => (s.rep ? `${s.rep}× (${s.steps.map(one).join(' + ')})` : one(s))).join(' · ')
}

// ---- which zone a lap / second falls in (same 6 zones the plan and the watch use) ----
// index 0 = below Z1 (HR < 65 % LTHR, or pace slower than Z1: walking / standing), 1..6 = Z1..Z6
// boundaries are the same rounded bpm / pace numbers the plan displays, so a value shown as "Z2 143–150" is classified Z2
export const hrZoneOf = (hr, cfg = ZONE_DEFAULTS) => { if (!hr) return null; if (cfg.hrEnds) { let k = 1; while (k < 6 && hr > cfg.hrEnds[k - 1]) k++; return k }; if (hr < hrRange(1, cfg)[0]) return 0; for (let z = 1; z <= 5; z++) if (hr <= hrRange(z, cfg)[1]) return z; return 6 }
export const paceZoneOf = (pace, cfg = ZONE_DEFAULTS) => { if (!pace) return null; if (pace > paceRange(1, cfg)[1]) return 0; for (let z = 1; z <= 5; z++) if (pace >= paceRange(z, cfg)[0]) return z; return 6 }
// seconds per zone (index 0..6) from per-km laps, time-weighted
export function zoneSeconds(laps, cfg = ZONE_DEFAULTS) {
  const hr = Array(7).fill(0), pace = Array(7).fill(0)
  for (const l of laps || []) { const d = l.duration_s || 0, h = hrZoneOf(l.avg_hr, cfg), q = paceZoneOf(l.avg_pace_s_km, cfg); if (h != null) hr[h] += d; if (q != null) pace[q] += d }
  return { hr, pace }
}
