// Which shoe role a session kind calls for, and the least-recently-used active shoe in that role.
export const ROLE_FOR = { quality: ['plated', 'daily'], tt: ['plated', 'short', 'daily'], race: ['plated'], long: ['daily', 'plated', 'easy'], speed: ['short', 'daily'], easy: ['easy', 'daily'], social: ['easy', 'daily'] }
export function pickShoe(day, gear, roles = {}) {
  if (!day?.km) return null
  const active = (gear || []).filter((s) => !s.retired)
  for (const r of ROLE_FOR[day.kind] || ['daily']) { const c = active.filter((s) => roles[s.id] === r).sort((a, b) => (a.last_used || '').localeCompare(b.last_used || '')); if (c.length) return c[0] }
  return null
}
