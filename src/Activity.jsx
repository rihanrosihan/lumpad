import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Chart from 'chart.js/auto'
import './styles-v61.css'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, MONTHS } from './lib/calendar.js'
import { efOf, decoupling, cumulativeKm } from './lib/analysis.js'
import { mean } from './lib/stats.js'
import { useStore } from './store.js'
import { Icon, Info } from './ui.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'
import { tsMs, hoursBack, airAtHour, airSign, googleTileUrl, MAP_STYLES, GOOGLE_STYLES } from './lib/geo.js'
import { cfgOf, hrRange, paceRange, zoneSeconds, zonesFromHist, ZONES } from './lib/zones.js'
import { FitPanel } from './FitPanel.jsx'
import ActivityCoach from './ActivityCoach.jsx'
import { OFFICIAL_RACES as OFFICIAL_BASE } from './data/officialRaces.js'
import { mergeOfficial, splitsToText, parseSplits, safeUrl } from './lib/official.js'
import { RouteIntel } from './GoogleRoute.jsx'
import LongRunContext from './LongRunContext.jsx'

const WORKOUT_TAGS = ['Easy', 'Tempo', 'Interval', 'Long Run', 'Race']
const FEEL_ITEMS = [
  ['Strong', 'pos'], ['Smooth', 'pos'], ['Fresh', 'pos'], ['Well fueled', 'pos'],
  ['Steady', 'neu'], ['Hot', 'neu'], ['Humid', 'neu'], ['Hilly', 'neu'],
  ['Fatigued', 'neg'], ['GI issue', 'neg'], ['Sore', 'neg'], ['Poor AQI', 'neg'],
]
const FEEL_ADVICE = {
  Strong: 'Strong aerobic and mechanical response — keep progression on track.',
  Smooth: 'Clean rhythm and relaxed mechanics throughout the session.',
  Fresh: 'Good recovery readiness — legs absorbed the load cleanly.',
  'Well fueled': 'Consistent energy delivery — keep this fueling approach.',
  Steady: 'Controlled effort right inside target zone.',
  Hot: 'Thermal strain elevated HR above pace — judge effort by HR.',
  Humid: 'High humidity limited cooling — increase sodium and fluid intake.',
  Hilly: 'Elevation shifts drove pace variance — evaluate by GAP.',
  Fatigued: 'Elevated fatigue logged — prioritize easy Z1/Z2 recovery.',
  'GI issue': 'GI distress logged — test lower-osmolality gels and earlier small sips.',
  Sore: 'Soreness logged — check 24h pain score before next quality session.',
  'Poor AQI': 'High PM2.5 load — keep outdoor effort in Z2 or move indoors.',
}



const km = (m) => (m == null ? '—' : (m / 1000).toFixed(m < 10000 ? 2 : 1))
const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`] }
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

function inferTag(a) {
  if (!a) return 'Easy'
  if (a.sport_class === 'strength') return 'Gym'
  if (OFFICIAL_BASE[a.date] || /marathon|race|hm\b|10k|5k/i.test(a.name || '')) return 'Race'
  const d = BY_DATE[a.date]
  if (d?.kind === 'race' || d?.kind === 'tt') return 'Race'
  if (d?.kind === 'long' || (a.distance_m || 0) >= 20000) return 'Long Run'
  if (d?.kind === 'quality') return /interval|400|600|800|repeat/i.test(d.label || '') ? 'Interval' : 'Tempo'
  return 'Easy'
}

function tagPillCls(t) {
  if (t === 'Race') return 'red'
  if (t === 'Long Run') return 'cobalt'
  if (t === 'Tempo') return 'amber'
  if (t === 'Interval') return 'purple'
  if (t === 'Easy') return 'green'
  return ''
}

function decodePolyline(str) {
  if (!str || typeof str !== 'string') return []
  let idx = 0, lat = 0, lng = 0
  const pts = []
  while (idx < str.length) {
    let b, shift = 0, res = 0
    do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += (res & 1) ? ~(res >> 1) : (res >> 1)
    shift = 0; res = 0
    do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += (res & 1) ? ~(res >> 1) : (res >> 1)
    pts.push([lat / 1e5, lng / 1e5])
  }
  return pts
}

function extractRouteCoords(a) {
  if (!a) return []
  const poly = a.summary_polyline || a.map?.summary_polyline || a.polyline
  if (poly) { const d = decodePolyline(poly); if (d.length >= 2) return d }
  if (Array.isArray(a.track) && a.track.length >= 2) {
    return a.track.map((p) => Array.isArray(p) ? p : [p.lat, p.lon ?? p.lng]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  }
  return [] // a route is drawn only from real data (the FIT file via /api/intel/stream, or a polyline/track on the record)
}

function olsLine(pts) {
  if (!pts || pts.length < 2) return []
  const n = pts.length
  const sx = pts.reduce((a, p) => a + p.x, 0), sy = pts.reduce((a, p) => a + p.y, 0)
  const sxy = pts.reduce((a, p) => a + p.x * p.y, 0), sx2 = pts.reduce((a, p) => a + p.x * p.x, 0)
  const m = (n * sxy - sx * sy) / ((n * sx2 - sx * sx) || 1)
  const b = (sy - m * sx) / n
  const lo = Math.min(...pts.map((p) => p.x)), hi = Math.max(...pts.map((p) => p.x))
  return [{ x: lo, y: Number((m * lo + b).toFixed(3)) }, { x: hi, y: Number((m * hi + b).toFixed(3)) }]
}

function fmtDeltaSec(diff) {
  if (diff == null || Number.isNaN(diff)) return { text: '—', color: 'var(--v-muted)' }
  const r = Math.round(diff)
  if (r === 0) return { text: '0:00', color: 'var(--v-muted)' }
  const s = Math.abs(r)
  return { text: `${r > 0 ? '+' : '-'}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, color: r > 0 ? 'var(--v-green-t)' : 'var(--v-red-t)' }
}

