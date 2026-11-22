// Home: ONE card for today — the call from the athlete's rules, the AI coach's one-line take, then only the metrics that need attention.
// Replaces the separate header summary, "Today's call" and "AI Coach daily brief" cards, which said the same thing three times.
import { useState } from 'react'
import { useApi } from './api.js'
import { Md } from './Coach.jsx'
import { watchList } from './lib/watch.js'

const wibDay = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10)
// preview: 200–300 characters, cut at a sentence or word boundary
export const preview = (t, max = 280, min = 200) => { if (t.length <= max) return t; const c = t.slice(0, max), at = Math.max(c.lastIndexOf('. '), c.lastIndexOf('! '), c.lastIndexOf('? ')); return at >= min ? c.slice(0, at + 1) : c.replace(/\s+\S*$/, '') + '…' }
const clean = (s) => String(s || '').replace(/\bbelum ditarik\b/gi, 'not yet extracted')
export default function TodayCard({ checkin, settings, go }) {
  const [open, setOpen] = useState(false), T = useApi('/api/twin'), twin = T.data?.state, R = useApi('/api/coach/runs')
  const brief = (R.data || []).find((r) => r.intent === 'daily_brief' && r.ok && wibDay(Date.parse(r.created_at)) === wibDay(Date.now()))
  const B = useApi(brief ? `/api/coach/run?id=${brief.id}` : '', !!brief), p = B.data?.parsed
  if (!twin) return null
  const { call, items } = watchList(twin, { checkin, sleepNeedMin: settings?.sleepNeedMin || 480 })
  const attention = items.filter((i) => i.status === 'alert' || i.status === 'watch').slice(0, 4), clear = items.filter((i) => i.status === 'ok')
  const coachLine = p?.summary ? clean(p.summary).replace(/^(GO|EASY ONLY|REST)[.:,—\s-]*/i, '') : null
  return <section className={`card watch call-${call?.level || 'none'}`} aria-label="Today">
    {call && <div className="watch-call">
      <span className="watch-verdict">{call.label}</span>
      <p>{call.why}</p>
    </div>}
    <div className="today-coach">
      {coachLine ? <>
        <p><b>AI coach:</b> {open ? coachLine : preview(coachLine)}</p>
        {open && <div className="today-detail">
          {p.recommendations?.length > 0 && <><h4>Next steps</h4><ol className="recs">{p.recommendations.map((r, i) => <li key={i}><b>{clean(r.action)}</b>{r.why && <small>{clean(r.why)}</small>}</li>)}</ol></>}
          {p.analysis_md && <Md text={clean(p.analysis_md)} />}
        </div>}
        <button type="button" className="link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : 'Show full brief'}</button>
      </> : <p className="muted">No AI brief yet today. <button className="link" onClick={() => go('coach', { intent: 'daily_brief' })}>Get today's brief →</button></p>}
    </div>
    {attention.length > 0 && <ul className="watch-list grid2">
      {attention.map((i) => <li key={i.id} className={`wi st-${i.status}`}>
        <div className="wi-top"><span className="wi-dot" aria-hidden="true" />{i.label}{i.rule && <small className="wi-rule">rule</small>}</div>
        <b className="wi-val">{i.value ?? '—'}{i.value != null && i.unit ? <small> {i.unit}</small> : null}</b>
        <small className="wi-ref">{i.ref}</small>
        <p className="wi-why">{i.why}</p>
      </li>)}
    </ul>}
    {clear.length > 0 && <p className="today-clear"><span className="wi-dot" aria-hidden="true" /> All clear: {clear.map((i) => `${i.label.toLowerCase()} ${i.value ?? ''}${i.unit && i.value != null ? ' ' + i.unit : ''}`.trim()).join(' · ')}</p>}
    <div className="today-foot">
      <button className="link" onClick={() => go('coach', brief ? {} : { intent: 'daily_brief' })}>Open AI coach →</button>
      <button className="link" onClick={() => go('ready')}>Readiness details →</button>
    </div>
  </section>
}
