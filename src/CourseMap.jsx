import { useState } from 'react'
import JAKIM from './data/routes/jakim.json'
import { Card, Chip, Evidence } from './ui.jsx'
import RouteMapLeaflet from './RouteMapLeaflet.jsx'

export const ROUTES = { jakim: JAKIM }
const fmtT = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` }
const fmtP = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

// Route card: map from the official GPX (km markers every 5 km, U-turns), a km scrubber with street + clock at the goal pace,
// the street-by-street list and the GPX download. No elevation: the official file has none (Jakarta is flat).
export default function CourseMap({ routeId = 'jakim', pace = null, goal = null, go = null }) {
  const R = ROUTES[routeId], [km, setKm] = useState(0)
  const seg = R.segments.find((s) => km >= s.from && km < s.to) || R.segments.at(-1)
  return <Card title="Official course" right={<Chip>{R.officialKm} km</Chip>}>
    <RouteMapLeaflet R={R} km={km} setKm={setKm} height="340px" />
    <label className="fld"><span>Distance: <b>km {km.toFixed(1)}</b></span><input type="range" min="0" max={R.officialKm} step="0.1" value={km} onChange={(e) => setKm(+e.target.value)} aria-label="Move along the course" /></label>
    <p><b>{seg.what}</b>{pace ? <> · {goal ? goal + ': ' : ''}<b>{fmtT(km * pace)}</b> at {fmtP(pace)}/km</> : null}</p>
    <ol className="cm-segs">{R.segments.map((s) => <li key={s.from}><button className={s === seg ? 'on' : ''} onClick={() => setKm(s.from)}><b>km {s.from % 1 ? s.from : s.from.toFixed(0)}–{s.to % 1 ? s.to : s.to.toFixed(0)}</b><span>{s.what}</span></button></li>)}</ol>
    <p className="muted">Four U-turns in the second half (km {R.turns.filter((t) => t.km > 12).map((t) => t.km).join(', ')}) plus one at km 12.4: take them wide and slow slightly, each costs a few seconds. No elevation data: the official file has none and the course is flat.</p>
    {go && <button className="btn sm full" onClick={() => go('route')}>Open the full course page: zoomable map, pacing plan, turn by turn</button>}
    <a className="btn sm full" href={R.gpx} download>Download the GPX (load it on the watch)</a>
    <Evidence>{R.source} The GPX track is {R.trackKm} km as drawn; the map and clock scale it to the certified {R.officialKm} km. Street names are read from the official map; km ranges come from the track.</Evidence>
  </Card>
}
export { fmtT, fmtP }
