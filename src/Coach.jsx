import { useState } from 'react'
import { Card, Chip, Screen, Sheet } from './ui.jsx'
import LagExplorer from './LagExplorer.jsx'
import ShoeDegradation from './ShoeDegradation.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'
import { fmtShort } from './lib/calendar.js'

// ---- rich markdown (bold, inline code/citations, tables, numbered/bullet lists, paragraphs) — no raw HTML injection
const cleanId = (s) => String(s || '').replace(/\bbelum ditarik\b/gi, 'not yet extracted')
const inline = (t) => cleanId(t).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
  if (p.startsWith('**') && p.endsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>
  if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="md-code">{p.slice(1, -1)}</code>
  return p
})
const parseRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isTableSep = (line) => /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line)

export function Md({ text }) {
  const blocks = cleanId(text).split(/\n{2,}/)
  return <div className="md">{blocks.map((b, i) => {
    const lines = b.split('\n').filter((l) => l.trim().length > 0)
    if (!lines.length) return null
    if (lines.length >= 2 && lines.every((l) => /^\s*\|/.test(l)) && isTableSep(lines[1])) {
      const head = parseRow(lines[0]), body = lines.slice(2).filter((l) => !isTableSep(l)).map(parseRow)
      return <div key={i} className="scroll md-tbl-wrap"><table className="lapt md-tbl"><thead><tr>{head.map((h, c) => <th key={c}>{inline(h)}</th>)}</tr></thead><tbody>{body.map((r, ri) => <tr key={ri}>{r.map((cell, ci) => <td key={ci}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>
    }
    if (lines.every((l) => /^\s*[-*] /.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>)}</ul>
    if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) return <ol key={i} className="md-ol">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>)}</ol>
    if (/^#{1,3} /.test(b)) return <h3 key={i}>{inline(b.replace(/^#{1,3} /, ''))}</h3>
    return <p key={i}>{lines.map((l, j) => <span key={j}>{inline(l)}{j < lines.length - 1 && <br />}</span>)}</p>
  })}</div>
}
const f1 = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (+x).toFixed(d))
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%')
export const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lumpad': '1' }, body: JSON.stringify(body || {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j })
const PRIO = { now: ['red', 'now'], this_week: ['yellow', 'this week'], later: ['none', 'later'] }
const INTENTS = [['daily_brief', 'Today\'s brief'], ['weekly_review', 'Weekly review'], ['race_plan', 'Race plan'], ['question', 'Free question'], ['session_review', 'Session review']]

export function Result({ p, res }) {
  const wb = p?._writeback
  return <Card title="Result" right={<span className="muted">{res.model} · ¥{f1(res.cost_cny, 2)}</span>}>
    <p className="lead">{cleanId(p.summary)}</p>
    {p.flags?.length > 0 && <div className="chips">{p.flags.map((f, i) => <Chip key={i} tone={f.type === 'gate' || f.type === 'injury' ? 'red' : 'yellow'}>{cleanId(f.text)}</Chip>)}</div>}
    {p.recommendations?.length > 0 && <ol className="recs">{p.recommendations.map((r, i) => <li key={i}><div><Chip tone={PRIO[r.priority]?.[0]}>{PRIO[r.priority]?.[1] || r.priority}</Chip>{r.needs_athlete_ok && <Chip>needs your approval</Chip>}</div><b>{cleanId(r.action)}</b><small>{cleanId(r.why)}</small></li>)}</ol>}
    <details className="more" open><summary>Full analysis</summary><Md text={p.analysis_md} /></details>
    {wb && (wb.stored.length + wb.merged.length + wb.rejected.length > 0) && <p className="src-note">Memory: {wb.stored.length} new (awaiting confirmation) · {wb.merged.length} merged · {wb.rejected.length} rejected (numbers/citations not verified).</p>}
  </Card>
}

const Tiles = ({ items }) => <div className="score-grid">{items.map(([k, v, e], i) => <div key={i}><small>{k}</small><b>{v}</b>{e && <em>{e}</em>}</div>)}</div>

function Status({ st }) {
  const g = st?.guard, spendPct = g ? Math.min(100, Math.round((g.spend_cny / g.cap_cny) * 100)) : 0
  return <Card title="System status">
    {!st ? <p className="muted">Loading…</p> : <>
      <Tiles items={[['FIT sessions', st.counts.fit_sessions, 'analysed per second'], ['Weather', st.counts.weather, 'runs with weather'], ['KB docs', st.counts.kb_docs, 'imported'], ['Daily log', st.counts.daily_log, 'days logged']]} />
      <div className="bar" role="img" aria-label={`Coach usage ${spendPct}%`}><i style={{ width: spendPct + '%', background: spendPct >= 80 ? 'var(--red-t)' : 'var(--cobalt)' }} /></div>
      <p className="muted">Coach: {st.model?.name || 'not chosen yet'} · ¥{f1(g?.spend_cny, 2)} of ¥{g?.cap_cny} this month{g?.level === 'paused' ? ' · PAUSED' : g?.level === 'limited' ? ' · limited (≥80%)' : ''}{!st.key ? ' · API key not set' : ''}</p>
      <p className="src-note">Last job: {st.jobs[0] ? `${st.jobs[0].kind} · ${st.jobs[0].status}${st.jobs[0].finished_at ? ' · ' + new Date(st.jobs[0].finished_at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : ''}` : 'never run'}</p>
      <button className="btn" disabled={st.busy} onClick={() => post('/api/intel/run', { kind: 'full' }).then(() => location.reload())}>{st.busy ? 'Running…' : 'Run analysis now'}</button>
    </>}
  </Card>
}

function Ask({ st }) {
  const [intent, setIntent] = useState('daily_brief'), [q, setQ] = useState(''), [busy, setBusy] = useState(false), [res, setRes] = useState(null), [err, setErr] = useState(''), [showCtx, setShowCtx] = useState(false)
  const P = useApi(showCtx ? `/api/coach/preview?intent=${encodeURIComponent(intent)}&question=${encodeURIComponent(q)}` : '', showCtx)
  const run = () => { setBusy(true); setErr(''); setRes(null); post('/api/coach/run', { intent, question: q }).then(setRes).catch((e) => setErr(e.message)).finally(() => setBusy(false)) }
  const p = res?.parsed
  return <>
    <Card title="Ask the coach · Hybrid RAG" right={st?.model && <Chip>{st.model.name}</Chip>}>
      <div className="chiprow" role="group" aria-label="Analysis type">{INTENTS.map(([k, l]) => <button key={k} aria-pressed={intent === k} onClick={() => setIntent(k)}>{l}</button>)}</div>
      {intent === 'question' && <textarea className="ask" rows={3} value={q} placeholder="e.g. why did HR@8:00 rise this week, or how did leg day affect my GCT?" onChange={(e) => setQ(e.target.value)} maxLength={1000} aria-label="Question" />}
      <div className="row2" style={{ gap: 8 }}>
        <button className="btn primary" disabled={busy || (intent === 'question' && q.trim().length < 5) || st?.guard?.level === 'paused'} onClick={run}>{busy ? 'Coach is analysing… (±30–90 s)' : 'Run analysis'}</button>
        <button className="btn" onClick={() => setShowCtx((x) => !x)} aria-pressed={showCtx}>{showCtx ? 'Hide RAG payload' : 'Inspect RAG payload (free)'}</button>
      </div>
      {showCtx && P.data && <div className="mod" style={{ marginTop: 10, background: 'var(--surface2)' }}>
        <div className="chips" style={{ marginTop: 0 }}>
          <Chip tone="green">schema: {P.data.schema}</Chip>
          <Chip>~{P.data.tokens_est} tokens</Chip>
          <Chip>{P.data.rules_count} locked/active rules</Chip>
          <Chip>{P.data.episodes?.length || 0} episodic runs</Chip>
          <Chip>{P.data.facts?.length || 0} semantic facts</Chip>
        </div>
        <p className="muted" style={{ fontSize: '.78rem', margin: '6px 0' }}>Retrieved items injected into prompt (BM25 + RRF + MMR + 16-D kNN): {P.data.episodes?.map((e) => `[${e.id}] ${e.title}`).join(' · ')}</p>
      </div>}
      {st?.guard?.level === 'paused' && <p className="muted">Monthly cap reached — analyses still run, the coach is back on the 1st.</p>}
      {err && <p className="err" role="alert">{err}</p>}
    </Card>
    {res && !res.ok && <Card title="Invalid answer"><p className="muted">The model's answer failed validation; no memory was written. {res.errors?.[0]}</p></Card>}
    {p && <Result p={p} res={res} />}
  </>
}
function Recent() {
  const R = useApi('/api/coach/runs'), [open, setOpen] = useState(null), D = useApi(open ? `/api/coach/run?id=${open}` : '', !!open)
  if (!R.data?.length) return null
  return <Card title="Coach history">
    <div className="alist">{R.data.slice(0, 8).map((r) => <button key={r.id} className="arow" onClick={() => setOpen(r.id)}><div className="t"><b>{INTENTS.find((i) => i[0] === r.intent)?.[1] || r.intent}</b><small>{!r.ok && r.error ? <><span className="errline">{/max_tokens/.test(r.error) ? 'ran out of tokens while thinking — fixed, run it again' : r.error.slice(0, 80)}</span><br /></> : null}{new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {r.provider}{r.model ? ' · ' + r.model : ''}</small></div><div className="n"><Chip tone={r.ok ? 'green' : 'yellow'}>{r.ok ? 'ok' : 'failed'}</Chip></div></button>)}</div>
    <Sheet open={!!open} onClose={() => setOpen(null)} label="Coach detail">{D.data?.parsed ? <>
      <div className="chips"><Chip tone="str">{INTENTS.find((i) => i[0] === D.data.intent)?.[1] || D.data.intent}</Chip>{D.data.model && <Chip>{D.data.model}</Chip>}{D.data.cost_cny != null && <Chip>¥{f1(D.data.cost_cny, 2)}</Chip>}</div>
      <h2 className="sess-title">{INTENTS.find((i) => i[0] === D.data.intent)?.[1] || D.data.intent}</h2>
      <p className="lead">{cleanId(D.data.parsed.summary)}</p>
      {D.data.parsed.flags?.length > 0 && <div className="chips">{D.data.parsed.flags.map((f, i) => <Chip key={i} tone={f.type === 'gate' || f.type === 'injury' ? 'red' : 'yellow'}>{cleanId(f.text)}</Chip>)}</div>}
      {D.data.parsed.recommendations?.length > 0 && <ol className="recs">{D.data.parsed.recommendations.map((r, i) => <li key={i}><div><Chip tone={PRIO[r.priority]?.[0]}>{PRIO[r.priority]?.[1] || r.priority}</Chip>{r.needs_athlete_ok && <Chip>needs your approval</Chip>}</div><b>{cleanId(r.action)}</b><small>{cleanId(r.why)}</small></li>)}</ol>}
      <Md text={D.data.parsed.analysis_md} />
    </> : <p className="muted">{D.data?.error ? `Run did not complete: ${D.data.error}` : 'Loading…'}</p>}</Sheet>
  </Card>
}

// ---- Durability: the long-run scorecard + pooled km-by-km fade curves + opening HR cost diagnostic
function RunBars({ km }) {
  if (!km?.length) return null; const W = 300, H = 70, bw = W / Math.max(km.length, 1)
  return <svg viewBox={`0 0 ${W} ${H}`} className="runbars" role="img" aria-label="Run share per km">{km.map((k, i) => <rect key={i} x={i * bw + 0.5} width={Math.max(1, bw - 1.5)} y={H - H * (k.runShare ?? 0)} height={H * (k.runShare ?? 0)} rx="1.5" fill={k.runShare >= 0.9 ? 'var(--green)' : k.runShare >= 0.6 ? 'var(--yellow)' : 'var(--red)'} />)}</svg>
}

const FADE_BUCKETS = [['long90', '≥16 km (90d)'], ['10k', '8–13 km'], ['hm', 'Half (19–24 km)'], ['25_35', '25–37 km'], ['fm', 'Marathon (≥37 km)']]
function FadeCurveCard({ twin }) {
  const [bucket, setBucket] = useState('long90')
  if (!twin) return null
  const fc = twin.fade_curves || {}, d = twin.durability || {}
  const raw = bucket === 'long90'
    ? (d.run_share_by_km || []).map((x) => ({ km: x.km, v: x.run_share, n: x.n }))
    : (fc[bucket]?.run_share || []).map((x) => ({ km: x.km, v: x.v, n: fc[bucket]?.n }))
  const W = 320, H = 96, bw = W / Math.max(raw.length, 1)
  const y90 = H - H * 0.9
  return <Card title="Pooled km-by-km durability decay curve" right={<Chip>{bucket === 'long90' ? `${d.long_runs_90d || 0} long runs` : `n=${fc[bucket]?.n || 0}`}</Chip>}>
    <div className="chiprow" role="group" aria-label="Distance bucket">{FADE_BUCKETS.map(([k, l]) => <button key={k} aria-pressed={bucket === k} onClick={() => setBucket(k)}>{l}</button>)}</div>
    {!raw.length ? <p className="muted">No FIT sessions in this distance bucket yet.</p> : <>
      <svg viewBox={`0 0 ${W} ${H}`} className="runbars" style={{ height: 96 }} role="img" aria-label="Pooled run share per km">
        <line x1="0" x2={W} y1={y90} y2={y90} stroke="var(--cobalt)" strokeWidth="1" strokeDasharray="3 3" />
        {raw.map((k, i) => <rect key={k.km} x={i * bw + 0.6} width={Math.max(1.5, bw - 1.6)} y={H - H * (k.v ?? 0)} height={H * (k.v ?? 0)} rx="1.5" fill={k.v >= 0.9 ? 'var(--green)' : k.v >= 0.65 ? 'var(--yellow)' : 'var(--red)'} />)}
      </svg>
      <div className="score-grid">
        <div><small>Durability ceiling</small><b>{d.durability_km ? `km ${d.durability_km}` : '—'}</b><em>drops &lt; 90% run share</em></div>
        <div><small>Continuous run (90d)</small><b>{d.longest_continuous_run_km ?? '—'} km</b><em>30d: {d.longest_continuous_run_km_30d ?? '—'} km</em></div>
        <div><small>Median fade onset</small><b>{d.fade_onset_km_median_90d ? `km ${d.fade_onset_km_median_90d}` : '—'}</b><em>GCT {d.gct_fade_ms_median_90d ?? '—'} ms</em></div>
      </div>
      <p className="src-note">Dashed line = 90% continuous running threshold. Green ≥ 90% running, amber 65–89%, crimson &lt; 65% (run-walk collapse).</p>
    </>}
  </Card>
}

function Durability() {
  const L = useApi('/api/intel/longruns'), T = useApi('/api/twin'), [sel, setSel] = useState(null), S = useApi(sel ? `/api/intel/session?id=${sel}` : '', !!sel), s = S.data
  const rows = L.data || []
  return <>
    <FadeCurveCard twin={T.data?.state} />
    <Card title="Opening cost vs. durability · runs ≥ 16 km"><p className="muted">The share of time actually running (not walking/stopped). Notice how sessions with a lower opening HR and lower HR@8:00 preserve higher EF and delay fade onset [Rule 9].</p>
      {L.state === 'ok' && !rows.length && <p className="muted">No runs ≥ 16 km with a FIT file yet. Older FIT files are still downloading gradually (40 per day).</p>}</Card>
    <div className="alist">{rows.map((r) => <button key={r.label_id} className="arow" onClick={() => setSel(r.label_id)} aria-label={`Run ${r.date} ${f1(r.distance_m / 1000)} km, run share ${pct(r.run_share)}`}>
      <div className="t"><b>{fmtShort(r.date)} · {f1(r.distance_m / 1000)} km</b><small>onset km {r.onset_km ?? '—'} · EF {f1(r.ef, 3)} · HR@8:00 {r.hr800 ?? '—'}{r.wbgt != null ? ` · WBGT ${f1(r.wbgt)}°C` : ''}</small>
        <div className="bar" aria-hidden="true"><i style={{ width: pct(r.run_share), background: r.run_share >= 0.9 ? 'var(--green)' : r.run_share >= 0.6 ? 'var(--yellow)' : 'var(--red)' }} /></div></div>
      <div className="n"><b>{pct(r.run_share)}</b><small>running</small></div></button>)}</div>
    <Sheet open={!!sel} onClose={() => setSel(null)} label="Session detail">
      {S.state === 'loading' && <div className="skel" style={{ height: 120 }} />}
      {s?.found && <><p className="muted">{s.date}</p><h2 className="sess-title">{f1(s.distance_m / 1000, 2)} km · {fmtDur(s.elapsed_s)}</h2>
        <Tiles items={[['Run share', pct(s.run_share)], ['EF', f1(s.ef, 3), 'km/h per bpm'], ['Drift', s.drift_pahr != null ? f1(s.drift_pahr) + '%' : s.run_drift != null ? f1(s.run_drift) + '% (run)' : '—', s.metrics.drift_pahr?.why || ''], ['Onset fade', s.onset_km ? 'km ' + s.onset_km : 'none', s.metrics.fade_onset?.trigger],
          ['GCT fade', s.gct_fade != null ? f1(s.gct_fade, 0) + ' ms' : '—', 'end vs start'], ['Stride', s.stride_fade != null ? f1(s.stride_fade, 3) + ' m' : '—'], ['HR@8:00', s.hr800 ?? '—', s.hr800 ? `z ${f1((s.hr800 - 143.1) / 5)}` : ''], ['Economy', f1(s.economy_jm), 'J/m']]} />
        <RunBars km={s.km} /><p className="src-note">Each bar = 1 km: green ≥ 90% running, yellow ≥ 60%, red below that.</p>
        {s.weather && !s.weather.indoor && <p className="muted">Weather: {s.weather.temp_c}°C · RH {s.weather.rh}% · WBGT≈{s.weather.wbgt} [calc]</p>}
        {s.card && <details className="more"><summary>Episode card (memory)</summary><pre className="card-pre">{s.card}</pre></details>}</>}
    </Sheet>
  </>
}

// ---- Twin Evolution & Version Diff Explorer
function TwinHistory() {
  const H = useApi('/api/twin/history'), rows = H.data || []
  const [va, setVa] = useState(null), [vb, setVb] = useState(null)
  const a = va ?? rows[1]?.version, b = vb ?? rows[0]?.version
  const D = useApi(a && b && a !== b ? `/api/twin/diff?a=${a}&b=${b}` : '', !!(a && b && a !== b))
  if (rows.length < 2) return null
  const diffEntries = Object.entries(D.data?.diff || {}).slice(0, 12)
  return <Card title="Digital Twin version history & diff" right={<Chip>v{rows[0].version}</Chip>}>
    <div className="form two" style={{ marginBottom: 8 }}>
      <label className="fld"><span>Compare baseline</span><select value={a || ''} onChange={(e) => setVa(+e.target.value)}>{rows.map((r) => <option key={r.version} value={r.version}>v{r.version} · {r.as_of} ({r.trigger})</option>)}</select></label>
      <label className="fld"><span>Against target</span><select value={b || ''} onChange={(e) => setVb(+e.target.value)}>{rows.map((r) => <option key={r.version} value={r.version}>v{r.version} · {r.as_of} ({r.trigger})</option>)}</select></label>
    </div>
    {diffEntries.length > 0 ? <div className="scroll" tabIndex={0} role="region" aria-label="Scrollable table"><table className="lapt"><thead><tr><th>Twin field</th><th>v{a}</th><th>v{b}</th></tr></thead><tbody>
      {diffEntries.map(([path, d]) => <tr key={path}><td><code className="md-code">{path}</code></td><td className="muted">{String(d.from ?? '—')}</td><td><b>{String(d.to ?? '—')}</b></td></tr>)}
    </tbody></table></div> : <p className="muted">No scalar field differences between v{a} and v{b}.</p>}
  </Card>
}

// ---- 4 Named Multi-Lag Physiological Correlation Matrices (Blueprint §6)
function CorrelationMatrices() {
  const M = useApi('/api/intel/matrices'), d = M.data
  if (!d) return null
  return <Card title="Multi-context physiological correlation matrices" right={<Chip>{d.sessions} FIT sessions</Chip>}>
    <h3 style={{ fontSize: '.84rem', margin: '4px 0 6px' }}>1. Gym-to-stride impact (runs 24–72 h after a gym session vs fresh legs)</h3>
    <div className="scroll" tabIndex={0} role="region" aria-label="Scrollable table"><table className="lapt">
      <thead><tr><th>Condition (runs ≥5 km)</th><th>n</th><th>Mean EF</th><th>Pa:HR drift</th><th>GCT fade</th><th>Stride Δ</th></tr></thead>
      <tbody>{(d.gym_to_stride || []).map((r) => <tr key={r.grp}>
        <td><b>{r.grp === 'post_gym_72h' ? 'Within 72 h of a gym session' : 'Fresh legs (no gym in 72 h)'}</b></td>
        <td>{r.n}</td><td>{r.ef}</td><td>{r.drift != null ? r.drift + '%' : '—'}</td><td>{r.gct_fade != null ? (r.gct_fade > 0 ? '+' : '') + r.gct_fade + ' ms' : '—'}</td><td>{r.stride_fade != null ? r.stride_fade + ' m' : '—'}</td>
      </tr>)}</tbody>
    </table></div>

    <h3 style={{ fontSize: '.84rem', margin: '12px 0 6px' }}>2. Z2 aerobic discipline vs. intensity creep (&gt;148 bpm ceiling on runs ≤15 km)</h3>
    <div className="scroll" tabIndex={0} role="region" aria-label="Scrollable table"><table className="lapt">
      <thead><tr><th>Zone regime</th><th>n</th><th>Mean HR</th><th>Mean EF</th><th>Pa:HR drift</th><th>GCT fade</th></tr></thead>
      <tbody>{(d.z2_discipline || []).map((r) => <tr key={r.zone}>
        <td><Chip tone={r.zone === 'z2_disciplined' ? 'green' : 'yellow'}>{r.zone === 'z2_disciplined' ? 'Z2 disciplined (≤148 bpm)' : 'Intensity creep (>148 bpm)'}</Chip></td>
        <td>{r.n}</td><td>{r.avg_hr} bpm</td><td><b>{r.ef}</b></td><td>{r.drift != null ? r.drift + '%' : '—'}</td><td>{r.gct_fade != null ? (r.gct_fade > 0 ? '+' : '') + r.gct_fade + ' ms' : '—'}</td>
      </tr>)}</tbody>
    </table></div>

    <h3 style={{ fontSize: '.84rem', margin: '12px 0 6px' }}>3. Outdoor vs indoor (treadmill) runs</h3>
    <div className="scroll" tabIndex={0} role="region" aria-label="Scrollable table"><table className="lapt">
      <thead><tr><th>Modality tag</th><th>n</th><th>Avg km</th><th>Mean EF</th><th>Mean run HR</th></tr></thead>
      <tbody>{(d.modalities || []).map((r) => <tr key={r.modality}>
        <td><code className="md-code">#{r.modality}</code></td><td>{r.n}</td><td>{r.avg_km} km</td><td>{r.ef}</td><td>{r.avg_hr} bpm</td>
      </tr>)}</tbody>
    </table></div>
    <p className="src-note">[MEASURED] Observational within-athlete matrices across {d.sessions} 1-Hz FIT sessions. Z2 aerobic ceiling 148 bpm. Differences are associations, not proof of cause.</p>
  </Card>
}

// ---- Twin
function Twin({ go }) {
  const T = useApi('/api/twin'), t = T.data?.state
  if (T.state === 'loading') return <div className="skel" style={{ height: 140 }} />
  if (!t) return <Card title="Digital Twin"><p className="muted">Not built yet. Press “Run analysis now” in the Coach tab.</p></Card>
  const L = t.load, A = t.aerobic, D = t.durability, H = t.heat, P = t.projection
  const kmGuard = L.km_vs_4wk_avg_pct == null ? ['none', '—'] : L.km_vs_4wk_avg_pct > 10 ? ['red', `+${L.km_vs_4wk_avg_pct}% (limit +10%)`] : ['green', `${L.km_vs_4wk_avg_pct > 0 ? '+' : ''}${L.km_vs_4wk_avg_pct}%`]
  const gapAction = (g) => {
    if (/shoe/i.test(g)) return ['Assign in Activities', () => go && go('activity')]
    if (/pain log/i.test(g)) return ['Log morning check-in', () => go && go('ready')]
    if (/FIT file|weather/i.test(g)) return ['Check COROS archive', () => go && go('profile')]
    return null
  }
  return <>
    <Card title="Load guard" right={<Chip tone={kmGuard[0]}>{kmGuard[0] === 'red' ? 'exceeded' : kmGuard[0] === 'green' ? 'safe' : 'no data yet'}</Chip>}>
      <Tiles items={[['Km vs 4-week average', kmGuard[1], 'rule ≤ +10%'], ['Longest run 30 d', f1(L.longest_run_km_30d) + ' km', 'LR ≤ 110% of this'], ['CTL / ATL / TSB', `${f1(L.ctl, 0)} / ${f1(L.atl, 0)} / ${f1(L.tsb, 0)}`], ['ACWR', f1(L.acwr_ewma, 2), `COROS ${f1(L.coros_ratio, 2)}`]]} />
      <p className="src-note">After Borobudur, the 15 Nov load spike makes the ratio temporarily high — not a progression signal.</p></Card>
    <Card title="Aerobic"><Tiles items={[['HR@8:00 (28 d)', f1(A.hr_at_800.value), A.hr_at_800.n ? `z ${f1(A.hr_at_800.z)} · n=${A.hr_at_800.n}` : 'no steady run yet'], ['Baseline', '143.1 ± 5.0', 'Jan–Sep 2026'], ['EF easy 28 d', f1(A.ef_easy_28d.value, 3), `n=${A.ef_easy_28d.n}`], ['Pace@HR150', A.pace_at_hr150.value ? fmtPaceS(A.pace_at_hr150.value) : '—', `n=${A.pace_at_hr150.n}`]]} /></Card>
    <Card title="Durability (90 days)"><Tiles items={[['Runs ≥ 16 km', D.long_runs_90d], ['Longest continuous run', D.longest_continuous_run_km + ' km', '≥ 90% running'], ['Durability km', D.durability_km ?? '—', 'run share < 90%'], ['Onset fade median', D.fade_onset_km_median_90d ?? '—', 'km']]} /></Card>
    <Card title="Heat">{H.hr_cost_bpm_per_c ? <Tiles items={[['HR cost', `${H.hr_cost_bpm_per_c.value} bpm/°C`, `CI ${H.hr_cost_bpm_per_c.ci.join(' … ')}`], ['EF cost', f1(H.ef_cost_per_c.value, 4) + '/°C'], ['Sample', H.n, `WBGT ${H.wbgt_range?.join('–')}`]]} /> : <p className="muted">{H.note || 'Waiting for weather data.'} (n={H.n ?? 0})</p>}</Card>
    <Card title="Shoes (OLS + 200-bootstrap EF residual)"><table className="lapt"><thead><tr><th>Shoe</th><th>km</th><th>n</th><th>ΔEF / 100 km</th><th>Status</th></tr></thead><tbody>{t.shoes.filter((s) => !s.retired || s.n).slice(0, 7).map((s) => <tr key={s.gear_id}><td>{s.name}</td><td>{s.km}</td><td>{s.n}</td><td>{s.ef_resid_per_100km != null ? `${s.ef_resid_per_100km > 0 ? '+' : ''}${s.ef_resid_per_100km} (${s.ci_per_100km?.join('…')})` : '—'}</td><td><small className="muted">{s.flag}</small></td></tr>)}</tbody></table>
      <p className="src-note">Only scored when n ≥ 8 steady FIT runs per shoe; controls for pace, WBGT/temperature, and duration.</p></Card>
    <CorrelationMatrices />
    <Card title="Sub-4:00 projection [MODEL]"><p className="muted">Illustrative scenarios based on the stated assumptions — not a prediction. The marathon realisation ratio is the biggest factor (observed 0.59, n=1).</p>
      <table className="lapt"><thead><tr><th>Scenario</th><th>Median</th><th>P(&lt;4:00)</th></tr></thead><tbody>{P.scenarios.map((s) => <tr key={s.name}><td>{s.name}</td><td>{fmtDur(s.fm_time_p10_p50_p90[1])}</td><td><b>{pct(s.p_sub4)}</b></td></tr>)}</tbody></table>
      <p className="src-note">Needs a VDOT gain of ≥ {P.required_gain_per_month['ratio 0.95']}/month (ratio 0.95) or ≥ {P.required_gain_per_month['ratio 0.90']}/month (ratio 0.90). {P.months_to_race} months to the race.</p></Card>
    <TwinHistory />
    {t.data_gaps?.length > 0 && <Card title="Data hygiene & actionable gaps" right={<Chip tone="yellow">{t.data_gaps.length} open</Chip>}><div className="scalelist">{t.data_gaps.map((g, i) => {
      const act = gapAction(g)
      return <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: 'var(--surface2)' }}>
        <span style={{ fontSize: '.86rem' }}>{g}</span>
        {act && go && <button className="btn sm" onClick={act[1]}>{act[0]} →</button>}
      </div>
    })}</div></Card>}
  </>
}

const SEMANTIC_TAGS = [
  ['all', 'All episodes'],
  ['#z2_disciplined', '#z2_disciplined'],
  ['#intensity_creep', '#intensity_creep'],
  ['#cardiac_drift_high', '#cardiac_drift_high'],
  ['#gct_stable', '#gct_stable'],
  ['#early_fade', '#early_fade'],
  ['#leg_day_72h', '#leg_day_72h'],
  ['#road_tmii', '#road_tmii'],
  ['#treadmill_bodimax', '#treadmill_bodimax'],
]

// ---- Memory & correlations
function Memory() {
  const [tick, setTick] = useState(0), [tag, setTag] = useState('all')
  const C = useApi(`/api/memory?status=candidate&limit=30&_=${tick}`), P = useApi(`/api/memory?status=proposal&limit=30&_=${tick}`)
  const Ep = useApi('/api/memory?tier=episodic&status=active&limit=60'), E = useApi('/api/intel/edges')
  const act = (id, action) => post('/api/memory/action', { id, action }).then(() => setTick((x) => x + 1)).catch((e) => alert(e.message))
  const Item = ({ m }) => <div className="memitem"><b>{cleanId(m.title)}</b><small>{cleanId(m.body)}</small><div className="chips"><Chip>{m.tier}</Chip><Chip>{m.evidence_tag}</Chip><Chip>×{m.n}</Chip></div>
    <div className="seg" role="group" aria-label="Actions"><button onClick={() => act(m.id, 'approve')}>Approve</button><button onClick={() => act(m.id, 'retract')}>Reject</button></div></div>
  const episodes = (Ep.data || []).filter((e) => tag === 'all' || (e.body || '').includes(tag))
  return <>
    <Card title="Awaiting confirmation" right={<Chip>{(C.data?.length || 0) + (P.data?.length || 0)}</Chip>}><p className="muted">Coach findings are stored as hypotheses. Only those you approve (or that repeat 3×) become active. Locked rules cannot be changed by the coach.</p>
      {[...(P.data || []), ...(C.data || [])].map((m) => <Item key={m.id} m={m} />)}{C.state === 'ok' && P.state === 'ok' && !C.data.length && !P.data.length && <p className="muted">Nothing is waiting.</p>}</Card>
    <Card title="Episodic memory cards · semantic tag filter" right={<Chip>{episodes.length} matched</Chip>}>
      <div className="chiprow" role="group" aria-label="Semantic tag filter">{SEMANTIC_TAGS.map(([k, l]) => <button key={k} aria-pressed={tag === k} onClick={() => setTag(k)}>{l}</button>)}</div>
      {episodes.slice(0, 8).map((e) => <details key={e.id} className="more"><summary><b>[{e.id}] {e.title}</b> · <span className="muted">{e.valid_from}</span></summary><pre className="card-pre">{e.body}</pre></details>)}
    </Card>
    <Card title="Correlations (association, not cause)">{E.state === 'ok' && !E.data.length ? <p className="muted">No single lag window has crossed Benjamini–Hochberg FDR q &lt; 0.10 yet; inspect the 4 Multi-Context Physiological Matrices and Lag Explorer in the Twin tab.</p> :
      (E.data || []).map((e) => <div key={e.id} className="memitem"><b>{e.exposure} → {e.outcome}</b><small>{e.lag_lo}–{e.lag_hi} days before the run · partial ρ {e.partial_rho} (CI {e.ci_lo}…{e.ci_hi}) · n={e.n} · q={e.q}</small><div className="chips"><Chip tone={e.status === 'supported' ? 'green' : 'yellow'}>{e.status === 'supported' ? 'supported' : e.status === 'candidate' ? 'candidate' : e.status}</Chip></div></div>)}</Card>
  </>
}

const SECTIONS = [['cs-ask', 'Ask the coach'], ['cs-twin', 'Digital Twin & Monte Carlo'], ['cs-lag', 'Lag explorer'], ['cs-mem', 'Memory & rules'], ['cs-dur', 'Durability'], ['cs-shoe', 'Shoe fleet'], ['cs-sys', 'System']]
const jumpTo = (id) => () => { const el = document.getElementById(id); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.focus({ preventScroll: true }) }
export default function Coach({ go }) {
  const st = useApi('/api/intel/status')
  return <Screen title="AI Coach, Digital Twin & Validated Rules" sub="Hybrid RAG · Digital Twin · athlete memory · every module on one page">
    <nav className="chipjump" aria-label="Jump to section">{SECTIONS.map(([id, l]) => <button key={id} onClick={jumpTo(id)}>{l}</button>)}</nav>
    <div id="cs-ask" tabIndex={-1} className="rgrid coachtop"><Ask st={st.data} /><Recent /></div>
    <div id="cs-twin" tabIndex={-1}><Twin go={go} /></div>
    <div id="cs-lag" tabIndex={-1}><LagExplorer /></div>
    <div id="cs-mem" tabIndex={-1}><Memory /></div>
    <div id="cs-dur" tabIndex={-1}><Durability /></div>
    <div id="cs-shoe" tabIndex={-1}><ShoeDegradation /></div>
    <div id="cs-sys" tabIndex={-1}><Status st={st.data} /></div>
  </Screen>
}

export function HomeCoach({ go }) {
  const R = useApi('/api/coach/runs'), T = useApi('/api/twin'), t = T.data?.state
  const brief = (R.data || []).find((r) => r.intent === 'daily_brief' && r.ok && r.created_at.slice(0, 10) >= new Date(Date.now() - 20 * 3600e3).toISOString().slice(0, 10)), B = useApi(brief ? `/api/coach/run?id=${brief.id}` : '', !!brief)
  const g = t?.load?.km_vs_4wk_avg_pct, sc = t?.projection?.scenarios
  const lastRun = (R.data || []).find((r) => r.ok), model = lastRun?.provider || lastRun?.model || null
  return <div className="card coachcard">
    <div className="ch"><h2><i className="cdot" aria-hidden="true" />AI Coach daily brief</h2><span className="chips" style={{ margin: 0 }}>{model && <Chip>{String(model).slice(0, 22)}</Chip>}<Chip tone={brief ? 'green' : undefined}>{brief ? 'Active brief' : 'no brief yet'}</Chip></span></div>
    {B.data?.parsed ? <p className="lead">{cleanId(B.data.parsed.summary)}</p> : <p className="muted">{t ? 'No brief today yet — generated automatically after the morning sync, or request one manually in the Coach tab.' : 'The Digital Twin is not built yet — run the intelligence pipeline first.'}</p>}
    {t && <div className="chips">
      {g != null && <Chip tone={g > 10 ? 'red' : 'green'}>Km vs 4 wk: {g > 0 ? '+' : ''}{g}% (limit +10%)</Chip>}
      {sc && <Chip>Sub-4: {pct(sc[0].p_sub4)} · {pct(sc[1].p_sub4)} · {pct(sc[2].p_sub4)} [MODEL]</Chip>}
    </div>}
    <div className="coachq" role="group" aria-label="Ask the coach">{[['Morning brief', 'daily_brief'], ['Run review', 'activity_review'], ['Weekly review', 'weekly_review'], ['Race strategy', 'race_strategy']].map(([l, k]) => <button key={k} onClick={() => go('coach', { intent: k })}>{l}</button>)}</div>
    <button className="link coachgo" onClick={() => go('coach')}>Open AI Coach →</button>
  </div>
}
