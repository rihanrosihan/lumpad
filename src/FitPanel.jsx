import { Card, Chip } from './ui.jsx'
import { useApi, fmtDur } from './api.js'
import { Z2_CEILING } from './lib/athlete.js'

const ZCOL = ['var(--c-rest)', 'var(--c-easy)', 'var(--green)', 'var(--c-long)', 'var(--yellow)', 'var(--c-quality)', 'var(--red)']
// one-line stacked bar of seconds per zone (index 0 = below Z1 / slower than Z1)
function ZoneStrip({ z, label }) {
  const t = (z || []).reduce((a, b) => a + b, 0); if (!t) return null
  const pct = z.map((v) => Math.round((v / t) * 100)), top = pct.indexOf(Math.max(...pct))
  return <div className="zstrip" role="img" aria-label={`${label} zones: ` + pct.map((p, i) => `${i ? 'Z' + i : 'below Z1'} ${p}%`).join(', ')}>
    <span>{label}</span><i>{z.map((v, i) => v ? <u key={i} style={{ width: (v / t) * 100 + '%', background: ZCOL[i] }} /> : null)}</i><em>{top ? 'Z' + top : '<Z1'} {pct[top]}%</em></div>
}

const f1 = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (+x).toFixed(d))
// Per-second analysis from the FIT file (intelligence layer) + semantic RAG tags + 16-D kNN fingerprint neighbours.
export function FitPanel({ id, go }) {
  const S = useApi(id ? `/api/intel/session?id=${encodeURIComponent(id)}` : '', !!id), s = S.data
  if (!s?.found) return S.state === 'ok' ? <p className="src-note">Per-second (FIT) analysis is not available for this session yet — FIT files are downloaded gradually.</p> : null
  const m = s.metrics, W = 300, H = 56, bw = W / Math.max(s.km.length, 1), drift = m.drift_pahr?.value ?? m.run_phase_drift?.value
  const tagsLine = (s.card || '').split('\n').find((l) => l.startsWith('Semantic tags:'))
  const tags = tagsLine ? tagsLine.replace('Semantic tags:', '').trim().split(/\s+/).filter(Boolean) : []
  const isCreep = tags.includes('#intensity_creep'), isZ2 = tags.includes('#z2_disciplined')
  const ctxLine = ((s.card || '').split('\n').find((l) => l.startsWith('7-day context:')) || '').replace('7-day context:', '').trim()
  return <Card title="Per-second analysis (FIT · Coros Pod 2)" right={<div className="chips" style={{ margin: 0 }}>{isCreep && <Chip tone="yellow">intensity creep (&gt;{Z2_CEILING} bpm)</Chip>}{isZ2 && <Chip tone="green">Z2 disciplined (≤{Z2_CEILING} bpm)</Chip>}<Chip>{s.km.length} km · 1 Hz</Chip></div>}>
    <div className="score-grid">
      <div><small>Run share</small><b>{Math.round((s.run_share || 0) * 100)}%</b><em>{fmtDur(m.run_s)} run · {fmtDur(m.walk_s)} walk</em></div>
      <div><small>EF (run phase)</small><b>{f1(s.ef, 3)}</b><em>net {f1(s.net_ef, 3)}</em></div>
      <div><small>Drift</small><b>{drift != null ? f1(drift) + '%' : '—'}</b><em>{m.drift_pahr?.value != null ? 'Pa:HR steady' : m.run_phase_drift?.value != null ? 'run phase' : m.drift_pahr?.why}</em></div>
      <div><small>Fade onset</small><b>{m.fade_onset?.km ? 'km ' + m.fade_onset.km : '—'}</b><em>{m.fade_onset?.trigger}</em></div>
      <div><small>GCT end vs start</small><b>{m.bio_fade ? (m.bio_fade.gct_ms > 0 ? '+' : '') + f1(m.bio_fade.gct_ms, 0) + ' ms' : '—'}</b><em>stride {m.bio_fade ? f1(m.bio_fade.stride_m, 3) + ' m' : '—'}</em></div>
      <div><small>HR@8:00</small><b>{m.hr_at_800 ?? '—'}</b><em>{m.hr_at_800 ? `z ${f1((m.hr_at_800 - 143.1) / 5)} vs baseline` : 'no steady block'}</em></div>
    </div>
    {(m.z6 || m.pacing) && <div className="score-grid" style={{ marginTop: 8 }}>
      <div><small>Run HR vs LTHR</small><b>{m.lthr_pct != null ? m.lthr_pct + '%' : '—'}</b><em>{m.lthr_pct >= 95 ? 'threshold effort' : m.lthr_pct >= 90 ? 'aerobic power' : m.lthr_pct != null ? 'aerobic' : ''}</em></div>
      <div><small>Pacing discipline</small><b>{m.pacing ? m.pacing.score + '/100' : '—'}</b><em>{m.pacing ? `${m.pacing.split} split · CV ${f1(m.pacing.cv_pct)}% · over ${m.pacing.km} running km` : 'needs ≥ 4 running km'}</em></div>
      <div><small>Per-second zones</small><ZoneStrip z={m.z6?.hr_s} label="HR" /><ZoneStrip z={m.z6?.pace_s} label="Pace" /></div>
    </div>}
    {ctxLine && <p className="muted" style={{ fontSize: '.82rem', margin: '8px 0 0' }}><b>Before this run:</b> {ctxLine}</p>}
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
