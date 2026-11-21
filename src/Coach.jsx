import { useEffect, useState } from 'react'
import { useSub } from './useSub.js'
import { Card, Chip, Sheet, SegmentedTabs, StatusPill, ProvenanceBadge } from './ui.jsx'
import LagExplorer from './LagExplorer.jsx'
import ShoeDegradation from './ShoeDegradation.jsx'
import KnowledgeGraphPanel from './KnowledgeGraph.jsx'
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
const pace = (x) => (x == null ? '—' : `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`)
const sgn = (x, d = 1) => (x == null ? '—' : (x > 0 ? '+' : '') + (+x).toFixed(d))
export const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lumpad': '1' }, body: JSON.stringify(body || {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j })
const PRIO = { now: ['red', 'now'], this_week: ['yellow', 'this week'], later: ['none', 'later'] }
const INTENTS = [['daily_brief', "Today's brief"], ['weekly_review', 'Weekly review'], ['race_plan', 'Race strategy'], ['session_review', 'Session review'], ['question', 'Free question']]

export function Result({ p, res }) {
  const wb = p?._writeback
  return <Card title="Coach output" right={<span className="muted">{res.model} · ¥{f1(res.cost_cny, 2)}</span>}>
    <p className="lead">{cleanId(p.summary)}</p>
    {p.flags?.length > 0 && <div className="chips">{p.flags.map((f, i) => <Chip key={i} tone={f.type === 'gate' || f.type === 'injury' ? 'red' : 'yellow'}>{cleanId(f.text)}</Chip>)}</div>}
    {p.recommendations?.length > 0 && <ol className="recs">{p.recommendations.map((r, i) => <li key={i}><div><Chip tone={PRIO[r.priority]?.[0]}>{PRIO[r.priority]?.[1] || r.priority}</Chip>{r.needs_athlete_ok && <Chip>needs your approval</Chip>}</div><b>{cleanId(r.action)}</b><small>{cleanId(r.why)}</small></li>)}</ol>}
    {p.twin_state_patch && Object.values(p.twin_state_patch).some((x) => x != null && x !== '') && <div className="mod yellow"><b>Suggested twin updates (not applied — check before acting)</b>
      <ul className="rules">{p.twin_state_patch.current_ef_baseline != null && <li>EF baseline → {p.twin_state_patch.current_ef_baseline}</li>}{p.twin_state_patch.shoe_alert && <li>Shoe: {cleanId(p.twin_state_patch.shoe_alert)}</li>}{p.twin_state_patch.readiness_modifier && <li>Readiness: {cleanId(p.twin_state_patch.readiness_modifier)}</li>}</ul></div>}
    <details className="more" open><summary>Full analysis</summary><Md text={p.analysis_md} /></details>
    {wb && (wb.stored.length + wb.merged.length + wb.rejected.length > 0) && <p className="src-note">Memory: {wb.stored.length} new (awaiting confirmation) · {wb.merged.length} merged · {wb.rejected.length} rejected (numbers/citations not verified).</p>}
  </Card>
}

const Tiles = ({ items }) => <div className="score-grid">{items.map(([k, v, e], i) => <div key={i}><small>{k}</small><b>{v}</b>{e && <em>{e}</em>}</div>)}</div>

