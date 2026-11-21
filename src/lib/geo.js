// Pure helpers for the Google-backed screens (place names, air quality at the run's hour, map styles).
export const tsMs = (t) => { const n = Number(t); return Number.isFinite(n) && n > 0 ? (n > 1e12 ? n : n * 1000) : null }
// how many hours of air history to ask for so that the run's start is inside the window (1..720, the API limit)
export const hoursBack = (startMs, nowMs = Date.now()) => Math.max(1, Math.min(720, Math.ceil((nowMs - startMs) / 3600e3) + 2))
// the history entry closest to the run start, only if it is within 90 minutes of it (otherwise null: never show a different hour as if it were the run's)
export function airAtHour(hours, startMs) {
  let best = null, bd = Infinity
  for (const h of hours || []) { const t = Date.parse(h.at); if (!Number.isFinite(t)) continue; const d = Math.abs(t - startMs); if (d < bd) { bd = d; best = h } }
  return best && bd <= 90 * 60e3 ? best : null
}
export const MAP_STYLES = [['clean', 'Clean Map'], ['street', 'Street Map'], ['roadmap', 'Google Roadmap'], ['satellite', 'Google Satellite'], ['terrain', 'Google Terrain']]
export const GOOGLE_STYLES = ['roadmap', 'satellite', 'terrain']
export const googleTileUrl = (t) => `/api/map/tile?z={z}&x={x}&y={y}&t=${t}`
export const airSign = (category) => { const c = String(category || '').toLowerCase(); return /excellent|good/.test(c) ? ['Good', 'good'] : /moderate|fair/.test(c) ? ['Normal', 'normal'] : c ? ['High', 'high'] : ['—', 'normal'] }

// ---- route drawing / export -------------------------------------------------------------------------------------------------------------------
export function svgRoute(points, w = 320, h = 200, pad = 10) {
  if (!points?.length) return { d: '', proj: () => [0, 0] }
  const las = points.map((p) => p[0]), los = points.map((p) => p[1]), la0 = Math.min(...las), la1 = Math.max(...las), lo0 = Math.min(...los), lo1 = Math.max(...los)
  const kx = Math.cos(((la0 + la1) / 2) * Math.PI / 180), sx = (w - 2 * pad) / Math.max(1e-9, (lo1 - lo0) * kx), sy = (h - 2 * pad) / Math.max(1e-9, la1 - la0), s = Math.min(sx, sy)
  const ox = (w - (lo1 - lo0) * kx * s) / 2, oy = (h - (la1 - la0) * s) / 2
  const proj = ([la, lo]) => [+(ox + (lo - lo0) * kx * s).toFixed(1), +(oy + (la1 - la) * s).toFixed(1)]
  return { d: points.map((p, i) => (i ? 'L' : 'M') + proj(p).join(' ')).join(''), proj }
}
export const elevPath = (el, w = 320, h = 70) => { const v = (el || []).filter((x) => x != null); if (v.length < 2) return ''; const lo = Math.min(...v), hi = Math.max(...v), span = Math.max(1, hi - lo); return v.map((e, i) => `${i ? 'L' : 'M'}${(i / (v.length - 1) * w).toFixed(1)} ${(h - 4 - ((e - lo) / span) * (h - 8)).toFixed(1)}`).join('') }
export const gpx = (name, pts) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Lumpad" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${String(name).replace(/[<>&]/g, '')}</name><trkseg>${pts.map(([a, b]) => `<trkpt lat="${a.toFixed(5)}" lon="${b.toFixed(5)}"/>`).join('')}</trkseg></trk></gpx>`
// ---- race-day travel ------------------------------------------------------------------------------------------------------------------------
const p2 = (n) => String(n).padStart(2, '0')
// "2027-10-24" + "02:15" at a UTC offset (seconds) → ISO with that offset
export const localIso = (date, hhmm, offsetS) => { const o = Math.abs(offsetS), sg = offsetS < 0 ? '-' : '+'; return `${date}T${hhmm}:00${sg}${p2(Math.floor(o / 3600))}:${p2(Math.floor((o % 3600) / 60))}` }
// clock time you must leave: arrive-by (HH:MM) minus travel minutes minus a buffer; may roll to the previous day
export function leaveBy(arriveHhmm, minutes, bufferMin = 10) { const [h, m] = arriveHhmm.split(':').map(Number); let t = h * 60 + m - Math.round(minutes) - bufferMin, day = 0; while (t < 0) { t += 1440; day-- } return { hhmm: `${p2(Math.floor(t / 60) % 24)}:${p2(t % 60)}`, dayOffset: day } }
export const bearing = ([a, b], [c, d]) => { const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r); return Math.round(((Math.atan2(y, x) / r) + 360) % 360) }
// heading of the course at the track point nearest to pos (looking `ahead` points forward)
export function courseHeading(track, pos, ahead = 6) { let bi = 0, bd = Infinity; track.forEach((p, i) => { const d = (p[0] - pos[0]) ** 2 + (p[1] - pos[1]) ** 2; if (d < bd) { bd = d; bi = i } }); const j = Math.min(track.length - 1, bi + ahead), i0 = j === bi ? Math.max(0, bi - ahead) : bi; return bearing(track[i0], track[j]) }
