import { useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { useApi, invalidate } from './api.js'
import { cleanCoachText } from './lib/coachText.js'
import { Md, post } from './Coach.jsx'

// Per-session coach review on the Run Analysis page. Reuses an existing session_review for this run if one exists; otherwise offers to run one
// (costs a few yuan-cents of the monthly cap, shown in the Coach tab). Only for runs the intelligence layer has analysed (FIT).
export default function ActivityCoach({ id, label }) {
  const st = useApi('/api/intel/status'), [busy, setBusy] = useState(false), [fresh, setFresh] = useState(null), [err, setErr] = useState(''), [tick, setTick] = useState(0), [open, setOpen] = useState(false)
  const q = `session ${label}`, hit = useApi(`/api/coach/latest?question=${encodeURIComponent(q)}&_=${tick}`).data
  const S = useApi(`/api/coach/status?intent=session_review&question=${encodeURIComponent(q)}&activity_id=${encodeURIComponent(id)}&_=${tick}`).data // is the saved analysis still current?
  const D = useApi(hit ? `/api/coach/run?id=${hit.id}` : '', !!hit), p = fresh?.parsed || D.data?.parsed
  const g = st.data?.guard, noKey = st.data && !st.data.key, paused = g?.level === 'paused'
  const run = () => { setBusy(true); setErr(''); post('/api/coach/run', { intent: 'session_review', question: q, activity_id: id }).then((r) => { invalidate('coach'); setFresh(r); setTick((t) => t + 1) }).catch((e) => setErr(e.message)).finally(() => setBusy(false)) }
  if (S?.no_fit) return <Card title="Coach analysis for this session"><p className="muted">Waiting for this run's FIT file. Weather, air quality, route map, elevation and the coach review appear after the next COROS sync (the FIT is downloaded after the run is listed). Nothing is analysed from older runs in the meantime.</p></Card>
  if (p) {
    const upToDate = fresh ? true : S ? S.up_to_date : null, when = fresh?.saved_at || hit?.created_at
    const clean = cleanCoachText, sum = clean(p.summary), short = sum.length > 280 ? sum.slice(0, 277).replace(/\s+\S*$/, '') + '…' : sum
    const recs = (p.recommendations || []).slice(0, 3), flags = (p.flags || []).slice(0, 2)
    return <>
      <div className="acoach-card">
        <div className="acoach-head"><Chip tone="green">✓ Analysed by AI coach</Chip>{when && <small className="muted">{new Date(when).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })}</small>}</div>
        <p className="lead">{short}</p>
        <button type="button" className="btn acoach-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide details' : 'Show details & next steps'}</button>
        {open && <div className="acoach-detail">
          {recs.length > 0 && <><h4>What to do next</h4><ol className="recs">{recs.map((r, i) => <li key={i}><b>{clean(r.action)}</b><small>{clean(r.why)}</small></li>)}</ol></>}
          {flags.length > 0 && <div className="chips">{flags.map((f, i) => <Chip key={i} tone={f.type === 'gate' || f.type === 'injury' ? 'red' : 'yellow'}>{clean(f.text)}</Chip>)}</div>}
          {p.analysis_md && <Md text={clean(p.analysis_md)} />}
        </div>}
      </div>
      <div className="acoach-foot">
        {upToDate ? <p className="muted">Up to date. A new day, check-in or new metrics unlock a fresh analysis.</p>
          : <><p className="muted">New data since this analysis.</p>
              {err && <p className="err" role="alert">{err}</p>}
              <button className="btn primary" disabled={busy || noKey || paused} onClick={run}>{busy ? 'Coach is analysing… (±30–90 s)' : 'Analyse again with the new data'}</button></>}
      </div>
    </>
  }
  return <Card title="Coach analysis for this session" right={<Chip>Not analysed yet</Chip>}>
    <p className="muted">Get a short verdict and 2–3 concrete next steps for this run. It is saved, so you only pay once.</p>
    {noKey && <p className="muted">DEEPSEEK_API_KEY is not set on the server, so automatic analysis is not active.</p>}
    {paused && <p className="muted">Monthly coach cap reached — back on the 1st.</p>}
    {err && <p className="err" role="alert">{err}</p>}
    <button className="btn primary" disabled={busy || noKey || paused} onClick={run}>{busy ? 'Coach is analysing… (±30–90 s)' : 'Analyse this session'}</button>
  </Card>
}
