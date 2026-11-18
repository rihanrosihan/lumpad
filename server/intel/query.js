// Query decomposition (blueprint §3.4.1): a free-text question → (a) SQL filters over fit_session, (b) the text query for FTS, (c) topics that pick
// the relevant correlation edges. Pure and deterministic (no LLM call), English + Indonesian keywords.
import { ATHLETE } from '../../src/lib/athlete.js'

const MONTHS = ['jan|january|januari', 'feb|february|februari', 'mar|march|maret', 'apr|april', 'may|mei', 'jun|june|juni', 'jul|july|juli', 'aug|august|agu|agustus', 'sep|sept|september', 'oct|october|okt|oktober', 'nov|november', 'dec|december|des|desember']
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const RACE_WORDS = [['borobudur', 'Borobudur'], ['jakim', 'Jakim'], ['jrf', 'JRF'], ['lps', 'LPS'], ['sentul', 'Sentul']]
const STOP = new Set(['hoka', 'asics', 'nike', 'adidas', 'puma', 'saucony', 'new', 'balance', 'brooks', 'mizuno', 'shoe', 'shoes', 'running', 'run'])
const TOPICS = [
  [/\bgct\b|ground contact|kontak/, ['gct_fade', 'gct_avg']], [/drift|decoupl|pa:?hr/, ['drift']], [/stride|langkah/, ['stride_fade']],
  [/gym|leg day|squat|calf|step-?up|leg curl|strength|beban/, ['strength_lower', 'strength_upper', 'strength_tl']], [/sleep|tidur/, ['sleep_min']], [/\bhrv\b/, ['hrv_dev']],
  [/threshold|double|tempo|ambang/, ['thr_min', 'double_days', 'quality_sessions', 'pace_hr150']], [/efficien|\bef\b|economy|ekonomi/, ['ef_resid']],
  [/durab|fade|run.?share|walk|jalan kaki/, ['run_share_long']], [/volume|mileage|km per week|weekly/, ['run_km', 'run_tl']],
]
export function decompose(question = '', { today = new Date().toISOString().slice(0, 10), gear = [] } = {}) {
  const q = String(question || '').toLowerCase(), f = {}
  // dates
  let m
  if (/\byesterday|kemarin\b/.test(q)) { f.from = f.to = addDays(today, -1) }
  else if (/\btoday|hari ini\b/.test(q)) { f.from = f.to = today }
  else if ((m = /\b(?:last|past|terakhir)\s+(\d{1,3})\s*(day|days|hari|week|weeks|minggu|month|months|bulan)\b/.exec(q)) || (m = /\b(\d{1,3})\s*(day|days|hari|week|weeks|minggu|month|months|bulan)\s+(?:terakhir|ago)\b/.exec(q))) {
    const n = +m[1], unit = /week|minggu/.test(m[2]) ? 7 : /month|bulan/.test(m[2]) ? 30 : 1; f.from = addDays(today, -n * unit); f.to = today
  } else if (/\b(last|past) week|minggu lalu|seminggu\b/.test(q)) { f.from = addDays(today, -7); f.to = today }
  else if (/\b(last|past) month|bulan lalu\b/.test(q)) { f.from = addDays(today, -30); f.to = today }
  if ((m = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(q))) { f.from = f.to = m[1] }
  else if (!f.from) {
    for (let i = 0; i < 12; i++) {
      // a month only counts with a year, a day number or "in/bulan/during" in front ("may" and "mar…athon" must not match)
      const re = new RegExp(`(?:\\b(?:in|on|during|since|bulan|sejak)\\s+(?:${MONTHS[i]})\\b(?:\\s+(20\\d{2}))?|\\b(?:${MONTHS[i]})\\s+(20\\d{2})\\b|\\b\\d{1,2}\\s+(?:${MONTHS[i]})\\b(?:\\s+(20\\d{2}))?)`)
      const mm = re.exec(q); if (!mm) continue
      const yy = mm[1] || mm[2] || mm[3], y = yy ? +yy : (i + 1 > +today.slice(5, 7) ? +today.slice(0, 4) - 1 : +today.slice(0, 4))
      f.from = `${y}-${String(i + 1).padStart(2, '0')}-01`; f.to = new Date(Date.UTC(y, i + 1, 0)).toISOString().slice(0, 10); break
    }
  }
  // named races → that race day (newest matching, or the year given)
  for (const [w, name] of RACE_WORDS) if (q.includes(w)) {
    const yr = (/\b(20\d{2})\b/.exec(q) || [])[1], hits = ATHLETE.races.filter((r) => r.name.includes(name) && (!yr || r.date.startsWith(yr)))
    if (hits.length) { const r = hits.at(-1); f.race = r.name; f.race_date = r.date; if (!f.from) { f.from = f.to = r.date } }
  }
  // distance / type
  if ((m = /\b(\d{1,2}(?:[.,]\d)?)\s?(?:k|km)\b/.exec(q))) { const k = parseFloat(m[1].replace(',', '.')); if (k >= 1) f.dist_km = [Math.round(k * 0.85 * 10) / 10, Math.round(k * 1.15 * 10) / 10] }
  if (/half|\bhm\b|setengah/.test(q)) f.dist_km = [19, 24]
  else if (/marathon|\bfm\b|maraton/.test(q) && !/half/.test(q)) f.dist_km = [35, 50]
  const kinds = []
  if (/long run|lari panjang|\blr\b/.test(q)) { kinds.push('long'); f.dist_km ||= [16, 50] }
  if (/\beasy|santai|z2\b|zone 2/.test(q)) kinds.push('easy')
  if (/tempo|threshold|interval|repeat|quality/.test(q)) kinds.push('quality')
  if (/\brace|lomba\b/.test(q)) kinds.push('race')
  if (/treadmill|bodimax|indoor/.test(q)) f.indoor = true
  if (kinds.length) f.kinds = kinds
  // heart rate thresholds
  if ((m = /(?:above|over|more than|>|di atas|lebih dari)\s*(\d{3})\s*(?:bpm)?/.exec(q))) f.hr_min = +m[1]
  if ((m = /(?:below|under|less than|<|di bawah|kurang dari)\s*(\d{3})\s*(?:bpm)?/.exec(q))) f.hr_max = +m[1]
  // shoes from the athlete's own garage: a distinctive word of the model name
  const shoes = gear.filter((g) => String(g.name || '').toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 4 && !STOP.has(w) && q.includes(w)) || (/x2\b/.test(q) && /x2\b/i.test(g.name)))
  if (shoes.length) f.shoes = shoes.map((g) => ({ id: g.id, name: g.name }))
  const topics = [...new Set(TOPICS.filter(([re]) => re.test(q)).flatMap(([, ids]) => ids))]
  if (shoes.length || /shoe|sepatu/.test(q)) topics.push('shoes')
  if (/heat|panas|wbgt|humid/.test(q)) topics.push('heat')
  return { filters: f, topics, has_filters: Object.keys(f).length > 0 }
}

// filters → a parameterised WHERE over fit_session (s) joined to run_weather (w)
export function filterSql(f = {}) {
  const w = [], p = []
  if (f.from) { w.push('s.date >= ?'); p.push(f.from) } if (f.to) { w.push('s.date <= ?'); p.push(f.to) }
  if (f.dist_km) { w.push('s.distance_m BETWEEN ? AND ?'); p.push(f.dist_km[0] * 1000, f.dist_km[1] * 1000) }
  if (f.hr_min) { w.push('s.run_hr >= ?'); p.push(f.hr_min) } if (f.hr_max) { w.push('s.run_hr <= ?'); p.push(f.hr_max) }
  if (f.indoor) w.push('COALESCE(w.indoor, 0) = 1')
  if (f.shoes?.length) { w.push(`s.shoe_id IN (${f.shoes.map(() => '?').join(',')})`); p.push(...f.shoes.map((s) => s.id)) }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p }
}
