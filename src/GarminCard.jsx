import { Card, Chip } from './ui.jsx'
import { garminFacts } from './lib/garmin.js'

// What the Garmin watch recorded for this activity (shown only when the Garmin import has data for it). For sessions before 2026 Garmin is the primary source.
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
export default function GarminCard({ g }) {
  const v = garminFacts(g); if (!v || (!v.facts.length && !v.zones.length && !v.sets.length)) return null
  return <Card title="Garmin data" right={<Chip>{v.primary ? 'primary source' : 'Garmin recording'}</Chip>}>
    {v.facts.length > 0 && <div className="fit-kpis">{v.facts.map((f) => <div key={f.k}><small>{f.k}</small><b>{f.v}</b>{f.note && <em>{f.note}</em>}</div>)}</div>}
    {v.zones.length > 0 && <>
      <h3 style={{ margin: '12px 0 6px', fontSize: 14 }}>Time in heart-rate zones</h3>
      {v.zones.filter((z) => z.s > 0).map((z) => <div key={z.z} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 64px', gap: 8, alignItems: 'center', fontSize: 13, margin: '3px 0' }}>
        <span>Z{z.z}</span><div style={{ background: 'var(--surface2)', borderRadius: 4, height: 8 }}><div style={{ width: z.pct + '%', height: 8, borderRadius: 4, background: 'var(--cobalt)' }} /></div><span style={{ textAlign: 'right' }}>{mmss(z.s)} · {z.pct}%</span></div>)}
    </>}
    {v.sets.length > 0 && <>
      <h3 style={{ margin: '12px 0 6px', fontSize: 14 }}>Strength sets</h3>
      <table className="tbl" style={{ width: '100%', fontSize: 13 }}><thead><tr><th align="left">Exercise</th><th>Sets</th><th>Reps</th><th>Top weight</th></tr></thead>
        <tbody>{v.sets.map((s, i) => <tr key={i}><td>{s.name}</td><td align="center">{s.sets ?? '—'}</td><td align="center">{s.reps ?? '—'}</td><td align="center">{s.max_kg != null ? s.max_kg + ' kg' : '—'}</td></tr>)}</tbody></table>
    </>}
    <p className="src-note">Garmin-scale values (load, training effect, Body Battery) are shown as recorded and are not converted to COROS equivalents.</p>
  </Card>
}
