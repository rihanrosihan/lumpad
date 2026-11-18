import { Card } from './ui.jsx'
import { useApi } from './api.js'

const f = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (+x).toFixed(d))
// Where this long run sits among the athlete's other runs ≥ 16 km (FIT-analysed only): run share, efficiency, drift, fade onset.
export default function LongRunContext({ label, go }) {
  const L = useApi('/api/intel/longruns'), rows = L.data || []
  if (!rows.length || !rows.some((r) => r.label_id === label)) return null
  return <Card title="Perbandingan lari panjang" right={<span className="muted">{rows.length} lari ≥ 16 km</span>}>
    <div className="scroll" tabIndex={0} role="region" aria-label="Tabel lari panjang (geser untuk melihat semua kolom)"><table className="zm">
      <thead><tr><th>Tanggal</th><th>Km</th><th>Berlari</th><th>EF</th><th>Drift</th><th>Onset km</th><th>HR@8:00</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.label_id} className={r.label_id === label ? 'cur' : ''} aria-current={r.label_id === label ? 'true' : undefined}>
        <td>{r.date.slice(5)}</td><td>{f(r.distance_m / 1000)}</td><td>{r.run_share != null ? Math.round(r.run_share * 100) + '%' : '—'}</td><td>{f(r.ef, 3)}</td><td>{r.drift_pahr != null ? f(r.drift_pahr) + '%' : r.run_drift != null ? f(r.run_drift) + '%' : '—'}</td><td>{r.onset_km ?? '—'}</td><td>{r.hr800 ?? '—'}</td></tr>)}</tbody>
    </table></div>
    <p className="muted">Baris tebal = sesi ini. Detail per sesi dan skor durability ada di tab AI Coach → Ketahanan.</p>
    {go && <button className="btn sm" onClick={() => go('coach')}>Buka Ketahanan</button>}
  </Card>
}
