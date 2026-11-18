import { Card, Chip } from './ui.jsx'
import { useApi, fmtDur } from './api.js'

const f1 = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (+x).toFixed(d))
// Per-second analysis from the FIT file (intelligence layer) + semantic RAG tags + 16-D kNN fingerprint neighbours.
export function FitPanel({ id, go }) {
  const S = useApi(id ? `/api/intel/session?id=${encodeURIComponent(id)}` : '', !!id), s = S.data
  if (!s?.found) return S.state === 'ok' ? <p className="src-note">Per-second (FIT) analysis is not available for this session yet — FIT files are downloaded gradually.</p> : null
  const m = s.metrics, W = 300, H = 56, bw = W / Math.max(s.km.length, 1), drift = m.drift_pahr?.value ?? m.run_phase_drift?.value
  const tagsLine = (s.card || '').split('\n').find((l) => l.startsWith('Semantic tags:'))
  const tags = tagsLine ? tagsLine.replace('Semantic tags:', '').trim().split(/\s+/).filter(Boolean) : []
  const isCreep = tags.includes('#intensity_creep'), isZ2 = tags.includes('#z2_disciplined')
  return <Card title="Per-second analysis (FIT · Coros Pod 2)" right={<div className="chips" style={{ margin: 0 }}>{isCreep && <Chip tone="yellow">intensity creep (&gt;148 bpm)</Chip>}{isZ2 && <Chip tone="green">Z2 disciplined (≤148 bpm)</Chip>}<Chip>{s.km.length} km · 1 Hz</Chip></div>}>
    <div className="score-grid">
      <div><small>Run share</small><b>{Math.round((s.run_share || 0) * 100)}%</b><em>{fmtDur(m.run_s)} run · {fmtDur(m.walk_s)} walk</em></div>
      <div><small>EF (run phase)</small><b>{f1(s.ef, 3)}</b><em>net {f1(s.net_ef, 3)}</em></div>
      <div><small>Drift</small><b>{drift != null ? f1(drift) + '%' : '—'}</b><em>{m.drift_pahr?.value != null ? 'Pa:HR steady' : m.run_phase_drift?.value != null ? 'run phase' : m.drift_pahr?.why}</em></div>
      <div><small>Fade onset</small><b>{m.fade_onset?.km ? 'km ' + m.fade_onset.km : '—'}</b><em>{m.fade_onset?.trigger}</em></div>
      <div><small>GCT end vs start</small><b>{m.bio_fade ? (m.bio_fade.gct_ms > 0 ? '+' : '') + f1(m.bio_fade.gct_ms, 0) + ' ms' : '—'}</b><em>stride {m.bio_fade ? f1(m.bio_fade.stride_m, 3) + ' m' : '—'}</em></div>
      <div><small>HR@8:00</small><b>{m.hr_at_800 ?? '—'}</b><em>{m.hr_at_800 ? `z ${f1((m.hr_at_800 - 143.1) / 5)} vs baseline` : 'no steady block'}</em></div>
    </div>
    {tags.length > 0 && <div className="chips" style={{ marginTop: 8 }}>{tags.map((t) => <Chip key={t} tone={t === '#intensity_creep' || t === '#cardiac_drift_high' || t === '#early_fade' ? 'yellow' : t === '#z2_disciplined' || t === '#gct_stable' ? 'green' : undefined}>{t}</Chip>)}</div>}
    <svg viewBox={`0 0 ${W} ${H}`} className="runbars" role="img" aria-label="Run share per km">{s.km.map((k, i) => <rect key={i} x={i * bw + 0.5} width={Math.max(1, bw - 1.5)} y={H - H * (k.runShare ?? 0)} height={H * (k.runShare ?? 0)} rx="1.5" fill={k.runShare >= 0.9 ? 'var(--green)' : k.runShare >= 0.6 ? 'var(--yellow)' : 'var(--red)'} />)}</svg>
    <p className="src-note">[FIT] Bars = share of each km spent running (green ≥ 90%, yellow ≥ 60%). Stop = distance not increasing; walk = cadence &lt; 125 spm. Power = COROS algorithmic estimate.{s.weather && !s.weather.indoor ? ` Weather ${s.weather.temp_c}°C, WBGT≈${s.weather.wbgt} [calc].` : ''}</p>
    {s.similar?.length > 0 && <div style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: '.82rem', color: 'var(--muted)', margin: '0 0 6px' }}>Most similar sessions (16-D physiological fingerprint kNN)</h3>
      <div className="scroll"><table className="lapt">
        <thead><tr><th>Date</th><th>Km</th><th>Similarity</th><th>Run share</th><th>EF</th><th>Onset</th><th>HR@8:00</th></tr></thead>
        <tbody>{s.similar.map((r) => <tr key={r.label_id} style={{ cursor: go ? 'pointer' : 'default' }} onClick={() => go && go('activity', { id: r.activity_id })}>
          <td><b>{r.date.slice(5)}</b></td>
          <td>{f1(r.distance_m / 1000, 1)}</td>
          <td><Chip tone={r.sim >= 0.75 ? 'green' : undefined}>{Math.round(r.sim * 100)}%</Chip></td>
          <td>{r.run_share != null ? Math.round(r.run_share * 100) + '%' : '—'}</td>
          <td>{f1(r.ef, 3)}</td>
          <td>{r.onset_km ? 'km ' + r.onset_km : '—'}</td>
          <td>{r.hr800 ?? '—'}</td>
        </tr>)}</tbody>
      </table></div>
    </div>}
  </Card>
}
