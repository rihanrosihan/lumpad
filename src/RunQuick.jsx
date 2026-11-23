// Quick analysis of one finished run, opened from Home → Recent Activities. Real data only: totals from the activity, zones / splits / cadence from the FIT metrics when
// the file is imported, the saved coach review when one exists. Closes with ✕, "Close Analysis", a tap on the backdrop or Escape.
import { useEffect, useRef } from 'react'
import { useApi, fmtDur, fmtPaceS } from './api.js'

const ZC = ['#94a3b8', '#60a5fa', '#34d399', '#fbbf24', '#fb923c', '#f43f5e', '#be123c']
const ZN = ['< Z1', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z5+']

export default function RunQuick({ a, hrCap, onClose, onFull }) {
  const id = String(a.ids?.[0] || a.id), label = id.replace(/^coros:/, '')
  const S = useApi(`/api/intel/session?id=${encodeURIComponent(id)}`).data
  const R = useApi('/api/coach/runs').data
  const hit = (R || []).find((r) => r.intent === 'session_review' && r.ok && r.question === `session ${label}`)
  const C = useApi(hit ? `/api/coach/run?id=${hit.id}` : '', !!hit).data?.parsed
  const box = useRef(null), closeBtn = useRef(null)
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', key)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    closeBtn.current?.focus()
    return () => { removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [onClose])
  const found = S?.found, km = found ? S.km || [] : [], z = found ? S.metrics?.z6?.hr_s : null
  const cadV = km.map((k) => k.cad).filter((x) => x > 0), cad = cadV.length ? Math.round(cadV.reduce((t, x) => t + x, 0) / cadV.length) : null
  const zt = z ? z.reduce((t, x) => t + x, 0) : 0
  const tiles = [['Distance', a.distance_m ? (a.distance_m / 1000).toFixed(2) + ' km' : '—'], ['Duration', a.duration_s ? fmtDur(a.duration_s) : '—'], ['Avg pace', a.avg_pace_s_km ? fmtPaceS(a.avg_pace_s_km) + ' /km' : '—'], ['Avg HR', a.avg_hr ? a.avg_hr + ' bpm' : '—'], ['Cadence', cad ? cad + ' spm' : '—']]
  return <div className="rq-back" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="rq" role="dialog" aria-modal="true" aria-labelledby="rq-title" ref={box}>
      <header className="rq-h"><div><small className="num">{a.date}</small><h2 id="rq-title">{a.name || 'Run'}</h2></div><button type="button" ref={closeBtn} className="rq-x" aria-label="Close analysis" onClick={onClose}>✕</button></header>
      <div className="rq-tiles">{tiles.map(([k, v]) => <div key={k} className={k === 'Avg HR' && a.avg_hr > hrCap ? 'warn' : ''}><small>{k}</small><b className="num">{v}</b></div>)}</div>
      <section><h3>Heart-rate zones</h3>
        {zt > 0 ? <><div className="rq-zbar" role="img" aria-label="Time in heart-rate zones">{z.map((s, i) => s > 0 && <i key={i} style={{ flexGrow: s, background: ZC[i] }} title={`${ZN[i]} ${Math.round(s / 60)} min`} />)}</div>
          <p className="rq-leg num">{z.map((s, i) => s >= 30 && <span key={i}><i style={{ background: ZC[i] }} />{ZN[i]} {Math.round(s / 60)}′ <em>({Math.round((s / zt) * 100)}%)</em></span>)}</p></>
          : <p className="muted">{S && !found ? 'Zones, splits and cadence appear after the FIT file of this run is imported (next COROS sync).' : 'Loading…'}</p>}</section>
      {km.length > 0 && <section><h3>Kilometre splits</h3>
        <div className="rq-tbl"><table><thead><tr><th>km</th><th>Pace</th><th>HR</th><th>Cad</th></tr></thead><tbody>{km.map((k) => <tr key={k.km}><td className="num">{k.km}</td><td className="num">{k.pace ? fmtPaceS(k.pace) : '—'}</td><td className={'num' + (k.hr > hrCap ? ' hi' : '')}>{k.hr ? Math.round(k.hr) : '—'}</td><td className="num">{k.cad ? Math.round(k.cad) : '—'}</td></tr>)}</tbody></table></div></section>}
      <section><h3>Coach note</h3>{C?.summary ? <p className="rq-note">{String(C.summary).replace(/\bbelum ditarik\b/gi, 'not yet extracted')}</p> : <p className="muted">No coach review saved for this run yet. Open the full analysis to request one.</p>}</section>
      <footer className="rq-f"><button type="button" className="btn" onClick={onClose}>Close Analysis</button><button type="button" className="btn primary" onClick={onFull}>Full analysis →</button></footer>
    </div>
  </div>
}