const INTENT_ALIAS = { activity_review: 'session_review', race_strategy: 'race_plan' }
function Ask({ st, initIntent }) {
  const [intent, setIntent] = useState(() => INTENT_ALIAS[initIntent] || initIntent || 'daily_brief')
  const [q, setQ] = useState(''), [busy, setBusy] = useState(false), [res, setRes] = useState(null), [err, setErr] = useState(''), [showCtx, setShowCtx] = useState(false)
  useEffect(() => { if (initIntent) setIntent(INTENT_ALIAS[initIntent] || initIntent) }, [initIntent])
  const P = useApi(showCtx ? `/api/coach/preview?intent=${encodeURIComponent(intent)}&question=${encodeURIComponent(q)}` : '', showCtx)
  const run = () => { setBusy(true); setErr(''); setRes(null); post('/api/coach/run', { intent, question: q }).then(setRes).catch((e) => setErr(e.message)).finally(() => setBusy(false)) }
  const p = res?.parsed
  return <div>
    <Card title="Ask AI Coach & Physiological Consultation" right={st?.model && <Chip>{st.model.name}</Chip>}>
      <div className="chiprow" role="group" aria-label="Analysis type">{INTENTS.map(([k, l]) => <button key={k} aria-pressed={intent === k} onClick={() => setIntent(k)}>{l}</button>)}</div>
      <textarea className="ask" rows={intent === 'question' ? 3 : 2} value={q} placeholder={intent === 'question' ? 'e.g. why did GCT drift on long runs in October after leg day, compared with Borobudur 2026?' : 'Optional focus — dates, a race, a shoe, a distance or an HR limit narrow what the coach retrieves'} onChange={(e) => setQ(e.target.value)} maxLength={1000} aria-label="Question" />
      <div className="row2" style={{ gap: 8 }}>
        <button className="btn primary" disabled={busy || (intent === 'question' && q.trim().length < 5) || st?.guard?.level === 'paused'} onClick={run}>{busy ? 'Coach is analysing… (±30–90 s)' : 'Run Prompt'}</button>
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
        {P.data.query && (P.data.query.topics?.length > 0 || Object.keys(P.data.query.filters || {}).length > 0) && <div className="chips"><Chip tone="str">query decomposition</Chip>{Object.entries(P.data.query.filters).map(([k, v]) => <Chip key={k}>{k}: {Array.isArray(v) ? v.join('–') : String(v)}</Chip>)}{P.data.query.topics.slice(0, 6).map((t) => <Chip key={t}>#{t}</Chip>)}</div>}
        {P.data.telemetry?.length > 0 && <p className="muted" style={{ fontSize: '.78rem', margin: '6px 0' }}>Exact km splits attached: {P.data.telemetry.map((t) => `${t.date} (${t.km} km, ${t.splits} splits)`).join(' · ')} · correlation edges: {P.data.edges}</p>}
        <p className="muted" style={{ fontSize: '.78rem', margin: '6px 0' }}>Retrieved items injected into prompt (SQL filters + BM25 + RRF + MMR + 16-D kNN): {P.data.episodes?.map((e) => `[${e.id}] ${e.title}${e.why && e.why !== 'recent' ? ' (' + e.why + ')' : ''}`).join(' · ')}</p>
      </div>}
      {st?.guard?.level === 'paused' && <p className="muted">Monthly cap reached — analyses still run, the coach is back on the 1st.</p>}
      {err && <p className="err" role="alert">{err}</p>}
    </Card>
    {res && !res.ok && <Card title="Invalid answer"><p className="muted">The model's answer failed validation; no memory was written. {res.errors?.[0]}</p></Card>}
    {p && <Result p={p} res={res} />}
  </div>
}

// ---- 4 Digital Twin Pillar KPI cards (beside Ask the Coach)
function TwinPillars({ twin }) {
  const t = twin?.state
  if (!t) return <div className="twin-pillars"><div className="kpi"><small>Digital Twin</small><b>—</b><em>Press “Run analysis” to build</em></div></div>
  const L = t.load || {}, A = t.aerobic || {}, D = t.durability || {}, H = t.heat || {}
  const kmVal = L.km_vs_4wk_avg_pct
  const kmExceeded = kmVal != null && kmVal > 10
  return <div className="twin-pillars">
    <div className={`kpi ${kmExceeded ? 'kpi-warn' : ''}`}>
      <div className="kpi-top"><small style={{ color: kmExceeded ? 'var(--red-t)' : 'var(--green-t)', fontWeight: 700, textTransform: 'uppercase' }}>Load Guard</small><Chip tone={kmVal == null ? undefined : kmExceeded ? 'red' : 'green'}>{kmVal == null ? 'no data' : kmExceeded ? 'exceeded' : 'safe'}</Chip></div>
      <b>{kmVal != null ? `${kmVal > 0 ? '+' : ''}${kmVal}%` : '—'}<span className="u"> vs 4-wk</span></b>
      <em>30d longest {f1(L.longest_run_km_30d)} km · CTL/ATL/TSB {f1(L.ctl, 0)}/{f1(L.atl, 0)}/{f1(L.tsb, 0)} · ACWR {f1(L.acwr_ewma, 2)}</em>
    </div>
    <div className="kpi">
      <div className="kpi-top"><small style={{ color: 'var(--cobalt-t)', fontWeight: 700, textTransform: 'uppercase' }}>Aerobic (28d)</small><Chip>n={A.hr_at_800?.n ?? 0}</Chip></div>
      <b>{f1(A.hr_at_800?.value)}<span className="u"> bpm @8:00</span></b>
      <em>Baseline 143.1 ± 5.0 · EF {f1(A.ef_easy_28d?.value, 3)} · Pace@HR150 {A.pace_at_hr150?.value ? fmtPaceS(A.pace_at_hr150.value) : '—'}</em>
    </div>
    <div className="kpi">
      <div className="kpi-top"><small style={{ color: 'var(--green-t)', fontWeight: 700, textTransform: 'uppercase' }}>Durability (90d)</small><Chip>{D.long_runs_90d ?? 0} ≥16k</Chip></div>
      <b>{D.longest_continuous_run_km ?? '—'} km<span className="u"> continuous</span></b>
      <em>Ceiling {D.durability_km ? `km ${D.durability_km}` : '—'} (&lt;90% run share) · Median fade {D.fade_onset_km_median_90d ? `km ${D.fade_onset_km_median_90d}` : '—'}</em>
    </div>
    <div className="kpi">
      <div className="kpi-top"><small style={{ color: 'var(--amber-t)', fontWeight: 700, textTransform: 'uppercase' }}>Heat Adaptation</small><Chip>n={H.n ?? 0}</Chip></div>
      <b>{H.hr_cost_bpm_per_c ? `${H.hr_cost_bpm_per_c.value}` : '—'}<span className="u">{H.hr_cost_bpm_per_c ? ' bpm/°C' : ''}</span></b>
      <em>{H.hr_cost_bpm_per_c ? `EF ${f1(H.ef_cost_per_c?.value, 4)}/°C · WBGT ${H.wbgt_range?.join('–')}°C` : (H.note || 'Waiting for weather pairs')}</em>
    </div>
  </div>
}

// ---- Sub-4 Readiness Ranges (P10-P90) & Adaptive Coach Decision Ledger (v2 Phase 5)
function Sub4AdaptiveCard({ twin }) {
  const s4 = useApi('/api/v2/sub4')
  const dec = useApi('/api/v2/decisions')
  const ranges = s4.data?.ranges || []
  const decisions = dec.data?.decisions || []
  const vNow = s4.data?.vdot_current ?? twin?.state?.profile?.vdot ?? 31.7
  const vNeed = s4.data?.vdot_needed ?? 39.9
  return (
    <Card title="Sub-4 Readiness Ranges (P10–P90) &amp; Adaptive Coach Loop" right={<span className="chips" style={{ margin: 0 }}><ProvenanceBadge type="MODEL" /><Chip tone="cobalt">VDOT {Number(vNow).toFixed(1)} → {vNeed}</Chip></span>}>
      {ranges.length > 0 ? (
        <div className="scroll" tabIndex={0}><table className="lapt">
          <thead><tr><th>Race Target</th><th>P10 (Fast)</th><th>P50 (Median)</th><th>P90 (Safe)</th><th>Primary Limiter</th><th>Confidence</th></tr></thead>
          <tbody>{ranges.map((r) => (
            <tr key={r.race_name}>
              <td><b>{r.race_name}</b></td>
              <td className="cmp-good">{r.p10_hms}</td>
              <td><b>{r.p50_hms}</b></td>
              <td className="muted">{r.p90_hms}</td>
              <td>{r.limiter}</td>
              <td><StatusPill tone={r.confidence === 'high' ? 'green' : r.confidence === 'moderate' ? 'cobalt' : 'amber'}>{r.confidence}</StatusPill></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>Sub-4 P10–P90 engine ready on <code>lumpadd serve</code> (:8788). Current VDOT gap: <b>+{(vNeed - Number(vNow)).toFixed(1)}</b> (durability &gt;20K is primary limiter).</p>
      )}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Chip>Phase 5 Decision Ledger: {decisions.length} records</Chip>
        {decisions.slice(0, 3).map((d) => (
          <StatusPill key={d.id} tone={d.verdict === 'helped' ? 'green' : d.verdict === 'harmed' ? 'red' : 'cobalt'}>
            {d.source}: {d.status}{d.verdict ? ` (${d.verdict})` : ''}
          </StatusPill>
        ))}
      </div>
    </Card>
  )
}

// ---- Versioned Digital Twin & P(Sub-4) Monte Carlo [MODEL] with Scenarios / twin/1 JSON toggle
function TwinMonteCarlo({ twin }) {
  const [view, setView] = useState('scenarios')
  const t = twin?.state, P = t?.projection
  if (!t) return null
  return <Card title="Versioned AthleteDigitalTwin & P(Sub-4) Monte Carlo" right={<span className="chips" style={{ margin: 0 }}><ProvenanceBadge type="MODEL" /><Chip>v{twin.version}</Chip></span>}>
    <div style={{ marginBottom: 10 }}>
      <SegmentedTabs tabs={[{ id: 'scenarios', label: '3 Scenarios' }, { id: 'json', label: `twin/${twin.version} JSON` }]} value={view} onChange={setView} label="Twin view" />
    </div>
    {view === 'scenarios' && P ? <>
      <p className="muted" style={{ marginTop: 0 }}>Illustrative scenarios under stated assumptions — not a prediction. Marathon realisation ratio is the dominant factor (observed 0.59, n=1).</p>
      <div className="scroll" tabIndex={0}><table className="lapt">
        <thead><tr><th>Scenario</th><th>Median FM</th><th>P(&lt;4:00)</th></tr></thead>
        <tbody>{(P.scenarios || []).map((s) => <tr key={s.name}><td><b>{s.name}</b></td><td className="mono">{fmtDur(s.fm_time_p10_p50_p90[1])}</td><td><b>{pct(s.p_sub4)}</b></td></tr>)}</tbody>
      </table></div>
      <p className="src-note">Required VDOT gain: ≥ {P.required_gain_per_month?.['ratio 0.95']}/mo (ratio 0.95) or ≥ {P.required_gain_per_month?.['ratio 0.90']}/mo (ratio 0.90). {P.months_to_race} months to A-Race.</p>
    </> : <pre className="card-pre" style={{ maxHeight: 280 }}>{JSON.stringify({ version: twin.version, as_of: t.as_of, load: t.load, aerobic: t.aerobic, durability: t.durability, projection: t.projection }, null, 2)}</pre>}
  </Card>
}

// ---- System Status + Recent Coach History (compact right column)
function RagStatusAndHistory({ st }) {
  const R = useApi('/api/coach/runs'), [open, setOpen] = useState(null), D = useApi(open ? `/api/coach/run?id=${open}` : '', !!open)
  const g = st?.guard, spendPct = g ? Math.min(100, Math.round((g.spend_cny / g.cap_cny) * 100)) : 0
  return <Card title="Multi-Lag SQL Engine & Hybrid RAG Status" right={st?.jobs?.[0] && <Chip tone={st.jobs[0].status === 'ok' ? 'green' : 'yellow'}>{st.jobs[0].status}</Chip>}>
    {!st ? <p className="muted">Loading…</p> : <>
      <Tiles items={[['FIT parsed', st.counts.fit_sessions, '1-Hz'], ['Weather', st.counts.weather, 'runs'], ['KB docs', st.counts.kb_docs, 'indexed'], ['Daily log', st.counts.daily_log, 'days']]} />
      <div className="bar" style={{ marginTop: 10 }} role="img" aria-label={`Coach usage ${spendPct}%`}><i style={{ width: spendPct + '%', background: spendPct >= 80 ? 'var(--red-t)' : 'var(--cobalt)' }} /></div>
      <p className="muted" style={{ fontSize: '.82rem', margin: '6px 0' }}>{st.model?.name || 'No model'} · ¥{f1(g?.spend_cny, 2)} / ¥{g?.cap_cny} this month{!st.key ? ' · API key not set' : ''}</p>
      <p className="src-note" style={{ marginBottom: 10 }}>Last job: {st.jobs[0] ? `${st.jobs[0].kind} · ${st.jobs[0].status}${st.jobs[0].finished_at ? ' · ' + new Date(st.jobs[0].finished_at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : ''}` : 'never run'}</p>
    </>}
    {R.data?.length > 0 && <>
      <h3 style={{ fontSize: '.84rem', margin: '8px 0 6px' }}>Recent Coach Runs</h3>
      <div className="alist">{R.data.slice(0, 5).map((r) => <button key={r.id} className="arow" onClick={() => setOpen(r.id)}>
        <div className="t"><b>{INTENTS.find((i) => i[0] === r.intent)?.[1] || r.intent}</b>
          <small>{!r.ok && r.error ? <><span className="errline">{r.error.slice(0, 64)}</span> · </> : null}{new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>
        <div className="n"><Chip tone={r.ok ? 'green' : 'yellow'}>{r.ok ? 'ok' : 'failed'}</Chip></div>
      </button>)}</div>
    </>}
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

// ---- Durability: pooled km-by-km fade curves + opening HR cost diagnostic
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
  return <Card title="Km-by-Km Running Share Decay Across Distance Buckets" right={<Chip>{bucket === 'long90' ? `${d.long_runs_90d || 0} long runs` : `n=${fc[bucket]?.n || 0}`}</Chip>}>
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
      <p className="src-note">Dashed line = 90% continuous running threshold. Green ≥ 90% running, amber 65–89%, crimson &lt; 65%.</p>
    </>}
  </Card>
}

function Durability({ twin }) {
  const L = useApi('/api/intel/longruns'), [sel, setSel] = useState(null), S = useApi(sel ? `/api/intel/session?id=${sel}` : '', !!sel), s = S.data
  const rows = L.data || []
  return <div className="rgrid">
    <FadeCurveCard twin={twin?.state} />
    <Card title="Opening Cost vs. Durability · Runs ≥ 16 km" right={<Chip>{rows.length} runs</Chip>}>
      <p className="muted" style={{ marginTop: 0 }}>Sessions with lower opening HR and HR@8:00 preserve higher EF and delay fade onset [Rule 9].</p>
      {L.state === 'ok' && !rows.length && <p className="muted">No runs ≥ 16 km with a FIT file yet.</p>}
      <div className="alist">{rows.slice(0, 8).map((r) => <button key={r.label_id} className="arow" onClick={() => setSel(r.label_id)}>
        <div className="t"><b>{fmtShort(r.date)} · {f1(r.distance_m / 1000)} km</b><small>onset km {r.onset_km ?? '—'} · EF {f1(r.ef, 3)} · HR@8:00 {r.hr800 ?? '—'}{r.wbgt != null ? ` · WBGT ${f1(r.wbgt)}°C` : ''}</small>
          <div className="bar" aria-hidden="true"><i style={{ width: pct(r.run_share), background: r.run_share >= 0.9 ? 'var(--green)' : r.run_share >= 0.6 ? 'var(--yellow)' : 'var(--red)' }} /></div></div>
        <div className="n"><b>{pct(r.run_share)}</b><small>running</small></div>
      </button>)}</div>
      <Sheet open={!!sel} onClose={() => setSel(null)} label="Session detail">
        {S.state === 'loading' && <div className="skel" style={{ height: 120 }} />}
        {s?.found && <><p className="muted">{s.date}</p><h2 className="sess-title">{f1(s.distance_m / 1000, 2)} km · {fmtDur(s.elapsed_s)}</h2>
          <Tiles items={[['Run share', pct(s.run_share)], ['EF', f1(s.ef, 3), 'km/h per bpm'], ['Drift', s.drift_pahr != null ? f1(s.drift_pahr) + '%' : s.run_drift != null ? f1(s.run_drift) + '% (run)' : '—', s.metrics.drift_pahr?.why || ''], ['Onset fade', s.onset_km ? 'km ' + s.onset_km : 'none', s.metrics.fade_onset?.trigger],
            ['GCT fade', s.gct_fade != null ? f1(s.gct_fade, 0) + ' ms' : '—', 'end vs start'], ['Stride', s.stride_fade != null ? f1(s.stride_fade, 3) + ' m' : '—'], ['HR@8:00', s.hr800 ?? '—', s.hr800 ? `z ${f1((s.hr800 - 143.1) / 5)}` : ''], ['Economy', f1(s.economy_jm), 'J/m']]} />
          <RunBars km={s.km} /><p className="src-note">Each bar = 1 km: green ≥ 90% running, yellow ≥ 60%, red below that.</p>
          {s.weather && !s.weather.indoor && <p className="muted">Weather: {s.weather.temp_c}°C · RH {s.weather.rh}% · WBGT≈{s.weather.wbgt} [calc]</p>}
          {s.card && <details className="more"><summary>Episode card (memory)</summary><pre className="card-pre">{s.card}</pre></details>}</>}
      </Sheet>
    </Card>
  </div>
}

// ---- Twin Evolution & Version Diff Explorer
function TwinHistory() {
  const H = useApi('/api/twin/history'), rows = H.data || []
  const [va, setVa] = useState(null), [vb, setVb] = useState(null)
  const a = va ?? rows[1]?.version, b = vb ?? rows[0]?.version
  const D = useApi(a && b && a !== b ? `/api/twin/diff?a=${a}&b=${b}` : '', !!(a && b && a !== b))
  if (rows.length < 2) return null
  const diffEntries = Object.entries(D.data?.diff || {}).slice(0, 12)
  return <Card title="Digital Twin Version History & Diff" right={<Chip>v{rows[0].version}</Chip>}>
    <div className="form two" style={{ marginBottom: 8 }}>
      <label className="fld"><span>Compare baseline</span><select value={a || ''} onChange={(e) => setVa(+e.target.value)}>{rows.map((r) => <option key={r.version} value={r.version}>v{r.version} · {r.as_of} ({r.trigger})</option>)}</select></label>
      <label className="fld"><span>Against target</span><select value={b || ''} onChange={(e) => setVb(+e.target.value)}>{rows.map((r) => <option key={r.version} value={r.version}>v{r.version} · {r.as_of} ({r.trigger})</option>)}</select></label>
    </div>
    {diffEntries.length > 0 ? <div className="scroll" tabIndex={0}><table className="lapt"><thead><tr><th>Twin field</th><th>v{a}</th><th>v{b}</th></tr></thead><tbody>
      {diffEntries.map(([path, d]) => <tr key={path}><td><code className="md-code">{path}</code></td><td className="muted">{String(d.from ?? '—')}</td><td><b>{String(d.to ?? '—')}</b></td></tr>)}
    </tbody></table></div> : <p className="muted">No scalar field differences between v{a} and v{b}.</p>}
  </Card>
}

// ---- Tabbed Multi-Context Physiological Matrices (Blueprint §6)
function CorrelationMatrices({ data }) {
  const [tab, setTab] = useState('z2')
  const d = data
  if (!d) return null
  const tabs = [
    { id: 'z2', label: 'Z2 vs. Creep' },
    { id: 'gym', label: 'Gym → Stride (72h)' },
    { id: 'mod', label: 'Route Modality' },
    ...(d.threshold_blocks?.length || d.race_fade?.length ? [{ id: 'race', label: 'Threshold & Race Fade' }] : []),
  ]
  return <Card title="Multi-Context Physiological & Biomechanical Matrices" right={<Chip>{d.sessions} FIT</Chip>}>
    <div style={{ marginBottom: 10 }}>
      <SegmentedTabs tabs={tabs} value={tab} onChange={setTab} label="Physiological matrix" />
    </div>
    {tab === 'z2' && <div className="scroll" tabIndex={0}><table className="lapt">
      <thead><tr><th>Zone regime (≤15 km, Z2 ≤{d.z2_ceiling} bpm)</th><th>n</th><th>Mean HR</th><th>Mean EF</th><th>Pa:HR drift</th><th>GCT fade</th></tr></thead>
      <tbody>{(d.z2_discipline || []).map((r) => <tr key={r.zone}>
        <td><Chip tone={r.zone === 'z2_disciplined' ? 'green' : 'yellow'}>{r.zone === 'z2_disciplined' ? `Z2 disciplined (≤${d.z2_ceiling})` : `Intensity creep (>${d.z2_ceiling})`}</Chip></td>
        <td>{r.n}</td><td>{r.avg_hr} bpm</td><td><b>{r.ef}</b></td><td>{r.drift != null ? r.drift + '%' : '—'}</td><td>{r.gct_fade != null ? (r.gct_fade > 0 ? '+' : '') + r.gct_fade + ' ms' : '—'}</td>
      </tr>)}</tbody>
    </table></div>}

    {tab === 'gym' && <div className="scroll" tabIndex={0}><table className="lapt">
      <thead><tr><th>Condition (runs ≥5 km)</th><th>n</th><th>Mean EF</th><th>Pa:HR drift</th><th>GCT fade</th><th>Stride Δ</th></tr></thead>
      <tbody>{(d.gym_to_stride || []).map((r) => <tr key={r.grp}>
        <td><b>{r.grp === 'post_gym_72h' ? 'Within 72 h of gym' : 'Fresh legs (no gym in 72 h)'}</b></td>
        <td>{r.n}</td><td>{r.ef}</td><td>{r.drift != null ? r.drift + '%' : '—'}</td><td>{r.gct_fade != null ? (r.gct_fade > 0 ? '+' : '') + r.gct_fade + ' ms' : '—'}</td><td>{r.stride_fade != null ? r.stride_fade + ' m' : '—'}</td>
      </tr>)}</tbody>
    </table></div>}

    {tab === 'mod' && <div className="scroll" tabIndex={0}><table className="lapt">
      <thead><tr><th>Modality tag</th><th>n</th><th>Avg km</th><th>Mean EF</th><th>Mean run HR</th></tr></thead>
      <tbody>{(d.modalities || []).map((r) => <tr key={r.modality}>
        <td><code className="md-code">#{r.modality}</code></td><td>{r.n}</td><td>{r.avg_km} km</td><td>{r.ef}</td><td>{r.avg_hr} bpm</td>
      </tr>)}</tbody>
    </table></div>}

    {tab === 'race' && <>
      {d.threshold_blocks?.length > 0 && <div className="scroll" style={{ marginBottom: 10 }} tabIndex={0}><table className="lapt">
        <thead><tr><th>4-wk Block</th><th>Min ≥90% LTHR/wk</th><th>Km/wk</th><th>Pace@HR150</th><th>Next 4 wk</th></tr></thead>
        <tbody>{d.threshold_blocks.map((b) => <tr key={b.from}><td><b>{b.from.slice(5)} → {b.to.slice(5)}</b></td><td>{b.thr_min_per_week}</td><td>{b.km_per_week}</td><td>{pace(b.pace_hr150_during_s)}</td><td>{b.pace_hr150_next4w_s != null ? <>{pace(b.pace_hr150_next4w_s)}{b.pace_hr150_during_s != null && <Chip tone={b.pace_hr150_next4w_s < b.pace_hr150_during_s ? 'green' : 'yellow'}>{sgn(b.pace_hr150_next4w_s - b.pace_hr150_during_s, 0)} s</Chip>}</> : '—'}</td></tr>)}</tbody>
      </table></div>}
      {d.race_fade?.length > 0 && <div className="scroll" tabIndex={0}><table className="lapt">
        <thead><tr><th>Race</th><th>21k+</th><th>Elev</th><th>Pace fade</th><th>GCT fade</th><th>Late run</th></tr></thead>
        <tbody>{d.race_fade.map((r) => <tr key={r.date}><td><b>{r.date}</b><br /><small className="muted">{r.name}</small></td><td>{r.pre8w.long_runs_21k}</td><td>{r.pre8w.gain_m} m</td>
          <td>{r.fade ? <b>{sgn(r.fade.pace_fade_pct)}%</b> : '—'}</td><td>{r.fade?.gct_fade_ms != null ? sgn(r.fade.gct_fade_ms, 0) + ' ms' : '—'}</td><td>{r.fade?.run_share_late != null ? Math.round(r.fade.run_share_late * 100) + '%' : '—'}</td></tr>)}</tbody>
      </table></div>}
    </>}
    <p className="src-note">[MEASURED] Observational within-athlete matrices across {d.sessions} 1-Hz FIT sessions. Associations, not proof of cause.</p>
  </Card>
}

// ---- Twin Snapshot (Physiological profile, 30d vs 90d anomaly, 28d HR zones, Strength transfer)
function TwinSnapshot({ twin, go }) {
  const t = twin?.state
  if (!t?.physiological_profile) return null
  const P = t.physiological_profile, B = t.baselines, I = t.intensity, S = t.strength_to_run_transfer
  const rows = [['EF (steady runs)', 'ef', 3, 'up'], ['HR at 8:00/km', 'hr_at_800', 1, 'down'], ['Pace at HR ≈ 150', 'pace_at_hr150_s', 0, 'down', pace], ['Cadence (spm)', 'cadence_spm', 1, 'up'], ['GCT (ms)', 'gct_ms', 0, 'down'], ['Stride (m)', 'stride_m', 3, 'up'], ['Vertical ratio (%)', 'vertical_ratio_pct', 2, 'down']]
  const tone = (d, dir) => (d == null || d === 0 ? undefined : (d > 0) === (dir === 'up') ? 'green' : 'yellow')
  const ZN = ['<Z1', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6'], ZC = ['var(--c-rest)', 'var(--c-easy)', 'var(--green)', 'var(--c-long)', 'var(--yellow)', 'var(--c-quality)', 'var(--red)']
  const gapAction = (g) => {
    if (/shoe/i.test(g)) return ['Assign in Activities', () => go && go('activity')]
    if (/pain log/i.test(g)) return ['Log morning check-in', () => go && go('ready')]
    if (/FIT file|weather/i.test(g)) return ['Check COROS archive', () => go && go('profile')]
    return null
  }
  return <>
    <Card title="Digital Twin Physiological Snapshot" right={<Chip>twin v{twin.version} · {t.as_of}</Chip>}>
      <div className="score-grid">
        <div><small>LTHR</small><b>{P.lthr} bpm</b><em>{P.src?.lthr}</em></div>
        <div><small>Max HR</small><b>{P.hrmax}</b><em>{P.hrmax_observed_180d ? `seen ${P.hrmax_observed_180d} in 180d` : ''}</em></div>
        <div><small>Resting HR</small><b>{P.rhr_7d ?? P.rhr_setting}</b><em>7d mean · setting {P.rhr_setting}</em></div>
        <div><small>Threshold pace</small><b>{pace(P.threshold_pace_s_km)}/km</b><em>VO2max {P.vo2max_coros}</em></div>
        <div><small>Z2 ceiling</small><b>{P.z2_ceiling} bpm</b><em>above = creep</em></div>
        <div><small>Weight</small><b>{P.weight_kg} kg</b><em>COROS profile</em></div>
      </div>
      <h3>Anomaly Check: Last 30 vs 90 Days</h3>
      <div className="scroll" tabIndex={0}><table className="lapt">
        <thead><tr><th>Metric</th><th>30 d (n={B.d30.n})</th><th>90 d (n={B.d90.n})</th><th>Δ</th></tr></thead>
        <tbody>{rows.map(([l, k, d, dir, fmt]) => { const D = B.delta_30_vs_90[k]; return <tr key={k}><td>{l}</td><td>{fmt ? fmt(B.d30[k]) : B.d30[k] ?? '—'}</td><td>{fmt ? fmt(B.d90[k]) : B.d90[k] ?? '—'}</td><td>{D == null ? '—' : <Chip tone={tone(D, dir)}>{sgn(D, d)}</Chip>}</td></tr> })}</tbody>
      </table></div>
      {I.hr_zone_pct_28d && <><h3>Intensity Distribution · Last 28 Days ({I.minutes_28d} min)</h3>
        <div className="zbig" role="img" aria-label={'HR zones 28 days: ' + I.hr_zone_pct_28d.map((p, i) => `${ZN[i]} ${p}%`).join(', ')}>{I.hr_zone_pct_28d.map((p, i) => p ? <i key={i} style={{ width: p + '%', background: ZC[i] }} title={`${ZN[i]} ${p}%`} /> : null)}</div>
        <div className="legend">{I.hr_zone_pct_28d.map((p, i) => <span key={i}><i className="kdot" style={{ background: ZC[i] }} />{ZN[i]} {p}%</span>)}</div>
        <p className="muted" style={{ fontSize: '.85rem' }}>Low intensity (&lt;Z3): <b>{I.low_share_pct}%</b> · easy runs above {I.z2_ceiling} bpm: <b>{I.easy_runs_above_z2} of {I.easy_runs}</b></p></>}
      {S?.by_lag_hours?.length > 0 && <><h3>Strength → Running Transfer</h3>
        <div className="scroll" tabIndex={0}><table className="lapt"><thead><tr><th>Run after gym</th><th>n</th><th>EF</th><th>Drift</th><th>Avg GCT</th><th>GCT fade</th></tr></thead>
          <tbody>{S.by_lag_hours.map((r) => <tr key={String(r.hours)}><td><b>{r.hours ? `+${r.hours} h` : 'no gym in 72 h'}</b></td><td>{r.n}</td><td>{r.ef}</td><td>{r.drift != null ? r.drift + '%' : '—'}</td><td>{r.gct_avg != null ? r.gct_avg + ' ms' : '—'}</td><td>{r.gct_fade != null ? sgn(r.gct_fade, 1) + ' ms' : '—'}</td></tr>)}</tbody></table></div></>}
    </Card>

    {t.shoes?.length > 0 && <Card title="Live Shoe-Sync & OLS Residual Unlock" right={<Chip>200-bootstrap</Chip>}>
      <div className="scroll" tabIndex={0}><table className="lapt"><thead><tr><th>Shoe</th><th>km</th><th>n</th><th>ΔEF / 100 km</th><th>Status</th></tr></thead>
        <tbody>{t.shoes.filter((s) => !s.retired || s.n).slice(0, 7).map((s) => <tr key={s.gear_id}><td><b>{s.name}</b></td><td>{s.km}</td><td>{s.n}</td><td>{s.ef_resid_per_100km != null ? `${s.ef_resid_per_100km > 0 ? '+' : ''}${s.ef_resid_per_100km} (${s.ci_per_100km?.join('…')})` : '—'}</td><td><small className="muted">{s.flag}</small></td></tr>)}</tbody></table></div>
      <p className="src-note">Scored when n ≥ 8 steady FIT runs per shoe; controls for pace, WBGT/temperature, and duration.</p>
    </Card>}

    {t.data_gaps?.length > 0 && <Card title="Data Hygiene & Actionable Gaps" right={<Chip tone="yellow">{t.data_gaps.length} open</Chip>}>
      <div className="scalelist">{t.data_gaps.map((g, i) => {
        const act = gapAction(g)
        return <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: 'var(--surface2)' }}>
          <span style={{ fontSize: '.86rem' }}>{g}</span>
          {act && go && <button className="btn sm" onClick={act[1]}>{act[0]} →</button>}
        </div>
      })}</div>
    </Card>}
  </>
}

const SEMANTIC_TAGS = [
  ['all', 'All episodes'],
  ['#intensity_creep', '#intensity_creep'],
  ['#z2_disciplined', '#z2_disciplined'],
  ['#early_fade', '#early_fade'],
  ['#leg_day_72h', '#leg_day_72h'],
  ['#treadmill_bodimax', '#treadmill_bodimax'],
  ['#cardiac_drift_high', '#cardiac_drift_high'],
  ['#gct_stable', '#gct_stable'],
  ['#road_tmii', '#road_tmii'],
]

function EpisodeCards() {
  const [tag, setTag] = useState('all')
  const Ep = useApi('/api/memory?tier=episodic&status=active&limit=60')
  const all = Ep.data || []
  const episodes = all.filter((e) => tag === 'all' || (e.body || '').includes(tag))
  return <Card title={`${all.length} FIT Episode Cards Indexed with Semantic Tags`} right={<Chip>{episodes.length} matched</Chip>}>
    <div className="chiprow" role="group" aria-label="Semantic tag filter">
      {SEMANTIC_TAGS.map(([k, l]) => {
        const cnt = k === 'all' ? all.length : all.filter((e) => (e.body || '').includes(k)).length
        return <button key={k} aria-pressed={tag === k} onClick={() => setTag(k)}>{l} ({cnt})</button>
      })}
    </div>
    {episodes.slice(0, 7).map((e) => <details key={e.id} className="more"><summary><b>[{e.id}] {e.title}</b> · <span className="muted">{e.valid_from}</span></summary><pre className="card-pre">{e.body}</pre></details>)}
    {!episodes.length && <p className="muted">No episode cards match {tag}.</p>}
  </Card>
}

// ---- Memory Hypothesis Queue (All / Semantic / Episodic filter + 3-col grid) + Correlations
function MemoryQueue({ pending, onAct }) {
  const [tierFilter, setTierFilter] = useState('all')
  const E = useApi('/api/intel/edges')
  const semCount = pending.filter((m) => m.tier === 'semantic').length
  const epiCount = pending.filter((m) => m.tier === 'episodic').length
  const shown = tierFilter === 'all' ? pending : pending.filter((m) => m.tier === tierFilter)
  return <>
    <Card title={`Athlete Memory & Hypothesis Confirmation Queue (${pending.length})`} right={<SegmentedTabs tabs={[{ id: 'all', label: 'All', badge: pending.length }, { id: 'semantic', label: 'Semantic', badge: semCount }, { id: 'episodic', label: 'Episodic', badge: epiCount }]} value={tierFilter} onChange={setTierFilter} label="Hypothesis tier" />}>
      <p className="muted" style={{ marginTop: 0 }}>Coach findings are stored as hypotheses. Only those you approve (or that repeat 3×) become active. Locked rules cannot be overwritten by the coach.</p>
      {shown.length > 0 ? <div className="hyp-grid">
        {shown.map((m) => <div key={m.id} className="hyp-card">
          <div className="chips" style={{ margin: 0 }}><Chip tone={m.tier === 'semantic' ? 'green' : undefined}>{m.tier}</Chip><Chip>{m.evidence_tag}</Chip><Chip>×{m.n}</Chip></div>
          <b style={{ fontSize: '.86rem' }}>{cleanId(m.title)}</b>
          <small className="muted" style={{ flex: 1 }}>{cleanId(m.body)}</small>
          <div className="seg" role="group" aria-label="Actions" style={{ marginTop: 6 }}>
            <button onClick={() => onAct(m.id, 'approve')}>Approve</button>
            <button onClick={() => onAct(m.id, 'retract')}>Reject</button>
          </div>
        </div>)}
      </div> : <p className="muted">No hypotheses awaiting confirmation in this view.</p>}
    </Card>
    {E.data?.length > 0 && <Card title="FDR-Supported Correlations (Association, Not Cause)" right={<Chip>{E.data.length} edges</Chip>}>
      <div className="hyp-grid">{E.data.map((e) => <div key={e.id} className="hyp-card">
        <b>{e.exposure} → {e.outcome}</b>
        <small className="muted">{e.lag_lo}–{e.lag_hi}d lag · partial ρ {e.partial_rho} (CI {e.ci_lo}…{e.ci_hi}) · n={e.n} · q={e.q}</small>
        <div className="chips" style={{ margin: 0 }}><Chip tone={e.status === 'supported' ? 'green' : 'yellow'}>{e.status}</Chip></div>
      </div>)}</div>
    </Card>}
  </>
}

const SECTIONS = [{ id: 'ask', label: 'Ask & Twin' }, { id: 'kg', label: 'Knowledge Graph' }, { id: 'mc', label: 'Monte Carlo & RAG' }, { id: 'lag', label: 'Lag Explorer' }, { id: 'mem', label: 'Memory Queue' }, { id: 'mat', label: 'Matrices & Episodes' }, { id: 'dur', label: 'Durability & Shoes' }]
const jumpTo = (id) => () => { const el = document.getElementById(id); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.focus({ preventScroll: true }) }

export default function Coach({ go, focus }) {
  const [tick, setTick] = useState(0), [sec, setSec] = useSub(SECTIONS.map((x) => x.id), focus?.section && SECTIONS.some((x) => x.id === focus.section) ? focus.section : 'ask')
  const [approvingAll, setApprovingAll] = useState(false)
  const st = useApi('/api/intel/status')
  const twin = useApi('/api/twin')
  const mat = useApi('/api/intel/matrices')
  const C = useApi(`/api/memory?status=candidate&limit=30&_=${tick}`)
  const P = useApi(`/api/memory?status=proposal&limit=30&_=${tick}`)
  const pending = [...(P.data || []), ...(C.data || [])]

  const act = (id, action) => post('/api/memory/action', { id, action }).then(() => setTick((x) => x + 1)).catch((e) => alert(e.message))
  const approveAll = async () => {
    if (!pending.length || approvingAll) return
    setApprovingAll(true)
    try {
      for (const m of pending) await post('/api/memory/action', { id: m.id, action: 'approve' })
      setTick((x) => x + 1)
    } catch (e) { alert(e.message) }
    finally { setApprovingAll(false) }
  }

  useEffect(() => {
    if (focus?.section === 'kg') setTimeout(() => { const el = document.getElementById('cs-kg'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.focus({ preventScroll: true }) }, 120)
  }, [focus])

  const s = st.data, g = s?.guard

  return <div className="screen">
    {/* Unified AI Coach Command Header */}
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div>
          <h1>AI Coach, Digital Twin &amp; Validated Rules</h1>
          <p className="sub">
            {s ? `${s.model?.name || 'Model not set'} · Usage: ¥${f1(g?.spend_cny, 2)} / ¥${g?.cap_cny} this month · ${s.counts.fit_sessions} FIT parsed · ${s.counts.weather} Weather logs · ${s.counts.kb_docs} KB docs` : 'Hybrid RAG · Knowledge Graph · Digital Twin · Athlete Memory'}
          </p>
        </div>
        <div className="prof-chips">
          <button type="button" className="btn sm" disabled={s?.busy} onClick={() => post('/api/intel/run', { kind: 'full' }).then(() => location.reload())}>
            {s?.busy ? 'Running pipeline…' : 'Run Analysis Now'}
          </button>
          {pending.length > 0 && <button type="button" className="btn primary sm" disabled={approvingAll} onClick={approveAll} style={{ background: '#059669' }}>
            {approvingAll ? 'Approving…' : `✓ Approve All ${pending.length} Rules`}
          </button>}
        </div>
      </div>
      <div className="prof-cmd-bar subtabs-scroll"><SegmentedTabs tabs={SECTIONS} value={sec} onChange={setSec} label="Coach sections" /></div>
    </div>

    {sec === 'ask' && <div id="cs-ask" tabIndex={-1} className="bio-split-75">
      <Ask st={s} initIntent={focus?.intent} />
      <TwinPillars twin={twin.data} />
    </div>}

    {sec === 'kg' && <div id="cs-kg" tabIndex={-1}><KnowledgeGraphPanel twin={twin.data} matrices={mat.data} status={s} /></div>}

    {sec === 'mc' && <div id="cs-mc" tabIndex={-1} className="rgrid">
      <div><Sub4AdaptiveCard twin={twin.data} /><TwinMonteCarlo twin={twin.data} /><TwinHistory /></div>
      <RagStatusAndHistory st={s} />
    </div>}

    {sec === 'lag' && <div id="cs-lag" tabIndex={-1}><LagExplorer /></div>}

    {sec === 'mem' && <div id="cs-mem" tabIndex={-1}><MemoryQueue pending={pending} onAct={act} /></div>}

    {sec === 'mat' && <div id="cs-mat" tabIndex={-1} className="rgrid">
      <CorrelationMatrices data={mat.data} />
      <EpisodeCards />
    </div>}

    {sec === 'dur' && <div id="cs-dur" tabIndex={-1}>
      <Durability twin={twin.data} />
      <TwinSnapshot twin={twin.data} go={go} />
      <ShoeDegradation />
    </div>}
  </div>
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
    <div className="coachq" role="group" aria-label="Ask the coach">{[['Morning brief', 'daily_brief'], ['Run review', 'session_review'], ['Weekly review', 'weekly_review'], ['Race plan', 'race_plan']].map(([l, k]) => <button key={k} onClick={() => go('coach', { intent: k })}>{l}</button>)}</div>
    <button className="link coachgo" onClick={() => go('coach')}>Open AI Coach →</button>
  </div>
}