function fmtZoneDur(sec) {
  const s = Math.max(0, Math.round(sec || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`
  return `${r}s`
}

const ZCOL = ['#06B6D4', '#22C55E', '#EAB308', '#F97316', '#EF4444', '#C026D3', '#9333EA']
const ZROWS = (cfg, kind) => (kind === 'hr' && cfg.hrEnds ? [1, 2, 3, 4, 5, 6].map((z) => { const r = hrRange(z, cfg); return { k: `Z${z} ${ZONES[z].name} · ${z === 1 ? '<' + (r[1] + 1) : z === 6 ? '>' + (r[0] - 1) : r[0] + '–' + r[1]} bpm`, c: ZCOL[z] } })
  : [kind === 'hr' ? `<Z1 · <${Math.round(cfg.lthr * 0.65)} bpm` : 'Slower · <Z1', ...[1, 2, 3, 4, 5, 6].map((z) => {
    const r = kind === 'hr' ? hrRange(z, cfg) : paceRange(z, cfg)
    return kind === 'hr' ? `Z${z} ${ZONES[z].name} · ${z === 6 ? r[0] + '+' : r[0] + '–' + r[1]} bpm` : `Z${z} ${ZONES[z].name} · ${fmtPaceS(r[0])}–${fmtPaceS(r[1])}`
  })].map((k, i) => ({ k, c: ZCOL[i] || '#9333EA' })))

function computePowerZones(laps, ftp = 199) {
  const defs = [
    ['Z1 Active Rec', `1–${Math.round(ftp * 0.52)}w`, 0, ftp * 0.52, '#06B6D4'],
    ['Z2 Endurance', `${Math.round(ftp * 0.52) + 1}–${Math.round(ftp * 0.71)}w`, ftp * 0.52, ftp * 0.71, '#22C55E'],
    ['Z3 Tempo', `${Math.round(ftp * 0.71) + 1}–${Math.round(ftp * 0.86)}w`, ftp * 0.71, ftp * 0.86, '#EAB308'],
    ['Z4 Threshold', `${Math.round(ftp * 0.86) + 1}–${ftp}w`, ftp * 0.86, ftp, '#F97316'],
    ['Z5 VO2 Max', `${ftp + 1}–${Math.round(ftp * 1.15)}w`, ftp, ftp * 1.15, '#EF4444'],
    ['Z6 Anaerobic', `${Math.round(ftp * 1.15) + 1}w+`, ftp * 1.15, 9999, '#C026D3'],
  ]
  const secs = defs.map(() => 0)
  let ss = 0
  for (const l of laps) {
    const pw = l.power, dur = l.duration_s || 0
    if (!pw || !dur) continue
    const idx = defs.findIndex((d) => pw > d[2] && pw <= d[3])
    if (idx >= 0) secs[idx] += dur
    if (pw >= ftp * 0.80 && pw <= ftp * 0.93) ss += dur
  }
  const rows = defs.map((d, i) => ({ k: `${d[0]} · ${d[1]}`, c: d[4], s: secs[i] }))
  rows.push({ k: `SS Sweet Spot · ${Math.round(ftp * 0.80)}–${Math.round(ftp * 0.93)}w`, c: '#EA580C', s: ss })
  return rows
}

function collapse5(rows) {
  if (rows.length === 6) return [   // six COROS zones: Z4+Z5 merge, as in the 7-zone view below
    { k: 'Z1 Warm Up · Recovery', c: '#94A3B8', s: rows[0]?.s || 0 },
    { k: 'Z2 Easy · Aerobic', c: '#3B82F6', s: rows[1]?.s || 0 },
    { k: 'Z3 Aerobic · Steady', c: '#10B981', s: rows[2]?.s || 0 },
    { k: 'Z4 Threshold · Sub-Max', c: '#F97316', s: (rows[3]?.s || 0) + (rows[4]?.s || 0) },
    { k: 'Z5 Max · Anaerobic', c: '#EF4444', s: rows[5]?.s || 0 },
  ]
  if (rows.length < 7) return rows
  return [
    { k: 'Z1 Warm Up · Recovery', c: '#94A3B8', s: (rows[0]?.s || 0) + (rows[1]?.s || 0) },
    { k: 'Z2 Easy · Aerobic', c: '#3B82F6', s: rows[2]?.s || 0 },
    { k: 'Z3 Aerobic · Steady', c: '#10B981', s: rows[3]?.s || 0 },
    { k: 'Z4 Threshold · Sub-Max', c: '#F97316', s: (rows[4]?.s || 0) + (rows[5]?.s || 0) },
    { k: 'Z5 Max · Anaerobic', c: '#EF4444', s: rows[6]?.s || 0 },
  ]
}

function group5k(laps) {
  const out = []
  for (let i = 0; i < laps.length; i += 5) {
    const chunk = laps.slice(i, i + 5)
    const dist = chunk.reduce((s, l) => s + (l.distance_m || 0), 0)
    const dur = chunk.reduce((s, l) => s + (l.duration_s || 0), 0)
    out.push({
      idx: `${chunk[0].idx}–${chunk.at(-1).idx}`,
      avg_pace_s_km: dist > 0 ? dur / (dist / 1000) : mean(chunk.map((l) => l.avg_pace_s_km)),
      avg_hr: mean(chunk.map((l) => l.avg_hr)) != null ? Math.round(mean(chunk.map((l) => l.avg_hr))) : null,
      distance_m: dist,
    })
  }
  return out
}

function ChartCanvas({ build, deps }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    const inst = build(ref.current)
    return () => { if (inst) inst.destroy() }
  }, deps)
  return <canvas ref={ref} />
}

function ZoneList({ rows }) {
  const tot = rows.reduce((a, r) => a + (r.s || 0), 0) || 1
  const maxS = Math.max(...rows.map((r) => r.s || 0), 1)
  return <div className="v61-zlist">
    {rows.map((r) => {
      const pct = Math.round(((r.s || 0) / tot) * 1000) / 10
      const w = r.s > 0 ? Math.max(4, Math.round((r.s / maxS) * 100)) : 0
      const parts = String(r.k || '').split(' · ')
      return <div key={r.k} className="v61-zrow">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts[0]}</div>
          {parts[1] && <div style={{ fontSize: 10.5, color: 'var(--v-muted)', fontFamily: 'var(--v-mono)' }}>{parts[1]}</div>}
        </div>
        <div className="v61-ztrack"><div className="v61-zfill" style={{ width: `${w}%`, background: r.c }} /></div>
        <div style={{ textAlign: 'right', fontFamily: 'var(--v-mono)', fontSize: 11 }}>
          <b>{fmtZoneDur(r.s)}</b>
          <div style={{ color: 'var(--v-muted)', fontSize: 10 }}>{pct.toFixed(1)}%</div>
        </div>
      </div>
    })}
  </div>
}

function HeroLeafletMap({ a, laps, google = false, route = null, routeData = false, id = '' }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const lineRef = useRef(null)
  const [style, setStyle] = useState(google ? 'roadmap' : 'clean'), picked = useRef(false)
  useEffect(() => { if (google && !picked.current) setStyle('roadmap') }, [google]) // Google map by default once the server says it has the key, unless you chose a style yourself
  const [snapped, setSnapped] = useState(false)
  const raw = useMemo(() => (route && route.length >= 2 ? route : extractRouteCoords(a)), [a, route])
  const snap = useApi(snapped && routeData && id ? `/api/geo/snap?id=${encodeURIComponent(id)}` : '', snapped && routeData && !!id).data
  const coords = snapped && snap?.points?.length > 1 ? snap.points : raw // snapped = Google's road-matched line (display only); the raw GPS track stays the source of every number

  useEffect(() => {
    if (!elRef.current || coords.length < 2) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    const map = L.map(elRef.current, { zoomControl: false, attributionControl: false, scrollWheelZoom: false })
    mapRef.current = map
    if (GOOGLE_STYLES.includes(style)) {
      L.tileLayer(googleTileUrl(style), { maxZoom: 20 }).addTo(map)   // proxied by the server (key stays there)
    } else {
      const url = style === 'clean'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
      L.tileLayer(url, { maxZoom: 18 }).addTo(map)
      if (style === 'clean') {
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, opacity: 0.7 }).addTo(map)
      }
    }
    const line = L.polyline(coords, { color: snapped ? '#4658D6' : '#F26B5B', weight: snapped ? 5 : 4.2, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(map)
    lineRef.current = line
    L.circleMarker(coords[0], { radius: 6.5, fillColor: '#10B981', color: '#fff', weight: 2.5, fillOpacity: 1 }).addTo(map).bindTooltip('Start')
    const end = coords[coords.length - 1]
    if (end[0] !== coords[0][0] || end[1] !== coords[0][1]) {
      L.circleMarker(end, { radius: 6.5, fillColor: '#EA3A3A', color: '#fff', weight: 2.5, fillOpacity: 1 }).addTo(map).bindTooltip('Finish')
    }
    map.fitBounds(line.getBounds(), { padding: [32, 32] })
    setTimeout(() => map.invalidateSize(), 120)
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [coords, style, snapped])

  if (coords.length >= 2) {
    return <div className="v61-map-wrap">
      <div ref={elRef} className="v61-map-canvas" />
      <div className="v61-map-top">
        {routeData && <button type="button" className={`v61-map-pill ${snapped ? 'active' : ''}`} onClick={() => setSnapped((s) => !s)}>{snapped ? (snap?.points?.length > 1 ? 'Route: Snapped' : 'Snapping…') : 'Route: GPS'}</button>}
        <select className="v61-map-pill" aria-label="Map style" value={style} onChange={(e) => { picked.current = true; setStyle(e.target.value) }}>
          {MAP_STYLES.filter(([k]) => google || !GOOGLE_STYLES.includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {GOOGLE_STYLES.includes(style) && <span className="v61-map-attr">Map data © Google</span>}
      <div className="v61-zoom-stack" role="group" aria-label="Map zoom controls">
        <button type="button" className="v61-zbtn" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
        <button type="button" className="v61-zbtn" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
        <button type="button" className="v61-zbtn" aria-label="Fit route" style={{ fontSize: 13 }} onClick={() => mapRef.current && lineRef.current && mapRef.current.fitBounds(lineRef.current.getBounds(), { padding: [32, 32] })}>⌖</button>
      </div>
    </div>
  }

  const paceVals = (laps || []).map((l) => l.avg_pace_s_km).filter(Boolean)
  return <div className="v61-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
    <div className="v61-card-head"><h3 className="v61-card-title">Session Pace Profile</h3><span className="v61-pill">{laps?.length || 0} laps</span></div>
    <div className="v61-chart-box" style={{ height: 195 }}>
      <ChartCanvas deps={[paceVals.join(',')]} build={(el) => new Chart(el, {
        type: 'line',
        data: { labels: paceVals.map((_, i) => `KM ${i + 1}`), datasets: [{ data: paceVals, borderColor: '#F26B5B', backgroundColor: 'rgba(242,107,91,0.18)', fill: true, tension: 0.32, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2.2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Pace: ${fmtPaceS(c.parsed.y)}/km` } } }, scales: { y: { reverse: true, ticks: { callback: (v) => fmtPaceS(v) } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } } } },
      })} />
    </div>
  </div>
}

