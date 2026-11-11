import { fmtPace } from './vdot.js'
// What to run, as pace lines derived from the latest VDOT (never typed). [ALGORITHMIC]
export function sessionPaces(day, p) {
  if (!day) return []
  const l = day.label.toLowerCase(), E = `${fmtPace(p.E[1])}–${fmtPace(p.E[0])}`, out = []
  const mp = (day.tags || []).find((t) => t.startsWith('MP'))
  switch (day.kind) {
    case 'easy': case 'social': out.push(['Easy', E + ' /km']); break
    case 'long':
      out.push(['Easy', E + ' /km'])
      if (mp) out.push(['Blok ' + mp, fmtPace(p.M) + ' /km (slot terbaru)'])
      break
    case 'speed': out.push(['Easy', E + ' /km']); out.push(['Strides / hills', 'cepat terkontrol, ≈ I ' + fmtPace(p.I) + ' /km, recovery penuh']); break
    case 'quality':
      if (/repeats|into|interval|400|600|800|mile/.test(l)) out.push(['I', fmtPace(p.I) + ' /km'])
      if (/tempo|steady|progressive|over|broken|on off|@mp|m-reps/.test(l)) out.push(['T', fmtPace(p.T) + ' /km'], ['Sub-T', fmtPace(p.subT) + ' /km'])
      if (!out.length) out.push(['T', fmtPace(p.T) + ' /km'], ['I', fmtPace(p.I) + ' /km'])
      out.push(['Easy (jeda)', E + ' /km']); break
    case 'tt': out.push(['Effort', 'all-out terkontrol; hasil menentukan benchmark']); break
    case 'race': out.push(['Race', /fm/.test(l) && /jrf/.test(l) ? '5:41 /km (sub-4) — lihat gate CP18' : 'finish-first, bukan tes VDOT']); break
    default: break
  }
  return out
}
