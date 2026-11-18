import { useStore } from './store.js'
import { diffDays, fmtShort } from './lib/calendar.js'
import { Card } from './ui.jsx'

// Shown only after a run >= 16 km (or a race) in the last 3 days, once, skippable. Feeds the GI / fuelling analysis (intelligence layer §0.4a).
export default function FuelCard({ last, today }) {
  const date = last?.date, [v, setV] = useStore('lumpad.fuel.' + (date || 'none'), {})
  if (!last || last.sport_class !== 'run' || (last.distance_m || 0) < 16000 || diffDays(today, date) > 3 || v.done || v.skipped) return null
  const set = (p) => setV({ ...v, ...p })
  return <Card title={`Setelah lari ${(last.distance_m / 1000).toFixed(1)} km · ${fmtShort(date)}`} right={<button className="btn" onClick={() => setV({ skipped: true })}>Lewati</button>}>
    <div className="fld"><span>Perut selama lari</span>
      <div className="pain" role="group" aria-label="Gejala perut" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>{[[0, 'Aman'], [1, 'Ringan'], [2, 'Sedang'], [3, 'Berat']].map(([n, l]) => <button key={n} aria-pressed={v.gi === n} className={n >= 2 ? 'hi' : ''} onClick={() => set({ gi: n })}>{l}</button>)}</div></div>
    <div className="fld" style={{ marginTop: 10 }}><span>Jumlah gel</span>
      <div className="pain" role="group" aria-label="Jumlah gel" style={{ gridTemplateColumns: 'repeat(8,1fr)' }}>{[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} aria-pressed={v.gels === n} onClick={() => set({ gels: n })}>{n === 7 ? '7+' : n}</button>)}</div></div>
    <div className="seg" role="group" aria-label="Cairan cukup?" style={{ marginTop: 10 }}>{[[true, 'Minum cukup'], [false, 'Kurang minum']].map(([b, l]) => <button key={String(b)} aria-pressed={v.fluidsOk === b} className={v.fluidsOk === b ? 'on' : ''} onClick={() => set({ fluidsOk: b })}>{l}</button>)}</div>
    <button className="btn primary" style={{ marginTop: 12 }} disabled={v.gi == null} onClick={() => set({ done: true })}>Simpan</button>
  </Card>
}
