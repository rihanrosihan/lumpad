import { Card, Chip } from './ui.jsx'
import { useApi, invalidate } from './api.js'
import { useState } from 'react'
import { post } from './Coach.jsx'
import { useStore } from './store.js'

// Coach setup. The provider (base URL, API key, model) can be changed here: the key is sealed on the server and is never shown again, only a masked form.
// The monthly spend cap stays a server setting (.env).
export default function CoachConfig() {
  const [lang, setLang] = useStore('lumpad.coach.lang', 'en')
  const S = useApi('/api/intel/status'), st = S.data, g = st?.guard, pct = g ? Math.min(100, Math.round((g.spend_cny / g.cap_cny) * 100)) : 0
  return <Card title="AI Coach & budget" right={st && <Chip tone={st.key ? 'green' : 'yellow'}>{st.key ? 'API key installed' : 'API key not set'}</Chip>}>
    {!st ? <p className="muted">Loading…</p> : <>
      <dl className="kv">
        <div><dt>Model</dt><dd>{st.model?.name || 'not chosen yet'}</dd></div>
        <div><dt>Spend this month</dt><dd>¥{(g?.spend_cny ?? 0).toFixed(2)} of ¥{g?.cap_cny}{g?.level === 'paused' ? ' · paused' : g?.level === 'limited' ? ' · limited' : ''}</dd></div>
        <div><dt>FIT sessions analysed</dt><dd>{st.counts.fit_sessions}</dd></div>
        <div><dt>Memory</dt><dd>{(st.memory || []).reduce((s, m) => s + m.n, 0)} items</dd></div>
      </dl>
      <div className="fld" style={{ margin: '8px 0' }}><span>Coach answer language</span>
        <div className="seg" role="group" aria-label="Coach answer language">{[['en', 'English'], ['id', 'Bahasa Indonesia']].map(([k, l]) => <button key={k} aria-pressed={lang === k} className={lang === k ? 'on' : ''} onClick={() => setLang(k)}>{l}</button>)}</div>
        <small className="muted">Applies to new briefs, reviews and answers. The app itself stays in English.</small></div>
      <div className="bar" role="img" aria-label={`Coach spend ${pct}%`}><i style={{ width: pct + '%', background: pct >= 80 ? 'var(--red-t)' : 'var(--accent)' }} /></div>
      <p className="muted">The monthly spend cap is a server setting (<code>DEEPSEEK_MONTHLY_CAP_CNY</code> in <code>.env</code>). With a key installed, your health and training context is sent to the model provider you choose below.</p>
    </>}
  </Card>
}

// Provider, key and model. Saving a changed key / URL / model first tests the connection (a tiny content-free request); the key is stored sealed and never returned.
export function ProviderSettings() {
  const C = useApi('/api/coach/config'), cfg = C.data
  const [form, setForm] = useState({ base: '', api_key: '', model: '', max: '' }), [test, setTest] = useState(null), [busy, setBusy] = useState(''), [msg, setMsg] = useState(null), [models, setModels] = useState([])
  if (!cfg) return <Card title="Provider, API key & model"><p className="muted">Loading…</p></Card>
  const val = (k, d) => (form[k] !== '' ? form[k] : d), base = val('base', cfg.base), model = val('model', cfg.model || ''), max = val('max', cfg.max_calls_per_day)
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setMsg(null) }
  const clear = () => { setForm({ base: '', api_key: '', model: '', max: '' }); setTest(null); invalidate('coach/config'); invalidate('intel/status') }
  const run = async (kind) => {
    setBusy(kind); setMsg(null)
    try {
      if (kind === 'test') { const t = await post('/api/coach/config/test', { base: form.base || cfg.base, api_key: form.api_key || undefined, model: model || undefined }); setTest(t); if (t.models?.length) setModels(t.models) }
      else if (kind === 'save') { await post('/api/coach/config', { base: form.base || undefined, api_key: form.api_key || undefined, model: form.model !== '' ? form.model : undefined, max_calls_per_day: form.max !== '' ? form.max : undefined }); clear(); setMsg({ ok: true, text: 'Saved. New briefs, reviews and answers use this provider.' }) }
      else { await post('/api/coach/config/reset', {}); clear(); setMsg({ ok: true, text: 'Back to the default provider from the server settings.' }) }
    } catch (e) { setMsg({ ok: false, text: e.message || 'Failed' }) }
    setBusy('')
  }
  const dirty = !!(form.base || form.api_key || form.model || form.max), saved = cfg.saved || {}
  return <Card title="Provider, API key & model" right={<Chip tone={cfg.key_set ? 'green' : 'yellow'}>{cfg.key_set ? `key ${cfg.key_masked} · ${cfg.key_source === 'saved' ? 'saved here' : 'from .env'}` : 'no key'}</Chip>}>
    <div className="form" style={{ gridTemplateColumns: '1fr' }}>
      <label className="fld"><span>API base URL</span><input type="url" inputMode="url" autoComplete="off" spellCheck="false" value={base} onChange={set('base')} placeholder={cfg.default_base} />
        <small>OpenAI-compatible, https only. Default: {cfg.default_base}.</small></label>
      <label className="fld"><span>API key</span><input type="password" autoComplete="new-password" spellCheck="false" value={form.api_key} onChange={set('api_key')} placeholder={cfg.key_set ? `${cfg.key_masked} — leave empty to keep` : 'paste a key'} />
        <small>Stored encrypted on the server and never shown again. A key pasted anywhere else (chat, email) is exposed: rotate it.</small></label>
      <label className="fld"><span>Model</span><input list="coach-models" autoComplete="off" spellCheck="false" value={model} onChange={set('model')} placeholder="auto: newest Flash" />
        <datalist id="coach-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        <small>{models.length ? `${models.length} models from the last test: pick one or type an id.` : 'Run “Test connection” to load the model list. Empty = newest Flash (DeepSeek only).'}</small></label>
      {(cfg.custom_endpoint || form.base) ? <label className="fld"><span>Max coach runs per day</span><input type="number" min="1" max="5000" value={max} onChange={set('max')} />
        <small>This provider has no balance endpoint, so the budget guard limits runs per day instead of spend.</small></label> : null}
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 4px' }}>
      <button type="button" className="btn sm" disabled={!!busy} onClick={() => run('test')}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
      <button type="button" className="btn sm primary" style={{ width: 'auto' }} disabled={!!busy || !dirty} onClick={() => run('save')}>{busy === 'save' ? 'Testing and saving…' : 'Save'}</button>
      {(saved.base || saved.key || saved.model) && <button type="button" className="btn sm" disabled={!!busy} onClick={() => run('reset')}>Reset to default</button>}
    </div>
    {test && <p className={test.ok ? 'ok' : 'err'} role="status">{test.ok ? `✓ Connected · model ${test.model} · ${test.model_count ?? 0} models · answered in ${(test.latency_ms / 1000).toFixed(1)} s · JSON output ${test.json_mode ? 'works' : 'did not work'}${test.warning ? ' — ' + test.warning : ''}` : `✗ ${test.error}`}</p>}
    {msg && <p className={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
  </Card>
}
