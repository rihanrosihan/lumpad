import { Card, Chip } from './ui.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'

const f1 = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (+x).toFixed(d))
// Per-second analysis from the FIT file (intelligence layer). Hidden until the FIT has been downloaded and processed.
export function FitPanel({ id }) {
  const S = useApi(id ? `/api/intel/session?id=${encodeURIComponent(id)}` : '', !!id), s = S.data
  if (!s?.found) return S.state === 'ok' ? <p className="src-note">Per-second (FIT) analysis is not available for this session yet — FIT files are downloaded gradually.</p> : null
  const m = s.metrics, W = 300, H = 56, bw = W / Math.max(s.km.length, 1), drift = m.drift_pahr?.value ?? m.run_phase_drift?.value
  return <Card title="Per-second analysis (FIT)" right={<Chip>{s.km.length} km</Chip>}>
    <div className="score-grid">
      <div><small>Run share</small><b>{Math.round((s.run_share || 0) * 100)}%</b><em>{fmtDur(m.run_s)} run · {fmtDur(m.walk_s)} walk</em></div>
      <div><small>EF (run phase)</small><b>{f1(s.ef, 3)}</b><em>net {f1(s.net_ef, 3)}</em></div>
      <div><small>Drift</small><b>{drift != null ? f1(drift) + '%' : '—'}</b><em>{m.drift_pahr?.value != null ? 'Pa:HR steady' : m.run_phase_drift?.value != null ? 'run phase' : m.drift_pahr?.why}</em></div>
      <div><small>Fade onset</small><b>{m.fade_onset?.km ? 'km ' + m.fade_onset.km : '—'}</b><em>{m.fade_onset?.trigger}</em></div>
      <div><small>GCT akhir vs awal</small><b>{m.bio_fade ? (m.bio_fade.gct_ms > 0 ? '+' : '') + f1(m.bio_fade.gct_ms, 0) + ' ms' : '—'}</b><em>stride {m.bio_fade ? f1(m.bio_fade.stride_m, 3) + ' m' : '—'}</em></div>
      <div><small>HR@8:00</small><b>{m.hr_at_800 ?? '—'}</b><em>{m.hr_at_800 ? `z ${f1((m.hr_at_800 - 143.1) / 5)} vs baseline` : 'no steady block'}</em></div>
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} className="runbars" role="img" aria-label="Run share per km">{s.km.map((k, i) => <rect key={i} x={i * bw + 0.5} width={Math.max(1, bw - 1.5)} y={H - H * (k.runShare ?? 0)} height={H * (k.runShare ?? 0)} rx="1.5" fill={k.runShare >= 0.9 ? 'var(--green)' : k.runShare >= 0.6 ? 'var(--yellow)' : 'var(--red)'} />)}</svg>
    <p className="src-note">[FIT] Bars = share of each km spent running (green ≥ 90%, yellow ≥ 60%). Stop = distance not increasing; walk = cadence &lt; 125 spm. Power = COROS algorithmic estimate.{s.weather && !s.weather.indoor ? ` Weather ${s.weather.temp_c}°C, WBGT≈${s.weather.wbgt} [calc].` : ''}</p>
  </Card>
}
