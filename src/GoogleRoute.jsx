import { useState } from 'react'
import { Card } from './ui.jsx'
import { useApi } from './api.js'
import { getJson } from './net.js'
import { svgRoute, elevPath, gpx } from './lib/geo.js'

// Route screens backed by the Google gateway. Route points leave the server only when GOOGLE_ROUTE_DATA=1 and only after a button press here.
const useCaps = () => useApi('/api/geo/capabilities').data
const Off = () => <p className="muted">Route data to Google is switched off on the server (<code>GOOGLE_ROUTE_DATA=1</code> in <code>.env</code> turns it on). Nothing is sent.</p>
function Elev({ el, gain, loss }) {
  const d = elevPath(el); if (!d) return <p className="muted">No elevation returned.</p>
  const v = el.filter((x) => x != null)
  return <div><svg viewBox="0 0 320 70" className="runbars" style={{ width: '100%', height: 70 }} role="img" aria-label={`Elevation profile, ${Math.min(...v)} to ${Math.max(...v)} m`}><path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" /></svg>
    <p className="muted" style={{ margin: 0 }}>+{gain ?? '—'} m / −{loss ?? '—'} m · {Math.min(...v)}–{Math.max(...v)} m (Google elevation, display only; the training numbers keep the watch's own)</p></div>
}
const Places = ({ list, kind }) => list?.length ? <ul className="rules">{list.slice(0, 12).map((p) => <li key={p.id}>{p.name || 'Unnamed'} <span className="muted">({p.lat?.toFixed(4)}, {p.lon?.toFixed(4)})</span></li>)}</ul> : <p className="muted">No {kind} points found near this route.</p>

// One finished activity: elevation, water / toilets / medical along it, and the static route map as a share image.
export function RouteIntel({ id }) {
  const caps = useCaps(), [on, setOn] = useState(false), [kind, setKind] = useState(null), key = encodeURIComponent(id)
  const E = useApi(on ? `/api/geo/elevation?id=${key}` : '', on), P = useApi(kind ? `/api/geo/places?id=${key}&kind=${kind}` : '', !!kind)
  if (!caps?.configured) return null
  return <Card title="Route intel" right={<span className="muted">Google</span>}>
    {!caps.route_data ? <Off /> : <>
      {!on ? <button className="btn sm" onClick={() => setOn(true)}>Load elevation and route map</button> : <>
        {E.state === 'loading' && <div className="skel" style={{ height: 70 }} />}
        {E.state === 'error' && <p className="muted">Could not load the elevation for this activity (no FIT file, or Google refused).</p>}
        {E.data && <Elev el={E.data.points} gain={E.data.gain_m} loss={E.data.loss_m} />}
        <figure style={{ margin: '10px 0 0' }}><img src={`/api/map/static?id=${key}`} alt="Route on a Google map" style={{ width: '100%', borderRadius: 12 }} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          <figcaption className="muted">Map data © Google · <a href={`/api/map/static?id=${key}`} download="route.png">Save as share image</a></figcaption></figure>
      </>}
      <div className="pills" style={{ marginTop: 10 }}>{[['water', 'Water'], ['toilets', 'Toilets'], ['medical', 'Medical']].map(([k, l]) => <button key={k} className={`btn sm ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{l} along route</button>)}</div>
      {kind && P.state === 'loading' && <div className="skel" style={{ height: 40 }} />}
      {kind && P.state === 'error' && <p className="muted">Could not search places for this route.</p>}
      {kind && P.data && <><Places list={P.data.places} kind={kind} /><p className="muted">{P.data.attribution}</p></>}
    </>}
  </Card>
}

// Plan a circuit of about N km from where you last ran: loop + elevation + water points, saved as GPX.
export function RoutePlanner() {
  const caps = useCaps(), [km, setKm] = useState(20), [bearing, setBearing] = useState(0), [R, setR] = useState({ state: 'idle' })
  if (!caps?.configured) return null
  const go = () => { setR({ state: 'loading' }); getJson(`/api/geo/loop?km=${km}&bearing=${bearing}`).then((d) => setR({ state: 'ok', d })).catch(() => setR({ state: 'error' })) }
  const d = R.d, sv = d ? svgRoute(d.points, 320, 200) : null
  return <Card title="Long-run route planner" right={<span className="muted">Google Routes</span>}>
    {!caps.route_data ? <Off /> : <>
      <div className="pills" style={{ alignItems: 'end' }}>
        <label className="fld"><span>Distance (km)</span><input type="number" min="3" max="45" step="1" value={km} onChange={(e) => setKm(Math.max(3, Math.min(45, Number(e.target.value) || 3)))} /></label>
        <label className="fld"><span>First leg heads</span><select value={bearing} onChange={(e) => setBearing(Number(e.target.value))}>{[[0, 'North'], [90, 'East'], [180, 'South'], [270, 'West']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <button className="btn sm" onClick={go} disabled={R.state === 'loading'}>{R.state === 'loading' ? 'Planning…' : 'Plan loop'}</button>
      </div>
      <p className="muted">Starts from the place of your last GPS run. Your start point and the route are sent to Google to plan it. The distance is a walking-route estimate; check it against the course before you rely on it.</p>
      {R.state === 'error' && <p className="muted">No loop could be planned here (no key, no GPS run yet, or no walkable circuit).</p>}
      {d && <>
        <p><b>{d.km} km</b> <span className="muted">(asked for {d.requested_km})</span></p>
        <svg viewBox="0 0 320 200" style={{ width: '100%', maxWidth: 420, background: 'var(--surface-2, transparent)', borderRadius: 12 }} role="img" aria-label="Planned loop outline"><path d={sv.d} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" />
          {(d.water || []).filter((p) => p.lat != null).map((p) => { const [x, y] = sv.proj([p.lat, p.lon]); return <circle key={p.id} cx={x} cy={y} r="3.5" fill="var(--c-tt, #4b8)"><title>{p.name || 'Water'}</title></circle> })}</svg>
        {d.elevation && <Elev el={d.elevation.points} gain={d.elevation.gain_m} loss={d.elevation.loss_m} />}
        <h4 style={{ margin: '10px 0 4px' }}>Water points near the loop</h4><Places list={d.water} kind="water" />
        <p className="muted">{d.attribution}</p>
        <a className="btn sm" download={`loop-${d.km}km.gpx`} href={'data:application/gpx+xml;charset=utf-8,' + encodeURIComponent(gpx(`Loop ${d.km} km`, d.points))}>Download GPX</a>
      </>}
    </>}
  </Card>
}
