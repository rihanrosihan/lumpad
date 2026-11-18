// COROS training schedule (queryTrainingSchedule) → [{ date, code, km, sec, tl }]. The tool answers in text blocks:
//   2027-01-01 / P10541 / Plan ID: … / idInPlan: … / Distance: 13.00 km / Estimated Time: 1:39:32 / Load: 221 TL
// Free-mode runs have no distance / time / load. Plan ids are not kept (COROS asks clients not to show them).
const toSec = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0)
export function parseSchedule(text) {
  const rows = []
  for (const block of String(text || '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean), date = lines.find((l) => /^\d{4}-\d{2}-\d{2}$/.test(l))
    if (!date) continue
    const code = lines.find((l) => /^P\d+$/.test(l)) || null, dist = block.match(/Distance:\s*([\d.]+)\s*(km|m)\b/i), time = block.match(/Estimated Time:\s*([\d:]+)/i), load = block.match(/Load:\s*(\d+)\s*TL/i)
    rows.push({ date, code, km: dist ? Math.round((dist[2].toLowerCase() === 'm' ? Number(dist[1]) / 1000 : Number(dist[1])) * 100) / 100 : null, sec: time ? toSec(time[1]) : null, tl: load ? Number(load[1]) : null })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

// Pull the schedule from `from` to `to` in chunks (the tool accepts months at a time) and return the merged rows.
export async function pullSchedule(call, from, to, addDays) {
  const rows = []
  for (let s = from; s <= to; s = addDays(s, 123)) { const e = addDays(s, 122) > to ? to : addDays(s, 122); rows.push(...parseSchedule(await call('queryTrainingSchedule', { startDate: s.replace(/-/g, ''), endDate: e.replace(/-/g, '') }))) }
  return [...new Map(rows.map((r) => [r.date, r])).values()].sort((a, b) => a.date.localeCompare(b.date))
}
