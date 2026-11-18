// pure date helpers (no JSON import, so they run under node --test as well)
export const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const diffDays = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 864e5)
export const dowOf = (s) => new Date(s + 'T12:00:00Z').getUTCDay() // 0 = Sunday
export const mondayOf = (s) => addDays(s, -((dowOf(s) + 6) % 7))
