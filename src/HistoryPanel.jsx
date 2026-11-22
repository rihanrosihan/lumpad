import { useMemo } from 'react'
import { Card, Chip, StatusPill } from './ui.jsx'
import { BarChart, Legend } from './charts.jsx'
import { useApi, fmtPaceS } from './api.js'

// History: the Garmin-primary era (before 2026), imported from the Garmin export. Every number comes from the imported data (history_month / twin_history); nothing is estimated here.
// Garmin-scale metrics (load, readiness, race predictor) are labelled as such and never mixed with COROS values.
const W = 340
const f = (x, d = 1) => (x == null || !Number.isFinite(+x) ? '—' : (+x).toFixed(d))
const mmss = (s) => (s == null ? '—' : fmtPaceS(s))
const hms = (s) => (s == null ? '—' : `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`)

// small multi-series line chart with decimal-aware ticks (the shared LineChart rounds ticks to integers, which hides EF 0.71 → 0.92)
function Trend({ data, lines, height = 140, label, dec = 0 }) {
  const vals = data.flatMap((d) => lines.map((l) => d[l.key])).filter((v) => v != null)
  if (vals.length < 2) return <p className="muted">Not enough data in this period.</p>
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo || 1) * 0.12, L = 36, R = 8, T = 8, B = 20
  const X = (i) => L + (i / Math.max(1, data.length - 1)) * (W - L - R), Y = (v) => T + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (height - T - B)
  const ticks = [lo, (lo + hi) / 2, hi], path = (k) => data.map((d, i) => (d[k] == null ? null : `${i && data[i - 1][k] != null ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(d[k]).toFixed(1)}`)).filter(Boolean).join(' ')
  const mark = [0, Math.floor((data.length - 1) / 2), data.length - 1]
  return <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={label}>
    {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className="gl" /><text x={L - 5} y={Y(t) + 4} className="gt" textAnchor="end">{t.toFixed(dec)}</text></g>)}
    {mark.map((i) => <text key={i} x={X(i)} y={height - 5} className="gt" textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{data[i].date.slice(2, 7)}</text>)}
    {lines.map((l) => <path key={l.key} d={path(l.key)} className="ln" style={{ stroke: l.color }} />)}
  </svg>
}

