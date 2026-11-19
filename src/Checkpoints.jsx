import { useEffect, useState } from 'react'
import { CHECKPOINTS, tone, killGate, TARGET, cpDistance } from './lib/plan.js'
import { vdotFromRace, parseTime } from './lib/vdot.js'
import { today, diffDays, parse, fmtShort, DAYS3, RACE_DATE } from './lib/calendar.js'
import { thresholds } from './Home.jsx'
import { Card, Chip, Icon, StatusPill, ProvenanceBadge } from './ui.jsx'

const KIND_LABEL = { tt: 'Time trial', lr: 'Long run', race: 'Race', ratio: 'HM ratio', gate: 'Gate' }
const T0 = CHECKPOINTS[0].date, CP3 = CHECKPOINTS.find((c) => c.id === 3), DAYS = diffDays(RACE_DATE, T0)

function PathChart({ results }) {
  const W = 340, H = 175, L = 30, R = 8, Tp = 8, B = 22, y0 = 30, y1 = 41
  const X = (d) => L + (diffDays(d, T0) / DAYS) * (W - L - R)
  const Y = (v) => Tp + (1 - (v - y0) / (y1 - y0)) * (H - Tp - B)
  const req = CHECKPOINTS.filter((c) => c.line && c.kind === 'tt').map((c) => [X(c.date), Y(c.line)])
  const reqEnd = [X(RACE_DATE), Y(TARGET.vdotNeeded)]
  const mo = (d) => diffDays(d, CP3.date) / 30.44
  const best = (d) => 33.0 + 0.74 * mo(d)
  const pts = CHECKPOINTS.filter((c) => results[c.id]?.vdot != null).map((c) => ({ x: X(c.date), y: Y(results[c.id].vdot), t: tone(results[c.id].vdot, c.line), id: c.id }))
  const path = (a) => a.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')
  return <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Fitness path: required line, best observed pace and TT results">
    {[32, 34, 36, 38, 40].map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="gl" /><text x={L - 5} y={Y(v) + 3} className="gt" textAnchor="end">{v}</text></g>)}
    {['2027-01-01', '2027-03-01', '2027-05-01', '2027-07-01', '2027-09-01'].map((d) => <text key={d} x={X(d)} y={H - 6} className="gt" textAnchor="middle">{fmtShort(d).split(' ')[0]}</text>)}
    <path d={path([[X(CP3.date), Y(CP3.line)], [X(RACE_DATE), Y(best(RACE_DATE))]])} className="ln best" />
    <path d={path([...req, reqEnd])} className="ln req" />
    <line x1={X(RACE_DATE)} x2={X(RACE_DATE)} y1={Tp} y2={H - B} className="racel" />
    <circle cx={reqEnd[0]} cy={reqEnd[1]} r="3.5" className="tgt" />
    {pts.map((q) => <circle key={q.id} cx={q.x} cy={q.y} r="4.5" className={'pt ' + q.t} />)}
  </svg>
}

// Time-trial result: explicit Save (Enter also works) with inline validation
function TimeEntry({ c, r, upd }) {
  const [v, setV] = useState(r.time || ''), [err, setErr] = useState('')
  useEffect(() => setV(r.time || ''), [r.time, c.id])
  const save = () => {
    const s = v.trim(); if (!s) { setErr(''); return upd(c.id, { time: '', vdot: null }) }
    if (!/^\d{1,2}(:\d{2}){1,2}$/.test(s)) return setErr('Format: mm:ss or h:mm:ss, e.g. 29:18')
    const vd = vdotFromRace(cpDistance(c), parseTime(s))
    if (!isFinite(vd) || vd < 20 || vd > 80) return setErr('This time does not make sense for that distance — check it again')
    setErr(''); upd(c.id, { time: s, vdot: vd })
  }
  return <div className="te"><label className="fld"><span>TT Result (mm:ss or h:mm:ss)</span>
    <input value={v} placeholder="e.g. 29:18" inputMode="numeric" enterKeyHint="done" aria-invalid={!!err} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
    {err && <small className="err" role="alert">{err}</small>}</label>
    <button className="btn primary sm" onClick={save}>Save</button></div>
}

