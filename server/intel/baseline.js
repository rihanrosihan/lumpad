// Monthly athlete baselines (audit H9). One row per metric per month in athlete_baseline: the reference the twin compares the current 28 days with.
// HR at 8:00/km: mean and SD over steady easy runs (3–15 km, ≥ 90 % running) in the 180 days that END 28 days before the month starts, so the window
// being judged never overlaps its own reference. Needs ≥ 10 runs; otherwise no row (the twin keeps the previous baseline or the seed). Idempotent.
import { idb, tx } from './db.js'

const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const r1 = (x) => Math.round(x * 10) / 10
export const MIN_N = 10, WINDOW_DAYS = 180, GAP_DAYS = 28

export function hr800Window(monthStart) { const to = addDays(monthStart, -GAP_DAYS); return { from: addDays(to, -WINDOW_DAYS), to } } // [from, to)
export function stats(v) { const n = v.length, m = v.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); return { n, mean: r1(m), sd: r1(sd) } }

export function baselineJob(T) {
  const month = T.slice(0, 7) + '-01'
  if (idb.prepare("SELECT 1 FROM athlete_baseline WHERE name='hr800' AND valid_from=?").get(month)) return { hr800: 'exists', valid_from: month }
  const { from, to } = hr800Window(month)
  const v = idb.prepare('SELECT hr800 FROM fit_session WHERE hr800 IS NOT NULL AND run_share >= 0.9 AND distance_m BETWEEN 3000 AND 15000 AND date >= ? AND date < ? ORDER BY date, start_ms, label_id').all(from, to).map((r) => r.hr800)
  if (v.length < MIN_N) return { hr800: 'too few runs', n: v.length, window: [from, to] }
  const s = stats(v)
  if (!(s.sd > 0)) return { hr800: 'no spread', n: s.n }
  tx(idb, () => {
    idb.prepare("UPDATE athlete_baseline SET valid_to=? WHERE name='hr800' AND valid_to IS NULL AND valid_from < ?").run(month, month)
    idb.prepare('INSERT INTO athlete_baseline (name, valid_from, valid_to, value, sd, n, source) VALUES (?,?,?,?,?,?,?)').run('hr800', month, null, s.mean, s.sd, s.n, `steady runs ${from}..${to}`)
  })
  return { hr800: 'written', valid_from: month, ...s }
}
