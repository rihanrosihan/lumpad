import { Card, Chip } from './ui.jsx'
import { useApi } from './api.js'

// Read-only view of the coach setup: the key and the cap are server settings (.env), so this shows state, never secrets.
export default function CoachConfig() {
  const S = useApi('/api/intel/status'), st = S.data, g = st?.guard, pct = g ? Math.min(100, Math.round((g.spend_cny / g.cap_cny) * 100)) : 0
  return <Card title="AI Coach & anggaran" right={st && <Chip tone={st.key ? 'green' : 'yellow'}>{st.key ? 'API key terpasang' : 'API key belum diisi'}</Chip>}>
    {!st ? <p className="muted">Memuat…</p> : <>
      <dl className="kv">
        <div><dt>Model</dt><dd>{st.model?.name || 'belum dipilih'}</dd></div>
        <div><dt>Pemakaian bulan ini</dt><dd>¥{(g?.spend_cny ?? 0).toFixed(2)} dari ¥{g?.cap_cny}{g?.level === 'paused' ? ' · dijeda' : g?.level === 'limited' ? ' · dibatasi' : ''}</dd></div>
        <div><dt>Sesi FIT dianalisis</dt><dd>{st.counts.fit_sessions}</dd></div>
        <div><dt>Memori</dt><dd>{(st.memory || []).reduce((s, m) => s + m.n, 0)} catatan</dd></div>
      </dl>
      <div className="bar" role="img" aria-label={`Pemakaian coach ${pct}%`}><i style={{ width: pct + '%', background: pct >= 80 ? 'var(--red-t)' : 'var(--accent)' }} /></div>
      <p className="muted">Kunci dan batas bulanan diatur di server (<code>DEEPSEEK_API_KEY</code>, <code>DEEPSEEK_MONTHLY_CAP_CNY</code> di <code>.env</code>) — halaman ini tidak pernah menampilkan kuncinya. Dengan kunci terpasang, konteks kesehatan dan latihanmu dikirim ke penyedia model.</p>
    </>}
  </Card>
}