export default function Checkpoints({ vdot, results, setResults, focus, go }) {
  const T = today(), kg = killGate(results)
  const next = CHECKPOINTS.find((c) => c.date >= T)?.id || CHECKPOINTS[0].id
  const [selId, setSelId] = useState(focus || next)
  useEffect(() => { if (focus) setSelId(focus) }, [focus])
  const upd = (id, patch) => setResults({ ...results, [id]: { ...results[id], ...patch } })

  const active = CHECKPOINTS.find((c) => c.id === selId) || CHECKPOINTS[0]
  const ar = results[active.id] || {}
  const aTT = active.kind === 'tt'
  const aTone = (aTT || active.kind === 'ratio') && ar.vdot != null ? tone(ar.vdot, active.line) : null
  const aTh = thresholds(active)
  const aDate = parse(active.date)
  const aAway = diffDays(active.date, T)

  return <div className="screen">
    {/* Unified Checkpoint Command Header + Horizontal CP1–CP20 Ribbon */}
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div>
          <div className="chips" style={{ margin: '0 0 6px' }}>
            <StatusPill tone={kg.fired ? 'red' : 'green'}>{kg.fired ? 'Kill Gate: ACTIVE' : 'Kill Gate: Inactive'}</StatusPill>
            <ProvenanceBadge type="MODEL" />
          </div>
          <h1>2027 Checkpoint Roadmap (CP1 – CP20)</h1>
          <p className="sub">{kg.fired ? `${kg.why} → recalibrate to measured tier (4:15 / 4:30 / finish-first).` : 'Kill Gate Rule: Two consecutive Red TTs starting from CP4, or HM conversion ratio < 0.85 at CP11, automatically recalibrates target pace.'}</p>
        </div>
        <div className="prof-chips">
          <StatusPill tone="cobalt">VDOT {vdot.v.toFixed(1)} → {TARGET.vdotNeeded}</StatusPill>
          {go && <button type="button" className="btn sm" onClick={() => go('calendar')}>Calendar →</button>}
        </div>
      </div>

      <div className="stepper prof-cmd-bar" style={{ marginBottom: 0 }} role="group" aria-label="Checkpoint pipeline">
        {CHECKPOINTS.map((c) => {
          const r = results[c.id] || {}
          const t = (c.kind === 'tt' || c.kind === 'ratio') && r.vdot != null ? tone(r.vdot, c.line) : null
          const st = t || (r.vdot != null || r.ratio != null ? 'done' : c.id === next ? 'next' : '')
          const isSel = c.id === active.id
          return <button key={c.id} className={`s-${st} ${isSel ? 'cp-sel' : ''}`} aria-pressed={isSel} onClick={() => setSelId(c.id)} aria-label={`CP${c.id} ${c.name}`}>
            <b>CP{c.id}</b>{c.date.slice(5)}
          </button>
        })}
      </div>
    </div>

    {/* Top 2-Col Row: VDOT Trajectory Chart (7) + Active Checkpoint Inspector & Logger (5) */}
    <div className="bio-split-75">
      <Card title="VDOT Fitness Trajectory (Jan – Oct 2027)" right={<StatusPill tone="red">Oct Target: {TARGET.vdotNeeded}</StatusPill>}>
        <PathChart results={results} />
        <div className="legend">
          <span><i className="ll req" />Required Sub-4 line</span>
          <span><i className="ll best" />Best observed pace (0.74/mo)</span>
          <span><i className="kdot k-easy" />Logged TT result</span>
        </div>
      </Card>

      <Card className="cp-inspector" title={`CP${active.id} · ${KIND_LABEL[active.kind]}`} right={<Chip tone={aTone || (active.id === next ? 'red' : undefined)}>{aTone ? aTone.toUpperCase() : aAway > 0 ? `in ${aAway}d` : aAway === 0 ? 'TODAY' : 'past'}</Chip>}>
        <p className="muted" style={{ margin: '0 0 4px', fontFamily: 'var(--f-mono)', fontSize: '.78rem' }}>
          {DAYS3[aDate.getDay()]}, {fmtShort(active.date)} {active.date.slice(0, 4)}{active.line ? ` · VDOT Line ${active.line.toFixed(1)}` : ''}
        </p>
        <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>{active.name}</h3>
        {active.note && <p className="note" style={{ margin: '0 0 10px' }}>{active.note}</p>}
        {aTh && <div className="chips" style={{ margin: '0 0 10px' }}><Chip tone="green">Green ≤ {aTh.G}</Chip><Chip tone="red">Red &gt; {aTh.R}</Chip></div>}
        {aTT && <TimeEntry c={active} r={ar} upd={upd} />}
        {aTone && <p role="status" style={{ margin: '8px 0' }}><Chip tone={aTone}>{aTone.toUpperCase()}</Chip> VDOT <b>{ar.vdot.toFixed(1)}</b> ({(ar.vdot - active.line >= 0 ? '+' : '')}{(ar.vdot - active.line).toFixed(1)} vs line)</p>}
        {active.kind === 'ratio' && <label className="fld" style={{ marginBottom: 8 }}><span>HM ratio (HM VDOT ÷ latest 5K/10K VDOT)</span>
          <input type="number" step="0.01" inputMode="decimal" value={ar.ratio ?? ''} onChange={(e) => upd(active.id, { ratio: e.target.value === '' ? null : +e.target.value })} /></label>}
        <div className="form five" style={{ marginTop: 10 }}>
          {['Sleep HR', 'HRV', 'Pain', '°C', 'RH %'].map((k) => <label key={k} className="fld"><span>{k}</span><input value={ar[k] || ''} onChange={(e) => upd(active.id, { [k]: e.target.value })} /></label>)}
        </div>
      </Card>
    </div>

    {/* All 20 Macrocycle Checkpoints 4-Column Grid */}
    <Card title={`All ${CHECKPOINTS.length} Macrocycle Checkpoints (2027)`} right={<span className="muted">Tap any card to inspect or log</span>}>
      <div className="cp-grid4">
        {CHECKPOINTS.map((c) => {
          const r = results[c.id] || {}
          const t = (c.kind === 'tt' || c.kind === 'ratio') && r.vdot != null ? tone(r.vdot, c.line) : null
          const away = diffDays(c.date, T)
          const isSel = c.id === active.id
          return <button key={c.id} type="button" className={`cp-card4 ${isSel ? 'on' : ''}`} onClick={() => { setSelId(c.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
            <div className="kpi-top">
              <small style={{ color: 'var(--cobalt-t)', fontWeight: 800 }}>CP{c.id} · {KIND_LABEL[c.kind]}</small>
              <span className="muted mono" style={{ fontSize: '.72rem' }}>{fmtShort(c.date)}</span>
            </div>
            <b style={{ fontSize: '.86rem', textAlign: 'left', margin: '4px 0' }}>{c.name}</b>
            <div className="kpi-top" style={{ marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line)' }}>
              <small className="muted">{t ? `Logged: ${r.time || r.vdot.toFixed(1)}` : away > 0 ? `${away}d left` : away === 0 ? 'Today' : 'Past'}</small>
              {c.line && <Chip tone={t || 'green'}>VDOT {c.line.toFixed(1)}</Chip>}
            </div>
          </button>
        })}
      </div>
    </Card>
  </div>
}
