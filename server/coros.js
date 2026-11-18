// COROS: no verified public API for individual developers (open item 9). Fallback = FIT file import.
// Units per COROS docs in project: distance 0.01 m, time s — FIT gives metres/seconds directly.
import FitParser from 'fit-file-parser'
export const status = () => ({ api: 'unverified', fallback: 'FIT import', note: 'Export FIT from the COROS app, or a download URL from the COROS tool in a coach session.' })
export function parseFit(buf) {
  return new Promise((resolve, reject) => {
    new FitParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm', mode: 'list' }).parse(buf, (err, d) => {
      if (err) return reject(err)
      const laps = (d.laps || []).map((l, i) => ({
        lap: i + 1, distance: l.total_distance, time: l.total_timer_time,
        pace: l.total_distance ? l.total_timer_time / (l.total_distance / 1000) : null, // s/km
        hr: l.avg_heart_rate ?? null, cadence: l.avg_cadence != null ? l.avg_cadence * 2 : null, power: l.avg_power ?? null,
      }))
      const s = (d.sessions || [])[0] || {}
      resolve({ source: 'coros-fit', date: s.start_time, sport: s.sport, distance: s.total_distance, time: s.total_timer_time, laps, pulledAt: new Date().toISOString() })
    })
  })
}
