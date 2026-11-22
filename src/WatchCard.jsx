// Home: "Today's call" — the decision from the athlete's own rules, then the few metrics that matter most today, worst first (src/lib/watch.js).
import { useApi } from './api.js'
import { watchList } from './lib/watch.js'

const DOT = { alert: 'Alert', watch: 'Watch', ok: 'OK', info: 'Season' }
export default function WatchCard({ checkin, settings, go }) {
  const T = useApi('/api/twin'), twin = T.data?.state
  if (!twin) return null
  const { call, items } = watchList(twin, { checkin, sleepNeedMin: settings?.sleepNeedMin || 480 })
  const top = items.slice(0, 6)
  return <section className={`card watch call-${call?.level || 'none'}`} aria-label="Today's call and metrics to watch">
    {call && <div className="watch-call">
      <span className="watch-verdict">{call.label}</span>
      <p><b>Today's call.</b> {call.why}</p>
    </div>}
    <ul className="watch-list">
      {top.map((i) => <li key={i.id} className={`wi st-${i.status}`}>
        <div className="wi-top"><span className="wi-dot" aria-label={DOT[i.status]} />{i.label}{i.rule && <small className="wi-rule">rule</small>}</div>
        <b className="wi-val">{i.value ?? '—'}{i.value != null && i.unit ? <small> {i.unit}</small> : null}</b>
        <small className="wi-ref">{i.ref}</small>
        <p className="wi-why">{i.why}</p>
      </li>)}
    </ul>
    <button className="link" onClick={() => go('ready')}>All readiness details →</button>
  </section>
}
