import { useStore } from './store.js'
import { BY_DATE, fmtLong, KIND } from './lib/calendar.js'
import { gateActive, proposeScale } from './lib/scaler.js'
import { Card, Chip } from './ui.jsx'

// Gate → Calendar auto-scaler: turns the next 72 h of hard sessions into easy/rehab when the readiness gate is active. Reversible; the plan itself is never edited.
export default function ScaleCard({ rd, M, T }) {
  const [sc, setSc] = useStore('lumpad.scale', {}), items = sc.items || {}
  const gate = gateActive({ tierId: rd.tier?.id, caps: rd.caps.length, progPct: M.prog?.pct }), proposal = proposeScale(BY_DATE, T, gate)
  const live = Object.entries(items).filter(([d]) => d >= T), applied = live.length > 0, list = applied ? live : Object.entries(proposal)
  if (!gate.active && !applied) return null
  const lbl = (o) => `${o.label || KIND[o.kind].label}${o.km ? ` · ${o.km} km` : ''}`
  return <Card className="scalecard" title="Gate → Calendar auto-scaler" right={<Chip tone={applied ? 'green' : 'yellow'}>{applied ? 'applied' : 'proposed'}</Chip>}>
    <p className="muted">{gate.active ? `Gate active: ${gate.reasons.join(' · ')}.` : 'Gate is clear now — the scaled sessions below are still applied.'} Hard sessions in the next 72 hours become easy/rehab; the plan data is not edited and this is reversible.</p>
    {list.length === 0 ? <p className="muted">No hard session in the next 72 hours — nothing to scale.</p>
      : <ul className="scalelist">{list.map(([d, o]) => <li key={d}><b>{fmtLong(d)}</b><span><s>{lbl(o.from)}</s> → {lbl(o.to)}</span></li>)}</ul>}
    <div className="row2">
      <button className="btn primary sm" disabled={applied || !list.length} onClick={() => setSc({ appliedAt: new Date().toISOString(), items: proposal })}>Apply 72 h auto-scale</button>
      <button className="btn sm" disabled={!applied} onClick={() => setSc({})}>Revert to plan</button>
    </div>
  </Card>
}