export default function Activity({ vdot, focus, go, settings }) {
  const T = today()
  const [offStored] = useStore('lumpad.official', {}), OFFICIAL_RACES = useMemo(() => mergeOfficial(OFFICIAL_BASE, offStored), [offStored])
  const [ym, setYm] = useState(T.slice(0, 7))
  const [sport, setSport] = useState('all')
  const [tagF, setTagF] = useState('all')
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [srcF, setSrcF] = useState('all'), [actF, setActF] = useState('all'), [fOpen, setFOpen] = useState(false)
  const geo = useApi('/api/geo/capabilities').data, mapsOn = !!(geo?.configured && geo?.route_data), [noMap, setNoMap] = useState({}) // real route thumbnails only when the server may send routes to Google
  useEffect(() => { if (!fOpen) return; const k = (e) => { if (e.key === 'Escape') setFOpen(false) }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [fOpen])
  const [hoverDay, setHoverDay] = useState('Tap/hover day')
  const sel = focus?.id || null

  const [from, to] = monthRange(ym), prevYm = shiftMonth(ym, -1), [pf] = monthRange(prevYm)
  const A = useApi(`/api/activities/merged?from=${pf}&to=${to}`), CR = useApi('/api/coach/analysed'), analysed = useMemo(() => new Set(CR.data || []), [CR.data]) // runs the AI coach has already reviewed
  const G = useApi('/api/gear')
  const Hist = useApi(`/api/activities/merged?from=${addDays(T, -180)}&to=${T}`)
  const gear = useMemo(() => Object.fromEntries((G.data || []).map((g) => [g.id, g.name])), [G.data])

  const flat = useMemo(() => [...(Hist.data?.length ? Hist.data : (A.data || []))].sort((x, y) => (y.date + (y.start_ts || '')).localeCompare(x.date + (x.start_ts || ''))), [Hist.data, A.data])
  const at = sel ? flat.findIndex((a) => (a.ids || [a.id]).includes(sel)) : -1
  const older = at >= 0 ? flat[at + 1] : null, newer = at > 0 ? flat[at - 1] : null

  if (sel) {
    return <section className="screen v61-scope v61-anim">
      <div className="v61-topbar">
        <button type="button" className="btn sm" onClick={() => go('activity')}><Icon n="left" size={16} /> Back</button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn sm" disabled={!older} onClick={() => older && go('activity', { id: older.ids?.[0] || older.id })}>← Prev</button>
          <button type="button" className="btn sm" disabled={!newer} onClick={() => newer && go('activity', { id: newer.ids?.[0] || newer.id })}>Next →</button>
        </div>
      </div>
      <Detail id={sel} gear={gear} gearList={G.data || []} vdot={vdot} history={Hist.data || []} go={go} settings={settings} />
    </section>
  }

  const all = (A.data || []).filter((a) => a.date >= from)
  const cum = cumulativeKm(all, ym), cumPrev = cumulativeKm(A.data || [], prevYm)
  const curKm = cum.at(-1)?.km ?? 0, prevKm = cumPrev.at(-1)?.km ?? 0
  const dKm = prevKm ? Math.round(((curKm - prevKm) / prevKm) * 1000) / 10 : null

  const hours = { Run: 0, Walk: 0, Gym: 0, Others: 0 }
  all.forEach((a) => {
    const h = (a.duration_s || 0) / 3600
    if (a.sport_class === 'run') hours.Run += h
    else if (a.sport_class === 'walk') hours.Walk += h
    else if (a.sport_class === 'strength') hours.Gym += h
    else hours.Others += h
  })
  const totHrs = Object.values(hours).reduce((s, v) => s + v, 0)
  const runKm = all.filter((a) => a.sport_class === 'run').reduce((s, a) => s + (a.distance_m || 0), 0) / 1000
  const totLoad = all.reduce((s, a) => s + (a.training_load || 0), 0)

  const filtered = all.filter((a) => {
    if (sport !== 'all' && a.sport_class !== sport) return false
    const t = inferTag(a)
    if (tagF !== 'all' && t !== tagF) return false
    if (srcF !== 'all' && !(a.sources || [a.source]).includes(srcF)) return false
    if (actF !== 'all' && String(a.sport) !== actF) return false
    if (q.trim() && !(String(a.name || '') + ' ' + t + ' ' + (gear[a.gear_id] || '')).toLowerCase().includes(q.trim().toLowerCase())) return false
    return true
  })
  const byTime = (x, y) => (y.date + (y.start_ts || '')).localeCompare(x.date + (x.start_ts || ''))
  const dist = (a) => (a.distance_m > 0 ? a.distance_m : null) // no distance (gym) goes last for longest and shortest
  const sorted = [...filtered].sort((x, y) => {
    if (sortBy === 'oldest') return -byTime(x, y)
    if (sortBy === 'longest' || sortBy === 'shortest') { const a = dist(x), b = dist(y); if (a == null && b == null) return byTime(x, y); if (a == null) return 1; if (b == null) return -1; return sortBy === 'longest' ? b - a : a - b }
    if (sortBy === 'fastest') return (x.avg_pace_s_km || 9999) - (y.avg_pace_s_km || 9999)
    if (sortBy === 'load') return (y.training_load || 0) - (x.training_load || 0)
    return byTime(x, y)
  })
  const SORTS = [['newest', 'Newest'], ['oldest', 'Oldest'], ['longest', 'Longest'], ['shortest', 'Shortest'], ['fastest', 'Fastest pace'], ['load', 'Highest TL']]
  const SPORT_OPTS = [['all', 'All'], ['run', 'Run'], ['walk', 'Walk'], ['strength', 'Gym']], SRC_OPTS = [['all', 'All'], ['coros', 'COROS'], ['strava', 'Strava']]
  const ACT_OPTS = [...new Set(all.map((a) => String(a.sport || '')).filter(Boolean))].sort() // the sport names the devices record (Run, TrailRun, Walk, Strength…)
  const nActive = (sport !== 'all') + (tagF !== 'all') + (srcF !== 'all') + (actF !== 'all') + (sortBy !== 'newest')
  const resetFilters = () => { setSport('all'); setTagF('all'); setSrcF('all'); setActF('all'); setSortBy('newest') }

  return <section className="screen v61-scope v61-anim">
    <div className="v61-feed-head">
      <div>
        <h1 className="v61-feed-title">Activities</h1>
        <p className="v61-card-sub">All synced runs, walks, and gym sessions</p>
      </div>
      <div className="v61-month-nav">
        <button type="button" className="v61-mbtn" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="Previous month">‹</button>
        <span className="v61-mlbl">{MONTHS[+ym.slice(5) - 1].slice(0, 3)} {ym.slice(0, 4)}</span>
        <button type="button" className="v61-mbtn" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="Next month">›</button>
      </div>
    </div>

    <div className="v61-feed-hero">
      <div className="v61-card">
        <div className="v61-big-km-row">
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--v-muted)' }}>Monthly Run Volume</div>
            <div className="v61-big-km">{curKm.toFixed(1)} km</div>
          </div>
          {dKm != null && <span className={`v61-pill ${dKm >= 0 ? 'green' : 'amber'}`}>{dKm >= 0 ? '+' : ''}{dKm}% vs prev</span>}
        </div>
        <div className="v61-chart-box" style={{ height: 145 }}>
          <ChartCanvas deps={[ym, curKm, prevKm]} build={(el) => new Chart(el, {
            type: 'line',
            data: {
              labels: cum.map((c) => `Day ${c.day}`),
              datasets: [
                { label: 'This month', data: cum.map((c) => (ym === T.slice(0, 7) && c.day > +T.slice(8) ? null : c.km)), borderColor: '#4658D6', backgroundColor: 'rgba(70,88,214,0.14)', fill: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.4 },
                { label: 'Last month', data: cum.map((_, i) => cumPrev[i]?.km ?? cumPrev.at(-1)?.km ?? 0), borderColor: '#94A3B8', borderDash: [5, 4], fill: false, tension: 0.25, pointRadius: 0, borderWidth: 1.5 },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              onHover: (_e, elems) => {
                if (!elems?.length) return
                const i = elems[0].index
                const c = cum[i]?.km ?? 0, p = cumPrev[i]?.km ?? cumPrev.at(-1)?.km ?? 0
                setHoverDay(`Day ${i + 1}: ${c.toFixed(1)} km vs ${p.toFixed(1)} km`)
              },
              plugins: { legend: { display: false } },
              scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { ticks: { callback: (v) => `${v}k` } } },
            },
          })} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--v-muted)', marginTop: 6 }}>
          <span>This month vs last month</span>
          <span>{hoverDay}</span>
        </div>
      </div>

      <div className="v61-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div className="v61-card-head"><h2 className="v61-card-title">Monthly Summary</h2></div>
          <div className="v61-sum-grid">
            <div className="v61-sum-tile"><small>Activities</small><b>{all.length}</b></div>
            <div className="v61-sum-tile"><small>Run Distance</small><b style={{ color: 'var(--v-green-t)' }}>{runKm.toFixed(1)} km</b></div>
            <div className="v61-sum-tile"><small>Avg Weekly</small><b>{(runKm / 4).toFixed(1)} km</b></div>
            <div className="v61-sum-tile"><small>Total Load</small><b style={{ color: 'var(--v-cobalt-t)' }}>{totLoad || '—'}</b></div>
          </div>
        </div>
        <div className="v61-hours-sec">
          <div className="v61-hours-head"><span>Total Hours by Sport</span><b>{totHrs.toFixed(1)}h total</b></div>
          <div className="v61-hours-grid">
            {[['Run', '#4658D6'], ['Walk', '#10B981'], ['Gym', '#E28120'], ['Others', '#8B5CF6']].map(([k, col]) => {
              const h = hours[k], pct = totHrs > 0 ? Math.round((h / totHrs) * 100) : 0
              return <div key={k} className="v61-hour-tile">
                <small>{k}</small>
                <b>{h.toFixed(1)}h</b>
                <div className="v61-hour-bar"><div style={{ width: `${h > 0 ? Math.max(10, pct) : 0}%`, background: col }} /></div>
              </div>
            })}
          </div>
        </div>
      </div>
    </div>

    <div className="v61-sticky-bar">
      <div className="v61-filter-top">
        <input className="v61-search" type="search" placeholder="Search run, race, tag, shoe…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className={`v61-filterbtn ${nActive ? 'on' : ''}`} aria-expanded={fOpen} aria-controls="feed-filter-panel" onClick={() => setFOpen((o) => !o)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg><span className="v61-filterbtn-t">Filter</span>{nActive > 0 && <em>{nActive}</em>}
        </button>
      </div>
      {fOpen && <div className="v61-filterpanel" id="feed-filter-panel" role="group" aria-label="Sort and filter activities">
        <div className="v61-fgroup"><b>Sort by</b><div className="v61-fopts">{SORTS.map(([k, l]) => <button key={k} type="button" className={`v61-fpill ${sortBy === k ? 'active' : ''}`} aria-pressed={sortBy === k} onClick={() => setSortBy(k)}>{l}</button>)}</div></div>
        <div className="v61-fgroup"><b>Sport type</b><div className="v61-fopts">{SPORT_OPTS.map(([k, l]) => <button key={k} type="button" className={`v61-fpill ${sport === k ? 'active' : ''}`} aria-pressed={sport === k} onClick={() => setSport(k)}>{l} ({k === 'all' ? all.length : all.filter((x) => x.sport_class === k).length})</button>)}</div></div>
        {ACT_OPTS.length > 1 && <div className="v61-fgroup"><b>Activity</b><div className="v61-fopts">{['all', ...ACT_OPTS].map((k) => <button key={k} type="button" className={`v61-fpill ${actF === k ? 'active' : ''}`} aria-pressed={actF === k} onClick={() => setActF(k)}>{k === 'all' ? 'All' : `${k} (${all.filter((x) => String(x.sport) === k).length})`}</button>)}</div></div>}
        <div className="v61-fgroup"><b>Tag</b><div className="v61-fopts">{['all', ...WORKOUT_TAGS].map((t) => <button key={t} type="button" className={`v61-fpill ${tagF === t ? 'active' : ''}`} aria-pressed={tagF === t} onClick={() => setTagF(t)}>{t === 'all' ? 'All tags' : t}</button>)}</div></div>
        <div className="v61-fgroup"><b>Source</b><div className="v61-fopts">{SRC_OPTS.map(([k, l]) => <button key={k} type="button" className={`v61-fpill ${srcF === k ? 'active' : ''}`} aria-pressed={srcF === k} onClick={() => setSrcF(k)}>{l}</button>)}</div></div>
        <div className="v61-fact"><button type="button" className="v61-fpill" onClick={resetFilters}>Reset</button><button type="button" className="v61-fpill active" onClick={() => setFOpen(false)}>Show {sorted.length} {sorted.length === 1 ? 'activity' : 'activities'}</button></div>
      </div>}
    </div>

    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'var(--v-muted)' }}>
      <span>Showing {sorted.length} {sorted.length === 1 ? 'activity' : 'activities'}</span>
      <span>Tap any card for full analysis</span>
    </div>

    <div className="v61-feed-grid">
      {sorted.map((a) => {
        const aid = a.ids?.[0] || a.id
        const tag = inferTag(a)
        const off = OFFICIAL_RACES[a.date]
        const title = off && (!a.name || /^outdoor run$/i.test(a.name.trim())) ? off.event : a.name
        return <article key={aid} className="v61-act-card" onClick={() => go('activity', { id: aid })}>
          <div className="v61-act-top">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {a.location && <span className="v61-pill">{a.location}</span>}
            {a.training_load != null && <span className="v61-pill cobalt">TL {a.training_load}</span>}
              <span className={`v61-pill ${tagPillCls(tag)}`}>{tag}</span>
              {a.sport_class === 'run' && (a.distance_m || 0) >= 5000 && (analysed.has(`session ${String(aid).replace(/^coros:/, '')}`) ? <span className="v61-pill ai-done" title="Analysed by the AI coach">AI</span> : <span className="v61-pill ai-todo" title="Not analysed yet">AI</span>)}
              {a.temp_c != null && <span className="v61-pill">{Math.round(a.temp_c)}°C</span>}
            </div>
          </div>
          <div className="v61-act-mid">
            <div style={{ minWidth: 0 }}>
              <h3 className="v61-act-name">{title}</h3>
              <div className="v61-card-sub">{fmtLong(a.date)}{off ? ` · Bib ${off.bib}` : ''}</div>
            </div>
            <div className="v61-mini-route" aria-hidden="true">
              {mapsOn && a.sport_class !== 'strength' && (a.distance_m || 0) > 0 && !noMap[aid]
                ? <img className="v61-mini-map" loading="lazy" decoding="async" alt="" src={`/api/map/static?id=${encodeURIComponent(aid)}&s=thumb`} onError={() => setNoMap((m) => ({ ...m, [aid]: 1 }))} />
                : <span className="v61-mini-ico">{a.sport_class === 'strength' ? '🏋️' : a.sport_class === 'walk' ? '🚶' : '🏃'}</span>}
            </div>
          </div>
          <div className="v61-act-kpis">
            <div><small>Distance</small><b>{a.distance_m ? `${km(a.distance_m)} km` : '—'}</b></div>
            <div><small>Time</small><b>{fmtDur(a.duration_s)}</b></div>
            <div><small>Avg Pace</small><b>{a.avg_pace_s_km ? `${fmtPaceS(a.avg_pace_s_km)}/km` : '—'}</b></div>
            <div><small>Avg HR</small><b>{a.avg_hr ? `${a.avg_hr} bpm` : '—'}</b></div>
          </div>
        </article>
      })}
    </div>
  </section>
}

