// D7: anonymous field aggregates from crawled public race-result databases (third-party personal data, class S3). Deterministic SQL/JS, zero LLM tokens. Participant names are NEVER stored
// or printed: the name column is read only to locate the athlete's own row for the percentile. Output = counts, quantiles and median paces per finish-time band (ol_field_stat).
import { DatabaseSync } from 'node:sqlite'

const sec = (t) => { const m = /^(\d+):(\d\d):(\d\d)$/.exec(String(t || '').trim()); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null }
const pace = (t) => { const m = /^(\d+):(\d\d)$/.exec(String(t || '').trim()); return m ? +m[1] * 60 + +m[2] : null }
export const q = (a, p) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
export const BANDS = { FM: [['<4h', 0, 4 * 3600], ['4-5h', 4 * 3600, 5 * 3600], ['5-6h', 5 * 3600, 6 * 3600], ['6-7h', 6 * 3600, 7 * 3600], ['>=7h', 7 * 3600, 1e9]], '10K': [['<50m', 0, 3000], ['50-60m', 3000, 3600], ['60-75m', 3600, 4500], ['75-90m', 4500, 5400], ['>=90m', 5400, 1e9]] }

// events: [{ event, file, scope, distance (participants.distance), race_date, band_key, me: { bib?, name? } }]
export function runField({ db, events, log = () => {} }) {
  const ins = db.prepare('INSERT OR REPLACE INTO ol_field_stat VALUES (?,?,?,?,?,?)'), out = {}
  for (const ev of events) {
    db.prepare('DELETE FROM ol_field_stat WHERE event=? AND scope=?').run(ev.event, ev.scope)   // re-runs replace, never accumulate
    const f = new DatabaseSync(ev.file, { readOnly: true }), rows = f.prepare('SELECT bib, status, net_time, upper(name) AS nm FROM participants WHERE distance=?').all(ev.distance)
    const put = (band, metric, value, n) => { if (value != null && Number.isFinite(value)) ins.run(ev.event, ev.scope, band, metric, Math.round(value * 100) / 100, n) }
    const stat = {}; for (const r of rows) stat[r.status] = (stat[r.status] || 0) + 1
    for (const [k, v] of Object.entries(stat)) put('all', 'status:' + k, v, rows.length)
    put('all', 'starters', rows.length - (stat.DNS || 0), rows.length)
    const fin = rows.filter((r) => r.status === 'Finished').map((r) => ({ ...r, s: sec(r.net_time) })).filter((r) => r.s)
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) put('all', `finish_s_p${p * 100}`, q(fin.map((r) => r.s), p), fin.length)
    // the athlete's own percentile (name used only to find the row)
    const me = fin.find((r) => (ev.me?.bib && r.bib === ev.me.bib) || (ev.me?.name && r.nm.startsWith(ev.me.name)))
    if (me) { put('athlete', 'finish_s', me.s, fin.length); put('athlete', 'rank_among_finishers', fin.filter((r) => r.s < me.s).length + 1, fin.length); put('athlete', 'percentile_faster_than', 100 * fin.filter((r) => r.s > me.s).length / fin.length, fin.length) }
    // checkpoints: reach share (attrition) and median segment pace per finish band
    const cp = f.prepare('SELECT s.split_order, MIN(s.km) AS km FROM splits s JOIN participants p ON p.bib = s.bib WHERE p.distance = ? GROUP BY s.split_order ORDER BY s.split_order').all(ev.distance), band = new Map(); for (const [name, lo, hi] of BANDS[ev.band_key]) band.set(name, new Set(fin.filter((r) => r.s >= lo && r.s < hi).map((r) => r.bib)))
    for (const c of cp) {
      const sp = f.prepare('SELECT s.bib, s.split_time, s.pace FROM splits s JOIN participants p ON p.bib = s.bib WHERE s.split_order = ? AND p.distance = ?').all(c.split_order, ev.distance)
      // (no attrition metric: the crawl holds splits for every starter, so 'reach share' would read 100 % everywhere and mean nothing)
      for (const [name, set] of band) { const p = sp.filter((r) => set.has(r.bib)).map((r) => pace(r.pace)).filter(Boolean); put(name, `seg_pace_s@km${c.km}`, q(p, 0.5), p.length) }
    }
    for (const [name, set] of band) put(name, 'finishers', set.size, fin.length)
    out[ev.event + '/' + ev.scope] = { participants: rows.length, finished: fin.length, athlete_found: !!me, checkpoints: cp.length }; f.close()
  }
  log('field:', JSON.stringify(out)); return out
}
export const EVENTS = (dir) => [
  { event: 'jakim-2026', file: dir + '/jakim2026.sqlite', scope: 'FM', distance: 'Marathon', race_date: '2026-06-14', band_key: 'FM', me: { bib: '44708' } },
  { event: 'milo-2025', file: dir + '/milo2025.sqlite', scope: '10K', distance: '10K', race_date: '2025-12-07', band_key: '10K', me: { name: 'RIHAN ROSIHAN' } },
  { event: 'guardian-2025', file: dir + '/guardian2025.sqlite', scope: '10K', distance: '10K', race_date: '2025-09-21', band_key: '10K', me: { name: 'RIHAN ROSIHAN' } },
]
