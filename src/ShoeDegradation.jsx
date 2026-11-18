import { useMemo } from 'react'
import { useApi } from './api.js'
import { Card, Chip, Evidence } from './ui.jsx'
import { efOf } from './lib/analysis.js'
import { shoeEfFit } from './lib/shoefit.js'
import { today, addDays, BY_DATE } from './lib/calendar.js'

// Shoe midsole degradation hint: does the efficiency factor of easy/long runs fall as a shoe's mileage grows? Hint only — confounded by fitness, heat and pacing.
export default function ShoeDegradation() {
  const T = today(), A = useApi(`/api/activities/merged?from=${addDays(T, -540)}&to=${T}`), G = useApi('/api/gear')
  const fit = useMemo(() => {
    const runs = (A.data || []).filter((a) => a.sport_class === 'run' && a.gear_id && (a.distance_m || 0) >= 4000 && ['easy', 'long', 'social'].includes(BY_DATE[a.date]?.kind || 'easy'))
      .map((a) => ({ date: a.date, gear_id: a.gear_id, distance_m: a.distance_m, ef: efOf(a) }))
    return shoeEfFit(runs)
  }, [A.data])
  const names = Object.fromEntries((G.data || []).map((g) => [g.id, g.name])), rows = Object.entries(fit).sort((a, b) => b[1].n - a[1].n)
  return <Card title="Shoe degradation vs efficiency" right={<Chip>hint only</Chip>}>
    {A.state === 'loading' ? <div className="skel" style={{ height: 80 }} /> : !rows.length ? <p className="muted">No runs with a shoe attached yet — shoes come from Strava (see Devices & connections).</p> :
      <div className="scroll" tabIndex={0} role="region" aria-label="Shoe efficiency table (scroll)"><table className="lapt"><thead><tr><th>Shoe</th><th>Runs</th><th>Km</th><th>EF / 100 km</th><th>Read</th></tr></thead>
        <tbody>{rows.map(([id, f]) => <tr key={id}><td>{names[id] || id}</td><td>{f.n}</td><td>{f.kmSpan}</td><td>{f.slopePer100 ?? '—'}{f.se100 != null ? <small className="muted"> ±{f.se100}</small> : null}</td><td><small className="muted">{f.flag}</small></td></tr>)}</tbody></table></div>}
    <Evidence>[calc] Linear regression of EF on the shoe's cumulative km over easy/long/social runs ≥ 4 km, scored only with ≥ 8 runs per shoe. Cumulative km counts only runs in the pulled window and attached to that shoe. A falling EF can also mean lost fitness, heat or pacing changes; there is no validated shoe lifespan in km. Ground-contact-time residuals need per-lap data and are not included yet.</Evidence>
  </Card>
}
