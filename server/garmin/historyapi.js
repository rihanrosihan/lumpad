// Read model for the History screen (Garmin-primary era, 2024-09 → 2025-12): monthly roll-ups, weekly twin_history points and the headline totals.
// Pure reads; returns { available: false } when the import has not run. Handles are passed in (intel.db, lumpad.db).
const safe = (fn, d) => { try { return fn() } catch { return d } }
const num = (x) => (x == null || !Number.isFinite(+x) ? null : +x)

export function weeklyPoint(row) {
  const s = JSON.parse(row.state)
  return { date: row.as_of, ctl: num(s.load?.ctl), atl: num(s.load?.atl), tsb: num(s.load?.tsb), acwr: num(s.load?.acwr_uncoupled), weekly_km: num(s.load?.weekly_km_4w), longest_km: num(s.load?.longest_run_km_30d),
    ef: num(s.aerobic?.ef_easy_28d?.value), hr800: num(s.aerobic?.hr_at_800?.value), pace150: num(s.aerobic?.pace_at_hr150?.value), rhr: num(s.recovery?.rhr?.value ?? s.profile?.rhr_7d), hrv: num(s.recovery?.hrv?.roll7),
    asleep_min: num(s.recovery?.sleep?.asleep_min), vo2max: num(s.profile?.vo2max_garmin), gaps: s.gaps?.length || 0 }
}

export function historyPayload(idb, app) {
  const months = safe(() => idb.prepare('SELECT * FROM history_month ORDER BY month').all(), null)
  if (!months?.length) return { available: false }
  const weeks = safe(() => idb.prepare('SELECT as_of, state FROM twin_history ORDER BY as_of').all().map(weeklyPoint), [])
  const nights = safe(() => app.prepare('SELECT COUNT(*) n FROM health_daily_garmin WHERE sleep_total_min IS NOT NULL').get().n, null), days = safe(() => app.prepare('SELECT COUNT(*) n FROM health_daily_garmin').get().n, null)
  const acts = safe(() => app.prepare("SELECT COUNT(*) n, SUM(source='garmin') g FROM activities WHERE garmin_id IS NOT NULL").get(), {}), enrich = safe(() => app.prepare('SELECT COUNT(*) n FROM activity_enrichment').get().n, null)
  const sum = (k) => months.reduce((a, m) => a + (m[k] || 0), 0)
  return { available: true, era: 'garmin_hist', from: months[0].month, to: months.at(-1).month, months, weeks,
    totals: { runs: sum('run_n'), run_km: Math.round(sum('run_km')), strength: sum('strength_n'), walks: sum('walk_n'), other: sum('other_n'), sleep_nights: nights, health_days: days, activities_linked: acts.n ?? null, garmin_only: acts.g ?? null, enriched: enrich },
    note: 'Garmin is the primary source before 2026. Load, readiness, stress, Body Battery and race predictions are Garmin-scale and not comparable with COROS values.' }
}
