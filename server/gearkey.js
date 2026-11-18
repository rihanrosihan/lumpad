// Strava's public API names shoes "g12345" while the Strava MCP (and our daily ingest) uses the bare number "12345": same shoe, two ids.
// Everything is stored under the bare number; mergeGearIds() repairs rows written before this rule existed (idempotent, runs at startup).
export const gearKey = (id) => { const s = String(id ?? ''); return /^g\d+$/.test(s) ? s.slice(1) : s }
export function mergeGearIds(db) {
  const rows = db.prepare('SELECT * FROM gear').all().filter((g) => /^g\d+$/.test(g.id)); let merged = 0
  for (const g of rows) {
    const key = g.id.slice(1), twin = db.prepare('SELECT * FROM gear WHERE id=?').get(key)
    if (twin) { // the prefixed row comes from the live Strava profile: its name / retired flag win, mileage is the larger of the two
      db.prepare('UPDATE gear SET name=?, brand=?, model=?, distance_m=?, retired=?, pulled_at=? WHERE id=?').run(g.name ?? twin.name, g.brand ?? twin.brand, g.model ?? twin.model, Math.max(g.distance_m || 0, twin.distance_m || 0), g.retired ?? twin.retired, g.pulled_at, key)
      db.prepare('DELETE FROM gear WHERE id=?').run(g.id)
    } else db.prepare('UPDATE gear SET id=? WHERE id=?').run(key, g.id)
    merged++
  }
  const acts = db.prepare("SELECT id, gear_id FROM activities WHERE gear_id IS NOT NULL").all().filter((a) => /^g\d+$/.test(a.gear_id))
  for (const a of acts) db.prepare('UPDATE activities SET gear_id=? WHERE id=?').run(a.gear_id.slice(1), a.id)
  return { merged, activities: acts.length }
}
