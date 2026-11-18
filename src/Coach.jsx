import { useState } from 'react'
import { Card, Chip, Screen, Sheet } from './ui.jsx'
import LagExplorer from './LagExplorer.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'
import { fmtShort, today } from './lib/calendar.js'

// ---- tiny markdown (bold, bullets, paragraphs) — no HTML injection
const inline = (t) => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p))
export function Md({ text }) {
  const blocks = String(text || '').split(/\n{2,}/)
  return <div className="md">{blocks.map((b, i) => { const lines = b.split('\n')
    if (lines.every((l) => /^\s*[-*] /.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>)}</ul>
    if (/^#{1,3} /.test(b)) return <h3 key={i}>{inline(b.replace(/^#{1,3} /, ''))}</h3>
    return <p key={i}>{lines.map((l, j) => <span key={j}>{inline(l)}{j < lines.length - 1 && <br />}</span>)}</p> })}</div>
}
const f1 = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (+x).toFixed(d))
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%')
export const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j })
const PRIO = { now: ['red', 'now'], this_week: ['yellow', 'this week'], later: ['none', 'later'] }
const INTENTS = [['daily_brief', 'Today\'s brief'], ['weekly_review', 'Weekly review'], ['race_plan', 'Race plan'], ['question', 'Free question']]

export function Result({ p, res }) {
  const wb = p?._writeback
  return <Card title="Result" right={<span className="muted">{res.model} · ¥{f1(res.cost_cny, 2)}</span>}>
    <p className="lead">{p.summary}</p>
    {p.flags?.length > 0 && <div className="chips">{p.flags.map((f, i) => <Chip key={i} tone={f.type === 'gate' || f.type === 'injury' ? 'red' : 'yellow'}>{f.text}</Chip>)}</div>}
    {p.recommendations?.length > 0 && <ol className="recs">{p.recommendations.map((r, i) => <li key={i}><div><Chip tone={PRIO[r.priority]?.[0]}>{PRIO[r.priority]?.[1] || r.priority}</Chip>{r.needs_athlete_ok && <Chip>needs your approval</Chip>}</div><b>{r.action}</b><small>{r.why}</small></li>)}</ol>}
    <details className="more"><summary>Full analysis</summary><Md text={p.analysis_md} /></details>
    {wb && (wb.stored.length + wb.merged.length + wb.rejected.length > 0) && <p className="src-note">Memory: {wb.stored.length} new (awaiting confirmation) · {wb.merged.length} merged · {wb.rejected.length} rejected (numbers/citations not verified).</p>}
  </Card>
}

const Tiles = ({ items }) => <div className="score-grid">{items.map(([k, v, e], i) => <div key={i}><small>{k}</small><b>{v}</b>{e && <em>{e}</em>}</div>)}</div>

function Status({ st }) {
  const g = st?.guard, spendPct = g ? Math.min(100, Math.round((g.spend_cny / g.cap_cny) * 100)) : 0
  return <Card title="System status">
    {!st ? <p className="muted">Loading…</p> : <>
      <Tiles items={[['FIT sessions', st.counts.fit_sessions, 'analysed per second'], ['Weather', st.counts.weather, 'runs with weather'], ['KB docs', st.counts.kb_docs, 'imported'], ['Daily log', st.counts.daily_log, 'days logged']]} />
      <div className="bar" role="img" aria-label={`Coach usage ${spendPct}%`}><i style={{ width: spendPct + '%', background: spendPct >= 80 ? 'var(--red-t)' : 'var(--accent)' }} /></div>
      <p className="muted">Coach: {st.model?.name || 'not chosen yet'} · ¥{f1(g?.spend_cny, 2)} of ¥{g?.cap_cny} this month{g?.level === 'paused' ? ' · PAUSED' : g?.level === 'limited' ? ' · limited (≥80%)' : ''}{!st.key ? ' · API key not set' : ''}</p>
      <p className="src-note">Last job: {st.jobs[0] ? `${st.jobs[0].kind} · ${st.jobs[0].status}${st.jobs[0].finished_at ? ' · ' + new Date(st.jobs[0].finished_at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : ''}` : 'never run'}</p>
      <button className="btn" disabled={st.busy} onClick={() => post('/api/intel/run', { kind: 'full' }).then(() => location.reload())}>{st.busy ? 'Running…' : 'Run analysis now'}</button>
    </>}
  </Card>
}

