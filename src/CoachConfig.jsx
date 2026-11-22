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

// Provider dropdown: DeepSeek (original) or Tokenomix (gateway), each with its own saved key and model. "Use" / "Save & use" make the chosen one active after a connection test;
// the key is stored sealed on the server and never returned (masked only). Switching back and forth keeps both keys.
const AUTO = '__auto__' // dropdown marker for "no fixed model"
export function ProviderSettings() {
  const C = useApi('/api/coach/config'), cfg = C.data
  const [sel, setSel] = useState(null), [form, setForm] = useState({ api_key: '', model: '', max: '' }), [test, setTest] = useState(null), [busy, setBusy] = useState(''), [msg, setMsg] = useState(null), [models, setModels] = useState({})
  if (!cfg?.providers) return <Card title="AI provider, API key & model"><p className="muted">Loading…</p></Card>
  const cur = sel || cfg.active, P = cfg.providers.find((x) => x.id === cur) || cfg.providers[0], inUse = cfg.providers.find((x) => x.active)
  const ML = useApi(P.key_set ? `/api/coach/models?provider=${cur}${form.api_key ? '&_=' + form.api_key.length : ''}` : '', P.key_set && !form.api_key), listed = ML.data?.ok ? ML.data.models : []
  const val = (k, d) => (form[k] !== '' ? form[k] : d), model = val('model', P.model || (P.id === 'deepseek' ? AUTO : '')), max = val('max', P.max_calls_per_day), dirty = !!(form.api_key || form.model || form.max)
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setMsg(null) }
  const pick = (id) => { setSel(id); setForm({ api_key: '', model: '', max: '' }); setTest(null); setMsg(null) }
  const refresh = () => { setForm({ api_key: '', model: '', max: '' }); setTest(null); invalidate('coach/config'); invalidate('intel/status') }
  const run = async (kind) => {
    const modelOut = form.model === AUTO ? '' : form.model
    setBusy(kind); setMsg(null)
    try {
      if (kind === 'test') { const t = await post('/api/coach/config/test', { provider: cur, api_key: form.api_key || undefined, model: model === AUTO ? undefined : model || undefined }); setTest(t); if (t.models?.length) setModels((m) => ({ ...m, [cur]: t.models })) }
      else if (kind === 'save') { await post('/api/coach/config', { provider: cur, api_key: form.api_key || undefined, model: form.model !== '' ? modelOut : undefined, max_calls_per_day: form.max !== '' ? form.max : undefined }); refresh(); setMsg({ ok: true, text: `Saved. The coach now uses ${P.label}.` }) }
      else if (kind === 'use') { await post('/api/coach/config', { provider: cur }); refresh(); setMsg({ ok: true, text: `Switched. The coach now uses ${P.label}.` }) }
      else { await post('/api/coach/config/reset', { provider: cur }); refresh(); setMsg({ ok: true, text: `Removed the saved key and model for ${P.label}.` }) }
    } catch (e) { setMsg({ ok: false, text: e.message || 'Failed' }) }
    setBusy('')
  }
  return <Card title="AI provider, API key & model" right={<Chip tone={inUse?.key_set ? 'green' : 'yellow'}>{inUse ? `in use: ${inUse.label}` : 'no provider'}</Chip>}>
    <div className="form" style={{ gridTemplateColumns: '1fr' }}>
      <label className="fld"><span>Provider</span>
        <select value={cur} onChange={(e) => pick(e.target.value)} aria-label="AI provider">{cfg.providers.map((x) => <option key={x.id} value={x.id}>{x.label}{x.active ? ' — in use' : ''}{x.key_set ? '' : ' — no key yet'}</option>)}</select>
        <small>{P.base} · {P.id === 'deepseek' ? 'the official DeepSeek API; spend is tracked from the account balance.' : 'OpenAI-compatible gateway; it has no balance endpoint, so a daily run limit is used instead of spend.'}</small></label>
      <label className="fld"><span>API key for {P.label}</span><input type="password" autoComplete="new-password" spellCheck="false" value={form.api_key} onChange={set('api_key')} placeholder={P.key_set ? `${P.key_masked} (${P.key_source === 'saved' ? 'saved here' : 'from .env'}) — leave empty to keep` : 'paste a key'} />
        <small>Stored encrypted on the server and never shown again. A key pasted anywhere else (chat, email) is exposed: rotate it.</small></label>
      <label className="fld"><span>Model</span>
        <select value={model} onChange={set('model')} aria-label="Model">
          {P.id === 'deepseek' && <option value={AUTO}>Automatic: newest Flash</option>}
          {P.id !== 'deepseek' && !model && <option value="" disabled>Choose a model…</option>}
          {model && model !== AUTO && !(models[cur]?.length ? models[cur] : listed).includes(model) && <option value={model}>{model} (saved)</option>}
          {(models[cur]?.length ? models[cur] : listed).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <small>{ML.state === 'loading' && !listed.length ? 'Loading the models available under this key…' : (models[cur]?.length || listed.length) ? `${(models[cur]?.length ? models[cur] : listed).length} models available under this key.` : (ML.data && !ML.data.ok ? ML.data.error : (P.key_set ? '' : 'Paste a key and press Test connection to load its models.'))}{P.id === 'tokenomix' ? ' A model is required for this provider.' : ''}</small></label>
      {P.custom_endpoint ? <label className="fld"><span>Max coach runs per day</span><input type="number" min="1" max="5000" value={max} onChange={set('max')} /><small>The budget guard stops new runs after this many in one day.</small></label> : null}
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 4px' }}>
      <button type="button" className="btn sm" disabled={!!busy} onClick={() => run('test')}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
      {dirty ? <button type="button" className="btn sm primary" style={{ width: 'auto' }} disabled={!!busy} onClick={() => run('save')}>{busy === 'save' ? 'Testing and saving…' : `Save & use ${P.label}`}</button>
        : !P.active && <button type="button" className="btn sm primary" style={{ width: 'auto' }} disabled={!!busy || !P.key_set} onClick={() => run('use')}>{busy === 'use' ? 'Testing and switching…' : `Use ${P.label}`}</button>}
      {(P.saved?.key || P.saved?.model) && <button type="button" className="btn sm" disabled={!!busy} onClick={() => run('reset')}>Remove saved key</button>}
    </div>
    {test && <p className={test.ok ? 'ok' : 'err'} role="status">{test.ok ? `✓ ${P.label}: connected · model ${test.model} · ${test.model_count ?? 0} models · answered in ${(test.latency_ms / 1000).toFixed(1)} s · JSON output ${test.json_mode ? 'works' : 'did not work'}${test.warning ? ' — ' + test.warning : ''}` : `✗ ${test.error}`}</p>}
    {msg && <p className={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
  </Card>
}
