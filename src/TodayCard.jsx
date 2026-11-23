// Home: ONE card for today — the call from the athlete's rules, the AI coach's one-line take, then only the metrics that need attention.
// Replaces the separate header summary, "Today's call" and "AI Coach daily brief" cards, which said the same thing three times.
import { useState } from 'react'
import { cleanCoachText } from './lib/coachText.js'
import { useApi, invalidate } from './api.js'
import { Md, post } from './Coach.jsx'
import { watchList, tomorrowCheck, painToday } from './lib/watch.js'
import { cfgOf, hrRange } from './lib/zones.js'
import { evidenceText } from './AdviceLog.jsx'

const wibDay = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10)
// preview: 200–300 characters, cut at a sentence or word boundary
export const preview = (t, max = 280, min = 200) => { if (t.length <= max) return t; const c = t.slice(0, max), at = Math.max(c.lastIndexOf('. '), c.lastIndexOf('! '), c.lastIndexOf('? ')); return at >= min ? c.slice(0, at + 1) : c.replace(/\s+\S*$/, '') + '…' }
const clean = cleanCoachText
export default function TodayCard({ checkin, settings, go, todayActs = [], date, tomorrow = null, weekPlanKm = null }) {
  const [open, setOpen] = useState(false), [tick, setTick] = useState(0), [busy, setBusy] = useState(false), [err, setErr] = useState(''), T = useApi('/api/twin'), twin = T.data?.state, R = useApi('/api/coach/runs')
  const brief = (R.data || []).find((r) => r.intent === 'daily_brief' && r.ok && wibDay(Date.parse(r.created_at)) === wibDay(Date.now()))
  const B = useApi(brief ? `/api/coach/run?id=${brief.id}` : '', !!brief), p = B.data?.parsed
  const stale = useApi(`/api/coach/status?intent=daily_brief&_=${tick}`).data, needsUpdate = !!brief && todayActs.length > 0 && stale && stale.up_to_date === false
  const update = () => { setBusy(true); setErr(''); post('/api/coach/run', { intent: 'daily_brief' }).then(() => { invalidate('coach'); setTick((t) => t + 1) }).catch((e) => setErr(e.message)).finally(() => setBusy(false)) }
  const fc = useApi(tomorrow?.km > 0 ? `/api/forecast/session?date=${tomorrow.date}&km=${tomorrow.km}` : '', tomorrow?.km > 0).data?.forecast
  const adv = useApi('/api/coach/advice?days=3').data, lastAdvice = (adv?.items || []).find((a) => ['followed', 'partly', 'not_followed'].includes(a.status))
  if (!twin) return null
  const { call, items } = watchList(twin, { checkin, sleepNeedMin: settings?.sleepNeedMin || 480, today: todayActs, date })
  const L = twin.load || {}, fresh = twin.as_of === date && L.ctl != null && L.atl != null, hrCap = hrRange(2, cfgOf(settings || {}))[1]
  const tm = tomorrowCheck(twin, tomorrow, { after: fresh ? Math.round((L.ctl - L.atl) * 10) / 10 : null, pain: painToday(checkin), weekPlanKm, hrCap })
  const attention = items.filter((i) => i.status === 'alert' || i.status === 'watch').slice(0, 4), clear = items.filter((i) => i.status === 'ok')
  const coachLine = p?.summary ? clean(p.summary).replace(/^(GO|EASY ONLY|REST)[.:,—\s-]*/i, '') : null
  const sev = { alert: 'alert', watch: 'watch', ok: 'ok' }
  return <div className={`hv2-today call-${call?.level || 'none'}`} aria-label="Today">
    <div className="hv2-lead">
      <div className="hv2-main">
        {call && <div className="hv2-status"><span className="hv2-verdict">{call.label}</span><span className="hv2-why">{call.why}</span></div>}
        {coachLine ? <div className="hv2-coach">
          <p><b>AI coach:</b> {open ? coachLine : preview(coachLine)}</p>
          {open && <div className="hv2-detail">
            {p.recommendations?.length > 0 && <><h4>Next steps</h4><ol>{p.recommendations.map((r, i) => <li key={i}><b>{clean(r.action)}</b>{r.why && <small>{clean(r.why)}</small>}</li>)}</ol></>}
            {p.analysis_md && <Md text={clean(p.analysis_md)} />}
          </div>}
          {needsUpdate && <p className="hv2-note" role="note">This brief was written before today's training. <button type="button" className="hv2-link" disabled={busy} onClick={update}>{busy ? 'Updating… (±30–90 s)' : 'Update with today\'s run →'}</button>{err && <span className="hv2-err" role="alert"> {err}</span>}</p>}
          <button type="button" className="hv2-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Show less ⌃' : 'Show full brief ⌄'}</button>
        </div> : <p className="hv2-coach hv2-empty">No AI brief yet today. <button className="hv2-link" onClick={() => go('coach', { intent: 'daily_brief' })}>Get today's brief →</button></p>}
      </div>
      {tomorrow && <aside className={`hv2-tmr tm-${tm.level}`} aria-label="Tomorrow">
        <div className="hv2-tmr-head"><span>Tomorrow</span><em className="hv2-tag">{tm.label}</em></div>
        <b className="hv2-tmr-title">{tm.plan?.label ? `${tm.plan.label} · ${tm.plan.km} km` : 'No run planned'}</b>
        <p className="hv2-tmr-text">{tm.why[0]}</p>
        {fc && <p className="hv2-tmr-text"><b>Heat:</b> best start {fc.best_start} · WBGT {fc.wbgt_best} <span className={`heat heat-${fc.band_best.toLowerCase()}`}>{fc.band_best.toLowerCase()}</span>{fc.move_earlier
          ? <> vs {fc.wbgt_usual} at your usual {fc.usual_start}: <b>start earlier</b>.</>
          : <> (usual {fc.usual_start}: {fc.wbgt_usual}): {['RED', 'BLACK'].includes(fc.band_best) ? <>no start time avoids the heat. <b>Run by heart rate, drink early{fc.band_best === 'BLACK' ? ', or go indoors' : ''}.</b></> : 'little difference.'}</>}</p>}
        {(tm.why.length > 1 || tm.confirm) && <details className="hv2-more"><summary>{tm.why.length > 1 ? `${tm.why.length - 1} more note${tm.why.length > 2 ? 's' : ''}` : 'When it is re-checked'}</summary>
          {tm.why.length > 1 && <ul>{tm.why.slice(1).map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {tm.confirm && <small>{tm.confirm}</small>}
        </details>}
      </aside>}
    </div>
    {attention.length > 0 && <ul className="hv2-signals">
      {attention.map((i) => <li key={i.id} className={`hv2-signal s-${sev[i.status] || 'ok'}`}>
        <div className="hv2-signal-top"><span className="hv2-dot" aria-hidden="true" /><span className="hv2-signal-name">{i.label}</span>{i.rule && <em className="hv2-tag">rule</em>}</div>
        <b className="hv2-signal-val">{i.value ?? '—'}{i.value != null && i.unit ? <small> {i.unit}</small> : null}</b>
        <span className="hv2-signal-ref" title={i.ref}>{i.ref}</span>
        <p className="hv2-signal-why">{i.why}</p>
      </li>)}
    </ul>}
    <div className="hv2-foot">
      {clear.length > 0 ? <p className="hv2-clear"><span className="hv2-dot ok" aria-hidden="true" /><span><b>All clear:</b> {clear.map((i) => `${i.label.toLowerCase()} ${i.value ?? ''}${i.unit && i.value != null ? ' ' + i.unit : ''}`.trim()).join(' · ')}</span></p> : <span />}
      <div className="hv2-links">
        <button className="hv2-link" onClick={() => go('coach', brief ? {} : { intent: 'daily_brief' })}>Open AI coach →</button>
        <button className="hv2-link" onClick={() => go('ready')}>Readiness details →</button>
      </div>
    </div>
    {lastAdvice && <p className="hv2-advice"><b>Last advice:</b> {lastAdvice.text.length > 90 ? lastAdvice.text.slice(0, 89) + '…' : lastAdvice.text} → <b className={`adv-${lastAdvice.status}`}>{{ followed: 'followed', partly: 'partly followed', not_followed: 'not followed' }[lastAdvice.status]}</b>{evidenceText(lastAdvice) ? ` (${evidenceText(lastAdvice)})` : ''}. <button type="button" className="hv2-link" onClick={() => go('coach', { section: 'adv' })}>Advice log →</button></p>}
  </div>
}
