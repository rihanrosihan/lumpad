// Gate → Calendar auto-scaler: when the readiness gate is active, the next 72 h of hard sessions are proposed as easy/rehab sessions.
// Pure functions; the overrides live in the synced store (key lumpad.scale) and never touch the plan data itself.
const HARDISH = new Set(['quality', 'tt', 'speed', 'long'])
export const SCALE_DAYS = 3
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)

// gate = { active, reasons[] } built by the caller from readiness tier / caps / distance progression
export function gateActive({ tierId, caps = 0, progPct = null } = {}) {
  const reasons = []
  if (tierId === 'compromised' || tierId === 'depleted') reasons.push(`Readiness tier ${tierId}`)
  if (caps > 0) reasons.push(`${caps} validated cap${caps > 1 ? 's' : ''} active`)
  if (progPct != null && progPct > 30) reasons.push(`Weekly distance +${progPct}% (> 30%)`)
  return { active: reasons.length > 0, reasons }
}
// → { [date]: { from: {kind,label,km}, to: {kind,label,km,scaled:true} } } for today..today+2 (races, gates and rest/gym days are never touched)
export function proposeScale(planByDate, today, gate) {
  const out = {}
  if (!gate?.active) return out
  for (let i = 0; i < SCALE_DAYS; i++) {
    const d = addDays(today, i), day = planByDate[d]
    if (!day || !HARDISH.has(day.kind) || /race|gate|CP\d/i.test(`${day.label} ${(day.tags || []).join(' ')}`)) continue
    const km = Math.max(3, Math.min(day.km || 5, Math.round((day.km || 5) * 0.6 * 10) / 10, 6))
    out[d] = { from: { kind: day.kind, label: day.label, km: day.km }, to: { kind: 'easy', label: 'Auto-scaled easy / rehab', km, scaled: true } }
  }
  return out
}
// the day as the app should show it: plan day with an active, still-current override merged in
export function effectiveDay(day, ov, today) {
  if (!day || !ov || day.date < today || !ov.to) return day
  return { ...day, kind: ov.to.kind, label: ov.to.label, km: ov.to.km, scaled: true, plannedLabel: day.label, plannedKm: day.km }
}
