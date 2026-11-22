// Shoe links for the Garmin-era rows, from STRAVA ONLY (the Garmin export has no activity→gear mapping). Uses the app's own Strava sync (read calls) with
// sources=['garmin'] so no COROS row and no gear mileage is touched; then copies the shoe onto fit_session_hist (our table) and returns the links for the graph.
import { syncShoes } from '../strava.js'
import { openIntel } from './fitsession.js'
import { openLive } from './apply.js'

export async function linkShoes({ since = '2024-09-01', dry = true, fetchFn, live = openLive(), idb = openIntel() } = {}) {
  const res = await syncShoes({ since, sources: ['garmin'], writeGear: false, dry, returnHits: true, ...(fetchFn ? { fetchFn } : {}) })
  const gear = new Set(live.prepare('SELECT id FROM gear').all().map((g) => g.id)), known = res.hits.filter((h) => gear.has(h.gear_id)), missing = [...new Set(res.hits.filter((h) => !gear.has(h.gear_id)).map((h) => h.gear_id))]
  const out = { dry, strava_activities: res.stravaActivities, garmin_rows_matched: res.matched, with_known_shoe: known.length, unknown_shoe_ids: missing, runs_without_shoe_in_strava: res.noGear, unmatched_strava_runs: res.unmatched }
  if (dry) return out
  const set = idb.prepare('UPDATE fit_session_hist SET shoe_id=? WHERE app_id=?'); let fit = 0
  idb.exec('BEGIN'); try {
    for (const row of live.prepare("SELECT id, gear_id FROM activities WHERE gear_id IS NOT NULL AND (source='garmin' OR garmin_id IS NOT NULL)").all()) fit += Number(set.run(row.gear_id, row.id).changes)
    idb.exec('COMMIT')
  } catch (e) { idb.exec('ROLLBACK'); throw e }
  return { ...out, fit_session_hist_updated: fit, garmin_rows_with_gear: live.prepare("SELECT COUNT(*) n FROM activities WHERE source='garmin' AND gear_id IS NOT NULL").get().n }
}
