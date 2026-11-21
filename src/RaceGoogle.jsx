import { useState } from 'react'
import { Card } from './ui.jsx'
import { useApi } from './api.js'
import { getJson } from './net.js'
import { localIso, leaveBy, courseHeading } from './lib/geo.js'
import { JRF_META, JRF_TRACK, JRF_MAP_COPS, JRF_MAP_KM5 } from './data/jrfCourse.js'

const NOTE = <p className="muted">Route data to Google is switched off on the server (<code>GOOGLE_ROUTE_DATA=1</code> in <code>.env</code> turns it on). Nothing is sent.</p>
// The race-day plan says roads close at 02:30 and the gate at 04:00; a car must be in by closure.
const RACE = { date: '2027-10-24', arriveBy: '02:15', dest: JRF_META.start, label: 'GBK start area' }

// When to leave home for race morning: traffic-aware drive time to the start, in the venue's own time zone.
export function RaceDayTravel() {
  const caps = useApi('/api/geo/capabilities').data, [o, setO] = useState(''), [R, setR] = useState({ state: 'idle' })
  if (!caps?.configured) return null
  const parse = (s) => { const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s || ''); return m ? [+m[1], +m[2]] : null }, from = parse(o)
  const here = () => navigator.geolocation?.getCurrentPosition((p) => setO(`${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`), () => setR({ state: 'error', why: 'Location permission was refused.' }))
  const go = async () => {
    setR({ state: 'loading' })
    try {
      const tz = await getJson(`/api/geo/timezone?lat=${RACE.dest[0]}&lon=${RACE.dest[1]}`), off = tz.utc_offset_s ?? 25200
      // Google only plans departures in the near future; for a far race ask for the next occurrence of that clock time at the same weekday instead
      const far = (Date.parse(RACE.date) - Date.now()) / 864e5 > 90, d = new Date(); if (far) { while (d.getUTCDay() !== new Date(RACE.date).getUTCDay()) d.setUTCDate(d.getUTCDate() + 1) }
      const day = far ? d.toISOString().slice(0, 10) : RACE.date, depart = localIso(day, leaveBy(RACE.arriveBy, 45, 0).hhmm, off)
      const r = await getJson(`/api/geo/route?olat=${from[0]}&olon=${from[1]}&dlat=${RACE.dest[0]}&dlon=${RACE.dest[1]}&depart=${encodeURIComponent(depart)}`)
      setR({ state: 'ok', r, tz, far })
    } catch { setR({ state: 'error', why: 'Could not get a drive time (route data off, or Google refused).' }) }
  }
  const r = R.r, mins = r?.minutes_traffic, lv = mins != null ? leaveBy(RACE.arriveBy, mins, 10) : null
  return <Card title="Race-morning travel: when to leave" right={<span className="muted">Google Routes</span>}>
    {!caps.route_data ? NOTE : <>
      <div className="pills" style={{ alignItems: 'end' }}>
        <label className="fld"><span>Leaving from (lat, lon)</span><input type="text" inputMode="decimal" placeholder="-6.2000, 106.8000" value={o} onChange={(e) => setO(e.target.value)} /></label>
        <button className="btn sm" onClick={here}>Use my location</button>
        <button className="btn sm" onClick={go} disabled={!from || R.state === 'loading'}>{R.state === 'loading' ? 'Checking…' : 'Check drive time'}</button>
      </div>
      <p className="muted">Your start point is sent to Google for this check only; it is kept in this page's memory, not saved anywhere. Car only: roads close 02:30; the free MRT starts 03:00.</p>
      {R.state === 'error' && <p className="muted">{R.why}</p>}
      {lv && <p><b>Leave by {lv.hhmm}{lv.dayOffset ? ' the night before' : ''}</b> <span className="muted">(arrive {RACE.arriveBy}; {mins} min in traffic{r.minutes_free_flow != null ? `, ${r.minutes_free_flow} min free-flow` : ''}{r.km != null ? `, ${r.km} km` : ''}, +10 min buffer; {R.tz.id || 'local time'})</span></p>}
      {R.far && lv && <p className="muted">The race is more than 90 days away, so this uses traffic for the next same-weekday night. Check again in the race week.</p>}
    </>}
  </Card>
}

// Street View at the places that matter on race day. Loaded on demand: each photo is a paid Google call and sends the exact point.
const SPOTS = [['Start', JRF_META.start], ...JRF_MAP_COPS.map((c) => [c.name, c.pos]), ...JRF_MAP_KM5.filter((k) => k.km === 40).map((k) => ['Km 40', k.pos])]
export function CourseStreetView() {
  const caps = useApi('/api/geo/capabilities').data, [on, setOn] = useState(false)
  if (!caps?.configured) return null
  return <Card title="Course photos" right={<span className="muted">Google Street View</span>}>
    {!caps.route_data ? NOTE : !on ? <button className="btn sm" onClick={() => setOn(true)}>Load photos of the start, COPs and km 40</button> :
      <div className="rgrid">{SPOTS.map(([n, p]) => <figure key={n} style={{ margin: 0 }}>
        <img src={`/api/geo/streetview?lat=${p[0]}&lon=${p[1]}&heading=${courseHeading(JRF_TRACK, p)}`} alt={`Street View at ${n}, facing along the course`} loading="lazy" style={{ width: '100%', borderRadius: 12 }} onError={(e) => { e.currentTarget.alt = `No Street View image at ${n}` }} />
        <figcaption className="muted">{n} · image © Google</figcaption></figure>)}</div>}
  </Card>
}
