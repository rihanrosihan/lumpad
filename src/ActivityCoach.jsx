import { useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { useApi } from './api.js'
import { Result, post } from './Coach.jsx'

// Per-session coach review on the Run Analysis page. Reuses an existing session_review for this run if one exists; otherwise offers to run one
// (costs a few yuan-cents of the monthly cap, shown in the Coach tab). Only for runs the intelligence layer has analysed (FIT).
export default function ActivityCoach({ id, label }) {
  const st = useApi('/api/intel/status'), R = useApi('/api/coach/runs'), [busy, setBusy] = useState(false), [fresh, setFresh] = useState(null), [err, setErr] = useState('')
  const q = `session ${label}`, hit = (R.data || []).find((r) => r.intent === 'session_review' && r.ok && r.question === q)
  const D = useApi(hit ? `/api/coach/run?id=${hit.id}` : '', !!hit), p = fresh?.parsed || D.data?.parsed
  const g = st.data?.guard, noKey = st.data && !st.data.key, paused = g?.level === 'paused'
  const run = () => { setBusy(true); setErr(''); post('/api/coach/run', { intent: 'session_review', question: q, activity_id: id }).then(setFresh).catch((e) => setErr(e.message)).finally(() => setBusy(false)) }
  if (p) return <Result p={p} res={fresh || { model: D.data?.model, cost_cny: D.data?.cost_cny }} />
  return <Card title="Coach analysis for this session" right={st.data?.model && <Chip>{st.data.model.name}</Chip>}>
    <p className="muted">The coach reads this session together with your load, weather and durability memory, then returns a summary and recommendations. The result is saved and shown here again.</p>
    {noKey && <p className="muted">DEEPSEEK_API_KEY is not set on the server, so automatic analysis is not active.</p>}
    {paused && <p className="muted">Monthly coach cap reached — back on the 1st.</p>}
    {err && <p className="err" role="alert">{err}</p>}
    <button className="btn primary" disabled={busy || noKey || paused} onClick={run}>{busy ? 'Coach is analysing… (±30–90 s)' : 'Analyse this session'}</button>
  </Card>
}
