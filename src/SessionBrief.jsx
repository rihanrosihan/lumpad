import { useState } from 'react'
import { Card, Chip, Evidence } from './ui.jsx'
import { buildSessionPrescription } from './lib/prescription.js'

const TONE = {
  go: ['green', 'GO · AS PLANNED'],
  scale: ['yellow', 'SCALE DOWN −25%'],
  easy_only: ['red', 'GATE ACTIVE · EASY ONLY'],
  rest: ['red', 'HOLD · REST / WALK'],
}

export default function SessionBrief({ day, readiness, healthRow, dailyCheckin, twinLoad, vdot, defaultWbgt = 27, compact = false }) {
  const [wbgt, setWbgt] = useState(defaultWbgt)
  if (!day || day.kind === 'rest' || day.kind === 'gym') return null
  const rx = buildSessionPrescription({
    day,
    readiness,
    healthRow,
    dailyCheckin,
    twinLoad,
    vdot: vdot?.v || vdot || 31.7,
    wbgt,
  })
  const [tone, badge] = TONE[rx.verdict] || TONE.go

  return <Card title="Smart execution & pacing brief" right={<Chip tone={tone}>{badge}</Chip>}>
    <p className="lead" style={{ marginTop: 0 }}>{rx.headline}</p>
    {rx.breaches.length > 0 && <div className="chips" style={{ marginBottom: 8 }}>
      {rx.breaches.map((b, i) => <Chip key={i} tone="red">{b.rule} {b.text}</Chip>)}
    </div>}

    <div className="score-grid">
      <div>
        <small>Target distance</small>
        <b>{rx.effectiveKm} km</b>
        <em>{rx.effectiveKm !== rx.plannedKm ? `scaled from ${rx.plannedKm} km` : `est. ~${rx.estMin} min`}</em>
      </div>
      <div>
        <small>Heat-adjusted pace</small>
        <b>{rx.heatPaceText}</b>
        <em>dry {rx.dryPaceText} (+{rx.heatPenaltyPct}%)</em>
      </div>
      <div>
        <small>0–10 km HR ceiling</small>
        <b>≤ {rx.openingCap.hrMaxBpm} bpm</b>
        <em>floor {rx.openingCap.paceFloorText} [Rule 9]</em>
      </div>
    </div>

    <label className="fld" style={{ display: 'block', marginTop: 10 }}>
      <span className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem' }}>
        <span>Expected WBGT thermal load</span>
        <b>{wbgt}°C (+{rx.heatPenaltyPct}% pace adjustment)</b>
      </span>
      <input type="range" min={16} max={33} step={1} value={wbgt} onChange={(e) => setWbgt(+e.target.value)} aria-label="Expected WBGT (°C)" />
    </label>

    {rx.fueling.needed && !compact && <div className="mod green" style={{ marginTop: 10 }}>
      <b>Fuelling & GI protection protocol ({rx.fueling.choRateGh} · {rx.fueling.fluidMlh})</b>
      <p style={{ margin: '4px 0' }}>
        Pre-run meal ≥ <b>{rx.fueling.mealBufferMin} min</b> before start
        {rx.fueling.giFlushKm > 0 ? ` · ${rx.fueling.giFlushKm} km warm-up GI flush` : ''}
        {' · '}Sodium <b>{rx.fueling.sodiumMgh}</b>
      </p>
      {rx.fueling.gelSchedule.length > 0 && <div className="chips" style={{ marginTop: 6 }}>
        {rx.fueling.gelSchedule.map((g, i) => <Chip key={i}>{g.min}′ (~km {g.km}): {g.item}</Chip>)}
      </div>}
    </div>}

    {!compact && <Evidence>[calc] Synthesises locked rules ([1] Sleep HR ≤ 67 bpm, [3] HRV status, [5] Pain &lt; 2/10, [7] Weekly km ≤ +10%, [9] Opening 0–10 km HR cap) with Ely 2007 WBGT thermal pacing (+0.25%/°C above 8°C).</Evidence>}
  </Card>
}
