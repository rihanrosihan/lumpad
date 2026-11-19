import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { JRF_META, JRF_TRACK, JRF_MAP_COPS, JRF_MAP_WBGT, JRF_MAP_HYDRO, JRF_MAP_KM5 } from './data/jrfCourse.js'

const dotIcon = (bg, txt, sz = 22) => L.divIcon({
  className: 'jrf-pin',
  html: `<div style="width:${sz}px;height:${sz}px;border-radius:999px;background:${bg};color:#fff;font:700 ${sz > 22 ? 10 : 9}px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${txt}</div>`,
  iconSize: [sz, sz],
  iconAnchor: [sz / 2, sz / 2],
})

export default function JrfCourseMap() {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef({})
  const [show, setShow] = useState({ cops: true, wbgt: true, hydro: false, km5: true })
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }))

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, { scrollWheelZoom: false, attributionControl: true })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map)

    const latlngs = JRF_TRACK.map((p) => [p[0], p[1]])
    const poly = L.polyline(latlngs, { color: '#4658D6', weight: 4, opacity: 0.9 }).addTo(map)
    map.fitBounds(poly.getBounds(), { padding: [20, 20] })

    // Start / Finish pin
    L.marker([JRF_META.start[0], JRF_META.start[1]], { icon: dotIcon('#10B981', 'S/F', 26) })
      .bindPopup('<b>Start / Finish</b><br/>Istora Senayan / East Plaza GBK<br/>Flag-off 04:00 WIB · COT 5h 00m (09:00)')
      .addTo(map)

    // Layer groups
    const gCops = L.layerGroup(JRF_MAP_COPS.map((c, i) =>
      L.marker([c.pos[0], c.pos[1]], { icon: dotIcon('#DC2626', `C${i + 1}`, 24) })
        .bindPopup(`<b>${c.name} · KM ${c.km}</b><br/>Closes: ${c.closes} (${c.elapsed})<br/>Elevation: ${c.pos[2]} m`)
    ))
    const gWbgt = L.layerGroup(JRF_MAP_WBGT.map((w) =>
      L.marker([w.pos[0], w.pos[1]], { icon: dotIcon('#D97706', 'W', 20) })
        .bindPopup(`<b>WBGT Flag Tent · KM ${w.km}</b><br/>Medical &amp; heat flag checkpoint<br/>Elevation: ${w.pos[2]} m`)
    ))
    const gHydro = L.layerGroup(JRF_MAP_HYDRO.map((h) =>
      L.marker([h.pos[0], h.pos[1]], { icon: dotIcon('#0284C7', 'H', 18) })
        .bindPopup(`<b>Le Minerale / HYDROPLUS Station · KM ${h.km}</b><br/>Official hydration station`)
    ))
    const gKm5 = L.layerGroup(JRF_MAP_KM5.map((k) =>
      L.marker([k.pos[0], k.pos[1]], { icon: dotIcon('#1E293B', `${k.km}`, 20) })
        .bindPopup(`<b>KM ${k.km}</b><br/>Elevation: ${k.pos[2]} m`)
    ))

    layersRef.current = { cops: gCops, wbgt: gWbgt, hydro: gHydro, km5: gKm5 }
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; layersRef.current = {} }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const [k, grp] of Object.entries(layersRef.current)) {
      if (show[k]) { if (!map.hasLayer(grp)) grp.addTo(map) }
      else { if (map.hasLayer(grp)) map.removeLayer(grp) }
    }
  }, [show])

  // Build SVG elevation profile (600x120 viewBox)
  const W = 600, H = 120, padL = 32, padR = 10, padT = 12, padB = 22
  const maxKm = JRF_META.distKm || 42.3
  const minE = Math.floor(JRF_META.minEle - 2), maxE = Math.ceil(JRF_META.maxEle + 2)
  const xOf = (km) => padL + (km / maxKm) * (W - padL - padR)
  const yOf = (ele) => padT + (1 - (ele - minE) / (maxE - minE || 1)) * (H - padT - padB)
  const ptsStr = JRF_TRACK.map((p) => `${xOf(p[3]).toFixed(1)},${yOf(p[2]).toFixed(1)}`).join(' ')
  const areaStr = `${xOf(0).toFixed(1)},${(H - padB).toFixed(1)} ${ptsStr} ${xOf(maxKm).toFixed(1)},${(H - padB).toFixed(1)}`

  return (
    <div>
      <div className="ch" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div className="chiprow" style={{ margin: 0 }}>
          <button type="button" aria-pressed={show.cops} onClick={() => toggle('cops')}>COPs (4)</button>
          <button type="button" aria-pressed={show.wbgt} onClick={() => toggle('wbgt')}>WBGT Tents (5)</button>
          <button type="button" aria-pressed={show.hydro} onClick={() => toggle('hydro')}>Hydration (19)</button>
          <button type="button" aria-pressed={show.km5} onClick={() => toggle('km5')}>5K Splits</button>
        </div>
        <a className="btn sm" href="/jrf-marathon-2026-full-marathon.gpx" download="jrf-marathon-2026-full-marathon.gpx">Download Official GPX (COROS)</a>
      </div>

      <div ref={mapEl} style={{ height: 340, width: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)', zIndex: 1 }} />

      <div className="score-grid" style={{ marginTop: 10 }}>
        <div><small>Official GPX</small><b>{JRF_META.distKm} km</b><em>{JRF_META.points} GPS pts</em></div>
        <div><small>Elevation Gain</small><b>+{JRF_META.gainM} m</b><em>Flat fast loop</em></div>
        <div><small>Altitude Range</small><b>{JRF_META.minEle}–{JRF_META.maxEle} m</b><em>Peak KM 40 (25.7 m)</em></div>
        <div><small>Hydration</small><b>19 stations</b><em>Le Minerale · HYDROPLUS</em></div>
        <div><small>WBGT Tents</small><b>5 tents</b><em>KM 20, 26, 30, 36, 40.5</em></div>
      </div>

      <div style={{ marginTop: 12 }}>
        <small className="muted" style={{ display: 'block', marginBottom: 4 }}>Elevation Profile (m) · Start/Finish Istora GBK (18.1 m) → Monas KM 15 (9.6 m) → Rasuna KM 25 (20.9 m) → Senayan KM 40 (25.7 m)</small>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--surface2)', borderRadius: 10, border: '1px solid var(--line)' }} role="img" aria-label={`JRF Marathon elevation profile ${JRF_META.minEle}m to ${JRF_META.maxEle}m, +${JRF_META.gainM}m gain`}>
          {[10, 20, 30].filter((e) => e >= minE && e <= maxE).map((e) => (
            <g key={e}>
              <line x1={padL} x2={W - padR} y1={yOf(e)} y2={yOf(e)} stroke="var(--line)" strokeDasharray="3 3" />
              <text x={padL - 4} y={yOf(e) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{e}m</text>
            </g>
          ))}
          <polygon points={areaStr} fill="color-mix(in srgb, var(--cobalt) 18%, transparent)" />
          <polyline points={ptsStr} fill="none" stroke="var(--cobalt)" strokeWidth="2" />
          {JRF_MAP_COPS.map((c, i) => (
            <g key={c.name}>
              <line x1={xOf(c.km)} x2={xOf(c.km)} y1={padT} y2={H - padB} stroke="#DC2626" strokeWidth="1" strokeDasharray="2 2" />
              <text x={xOf(c.km)} y={padT + 8} textAnchor="middle" fontSize="8" fontWeight="700" fill="#DC2626">C{i + 1}</text>
            </g>
          ))}
          {[0, 5, 10, 15, 20, 25, 30, 35, 40].map((km) => (
            <text key={km} x={xOf(km)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">{km}k</text>
          ))}
        </svg>
      </div>
    </div>
  )
}