function Detail({ id, gear, gearList = [], vdot, history, go, settings }) {
  const D = useApi(id ? `/api/activities/detail?id=${encodeURIComponent(id)}` : '', !!id), a = D.data
  const [ctx, setCtx] = useStore('lumpad.act.' + (id || 'none').replace(/[^A-Za-z0-9._-]/g, '_'), {
    rpe: '', gels: '', cho_g: '', note: '', tag: '', feels: [], rating: '', title: '', official_bib: '', official_url: '',
  })
  const [offStored, setOffStored] = useStore('lumpad.official', {}), OFFICIAL_RACES = useMemo(() => mergeOfficial(OFFICIAL_BASE, offStored), [offStored])
  const [offEdit, setOffEdit] = useState(null)
  const [tab, setTab] = useState('overview')
  const [zoneMode, setZoneMode] = useState(7)
  const [lapMode, setLapMode] = useState('all')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [gapKpi, setGapKpi] = useState(null)
  const [hrKpi, setHrKpi] = useState(null)
  const [phrKpi, setPhrKpi] = useState(null)
  const [driftKpi, setDriftKpi] = useState(null)
  const [matchedPill, setMatchedPill] = useState(null)

  useEffect(() => {
    setLapMode('all')
    setEditingTitle(false)
    setEditingNote(false)
    setGapKpi(null); setHrKpi(null); setPhrKpi(null); setDriftKpi(null); setMatchedPill(null)
  }, [id])

  const laps = a?.laps || []
  const ef = a ? efOf(a) : null
  const dc = decoupling(laps)
  const zcfg = cfgOf(settings || {}), zs = laps.length ? zoneSeconds(laps, { ...zcfg, hrEnds: null }) : null   // per-lap fallback keeps the percentage-of-LTHR model so labels and data agree
  const pz = zs && zs.pace.some((x) => x > 0)
  const officialBase = a ? OFFICIAL_RACES[a.date] : null
  const activeTag = ctx.tag || inferTag(a)
  const isRace = activeTag === 'Race'
  const activeTab = !isRace && tab === 'official' ? 'overview' : tab
  const setC = (patch) => setCtx({ ...ctx, ...patch })
  const activeFeels = Array.isArray(ctx.feels) ? ctx.feels : []
  const dyn = (k) => { const v = mean(laps.map((l) => l[k])); return v == null ? null : Math.round(v * 100) / 100 }

  const displayTitle = ctx.title || (officialBase && (!a?.name || /^outdoor run$/i.test(a.name.trim())) ? officialBase.event : (a?.name || 'Activity'))

  const baseLaps = lapMode === '5k' && laps.length >= 10 ? group5k(laps) : laps
  const shownLaps = useMemo(() => {
    const withD = baseLaps.map((l, i) => ({ ...l, delta_s: i === 0 || !l.avg_pace_s_km || !baseLaps[i - 1]?.avg_pace_s_km ? null : baseLaps[i - 1].avg_pace_s_km - l.avg_pace_s_km }))
    if (lapMode === 'fast') return [...withD].filter((l) => l.avg_pace_s_km).sort((x, y) => x.avg_pace_s_km - y.avg_pace_s_km).slice(0, 8)
    if (lapMode === 'fade') return withD.filter((l) => (l.avg_pace_s_km || 0) >= 540)
    return withD
  }, [baseLaps, lapMode])

  const validP = shownLaps.map((l) => l.avg_pace_s_km).filter(Boolean)
  const minPace = validP.length ? Math.min(...validP) : 1, maxPace = validP.length ? Math.max(...validP) : 1

  // Google extras (only when the server has a key): place name of the start, air quality at the run's hour
  const caps = useApi('/api/geo/capabilities').data
  const ST = useApi(id ? `/api/intel/stream?id=${encodeURIComponent(id)}` : '', !!id && a?.sport_class === 'run'), streamRoute = ST.data?.found && ST.data.route?.length >= 2 ? ST.data.route : null // the real GPS track from the FIT file
  // HR zones: every second of the FIT (like COROS); the per-lap average is only the fallback when there is no FIT. Index 0..5 = Z1..Z6 with explicit ends, else 0..6 (0 = below Z1).
  const hrv = ST.data?.hr_hist ? zonesFromHist(ST.data.hr_hist, zcfg.hrEnds) : zs?.hr || null, hzOk = !!hrv && hrv.some((x) => x > 0), hrFromFit = !!ST.data?.hr_hist
  const ENV = useApi(id ? `/api/env/activity?id=${encodeURIComponent(id)}` : '', !!id && a?.sport_class === 'run').data, envRun = ENV?.run && !ENV.run.indoor ? ENV.run : null // weather during this run (Open-Meteo, stored with the FIT session)
  const SESS = useApi(id ? `/api/intel/session?id=${encodeURIComponent(id)}` : '', !!id && a?.sport_class === 'run').data // device ascent from the FIT session
  const c0 = a ? (streamRoute || extractRouteCoords(a))[0] : null, startMs = a ? tsMs(a.start_ts) : null
  const geoOn = !!caps?.configured && !!c0
  const place = useApi(geoOn ? `/api/geo/place?lat=${c0[0]}&lon=${c0[1]}` : '', geoOn).data
  const airH = useApi(geoOn && startMs ? `/api/env/airhistory?lat=${c0[0]}&lon=${c0[1]}&hours=${hoursBack(startMs)}&ts=${startMs}` : '', geoOn && !!startMs).data
  const air = airH && startMs ? airAtHour(airH.hours, startMs) : null, airIdx = air?.local || air?.universal || null, airS = airSign(airIdx?.category)

  if (D.state === 'loading') return <div className="skel" style={{ height: 180 }} />
  if (D.state === 'error' || !a) return <p className="muted">Could not load this activity.</p>

  const tempC = a.temp_c ?? envRun?.temp_c ?? null, rh = a.humidity ?? envRun?.rh ?? null // no invented defaults: unknown stays unknown
  const heatSign = tempC == null ? ['—', 'normal'] : tempC >= 29 ? ['High', 'high'] : tempC >= 25 ? ['Normal', 'normal'] : ['Good', 'good']
  const streamGain = (() => { const al = ST.data?.has_alt ? ST.data.alt.filter((x) => x != null) : []; let g = 0; for (let i = 1; i < al.length; i++) if (al[i] > al[i - 1]) g += al[i] - al[i - 1]; return al.length > 20 ? g : null })()
  const elevGain = a.elev_gain_m ?? a.ascent_m ?? a.total_elevation_gain ?? SESS?.gain_m ?? streamGain
  const tabs = [['overview', 'Overview'], ['zones', 'Zones'], ['splits', 'Splits'], ['drift', 'Drift & GAP'], ['matched', 'Matched'], ...(isRace ? [['official', 'Official Result']] : [])]

  const recentRuns = history.filter((h) => h.sport_class === 'run' && (h.distance_m || 0) >= 3000 && h.date <= a.date).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 6)
  const efSeries = [...recentRuns].reverse().map((r) => ({ lbl: r.date.slice(5), v: efOf(r) })).filter((x) => x.v)
  const activeGearId = ctx.gear_id || a.gear_id
  const gearObj = gearList.find((g) => String(g.id) === String(activeGearId))
  const shoeKm = gearObj ? Math.round((gearObj.distance_m || (gearObj.km ? gearObj.km * 1000 : 0)) / 1000) : null
  const shoeMax = gearObj?.max_km || 650
  const shoePct = shoeKm != null ? Math.min(100, Math.round((shoeKm / shoeMax) * 100)) : 45

  return <>
    {/* Hero: Left Leaflet Map + Right Clean Header & 3x2 KPI Grid */}
    <div className="v61-hero-grid">
      <HeroLeafletMap a={a} laps={laps} google={!!caps?.configured} route={streamRoute} routeData={!!caps?.route_data} id={id} />

      <div className="v61-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          {!editingTitle ? (
            <div className="v61-title-wrap">
              <h1 className="v61-title">{displayTitle}</h1>
              <button type="button" className="v61-edit-btn" onClick={() => { setTitleDraft(displayTitle); setEditingTitle(true) }}>✎ Edit</button>
            </div>
          ) : (
            <div className="v61-title-wrap">
              <input className="v61-title-input" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} autoFocus />
              <button type="button" className="v61-edit-btn save" onClick={() => { if (titleDraft.trim()) setC({ title: titleDraft.trim() }); setEditingTitle(false) }}>Save</button>
              <button type="button" className="v61-edit-btn" onClick={() => setEditingTitle(false)}>Cancel</button>
            </div>
          )}

          <div className="v61-badges">
            {a.training_load != null && <span className="v61-pill cobalt">TL {a.training_load}</span>}
            <select className="v61-tag-select" data-wtag={activeTag} aria-label="Workout type tag" value={activeTag} onChange={(e) => setC({ tag: e.target.value })}>
              {WORKOUT_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {a.distance_m && <span className="v61-pill">{km(a.distance_m)} km</span>}
            {a.temp_c != null && <span className="v61-pill amber">{Math.round(a.temp_c)}°C · RH {rh ?? '—'}%</span>}
          </div>

          <p className="v61-card-sub" style={{ marginTop: 8 }}>
            📅 {fmtLong(a.date)} · ⌚ {(a.sources || []).join(' & ') || 'COROS'}
          </p>
        </div>

        <div className="v61-kpi-grid">
          <div className="v61-kpi-cell"><small>Distance</small><b>{a.distance_m ? `${km(a.distance_m)} km` : '—'}</b><em>{activeTag}</em></div>
          <div className="v61-kpi-cell"><small>Time</small><b>{fmtDur(a.duration_s)}</b><em>{a.elapsed_s && a.elapsed_s > a.duration_s ? `Elapsed ${fmtDur(a.elapsed_s)}` : 'Moving time'}</em></div>
          <div className="v61-kpi-cell"><small>Avg Pace</small><b>{a.avg_pace_s_km ? `${fmtPaceS(a.avg_pace_s_km)} /km` : '—'}</b><em>{a.adjusted_pace_s_km ? `GAP ${fmtPaceS(a.adjusted_pace_s_km)}/km` : 'Pace'}</em></div>
          <div className="v61-kpi-cell"><small>Elev Gain</small><b>{elevGain != null ? `▲ ${Math.round(elevGain)} m` : '—'}</b><em>Course gain</em></div>
          <div className="v61-kpi-cell"><small>Avg HR</small><b>{a.avg_hr ? `${a.avg_hr} bpm` : '—'}</b><em>{a.max_hr ? `Max ${a.max_hr} bpm` : 'Heart rate'}</em></div>
          <div className="v61-kpi-cell"><small>{a.calories ? 'Calories' : 'Efficiency'}</small><b>{a.calories ? Math.round(a.calories).toLocaleString() : (ef ?? '—')}</b><em>{a.calories ? 'kcal' : (dc ? `Pa:Hr ${dc.pct}%` : 'EF')}</em></div>
        </div>
      </div>
    </div>

    {/* Fixed-on-Scroll Header Navigation Tabs */}
    <div className="v61-sticky-bar">
      <nav className="v61-seg-tabs" role="tablist" aria-label="Activity sections">
        {tabs.map(([k, lbl]) => (
          <button key={k} type="button" role="tab" aria-selected={activeTab === k} className={`v61-seg-tab ${activeTab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </nav>
    </div>

    {/* TAB 1: OVERVIEW */}
    {activeTab === 'overview' && <div className="v61-anim" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Conditions & Course Intel — uniform 3-row tiles */}
      <div className="v61-card">
        <div className="v61-card-head">
          <div>
            <h2 className="v61-card-title">Conditions &amp; Course Intel</h2>
            <p className="v61-card-sub">Weather, air quality, and course conditions</p>
          </div>
          <span className="v61-pill cobalt">{tempC == null ? (SESS && SESS.found === false ? 'Waiting for FIT file' : 'No weather data') : tempC >= 29 ? 'Heat Stress' : 'Standard Conditions'}</span>
        </div>
        <div className="v61-env-grid">
          <div className="v61-env-tile">
            <div className="v61-env-top"><span>Weather</span><span className={`v61-sign ${heatSign[1]}`}><i />{heatSign[0]}</span></div>
            <div className="v61-env-val">{tempC != null ? `${Math.round(tempC)}°C` : '—'}</div>
            <div className="v61-env-sub"><span>RH {rh != null ? `${Math.round(rh)}%` : '—'}</span><span>{envRun?.wbgt != null ? `WBGT ≥ ${envRun.wbgt}°C` : envRun?.dew_c != null ? `Dew ${Math.round(envRun.dew_c)}°C` : ''}</span></div>
          </div>
          <div className="v61-env-tile">
            <div className="v61-env-top"><span>Air Quality</span><span className={`v61-sign ${airS[1]}`}><i />{airS[0]}</span></div>
            <div className="v61-env-val">{airIdx?.category ? String(airIdx.category).replace(/\s*air quality\s*/i, '').trim() || airIdx.category : '—'}</div>
            <div className="v61-env-sub"><span>{airIdx ? `${String(airIdx.name || 'AQI').replace(/\s*\(.*\)\s*/, '')} ${airIdx.aqi ?? ''}`.trim() : (SESS && SESS.found === false ? 'Waiting for FIT file' : 'Not pulled for this run')}</span><span>{air ? 'At the run hour' : ''}</span></div>
          </div>
          <div className="v61-env-tile">
            <div className="v61-env-top"><span>Effort Load</span><span className={`v61-sign ${(a.training_load || 0) > 220 ? 'high' : 'normal'}`}><i />{(a.training_load || 0) > 220 ? 'High' : 'Normal'}</span></div>
            <div className="v61-env-val">TL {a.training_load ?? '—'}</div>
            <div className="v61-env-sub"><span>Aerobic TE {a.aerobic_te ?? '—'}</span><span>Anaerobic TE {a.anaerobic_te ?? '—'}</span></div>
          </div>
          <div className="v61-env-tile">
            <div className="v61-env-top"><span>Drift</span><span className={`v61-sign ${dc && dc.pct > 8 ? 'high' : 'good'}`}><i />{dc && dc.pct > 8 ? 'High' : 'Good'}</span></div>
            <div className="v61-env-val">{dc ? `${dc.pct}%` : '—'}</div>
            <div className="v61-env-sub"><span>Aerobic decoupling</span><span>Elev {elevGain != null ? `+${Math.round(elevGain)}m` : '—'}</span></div>
          </div>
        </div>
      </div>

      <div className="v61-overview-grid">
        <div className="v61-insight-card">
          <div className="v61-card-head" style={{ marginBottom: 4 }}>
            <div>
              <h2 className="v61-card-title">Workout Insights</h2>
              <p className="v61-card-sub">Personalized pacing, effort, and recovery summary</p>
            </div>
            <span className="v61-ai-badge">✦ Lumpad AI</span>
          </div>

          <div className="v61-feel-grid">
            {FEEL_ITEMS.map(([lbl, tone]) => {
              const on = activeFeels.includes(lbl)
              return <button key={lbl} type="button" className={`v61-feel ${tone} ${on ? 'active' : ''}`} onClick={() => setC({ feels: on ? activeFeels.filter((x) => x !== lbl) : [...activeFeels, lbl] })}>{lbl}</button>
            })}
          </div>

          {activeFeels.length > 0 && <p style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 10px' }}>
            <b>Condition Context ({activeFeels.join(' · ')}):</b> {activeFeels.map((f) => FEEL_ADVICE[f]).filter(Boolean).join(' ')}
          </p>}

          {a.sport_class === 'run' && (a.distance_m || 0) >= 5000
            ? <ActivityCoach id={a.ids?.[0] || id} label={String(a.ids?.[0] || id).replace(/^coros:/, '')} />
            : <p className="v61-card-sub">Deep workout narrative generates automatically for runs ≥ 5 km.</p>}

          <div className="v61-rate-bar">
            <span>{ctx.rating ? 'Thanks for your feedback' : 'Rate this insight'}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className={`v61-rate-btn ${ctx.rating === 'up' ? 'active' : ''}`} aria-label="Thumbs up" onClick={() => setC({ rating: ctx.rating === 'up' ? '' : 'up' })}>👍</button>
              <button type="button" className={`v61-rate-btn ${ctx.rating === 'down' ? 'active' : ''}`} aria-label="Thumbs down" onClick={() => setC({ rating: ctx.rating === 'down' ? '' : 'down' })}>👎</button>
            </div>
          </div>
        </div>

        <div>
          <div className="v61-card">
            <div className="v61-card-head">
              <h2 className="v61-card-title">Running Dynamics</h2>
              <span className="v61-pill cobalt">TE {a.aerobic_te ?? '—'} / {a.anaerobic_te ?? '—'}</span>
            </div>
            <div className="v61-dyn-grid">
              <div className="v61-dyn-tile"><small>GCT</small><b>{dyn('gct_ms') != null ? `${Math.round(dyn('gct_ms'))} ms` : '—'}</b></div>
              <div className="v61-dyn-tile"><small>Vert Osc</small><b>{dyn('vo_cm') != null ? `${dyn('vo_cm')} cm` : '—'}</b></div>
              <div className="v61-dyn-tile"><small>Vert Ratio</small><b>{dyn('vratio_pct') != null ? `${dyn('vratio_pct')}%` : '—'}</b></div>
              <div className="v61-dyn-tile"><small>Avg Power</small><b>{dyn('power') != null ? `${Math.round(dyn('power'))} W` : '—'}</b></div>
              <div className="v61-dyn-tile"><small>Stride</small><b>{dyn('stride_m') != null ? `${dyn('stride_m')} m` : '—'}</b></div>
              <div className="v61-dyn-tile"><small>EF <Info k="EF" /> / Pa:Hr</small><b>{ef ?? '—'}{dc ? ` / ${dc.pct}%` : ''}</b></div>
            </div>
          </div>

          <div className="v61-card">
            <div className="v61-card-head">
              <div>
                <h2 className="v61-card-title">Session Log &amp; Fueling</h2>
                <p className="v61-card-sub">Track your effort, fueling, and how the run felt</p>
              </div>
            </div>

            <label className="fld" style={{ display: 'block', marginBottom: 10 }}>
              <span>Running shoe</span>
              <select value={ctx.gear_id ?? a.gear_id ?? ''} onChange={(e) => { const g = e.target.value; setC({ gear_id: g }); fetch('/api/activities/shoe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lumpad': '1' }, body: JSON.stringify({ id: a.ids?.[0] || id, gear_id: g || null }) }).catch(() => {}) }}>
                <option value="">— Not assigned —</option>
                {Object.entries(gear).map(([gid, gname]) => <option key={gid} value={gid}>{gname}</option>)}
              </select>
            </label>

            <div className="fld" style={{ marginBottom: 10 }}>
              <span>GI distress</span>
              <div className="v61-gi-grid">
                {[[0, 'None'], [1, 'Mild'], [2, 'Mod'], [3, 'Severe']].map(([n, l]) => (
                  <button key={n} type="button" className={`v61-gi-btn ${n >= 2 ? 'warn' : ''} ${ctx.gi === n ? 'active' : ''}`} onClick={() => setC({ gi: ctx.gi === n ? '' : n })}>{l}</button>
                ))}
              </div>
            </div>

            <div className="fld" style={{ marginBottom: 10 }}>
              <span>Session RPE (1–10)</span>
              <div className="v61-rpe-grid">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" className={`v61-rpe-btn ${ctx.rpe === n ? 'active' : ''}`} onClick={() => setC({ rpe: ctx.rpe === n ? '' : n })}>{n}</button>
                ))}
              </div>
            </div>

            <div className="form two" style={{ marginBottom: 8 }}>
              <label className="fld"><span>Gels taken</span><input inputMode="numeric" type="number" value={ctx.gels} onChange={(e) => setC({ gels: e.target.value === '' ? '' : +e.target.value })} /></label>
              <label className="fld"><span>Actual carbs (g)</span><input inputMode="numeric" type="number" value={ctx.cho_g} onChange={(e) => setC({ cho_g: e.target.value === '' ? '' : +e.target.value })} /></label>
            </div>
            {ctx.cho_g !== '' && a.duration_s > 0 && <p className="v61-card-sub" style={{ marginBottom: 10 }}>≈ {Math.round(ctx.cho_g / (a.duration_s / 3600))} g/h (target &gt;90 min: 30–60 g/h)</p>}

            <div className="fld">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span>Session notes</span>
                {!editingNote ? (
                  <button type="button" className="v61-edit-btn" onClick={() => { setNoteDraft(ctx.note || ''); setEditingNote(true) }}>✎ Edit</button>
                ) : (
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button type="button" className="v61-edit-btn save" onClick={() => { setC({ note: noteDraft.trim() }); setEditingNote(false) }}>Save</button>
                    <button type="button" className="v61-edit-btn" onClick={() => setEditingNote(false)}>Cancel</button>
                  </div>
                )}
              </div>
              {!editingNote
                ? <div className="v61-note-box">{ctx.note || 'No notes yet — tap Edit to add.'}</div>
                : <textarea rows={2} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Pacing, heat, how legs felt…" autoFocus />}
            </div>
          </div>
        </div>
      </div>
    </div>}

    {/* TAB 2: ZONES */}
    {activeTab === 'zones' && <div className="v61-anim" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {hzOk && <div className="v61-card">
        <div className="v61-card-head">
          <div>
            <h2 className="v61-card-title">Heart Rate Zones</h2>
            <p className="v61-card-sub">LTHR {zcfg.lthr} bpm · Avg {a.avg_hr ?? '—'} · Max {a.max_hr ?? '—'}</p>
          </div>
          <div className="v61-mtoggle">
            <button type="button" className={zoneMode === 7 ? 'active' : ''} onClick={() => setZoneMode(7)}>7-Zone</button>
            <button type="button" className={zoneMode === 5 ? 'active' : ''} onClick={() => setZoneMode(5)}>5-Zone</button>
          </div>
        </div>
        <ZoneList rows={zoneMode === 5 ? collapse5(ZROWS(hrFromFit ? zcfg : { ...zcfg, hrEnds: null }, 'hr').map((r, i) => ({ ...r, s: hrv[i] }))) : ZROWS(hrFromFit ? zcfg : { ...zcfg, hrEnds: null }, 'hr').map((r, i) => ({ ...r, s: hrv[i] }))} />
        {pz && (() => { const top = (arr) => arr.indexOf(Math.max(...arr)), dh = top(hrv) + (hrFromFit ? 1 : 0), dp = top(zs.pace); return dh - dp >= 2 ? <p className="banner" style={{ marginTop: 12 }}>HR sat {dh - dp} zones higher than pace: judge effort by HR, not pace.</p> : null })()}
      </div>}
      <div className="v61-two-col">
        {laps.some((l) => l.power > 0) && <div className="v61-card">
          <div className="v61-card-head">
            <div><h2 className="v61-card-title">Power Zones</h2><p className="v61-card-sub">Includes Sweet Spot (SS)</p></div>
            <span className="v61-pill cobalt">Avg {Math.round(dyn('power') || 0)}W</span>
          </div>
          <ZoneList rows={computePowerZones(laps, settings?.ftp || 199)} />
        </div>}
        {pz && <div className="v61-card">
          <div className="v61-card-head">
            <div><h2 className="v61-card-title">Pace (/km) · GAP</h2><p className="v61-card-sub">Threshold {fmtPaceS(zcfg.tpace)}/km</p></div>
            {a.adjusted_pace_s_km && <span className="v61-pill">GAP {fmtPaceS(a.adjusted_pace_s_km)}/km</span>}
          </div>
          <ZoneList rows={ZROWS(zcfg, 'pace').map((r, i) => ({ ...r, s: zs.pace[i] }))} />
        </div>}
      </div>
    </div>}

    {/* TAB 3: SPLITS */}
    {activeTab === 'splits' && <div className="v61-card v61-anim">
      <div className="v61-card-head">
        <div><h2 className="v61-card-title">Kilometer Splits ({shownLaps.length} shown)</h2><p className="v61-card-sub">Pace, heart rate, and change per kilometer</p></div>
      </div>
      <div className="v61-pills-row" style={{ marginBottom: 12 }}>
        {[['all', `All (${laps.length})`], ['5k', '5K Blocks'], ['fast', 'Fastest 8'], ['fade', 'Fade (>9:00)']].map(([k, l]) => (
          <button key={k} type="button" className={`v61-fpill ${lapMode === k ? 'active' : ''}`} onClick={() => setLapMode(k)}>{l}</button>
        ))}
      </div>
      <div className="v61-splits-hdr-wrap">
        <div className="v61-splits-hdr"><span>KM</span><span>AVG PACE</span><span style={{ textAlign: 'right' }}>HR</span><span style={{ textAlign: 'right' }}>+/-</span></div>
        <div className="v61-splits-hdr dup" aria-hidden="true"><span>KM</span><span>AVG PACE</span><span style={{ textAlign: 'right' }}>HR</span><span style={{ textAlign: 'right' }}>+/-</span></div>
      </div>
      {(() => {
        const row = (l) => {
          const sec = l.avg_pace_s_km || maxPace
          const ratio = maxPace === minPace ? 0.85 : 0.45 + 0.55 * ((maxPace - sec) / (maxPace - minPace))
          const pct = Math.round(Math.max(36, Math.min(100, ratio * 100)))
          const d = fmtDeltaSec(l.delta_s)
          return <div key={l.idx} className="v61-split-row">
            <span style={{ fontFamily: 'var(--v-mono)', fontSize: 11.5, fontWeight: 700 }}>{l.idx}</span>
            <div className="v61-strack"><div className={`v61-sfill ${l.avg_pace_s_km === minPace ? 'fast' : ''}`} style={{ width: `${pct}%` }}>{fmtPaceS(l.avg_pace_s_km)}/km</div></div>
            <span style={{ textAlign: 'right', fontFamily: 'var(--v-mono)', fontSize: 11, color: 'var(--v-muted)' }}>{l.avg_hr ?? '—'}</span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--v-mono)', fontSize: 11.5, fontWeight: 700, color: d.color }}>{d.text}</span>
          </div>
        }
        const mid = Math.ceil(shownLaps.length / 2)
        return <div className="v61-splits-cols">
          <div className="v61-splits-col">{shownLaps.slice(0, mid).map(row)}</div>
          <div className="v61-splits-col">{shownLaps.slice(mid).map(row)}</div>
        </div>
      })()}
    </div>}

    {/* TAB 4: DRIFT & GAP (4 Interactive Chart.js Charts with OLS Trend Lines + Live KM Readouts) */}
    {activeTab === 'drift' && <div className="v61-anim" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {laps.length > 1 && (() => {
        const labels = laps.map((l) => `KM ${l.idx}`)
        const paceVals = laps.map((l) => l.avg_pace_s_km || null)
        const hrVals = laps.map((l) => l.avg_hr || null)
        const half = Math.ceil(laps.length / 2)
        let cumMin = 0
        const phr1 = [], phr2 = [], dr1 = [], dr2 = []
        laps.forEach((l, i) => {
          cumMin += (l.duration_s || 0) / 60
          if (l.power > 0 && l.avg_hr > 0) {
            const pObj = { x: Math.round(cumMin), y: Number((l.power / l.avg_hr).toFixed(2)), km: l.idx, half: i < half ? '1st Half' : '2nd Half' }
            const dObj = { x: Math.round(l.power), y: Math.round(l.avg_hr), km: l.idx, half: i < half ? '1st Half' : '2nd Half' }
            if (i < half) { phr1.push(pObj); dr1.push(dObj) } else { phr2.push(pObj); dr2.push(dObj) }
          }
        })
        return <div className="v61-drift-grid">
          <div className="v61-card">
            <div className="v61-card-head"><div><h2 className="v61-card-title">Grade Adjusted Pace (GAP) <Info k="GAP" /></h2><p className="v61-card-sub">Tap or hover any KM for exact split</p></div></div>
            <div className="v61-chart-kpis">{gapKpi || <><span>Avg GAP <b>{a.adjusted_pace_s_km ? fmtPaceS(a.adjusted_pace_s_km) + '/km' : fmtPaceS(a.avg_pace_s_km) + '/km'}</b></span><span>Fastest <b>{fmtPaceS(Math.min(...paceVals.filter(Boolean)))}/km</b></span></>}</div>
            <div className="v61-chart-box">
              <ChartCanvas deps={[id, laps.length]} build={(el) => new Chart(el, {
                type: 'line',
                data: { labels, datasets: [{ label: 'Pace', data: paceVals, borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.2)', fill: true, tension: 0.32, pointRadius: 2, pointHoverRadius: 6, borderWidth: 2 }] },
                options: {
                  responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                  onHover: (_e, elems) => { if (!elems?.length) return; const i = elems[0].index; setGapKpi(<><span><b>KM {laps[i].idx}</b></span><span>Pace <b style={{ color: '#3B82F6' }}>{fmtPaceS(paceVals[i])}/km</b></span><span>HR <b>{hrVals[i]} bpm</b></span></>) },
                  plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,23,42,0.92)', callbacks: { label: (c) => `Pace: ${fmtPaceS(c.parsed.y)}/km` } } },
                  scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } }, y: { reverse: true, ticks: { callback: (v) => fmtPaceS(v) } } },
                },
              })} />
            </div>
          </div>

          <div className="v61-card">
            <div className="v61-card-head"><div><h2 className="v61-card-title">Heart Rate Stream</h2><p className="v61-card-sub">Heart rate across the session</p></div></div>
            <div className="v61-chart-kpis">{hrKpi || <><span>Avg HR <b>{a.avg_hr ?? '—'} bpm</b></span><span>Max HR <b>{a.max_hr ?? '—'} bpm</b></span><span>LTHR <b>{zcfg.lthr} bpm</b></span></>}</div>
            <div className="v61-chart-box">
              <ChartCanvas deps={[id, laps.length]} build={(el) => new Chart(el, {
                type: 'line',
                data: { labels, datasets: [{ label: 'HR', data: hrVals, borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.16)', fill: true, tension: 0.35, pointRadius: 2, pointHoverRadius: 6, borderWidth: 2 }] },
                options: {
                  responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                  onHover: (_e, elems) => { if (!elems?.length) return; const i = elems[0].index; setHrKpi(<><span><b>KM {laps[i].idx}</b></span><span>HR <b style={{ color: '#EF4444' }}>{hrVals[i]} bpm</b></span><span>Pace <b>{fmtPaceS(paceVals[i])}/km</b></span></>) },
                  plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,23,42,0.92)', callbacks: { label: (c) => `HR: ${c.parsed.y} bpm` } } },
                  scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } }, y: { suggestedMin: 120, suggestedMax: 190 } },
                },
              })} />
            </div>
          </div>

          <div className="v61-card">
            <div className="v61-card-head"><div><h2 className="v61-card-title">Power / HR Decoupling</h2><p className="v61-card-sub">First half vs. second half aerobic stability</p></div></div>
            <div className="v61-chart-kpis">{phrKpi || <><span>EF <b>{ef ?? '—'}</b></span><span>Decoupling <b>{dc ? dc.pct + '%' : '—'}</b></span></>}</div>
            <div className="v61-chart-box">
              <ChartCanvas deps={[id, phr1.length + phr2.length]} build={(el) => new Chart(el, {
                type: 'scatter',
                data: { datasets: [
                  { label: '1st Half', data: phr1, backgroundColor: 'rgba(147,51,234,0.75)', pointRadius: 4.5, pointHoverRadius: 7 },
                  { label: '2nd Half', data: phr2, backgroundColor: 'rgba(234,58,58,0.75)', pointRadius: 4.5, pointHoverRadius: 7 },
                  { label: 'Trend', type: 'line', data: olsLine([...phr1, ...phr2]), borderColor: '#EA3A3A', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false },
                ] },
                options: {
                  responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false },
                  onHover: (_e, elems) => { const f = elems?.find((e) => e.datasetIndex < 2); if (!f) return; const pt = (f.datasetIndex === 0 ? phr1 : phr2)[f.index]; if (pt) setPhrKpi(<><span><b>KM {pt.km}</b> ({pt.x}m)</span><span>{pt.half}</span><span>W/HR <b>{pt.y.toFixed(2)}</b></span></>) },
                  plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,23,42,0.92)', filter: (it) => it.datasetIndex < 2, callbacks: { label: (c) => `${c.raw.half} · KM ${c.raw.km}: W/HR ${c.raw.y}` } } },
                  scales: { x: { ticks: { callback: (v) => `${v}m` } } },
                },
              })} />
            </div>
          </div>

          <div className="v61-card">
            <div className="v61-card-head"><div><h2 className="v61-card-title">Power–HR Drift (1st vs 2nd Half)</h2><p className="v61-card-sub">Watts vs BPM with dashed regression trends</p></div></div>
            <div className="v61-chart-kpis">{driftKpi || <><span><b style={{ color: '#9333EA' }}>●</b> 1st Half</span><span><b style={{ color: '#EA3A3A' }}>●</b> 2nd Half</span></>}</div>
            <div className="v61-chart-box">
              <ChartCanvas deps={[id, dr1.length + dr2.length]} build={(el) => new Chart(el, {
                type: 'scatter',
                data: { datasets: [
                  { label: '1st Half', data: dr1, backgroundColor: 'rgba(147,51,234,0.75)', pointRadius: 4.5, pointHoverRadius: 7 },
                  { label: '2nd Half', data: dr2, backgroundColor: 'rgba(234,58,58,0.75)', pointRadius: 4.5, pointHoverRadius: 7 },
                  { label: '1st Trend', type: 'line', data: olsLine(dr1), borderColor: '#9333EA', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false },
                  { label: '2nd Trend', type: 'line', data: olsLine(dr2), borderColor: '#EA3A3A', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false },
                ] },
                options: {
                  responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false },
                  onHover: (_e, elems) => { const f = elems?.find((e) => e.datasetIndex < 2); if (!f) return; const pt = (f.datasetIndex === 0 ? dr1 : dr2)[f.index]; if (pt) setDriftKpi(<><span><b>{pt.half}</b> (KM {pt.km})</span><span><b>{pt.x}W</b> @ <b>{pt.y} bpm</b></span></>) },
                  plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,23,42,0.92)', filter: (it) => it.datasetIndex < 2, callbacks: { label: (c) => `${c.raw.half} · KM ${c.raw.km}: ${c.raw.x}W @ ${c.raw.y} bpm` } } },
                  scales: { x: { ticks: { callback: (v) => `${v}w` } } },
                },
              })} />
            </div>
          </div>
        </div>
      })()}
      {a.sport_class === 'run' && <FitPanel id={a.ids?.[0] || id} go={go} />}
    </div>}

    {/* TAB 5: MATCHED & GEAR */}
    {activeTab === 'matched' && <div className="v61-overview-grid v61-anim">
      <div className="v61-card">
        <div className="v61-card-head">
          <div><h2 className="v61-card-title">Matched &amp; Similar Runs</h2><p className="v61-card-sub">Compare efficiency across recent runs</p></div>
          <span className="v61-pill green">{matchedPill || `EF ${ef ?? '—'}`}</span>
        </div>
        {efSeries.length >= 2 && <div className="v61-chart-box" style={{ height: 145, marginBottom: 10 }}>
          <ChartCanvas deps={[id, efSeries.length]} build={(el) => new Chart(el, {
            type: 'line',
            data: { labels: efSeries.map((x) => x.lbl), datasets: [{ data: efSeries.map((x) => x.v), borderColor: '#4658D6', backgroundColor: 'rgba(70,88,214,0.14)', fill: true, tension: 0.3, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.4 }] },
            options: {
              responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              onHover: (_e, elems) => { if (!elems?.length) return; const i = elems[0].index; setMatchedPill(`${efSeries[i].lbl} · EF ${efSeries[i].v.toFixed(2)}`) },
              plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } },
            },
          })} />
        </div>}
        {recentRuns.map((r) => (
          <div key={r.ids?.[0] || r.id} onClick={() => go('activity', { id: r.ids?.[0] || r.id })} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--v-border)', cursor: 'pointer', gap: 10 }}>
            <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{OFFICIAL_RACES[r.date]?.event || r.name}</div><div className="v61-card-sub">{fmtLong(r.date)} · {km(r.distance_m)} km</div></div>
            <div style={{ textAlign: 'right', fontFamily: 'var(--v-mono)', flexShrink: 0 }}><div style={{ fontWeight: 800, fontSize: 13 }}>{fmtPaceS(r.avg_pace_s_km)}/km</div><div style={{ fontSize: 11, color: 'var(--v-green-t)', fontWeight: 700 }}>EF {efOf(r) ?? '—'}</div></div>
          </div>
        ))}
      </div>

      <div>
        <div className="v61-card">
          <div className="v61-card-head"><div><h2 className="v61-card-title">Gear &amp; Sensors</h2><p className="v61-card-sub">Shoe mileage &amp; connected watch</p></div></div>
          <div className="v61-gear-tile">
            <div className="v61-gear-ico">👟</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <b style={{ fontSize: 13.5 }}>{activeGearId && gear[activeGearId] ? gear[activeGearId] : 'No shoe assigned'}</b>
                <span className="v61-pill green">{shoePct >= 85 ? 'Near Retire' : 'Healthy Foam'}</span>
              </div>
              <div className="v61-card-sub">{shoeKm != null ? `${shoeKm} / ${shoeMax} km logged · ${shoePct}% lifespan` : 'Assign a shoe in Overview'}</div>
              {shoeKm != null && <div className="v61-gear-bar"><div style={{ width: `${shoePct}%`, background: shoePct >= 85 ? '#E28120' : '#10B981' }} /></div>}
            </div>
          </div>
          <div className="v61-gear-tile" style={{ marginBottom: 0 }}>
            <div className="v61-gear-ico">⌚</div>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13.5 }}>COROS APEX 4 42mm</b>
              <div className="v61-card-sub">Synced with {(a.sources || []).join(' & ') || 'COROS'}</div>
            </div>
          </div>
        </div>
        {c0 && <RouteIntel id={a.ids?.[0] || id} />}
        {a.sport_class === 'run' && (a.distance_m || 0) >= 16000 && <LongRunContext label={String(a.ids?.[0] || id).replace(/^coros:/, '')} go={go} />}
      </div>
    </div>}

    {/* TAB 6: OFFICIAL RESULT (Shown only when Tag === 'Race') */}
    {activeTab === 'official' && isRace && <div className="v61-overview-grid v61-anim">
      <div className="v61-card">
        <div className="v61-card-head">
          <div><h2 className="v61-card-title">{officialBase?.event || displayTitle}</h2><p className="v61-card-sub">{officialBase?.provider || 'Official Chip Timing'}</p></div>
          <span className="v61-pill red">{ctx.official_bib || officialBase?.bib || 'Bib N/A'}</span>
        </div>
        <div className="v61-off-grid">
          <div className="v61-dyn-tile"><small>Net / Chip</small><b>{officialBase?.net || fmtDur(a.duration_s)}</b></div>
          <div className="v61-dyn-tile"><small>Gun / Watch</small><b>{officialBase?.gun || fmtDur(a.duration_s)}</b></div>
          <div className="v61-dyn-tile"><small>Status</small><b>{officialBase?.status || 'Race'}</b></div>
        </div>
        {officialBase?.rank && <p className="v61-card-sub" style={{ marginBottom: 12 }}><b>Standing:</b> {officialBase.rank}</p>}
        {(ctx.official_url || officialBase?.url) && (
          <a href={ctx.official_url || officialBase.url} target="_blank" rel="noopener noreferrer" className="v61-btn-cobalt" style={{ width: '100%' }}>
            Open Official Result Link ↗
          </a>
        )}
        <div className="form two" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--v-border)' }}>
          <label className="fld"><span>Bib Number</span><input type="text" placeholder="#B13718" value={ctx.official_bib || officialBase?.bib || ''} onChange={(e) => setC({ official_bib: e.target.value })} /></label>
          <label className="fld"><span>Official Result URL</span><input type="url" placeholder="https://scorenow.id/..." value={ctx.official_url || officialBase?.url || ''} onChange={(e) => setC({ official_url: e.target.value })} /></label>
        </div>
      </div>

      <div className="v61-card">
        <div className="v61-card-head"><div><h2 className="v61-card-title">Official Timing Mat Splits</h2><p className="v61-card-sub">Official checkpoint timing splits</p></div></div>
        {officialBase?.splits?.length ? (
          <div className="scroll" tabIndex={0}><table className="lapt">
            <thead><tr><th>Checkpoint</th><th>Cumulative</th><th>Split Pace</th></tr></thead>
            <tbody>{officialBase.splits.map(([cp, t, sp]) => <tr key={cp}><td><b>{cp}</b></td><td style={{ fontFamily: 'var(--v-mono)' }}>{t}</td><td style={{ fontFamily: 'var(--v-mono)' }}>{sp}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="v61-card-sub">No official mat splits saved for this date.</p>}
        {offEdit == null
          ? <button type="button" className="v61-edit-btn" style={{ marginTop: 12 }} onClick={() => setOffEdit({ ...Object.fromEntries(['event', 'bib', 'status', 'net', 'gun', 'rank', 'provider', 'url'].map((k) => [k, officialBase?.[k] || ''])), splits: splitsToText(officialBase?.splits) })}>✎ Edit official result</button>
          : <div className="form" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--v-border)' }}>
            {[['event', 'Event'], ['bib', 'Bib'], ['status', 'Status'], ['net', 'Net / chip'], ['gun', 'Gun / watch'], ['rank', 'Standing'], ['provider', 'Timing provider'], ['url', 'Result URL (https)']].map(([k, l]) =>
              <label key={k} className="fld"><span>{l}</span><input type="text" value={offEdit[k]} onChange={(e) => setOffEdit({ ...offEdit, [k]: e.target.value })} /></label>)}
            <label className="fld"><span>Mat splits, one per line: checkpoint | time | pace</span><textarea rows={5} value={offEdit.splits} onChange={(e) => setOffEdit({ ...offEdit, splits: e.target.value })} placeholder="10K | 1:18:59 | 7:54/km" /></label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="v61-edit-btn save" onClick={() => { const { splits, url, ...f } = offEdit; setOffStored({ ...offStored, [a.date]: { ...f, url: safeUrl(url), splits: parseSplits(splits) } }); setOffEdit(null) }}>Save</button>
              <button type="button" className="v61-edit-btn" onClick={() => setOffEdit(null)}>Cancel</button>
              {offStored?.[a.date] && <button type="button" className="v61-edit-btn" onClick={() => { const { [a.date]: _drop, ...rest } = offStored; setOffStored(rest); setOffEdit(null) }}>Restore built-in</button>}
            </div>
            <p className="v61-card-sub">Saved in your synced settings, so it shows on every device. Only the date of this activity is edited.</p>
          </div>}
      </div>
    </div>}
  </>
}
