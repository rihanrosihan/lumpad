import { useEffect, useRef, useState } from 'react'
import { CHECKPOINTS, tone, killGate, TARGET } from './lib/plan.js'
import { vdotFromRace, parseTime, fmtTime } from './lib/vdot.js'
import { today, diffDays, parse, fmtShort, DAYS3, RACE_DATE } from './lib/calendar.js'
import { cpDistance } from './lib/plan.js'
import { thresholds } from './Home.jsx'
import { Card, Chip, Screen, Icon } from './ui.jsx'

const KIND_LABEL = { tt: 'Time trial', lr: 'Long run', race: 'Race', ratio: 'HM ratio', gate: 'Gate' }
const T0 = CHECKPOINTS[0].date, CP3 = CHECKPOINTS.find((c) => c.id === 3), DAYS = diffDays(RACE_DATE, T0)

function PathChart({ results }) {
  const W = 340, H = 170, L = 30, R = 8, Tp = 8, B = 22, y0 = 30, y1 = 41
  const X = (d) => L + (diffDays(d, T0) / DAYS) * (W - L - R), Y = (v) => Tp + (1 - (v - y0) / (y1 - y0)) * (H - Tp - B)
  const req = CHECKPOINTS.filter((c) => c.line && c.kind === 'tt').map((c) => [X(c.date), Y(c.line)]), reqEnd = [X(RACE_DATE), Y(TARGET.vdotNeeded)]
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

// Time-trial result: explicit Save (Enter also works) with inline validation, so a typo is never silently dropped
function TimeEntry({ c, r, upd }) {
  const [v, setV] = useState(r.time || ''), [err, setErr] = useState('')
  useEffect(() => setV(r.time || ''), [r.time])
  const save = () => {
    const s = v.trim(); if (!s) { setErr(''); return upd(c.id, { time: '', vdot: null }) }
    if (!/^\d{1,2}(:\d{2}){1,2}$/.test(s)) return setErr('Format: mm:ss or h:mm:ss, e.g. 29:18')
    const vd = vdotFromRace(cpDistance(c), parseTime(s))
    if (!isFinite(vd) || vd < 20 || vd > 80) return setErr('This time does not make sense for that distance — check it again')
    setErr(''); upd(c.id, { time: s, vdot: vd })
  }
  return <div className="te"><label className="fld"><span>TT time (mm:ss or h:mm:ss)</span>
    <input value={v} placeholder="mis. 29:18" inputMode="numeric" enterKeyHint="done" aria-invalid={!!err} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
    {err && <small className="err" role="alert">{err}</small>}</label>
    <button className="btn sm" onClick={save}>Save</button></div>
}

export default function Checkpoints({ vdot, results, setResults, focus }) {
  const T = today(), kg = killGate(results)
  const next = CHECKPOINTS.find((c) => c.date >= T)?.id
  const [open, setOpen] = useState(focus || next)
  const pastList = CHECKPOINTS.filter((c) => c.date < T && c.id !== next)
  const [showPast, setShowPast] = useState(false)
  const refs = useRef({})
  useEffect(() => { if (focus) { setOpen(focus); setTimeout(() => refs.current[focus]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) } }, [focus])
  const upd = (id, patch) => setResults({ ...results, [id]: { ...results[id], ...patch } })

  return <>
    <Card className={kg.fired ? 'c-red' : ''}>
      <div className="ch"><h2>Kill gate</h2><Chip tone={kg.fired ? 'red' : 'green'}>{kg.fired ? 'ACTIVE' : 'not triggered'}</Chip></div>
      <p className="muted">{kg.fired ? kg.why + ' → move to a measured tier (4:15 / 4:30 / finish-first). The race is still run.' : 'Two consecutive red TTs from CP4, or CP11 ratio < 0.85.'}</p>
    </Card>
    <div className="stepper" role="group" aria-label="Checkpoint pipeline">{CHECKPOINTS.map((c) => { const r = results[c.id] || {}, t = (c.kind === 'tt' || c.kind === 'ratio') && r.vdot != null ? tone(r.vdot, c.line) : null, st = t || (r.vdot != null || r.ratio != null ? 'done' : c.id === next ? 'next' : '')
      return <button key={c.id} className={'s-' + st} onClick={() => { setOpen(c.id); setShowPast(true); setTimeout(() => refs.current[c.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }} aria-label={`CP${c.id} ${c.name}${t ? ', result ' + t : ''}`}><b>CP{c.id}</b>{c.date.slice(5)}</button> })}</div>
    <Card title="Fitness path (VDOT)" right={<span className="muted">now {vdot.v.toFixed(1)}</span>}>
      <PathChart results={results} />
      <div className="legend"><span><i className="ll req" />Required line</span><span><i className="ll best" />Best observed pace (0.74/mo)</span><span><i className="kdot k-easy" />TT result (green / yellow / red)</span></div>
    </Card>

    <ol className="tl">
      {pastList.length > 0 && <li><button className="grp" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}><span>Past ({pastList.length})</span><span>{showPast ? 'Hide' : 'Show'}</span></button></li>}
      {CHECKPOINTS.filter((c) => showPast || !pastList.includes(c) || open === c.id).map((c) => {
        const r = results[c.id] || {}, tt = c.kind === 'tt', t = (tt || c.kind === 'ratio') && r.vdot != null ? tone(r.vdot, c.line) : null
        const logged = r.vdot != null || r.ratio != null || ['Sleep HR', 'HRV', 'Pain', '°C', 'RH %'].some((k) => r[k])
        const past = c.date < T, d = parse(c.date), th = thresholds(c), isOpen = open === c.id
        const status = t ? t : logged ? 'done' : c.id === next ? 'next' : past ? 'miss' : 'todo'
        return <li key={c.id} ref={(el) => (refs.current[c.id] = el)} className={`tli s-${status}`}>
          <button className="tlh" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
            <span className="tld"><b>{d.getDate()}</b><small>{fmtShort(c.date).split(' ')[0]}</small><small>{DAYS3[d.getDay()]}</small></span>
            <span className="tlt"><small>CP{c.id} · {KIND_LABEL[c.kind]}</small><b>{c.name}</b>
              <small>{past ? (logged ? 'logged' : 'not logged') : diffDays(c.date, T) === 0 ? 'today' : diffDays(c.date, T) + ' days away'}{c.line ? ` · line ${c.line.toFixed(1)}` : ''}</small></span>
            <span className={`st st-${status}`} aria-label={status}>{t ? t[0].toUpperCase() : status === 'done' ? <Icon n="check" size={14} /> : status === 'next' ? '▶' : ''}</span>
          </button>
          {isOpen && <div className="tlb">
            <p className="note">{c.note}</p>
            {th && <p className="thr"><Chip tone="green">Green ≤ {th.G}</Chip> <Chip tone="red">Red &gt; {th.R}</Chip></p>}
            {tt && <TimeEntry c={c} r={r} upd={upd} />}
            {t && <p role="status"><Chip tone={t}>{t === 'green' ? 'Green' : t === 'yellow' ? 'Yellow' : 'Red'}</Chip> VDOT {r.vdot.toFixed(1)} · {(r.vdot - c.line).toFixed(1)} from the line</p>}
            {c.kind === 'ratio' && <label className="fld"><span>HM ratio (HM VDOT ÷ latest 5K/10K VDOT)</span>
              <input type="number" step="0.01" inputMode="decimal" value={r.ratio ?? ''} onChange={(e) => upd(c.id, { ratio: e.target.value === '' ? null : +e.target.value })} /></label>}
            <div className="form five">{['Sleep HR', 'HRV', 'Pain', '°C', 'RH %'].map((k) => <label key={k} className="fld"><span>{k}</span><input value={r[k] || ''} onChange={(e) => upd(c.id, { [k]: e.target.value })} /></label>)}</div>
          </div>}
        </li>
      })}
    </ol>
  </>
}
