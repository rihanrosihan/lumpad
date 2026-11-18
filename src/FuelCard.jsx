import { useStore } from './store.js'
import { diffDays, fmtShort } from './lib/calendar.js'
import { Card } from './ui.jsx'

// Shown only after a run >= 16 km (or a race) in the last 3 days, once, skippable. Feeds the GI / fuelling analysis (intelligence layer §0.4a).
export default function FuelCard({ last, today }) {
  const date = last?.date, [v, setV] = useStore('lumpad.fuel.' + (date || 'none'), {})
  if (!last || last.sport_class !== 'run' || (last.distance_m || 0) < 16000 || diffDays(today, date) > 3 || v.done || v.skipped) return null
  const set = (p) => setV({ ...v, ...p })
  return <Card title={`After the ${(last.distance_m / 1000).toFixed(1)} km run · ${fmtShort(date)}`} right={<button className="btn" onClick={() => setV({ skipped: true })}>Skip</button>}>
    <div className="fld"><span>Stomach during the run</span>
      <div className="pain" role="group" aria-label="GI symptoms" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>{[[0, 'None'], [1, 'Mild'], [2, 'Moderate'], [3, 'Severe']].map(([n, l]) => <button key={n} aria-pressed={v.gi === n} className={n >= 2 ? 'hi' : ''} onClick={() => set({ gi: n })}>{l}</button>)}</div></div>
    <div className="fld" style={{ marginTop: 10 }}><span>Number of gels</span>
      <div className="pain" role="group" aria-label="Number of gels" style={{ gridTemplateColumns: 'repeat(8,1fr)' }}>{[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} aria-pressed={v.gels === n} onClick={() => set({ gels: n })}>{n === 7 ? '7+' : n}</button>)}</div></div>
    <div className="seg" role="group" aria-label="Enough fluids?" style={{ marginTop: 10 }}>{[[true, 'Enough fluids'], [false, 'Not enough']].map(([b, l]) => <button key={String(b)} aria-pressed={v.fluidsOk === b} className={v.fluidsOk === b ? 'on' : ''} onClick={() => set({ fluidsOk: b })}>{l}</button>)}</div>
    <button className="btn primary" style={{ marginTop: 12 }} disabled={v.gi == null} onClick={() => set({ done: true })}>Save</button>
  </Card>
}
