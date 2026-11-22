// The advice ledger: what the coach asked for, and what the athlete then actually did (resolved from COROS data; any status can be corrected by hand).
import { useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { useApi, invalidate } from './api.js'

const KIND = { session: 'Session', rest: 'Rest day', cap: 'Heart-rate limit', fuel: 'Fuel & fluids', volume: 'Weekly volume', strength: 'Strength', other: 'Other' }
const STATUS = { followed: ['Followed', 'green'], partly: ['Partly', 'yellow'], not_followed: ['Not followed', 'red'], open: ['Waiting for the day', undefined], unknown: ['No date', undefined], void: ['Cannot be checked', undefined] }
export const evidenceText = (a) => {
  const e = a.evidence || {}, t = a.target || {}, bits = []
  if (e.runs) bits.push(`ran ${e.km} km${e.avg_hr ? `, average ${e.avg_hr} bpm` : ''}`); else if (a.status && a.status !== 'open' && a.status !== 'unknown' && a.status !== 'void') bits.push('no run that day')
  if (t.km) bits.push(`asked ${t.km} km`); if (t.hr_cap_bpm) bits.push(`limit ${t.hr_cap_bpm} bpm`)
  return bits.join(' · ')
}
export default function AdviceLog() {
  const [tick, setTick] = useState(0), A = useApi(`/api/coach/advice?days=30&_=${tick}`), [err, setErr] = useState(''), d = A.data
  const mark = (id, status) => fetch('/api/coach/advice/status', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lumpad': '1' }, body: JSON.stringify({ id, status }) })
    .then((r) => (r.ok ? (invalidate('coach'), setTick((t) => t + 1)) : r.json().then((j) => Promise.reject(new Error(j.error || 'failed'))))).catch((e) => setErr(e.message))
  if (!d) return <Card title="Advice log"><p className="muted">Loading…</p></Card>
  const by = Object.entries(d.summary?.by_kind || {})
  return <Card title="Advice log" right={<Chip>{d.summary?.resolved || 0} checked · {d.summary?.open || 0} waiting</Chip>}>
    <p className="muted" style={{ fontSize: '.84rem', margin: '0 0 8px' }}>Every concrete instruction the coach gives is saved here and checked against what you actually did. The coach sees this track record, so it stops repeating advice that does not work.</p>
    {by.length > 0 && <div className="chips" style={{ marginBottom: 8 }}>{by.map(([k, b]) => <Chip key={k} tone={b.followed / b.n >= 0.6 ? 'green' : b.not_followed / b.n >= 0.5 ? 'red' : 'yellow'}>{KIND[k] || k}: {b.followed} of {b.n} followed</Chip>)}</div>}
    {err && <p className="err" role="alert">{err}</p>}
    {d.items.length === 0 ? <p className="muted">No advice saved yet. It starts with the next coach answer.</p> : <ul className="advlist" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {d.items.map((a) => { const [lab, tone] = STATUS[a.status] || [a.status]; return <li key={a.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '8px 12px', display: 'grid', gap: 3 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}><small className="muted">{a.for_date || 'no date'} · {KIND[a.kind] || a.kind}</small><span style={{ marginLeft: 'auto' }}><Chip tone={tone}>{lab}{a.manual ? ' (by you)' : ''}</Chip></span></div>
        <span>{a.text}</span>
        {evidenceText(a) && <small className="muted">{evidenceText(a)}</small>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }} role="group" aria-label="Correct this result">
          {[['followed', 'I did it'], ['partly', 'Partly'], ['not_followed', 'I did not']].map(([s, l]) => <button key={s} type="button" className="link" aria-pressed={a.status === s} onClick={() => mark(a.id, s)}>{l}</button>)}
          {a.manual ? <button type="button" className="link" onClick={() => mark(a.id, 'open')}>Check again automatically</button> : null}
        </div></li> })}
    </ul>}
  </Card>
}
