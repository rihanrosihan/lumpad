import { Card, Chip } from './ui.jsx'
import { useApi } from './api.js'

// Read-only view of the coach setup: the key and the cap are server settings (.env), so this shows state, never secrets.
export default function CoachConfig() {
  const S = useApi('/api/intel/status'), st = S.data, g = st?.guard, pct = g ? Math.min(100, Math.round((g.spend_cny / g.cap_cny) * 100)) : 0
  return <Card title="AI Coach & budget" right={st && <Chip tone={st.key ? 'green' : 'yellow'}>{st.key ? 'API key installed' : 'API key not set'}</Chip>}>
    {!st ? <p className="muted">Loading…</p> : <>
      <dl className="kv">
        <div><dt>Model</dt><dd>{st.model?.name || 'not chosen yet'}</dd></div>
        <div><dt>Spend this month</dt><dd>¥{(g?.spend_cny ?? 0).toFixed(2)} of ¥{g?.cap_cny}{g?.level === 'paused' ? ' · paused' : g?.level === 'limited' ? ' · limited' : ''}</dd></div>
        <div><dt>FIT sessions analysed</dt><dd>{st.counts.fit_sessions}</dd></div>
        <div><dt>Memory</dt><dd>{(st.memory || []).reduce((s, m) => s + m.n, 0)} items</dd></div>
      </dl>
      <div className="bar" role="img" aria-label={`Coach spend ${pct}%`}><i style={{ width: pct + '%', background: pct >= 80 ? 'var(--red-t)' : 'var(--accent)' }} /></div>
      <p className="muted">The key and monthly cap are server settings (<code>DEEPSEEK_API_KEY</code>, <code>DEEPSEEK_MONTHLY_CAP_CNY</code> in <code>.env</code>) — this page never shows the key. With a key installed, your health and training context is sent to the model provider.</p>
    </>}
  </Card>
}
