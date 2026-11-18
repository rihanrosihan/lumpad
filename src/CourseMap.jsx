import { useMemo, useState } from 'react'
import JAKIM from './data/routes/jakim.json'
import { Card, Chip, Evidence } from './ui.jsx'

export const ROUTES = { jakim: JAKIM }
const fmtT = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` }
const fmtP = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const W = 300, H = 400, PAD = 14

// Route card: map from the official GPX (km markers every 5 km, U-turns), a km scrubber with street + clock at the goal pace,
// the street-by-street list and the GPX download. No elevation: the official file has none (Jakarta is flat).
export default function CourseMap({ routeId = 'jakim', pace = null, goal = null }) {
  const R = ROUTES[routeId], [km, setKm] = useState(0)
  const proj = useMemo(() => {
    const [la0, lo0, la1, lo1] = R.bbox, k = Math.cos(((la0 + la1) / 2) * Math.PI / 180), w = (lo1 - lo0) * k, h = la1 - la0, s = Math.min((W - 2 * PAD) / w, (H - 2 * PAD) / h)
    const ox = (W - w * s) / 2, oy = (H - h * s) / 2
    return ([la, lo]) => [ox + (lo - lo0) * k * s, oy + (la1 - la) * s]
  }, [R])
  const path = useMemo(() => R.line.map((p, i) => { const [x, y] = proj(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}` }).join(''), [R, proj])
  const pos = useMemo(() => { const l = R.line; let i = l.findIndex((p) => p[2] >= km); if (i < 1) i = i === 0 ? 1 : l.length - 1; const a = l[i - 1], b = l[i], f = (km - a[2]) / Math.max(1e-9, b[2] - a[2]); return proj([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]) }, [R, proj, km])
  const seg = R.segments.find((s) => km >= s.from && km < s.to) || R.segments.at(-1)
  const fives = R.marks.filter((m) => m.km % 5 === 0)
  const [sx, sy] = proj(R.start), [fx, fy] = proj(R.finish)
  return <Card title="Official course" right={<Chip>{R.officialKm} km</Chip>}>
    <div className="cmap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Course map of ${R.name}: Monas, Mampang, Satrio, Prapanca Raya and Sisingamangaraja out-and-backs, finish at Gelora Bung Karno`}>
        <path d={path} className="cm-line" />
        {R.turns.map((t) => { const [x, y] = proj(t.ll); return <g key={t.km}><circle cx={x} cy={y} r="4" className="cm-turn" /><title>{`${t.name} · km ${t.km}`}</title></g> })}
        {fives.map((m) => { const [x, y] = proj(m.ll); return <g key={m.km}><circle cx={x} cy={y} r="8" className="cm-k" /><text x={x} y={y + 3} textAnchor="middle" className="cm-kt">{m.km}</text></g> })}
        <circle cx={sx} cy={sy} r="6" className="cm-start" /><rect x={fx - 5} y={fy - 5} width="10" height="10" className="cm-fin" />
        <text x={sx + 9} y={sy - 6} className="cm-lab">Start · Monas</text><text x={fx - 9} y={fy - 8} textAnchor="end" className="cm-lab">Finish · GBK</text>
        <circle cx={pos[0]} cy={pos[1]} r="6" className="cm-pos" />
      </svg>
    </div>
    <label className="fld"><span>Distance: <b>km {km.toFixed(1)}</b></span><input type="range" min="0" max={R.officialKm} step="0.1" value={km} onChange={(e) => setKm(+e.target.value)} aria-label="Move along the course" /></label>
    <p><b>{seg.what}</b>{pace ? <> · {goal ? goal + ': ' : ''}<b>{fmtT(km * pace)}</b> at {fmtP(pace)}/km</> : null}</p>
    <ol className="cm-segs">{R.segments.map((s) => <li key={s.from}><button className={s === seg ? 'on' : ''} onClick={() => setKm(s.from)}><b>km {s.from % 1 ? s.from : s.from.toFixed(0)}–{s.to % 1 ? s.to : s.to.toFixed(0)}</b><span>{s.what}</span></button></li>)}</ol>
    <p className="muted">Four U-turns in the second half (km {R.turns.filter((t) => t.km > 12).map((t) => t.km).join(', ')}) plus one at km 12.4: take them wide and slow slightly, each costs a few seconds. No elevation data: the official file has none and the course is flat.</p>
    <a className="btn sm full" href={R.gpx} download>Download the GPX (load it on the watch)</a>
    <Evidence>{R.source} The GPX track is {R.trackKm} km as drawn; the map and clock scale it to the certified {R.officialKm} km. Street names are read from the official map; km ranges come from the track.</Evidence>
  </Card>
}
export { fmtT, fmtP }
