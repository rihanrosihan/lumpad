import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useStore } from './store.js'

// Real map (OpenStreetMap data, CARTO basemap tiles) under the official route. Needs img-src https://*.basemaps.cartocdn.com in the CSP;
// without network the line is still drawn on a plain background. The map is locked until "Move map" is pressed so scrolling the page never drags it.
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'
const GRADE = { down: '--c-tt', flat: '--green', gentle: '--yellow', rise: '--c-quality' }
const isDark = () => { const t = document.documentElement.dataset.theme; return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) }
const tileUrl = () => `https://{s}.basemaps.cartocdn.com/${isDark() ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`

export default function RouteMapLeaflet({ R, P = null, km, setKm, sel = null, hl = null, height = 'min(70vh, 600px)' }) {
  const el = useRef(null), M = useRef({}), [unlocked, setUnlocked] = useState(false), [tilesOn, setTilesOn] = useStore('lumpad.maptiles', 'on'), [zoom, setZoom] = useState(12)
  const posAt = (k) => { const l = R.line; let i = l.findIndex((p) => p[2] >= k); if (i < 1) i = i === 0 ? 1 : l.length - 1; const a = l[i - 1], b = l[i], f = (k - a[2]) / Math.max(1e-9, b[2] - a[2]); return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])] }

  // build once
  useEffect(() => {
    const map = L.map(el.current, { zoomControl: true, attributionControl: true, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0.25 })
    const b = R.bbox; map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [18, 18] }); M.current = { map, segs: [], marks: L.layerGroup().addTo(map) }
    map.attributionControl.setPrefix(false); map.on('zoomend', () => setZoom(map.getZoom()))
    // route: one polyline per simplified segment (coloured by grade below), selection halo under it
    M.current.halo = L.polyline([], { color: '#fff', weight: 14, opacity: 0.4, lineCap: 'round' }).addTo(map)
    R.line.slice(1).forEach((q, i) => { const p = R.line[i], pl = L.polyline([[p[0], p[1]], [q[0], q[1]]], { weight: 4, opacity: 1, lineCap: 'round', color: css('--accent') }).addTo(map); pl._km = (p[2] + q[2]) / 2; pl._a = p[2]; pl._b = q[2]; M.current.segs.push(pl) })
    R.turns.forEach((t) => L.circleMarker(t.ll, { radius: 5, weight: 2, color: css('--surface'), fillColor: css('--yellow'), fillOpacity: 1 }).bindTooltip(`${t.name} · km ${t.km}`).addTo(map))
    L.marker(R.start, { icon: L.divIcon({ className: 'rml-pin rml-start', html: '<span>Start · Monas</span>', iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(map)
    L.marker(R.finish, { icon: L.divIcon({ className: 'rml-pin rml-fin', html: '<span>Finish · GBK</span>', iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(map)
    M.current.cur = L.circleMarker(R.start, { radius: 8, weight: 4, color: css('--accent'), fillColor: '#fff', fillOpacity: 1 }).addTo(map)
    map.on('click', (e) => { let best = 0, bd = 1e18; R.line.forEach((p, i) => { const d = (p[0] - e.latlng.lat) ** 2 + (p[1] - e.latlng.lng) ** 2; if (d < bd) { bd = d; best = i } }); setKm(R.line[best][2]) })
    const mq = matchMedia('(prefers-color-scheme: dark)'), onTheme = () => M.current.retile?.()
    mq.addEventListener?.('change', onTheme); const mo = new MutationObserver(onTheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const ro = new ResizeObserver(() => map.invalidateSize()); ro.observe(el.current)
    return () => { mq.removeEventListener?.('change', onTheme); mo.disconnect(); ro.disconnect(); map.remove(); M.current = {} }
  }, [R]) // eslint-disable-line

  // tiles on / off, light / dark
  useEffect(() => {
    const m = M.current; if (!m.map) return
    const apply = () => { if (m.tiles) { m.map.removeLayer(m.tiles); m.tiles = null } if (tilesOn !== 'off') m.tiles = L.tileLayer(tileUrl(), { subdomains: 'abcd', maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>' }).addTo(m.map).bringToBack() }
    m.retile = apply; apply()
  }, [tilesOn, R])

  // interaction lock
  useEffect(() => { const map = M.current.map; if (!map) return; for (const h of ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom']) map[h][unlocked ? 'enable' : 'disable']() }, [unlocked])

  // grade colours, highlight, selection
  useEffect(() => {
    const m = M.current; if (!m.map) return
    m.segs.forEach((pl) => { const c = P ? P.classOf(P.grade(pl._km)) : null; pl.setStyle({ color: c ? css(GRADE[c]) : css('--accent'), opacity: hl && c && hl !== c ? 0.2 : 1 }) })
    m.halo.setLatLngs(sel ? R.line.filter((p) => p[2] >= sel[0] && p[2] <= sel[1]).map((p) => [p[0], p[1]]) : [])
  }, [P, hl, sel, R])

  // km markers by zoom, cursor
  useEffect(() => {
    const m = M.current; if (!m.map) return; m.marks.clearLayers()
    R.marks.filter((k) => (zoom >= 14 ? true : zoom >= 13 ? k.km % 2 === 0 : k.km % 5 === 0)).forEach((k) => L.marker(k.ll, { icon: L.divIcon({ className: 'rml-km', html: `<span>${k.km}</span>`, iconSize: [22, 22] }), keyboard: false }).on('click', () => setKm(k.km)).addTo(m.marks))
  }, [zoom, R]) // eslint-disable-line
  useEffect(() => { M.current.cur?.setLatLng(posAt(km)) }, [km, R]) // eslint-disable-line

  return <div className="rmapL">
    <div ref={el} className="rml" style={{ height }} role="application" aria-label="Map of the course. Press Move map to pan and zoom, or use the slider below." />
    <div className="rml-bar"><button className={unlocked ? 'on' : ''} aria-pressed={unlocked} onClick={() => setUnlocked(!unlocked)}>{unlocked ? 'Lock map' : 'Move map'}</button><button aria-pressed={tilesOn !== 'off'} onClick={() => setTilesOn(tilesOn === 'off' ? 'on' : 'off')}>{tilesOn === 'off' ? 'Show street map' : 'Lines only'}</button></div>
  </div>
}