export default function HistoryPanel() {
  const { data: H, state } = useApi('/api/history')
  const months = H?.months || [], weeks = H?.weeks || []
  const bars = useMemo(() => months.map((m) => ({ date: m.month, value: m.run_km || 0, tick: m.month.slice(5) === '01' ? m.month.slice(2, 4) : m.month.slice(5) })), [months])
  const ef = useMemo(() => weeks.filter((w) => w.ef != null || w.hr800 != null), [weeks])
  const mdata = useMemo(() => months.map((m) => ({ date: m.month + '-01', sleep: m.sleep_h, rhr: m.rhr, p5: m.pred_5k_s ? m.pred_5k_s / 60 : null, vo2: m.vo2max })), [months])
  if (state === 'loading' && !H) return <p className="muted">Loading history…</p>
  if (!H?.available) return <Card title="History"><p className="muted">The Garmin history has not been imported yet.</p></Card>
  const T = H.totals, best = months.reduce((b, m) => (m.run_km > (b?.run_km || 0) ? m : b), null)
  return <div className="fit-grid">
    <Card title="Garmin history" right={<StatusPill tone="cobalt">{H.from} → {H.to}</StatusPill>}>
      <div className="fit-kpis">
        <div><small>Runs</small><b>{T.runs}</b><em>{T.run_km} km total</em></div>
        <div><small>Biggest month</small><b>{best ? `${f(best.run_km, 0)} km` : '—'}</b><em>{best?.month || ''}</em></div>
        <div><small>Strength · walks · other</small><b>{T.strength} · {T.walks} · {T.other}</b><em>sessions</em></div>
        <div><small>Sleep recorded</small><b>{T.sleep_nights ?? '—'}</b><em>nights</em></div>
        <div><small>Days of health data</small><b>{T.health_days ?? '—'}</b><em>sleep, HR, stress, readiness</em></div>
        <div><small>Activities linked</small><b>{T.activities_linked ?? '—'}</b><em>{T.garmin_only ?? 0} Garmin-only</em></div>
      </div>
      <p className="src-note">{H.note}</p>
    </Card>
    <Card title="Running volume per month" right={<Chip>km</Chip>}>
      <BarChart data={bars} height={110} label={`Monthly running km: ${months.map((m) => `${m.month} ${f(m.run_km, 0)}`).join(', ')}`} />
      <p className="src-note">Longest run by month: {months.filter((m) => m.long_run_km).map((m) => `${m.month.slice(2)} ${f(m.long_run_km, 0)} km`).join(' · ')}</p>
    </Card>
    <Card title="Fitness and fatigue (Garmin load)" right={<Chip>weekly</Chip>}>
      <Trend data={weeks} lines={[{ key: 'ctl', color: 'var(--cobalt)' }, { key: 'atl', color: 'var(--red)' }]} label="Chronic and acute training load by week" />
      <Legend items={[{ label: 'CTL (fitness)', color: 'var(--cobalt)' }, { label: 'ATL (fatigue)', color: 'var(--red)' }]} />
      <p className="src-note">Built from Garmin activity load (EWMA 42/7 days). Garmin scale: not comparable with COROS load.</p>
    </Card>
    <Card title="Aerobic efficiency (EF)" right={<Chip>steady runs, 28-day</Chip>}>
      <Trend data={ef} lines={[{ key: 'ef', color: 'var(--green)' }]} dec={2} label="Efficiency factor by week" />
      <p className="src-note">EF up means more speed per heartbeat. From FIT streams of steady 3–15 km runs; weeks with no such runs are skipped.{ef.length ? ` Latest ${f(ef.at(-1)?.ef, 3)}.` : ''}</p>
    </Card>
    <Card title="Sleep and resting heart rate" right={<Chip>monthly average</Chip>}>
      <Trend data={mdata} lines={[{ key: 'sleep', color: 'var(--cobalt)' }]} dec={1} height={110} label="Average sleep hours per month" />
      <Legend items={[{ label: 'Sleep (h)', color: 'var(--cobalt)' }]} />
      <Trend data={mdata} lines={[{ key: 'rhr', color: 'var(--red)' }]} dec={0} height={110} label="Average resting heart rate per month" />
      <Legend items={[{ label: 'Resting HR (bpm)', color: 'var(--red)' }]} />
    </Card>
    <Card title="Garmin race predictor" right={<Chip>month end</Chip>}>
      <Trend data={mdata} lines={[{ key: 'p5', color: 'var(--green)' }]} dec={1} height={110} label="Predicted 5K time in minutes" />
      <Legend items={[{ label: 'Predicted 5K (min)', color: 'var(--green)' }]} />
      <p className="src-note">Garmin's own estimate, shown only for the trend. Latest: 5K {mmss(months.at(-1)?.pred_5k_s)} · 10K {mmss(months.at(-1)?.pred_10k_s)} · HM {hms(months.at(-1)?.pred_hm_s)}; VO2max {f(months.at(-1)?.vo2max, 0)}.</p>
    </Card>
    <Card title="Month by month">
      <div className="tbl-wrap" style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
          <thead><tr><th align="left">Month</th><th>Runs</th><th>km</th><th>Long</th><th>EF</th><th>Sleep h</th><th>RHR</th><th>Ready</th></tr></thead>
          <tbody>{[...months].reverse().map((m) => <tr key={m.month}><td>{m.month}</td><td align="center">{m.run_n}</td><td align="center">{f(m.run_km, 0)}</td><td align="center">{f(m.long_run_km, 1)}</td><td align="center">{f(m.ef_mean, 3)}</td>
            <td align="center">{f(m.sleep_h, 1)}</td><td align="center">{f(m.rhr, 0)}</td><td align="center">{f(m.readiness, 0)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="src-note">Readiness is Garmin's own score. HRV exists from 2025-09 only; months with fewer than 3 steady runs have no EF.</p>
    </Card>
  </div>
}