function Ask({ st }) {
  const [intent, setIntent] = useState('daily_brief'), [q, setQ] = useState(''), [busy, setBusy] = useState(false), [res, setRes] = useState(null), [err, setErr] = useState('')
  const run = () => { setBusy(true); setErr(''); setRes(null); post('/api/coach/run', { intent, question: q }).then(setRes).catch((e) => setErr(e.message)).finally(() => setBusy(false)) }
  const p = res?.parsed, wb = p?._writeback
  return <>
    <Card title="Ask the coach" right={st?.model && <Chip>{st.model.name}</Chip>}>
      <div className="chiprow" role="group" aria-label="Analysis type">{INTENTS.map(([k, l]) => <button key={k} aria-pressed={intent === k} onClick={() => setIntent(k)}>{l}</button>)}</div>
      {intent === 'question' && <textarea className="ask" rows={3} value={q} placeholder="e.g. why did HR@8:00 rise this week?" onChange={(e) => setQ(e.target.value)} maxLength={1000} aria-label="Question" />}
      <button className="btn primary" disabled={busy || (intent === 'question' && q.trim().length < 5) || st?.guard?.level === 'paused'} onClick={run}>{busy ? 'Coach is analysing… (±30–90 s)' : 'Run'}</button>
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
    <div className="alist">{R.data.slice(0, 8).map((r) => <button key={r.id} className="arow" onClick={() => setOpen(r.id)}><div className="t"><b>{INTENTS.find((i) => i[0] === r.intent)?.[1] || r.intent}</b><small>{new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {r.provider}{r.model ? ' · ' + r.model : ''}</small></div><div className="n"><small>{r.ok ? 'ok' : 'failed'}</small></div></button>)}</div>
    <Sheet open={!!open} onClose={() => setOpen(null)} label="Coach detail">{D.data?.parsed ? <><h2 className="sess-title">{D.data.intent}</h2><p className="lead">{D.data.parsed.summary}</p><Md text={D.data.parsed.analysis_md} /></> : <p className="muted">{D.data?.error || 'Loading…'}</p>}</Sheet>
  </Card>
}

// ---- Durability: the long-run scorecard (the limiter behind both marathon DNFs)
function RunBars({ km }) {
  if (!km?.length) return null; const W = 300, H = 70, bw = W / Math.max(km.length, 1)
  return <svg viewBox={`0 0 ${W} ${H}`} className="runbars" role="img" aria-label="Run share per km">{km.map((k, i) => <rect key={i} x={i * bw + 0.5} width={Math.max(1, bw - 1.5)} y={H - H * (k.runShare ?? 0)} height={H * (k.runShare ?? 0)} rx="1.5" fill={k.runShare >= 0.9 ? 'var(--green)' : k.runShare >= 0.6 ? 'var(--yellow)' : 'var(--red)'} />)}</svg>
}
function Durability() {
  const L = useApi('/api/intel/longruns'), [sel, setSel] = useState(null), S = useApi(sel ? `/api/intel/session?id=${sel}` : '', !!sel), s = S.data
  return <>
    <Card title="Run share · runs ≥ 16 km"><p className="muted">The share of time actually running (not walking/stopped). This is the main limiter in both of your marathons: speed while running holds, what drops is the running share after km 20.</p>
      {L.state === 'ok' && !L.data.length && <p className="muted">No runs ≥ 16 km with a FIT file yet. Older FIT files are still downloading gradually (40 per day).</p>}</Card>
    <div className="alist">{(L.data || []).map((r) => <button key={r.label_id} className="arow" onClick={() => setSel(r.label_id)} aria-label={`Run ${r.date} ${f1(r.distance_m / 1000)} km, run share ${pct(r.run_share)}`}>
      <div className="t"><b>{fmtShort(r.date)} · {f1(r.distance_m / 1000)} km</b><small>onset km {r.onset_km ?? '—'} · EF {f1(r.ef, 3)}{r.wbgt != null ? ` · WBGT ${f1(r.wbgt)}` : ''}</small>
        <div className="bar" aria-hidden="true"><i style={{ width: pct(r.run_share), background: r.run_share >= 0.9 ? 'var(--green)' : r.run_share >= 0.6 ? 'var(--yellow)' : 'var(--red)' }} /></div></div>
      <div className="n"><b>{pct(r.run_share)}</b><small>berlari</small></div></button>)}</div>
    <Sheet open={!!sel} onClose={() => setSel(null)} label="Session detail">
      {S.state === 'loading' && <div className="skel" style={{ height: 120 }} />}
      {s?.found && <><p className="muted">{s.date}</p><h2 className="sess-title">{f1(s.distance_m / 1000, 2)} km · {fmtDur(s.elapsed_s)}</h2>
        <Tiles items={[['Run share', pct(s.run_share)], ['EF', f1(s.ef, 3), 'km/h per bpm'], ['Drift', s.drift_pahr != null ? f1(s.drift_pahr) + '%' : s.run_drift != null ? f1(s.run_drift) + '% (run)' : '—', s.metrics.drift_pahr?.why || ''], ['Onset fade', s.onset_km ? 'km ' + s.onset_km : 'none', s.metrics.fade_onset?.trigger],
          ['GCT fade', s.gct_fade != null ? f1(s.gct_fade, 0) + ' ms' : '—', 'akhir vs awal'], ['Stride', s.stride_fade != null ? f1(s.stride_fade, 3) + ' m' : '—'], ['HR@8:00', s.hr800 ?? '—', s.hr800 ? `z ${f1((s.hr800 - 143.1) / 5)}` : ''], ['Ekonomi', f1(s.economy_jm), 'J/m']]} />
        <RunBars km={s.km} /><p className="src-note">Each bar = 1 km: green ≥ 90% running, yellow ≥ 60%, red below that.</p>
        {s.weather && !s.weather.indoor && <p className="muted">Weather: {s.weather.temp_c}°C · RH {s.weather.rh}% · WBGT≈{s.weather.wbgt} [calc]</p>}
        {s.card && <details className="more"><summary>Episode card (memory)</summary><pre className="card-pre">{s.card}</pre></details>}</>}
    </Sheet>
  </>
}

// ---- Twin
function Twin() {
  const T = useApi('/api/twin'), t = T.data?.state
  if (T.state === 'loading') return <div className="skel" style={{ height: 140 }} />
  if (!t) return <Card title="Digital Twin"><p className="muted">Not built yet. Press “Run analysis now” in the Coach tab.</p></Card>
  const L = t.load, A = t.aerobic, D = t.durability, H = t.heat, P = t.projection
  const kmGuard = L.km_vs_4wk_avg_pct == null ? ['none', '—'] : L.km_vs_4wk_avg_pct > 10 ? ['red', `+${L.km_vs_4wk_avg_pct}% (limit +10%)`] : ['green', `${L.km_vs_4wk_avg_pct > 0 ? '+' : ''}${L.km_vs_4wk_avg_pct}%`]
  return <>
    <Card title="Load guard" right={<Chip tone={kmGuard[0]}>{kmGuard[0] === 'red' ? 'exceeded' : kmGuard[0] === 'green' ? 'safe' : 'no data yet'}</Chip>}>
      <Tiles items={[['Km vs 4-week average', kmGuard[1], 'rule ≤ +10%'], ['Longest run 30 d', f1(L.longest_run_km_30d) + ' km', 'LR ≤ 110% of this'], ['CTL / ATL / TSB', `${f1(L.ctl, 0)} / ${f1(L.atl, 0)} / ${f1(L.tsb, 0)}`], ['ACWR', f1(L.acwr_ewma, 2), `COROS ${f1(L.coros_ratio, 2)}`]]} />
      <p className="src-note">After Borobudur, the 15 Nov load spike makes the ratio temporarily high — not a progression signal.</p></Card>
    <Card title="Aerobic"><Tiles items={[['HR@8:00 (28 d)', f1(A.hr_at_800.value), A.hr_at_800.n ? `z ${f1(A.hr_at_800.z)} · n=${A.hr_at_800.n}` : 'no steady run yet'], ['Baseline', '143.1 ± 5.0', 'Jan–Sep 2026'], ['EF easy 28 d', f1(A.ef_easy_28d.value, 3), `n=${A.ef_easy_28d.n}`], ['Pace@HR150', A.pace_at_hr150.value ? fmtPaceS(A.pace_at_hr150.value) : '—', `n=${A.pace_at_hr150.n}`]]} /></Card>
    <Card title="Durability (90 days)"><Tiles items={[['Runs ≥ 16 km', D.long_runs_90d], ['Longest continuous run', D.longest_continuous_run_km + ' km', '≥ 90% running'], ['Durability km', D.durability_km ?? '—', 'run share < 90%'], ['Onset fade median', D.fade_onset_km_median_90d ?? '—', 'km']]} /></Card>
    <Card title="Heat">{H.hr_cost_bpm_per_c ? <Tiles items={[['HR cost', `${H.hr_cost_bpm_per_c.value} bpm/°C`, `CI ${H.hr_cost_bpm_per_c.ci.join(' … ')}`], ['EF cost', f1(H.ef_cost_per_c.value, 4) + '/°C'], ['Sample', H.n, `WBGT ${H.wbgt_range?.join('–')}`]]} /> : <p className="muted">{H.note || 'Waiting for weather data.'} (n={H.n ?? 0})</p>}</Card>
    <Card title="Shoes"><table className="lapt"><thead><tr><th>Shoe</th><th>km</th><th>n</th><th>EF vs km</th></tr></thead><tbody>{t.shoes.filter((s) => !s.retired || s.n).slice(0, 7).map((s) => <tr key={s.gear_id}><td>{s.name}</td><td>{s.km}</td><td>{s.n}</td><td><small className="muted">{s.flag}</small></td></tr>)}</tbody></table>
      <p className="src-note">Only scored when n ≥ 8 runs per shoe; no validated shoe lifespan exists.</p></Card>
    <Card title="Sub-4:00 projection [MODEL]"><p className="muted">Illustrative scenarios based on the stated assumptions — not a prediction. The marathon realisation ratio is the biggest factor (observed 0.59, n=1).</p>
      <table className="lapt"><thead><tr><th>Scenario</th><th>Median</th><th>P(&lt;4:00)</th></tr></thead><tbody>{P.scenarios.map((s) => <tr key={s.name}><td>{s.name}</td><td>{fmtDur(s.fm_time_p10_p50_p90[1])}</td><td><b>{pct(s.p_sub4)}</b></td></tr>)}</tbody></table>
      <p className="src-note">Needs a VDOT gain of ≥ {P.required_gain_per_month['ratio 0.95']}/month (ratio 0.95) or ≥ {P.required_gain_per_month['ratio 0.90']}/month (ratio 0.90). {P.months_to_race} months to the race.</p></Card>
    {t.data_gaps?.length > 0 && <Card title="Data gaps"><ul className="plainlist">{t.data_gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></Card>}
  </>
}

// ---- Memory & correlations
function Memory() {
  const [tick, setTick] = useState(0), C = useApi(`/api/memory?status=candidate&limit=30&_=${tick}`), P = useApi(`/api/memory?status=proposal&limit=30&_=${tick}`), E = useApi('/api/intel/edges')
  const act = (id, action) => post('/api/memory/action', { id, action }).then(() => setTick((x) => x + 1)).catch((e) => alert(e.message))
  const Item = ({ m }) => <div className="memitem"><b>{m.title}</b><small>{m.body}</small><div className="chips"><Chip>{m.tier}</Chip><Chip>{m.evidence_tag}</Chip><Chip>×{m.n}</Chip></div>
    <div className="seg" role="group" aria-label="Actions"><button onClick={() => act(m.id, 'approve')}>Approve</button><button onClick={() => act(m.id, 'retract')}>Reject</button></div></div>
  return <>
    <Card title="Awaiting confirmation" right={<Chip>{(C.data?.length || 0) + (P.data?.length || 0)}</Chip>}><p className="muted">Coach findings are stored as hypotheses. Only those you approve (or that repeat 3×) become active. Locked rules cannot be changed by the coach.</p>
      {[...(P.data || []), ...(C.data || [])].map((m) => <Item key={m.id} m={m} />)}{C.state === 'ok' && P.state === 'ok' && !C.data.length && !P.data.length && <p className="muted">Nothing is waiting.</p>}</Card>
    <Card title="Correlations (association, not cause)">{E.state === 'ok' && !E.data.length ? <p className="muted">No relationship has passed the statistical controls yet. Expected for now: only {'~'}70 FIT sessions analysed; the more FIT files, the stronger this test.</p> :
      (E.data || []).map((e) => <div key={e.id} className="memitem"><b>{e.exposure} → {e.outcome}</b><small>{e.lag_lo}–{e.lag_hi} days before the run · partial ρ {e.partial_rho} (CI {e.ci_lo}…{e.ci_hi}) · n={e.n} · q={e.q}</small><div className="chips"><Chip tone={e.status === 'supported' ? 'green' : 'yellow'}>{e.status === 'supported' ? 'supported' : e.status === 'candidate' ? 'candidate' : e.status}</Chip></div></div>)}</Card>
  </>
}

const VIEWS = [['coach', 'Coach'], ['dur', 'Durability'], ['twin', 'Twin'], ['mem', 'Memory']]
export default function Coach() {
  const [v, setV] = useState('coach'), st = useApi('/api/intel/status')
  return <Screen title="Coach" sub="Monitoring · analysis · guidance toward sub-4:00">
    <div className="seg3" role="tablist" aria-label="Coach sections">{VIEWS.map(([k, l]) => <button key={k} role="tab" aria-selected={v === k} onClick={() => setV(k)}>{l}</button>)}</div>
    {v === 'coach' && <><Ask st={st.data} /><Recent /><Status st={st.data} /></>}
    {v === 'dur' && <Durability />}
    {v === 'twin' && <><Twin /><LagExplorer /></>}
    {v === 'mem' && <Memory />}
  </Screen>
}

// ---- Home card: today's brief + the two numbers that matter (load guard, sub-4 scenarios)
export function HomeCoach({ go }) {
  const R = useApi('/api/coach/runs'), T = useApi('/api/twin'), t = T.data?.state
  const brief = (R.data || []).find((r) => r.intent === 'daily_brief' && r.ok && r.created_at.slice(0, 10) >= new Date(Date.now() - 20 * 3600e3).toISOString().slice(0, 10)), B = useApi(brief ? `/api/coach/run?id=${brief.id}` : '', !!brief)
  const g = t?.load?.km_vs_4wk_avg_pct, sc = t?.projection?.scenarios
  return <button className="card hero-btn" onClick={() => go('coach')} aria-label="Open Coach">
    <div className="ch"><h2>Coach</h2><Chip>{brief ? 'today\'s brief' : 'no brief yet'}</Chip></div>
    {B.data?.parsed ? <p className="lead">{B.data.parsed.summary}</p> : <p className="muted">{t ? 'No brief today yet — generated automatically after the morning sync, or request one manually in the Coach tab.' : 'The Digital Twin has not been built yet.'}</p>}
    {t && <div className="chips">
      {g != null && <Chip tone={g > 10 ? 'red' : 'green'}>Km vs 4 wk: {g > 0 ? '+' : ''}{g}% (limit +10%)</Chip>}
      {sc && <Chip>Sub-4: {pct(sc[0].p_sub4)} · {pct(sc[1].p_sub4)} · {pct(sc[2].p_sub4)} [MODEL]</Chip>}
    </div>}
  </button>
}
