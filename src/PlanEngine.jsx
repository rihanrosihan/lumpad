import { useState } from 'react'
import { useApi } from './api.js'
import { Card, Chip, Screen, SegmentedTabs } from './ui.jsx'
import { fmtShort, fmtLong } from './lib/calendar.js'
import * as U from './lib/planui.js'
import './plan-engine.css'

export async function send(method, path, body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }), j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status)
  return j
}
const useAct = (after) => { const [busy, setBusy] = useState(false), [msg, setMsg] = useState(null)
  const run = async (fn, ok) => { setBusy(true); setMsg(null); try { const r = await fn(); setMsg({ tone: 'green', text: typeof ok === 'function' ? ok(r) : ok || 'Done' }); after?.(r) } catch (e) { setMsg({ tone: 'red', text: e.message }) } setBusy(false) }
  return { busy, msg, run } }
const Msg = ({ msg }) => (msg ? <p className={`pe-msg ${msg.tone}`} role="status">{msg.text}</p> : null)

// weekly km, old plan (grey) vs proposed (accent). Text alternative below for screen readers.
function WeekChart({ series }) {
  if (!series.length) return null
  const W = 640, H = 150, pad = 24, max = Math.max(10, ...series.flatMap((s) => [s.before, s.after])), bw = (W - pad) / series.length
  return <figure className="pe-chart"><svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Weekly km, old plan versus proposed, ${series.length} weeks. Old peak ${Math.max(...series.map((s) => s.before))} km, proposed peak ${Math.max(...series.map((s) => s.after))} km.`}>
    {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad} x2={W} y1={H - f * (H - 8)} y2={H - f * (H - 8)} className="pe-grid" /><text x={0} y={H - f * (H - 8) + 4} className="pe-ax">{Math.round(max * f)}</text></g>)}
    {series.map((s, i) => { const x = pad + i * bw, h = (v) => (v / max) * (H - 8); return <g key={s.monday}><rect x={x + 1} y={H - h(s.before)} width={Math.max(1, bw / 2 - 1)} height={h(s.before)} className="pe-bar old"><title>{fmtShort(s.monday)} old {s.before} km</title></rect><rect x={x + bw / 2} y={H - h(s.after)} width={Math.max(1, bw / 2 - 1)} height={h(s.after)} className="pe-bar new"><title>{fmtShort(s.monday)} new {s.after} km</title></rect></g> })}
    <text x={pad} y={H + 14} className="pe-ax">{fmtShort(series[0].monday)}</text><text x={W} y={H + 14} textAnchor="end" className="pe-ax">{fmtShort(series.at(-1).monday)}</text>
  </svg><figcaption><i className="pe-key old" /> old plan <i className="pe-key new" /> proposed · km per week</figcaption></figure>
}
const DiffList = ({ diff }) => <div className="pe-diff">{U.diffGroups(diff).map((g) => <details key={g.monday}><summary>Week of {fmtShort(g.monday)} <Chip tone={g.delta < 0 ? 'yellow' : g.delta > 0 ? 'red' : undefined}>{g.delta > 0 ? '+' : ''}{g.delta} km</Chip></summary>
  <ul>{g.days.map((d) => <li key={d.date}><b>{fmtShort(d.date)}</b><span><s>{U.dayText(d.before)}</s> → {U.dayText(d.after)}</span></li>)}</ul></details>)}</div>

function Proposal({ p, onDone }) {
  const A = useAct(onDone), s = p.summary || {}, macro = p.loop === 'macro'
  return <Card title={`${macro ? 'Season plan' : 'Change'} · ${U.proposalKind(p)}`} right={<Chip tone="yellow">proposed</Chip>}>
    <p>{p.rationale_det}</p>
    {macro && <>
      <WeekChart series={U.weeklySeries(s)} />
      <ul className="pe-stats"><li><b>{s.peak_before} → {s.peak_after}</b><span>peak km/week</span></li><li><b>{s.changed_days}</b><span>days change</span></li><li><b>{s.key_session_changes}</b><span>key sessions touched</span></li><li><b>{s.guard_baseline === 'build' ? 'build weeks' : 'as written'}</b><span>load-guard baseline</span></li></ul>
      {s.conflicts?.length > 0 && <><h3>Checkpoints postponed ({s.conflicts.length})</h3><ul className="pe-list">{s.conflicts.map((c) => <li key={c.date}><b>{fmtShort(c.date)}</b> {c.label}: {c.why}</li>)}</ul></>}
      {s.kept_violations > 0 && <p className="muted">The current week is already over the load guard and sits inside the frozen horizon; it is kept as is.</p>}
    </>}
    <h3>What changes</h3><DiffList diff={p.diff || []} />
    <p className="pe-rules">{(p.rules || []).map((r) => <Chip key={r.id} tone="green">{r.id}</Chip>)}</p>
    <div className="row2"><button className="btn primary sm" disabled={A.busy} onClick={() => A.run(() => send('POST', '/api/plan/proposals/accept', { adjustment_id: p.id }), (r) => `Accepted. ${r.sync?.synced ? 'The plan is updated.' : 'Stored; the app keeps showing plan.json until the plan engine is the live source.'}`)}>Accept</button>
      <button className="btn sm" disabled={A.busy} onClick={() => A.run(() => send('POST', '/api/plan/proposals/reject', { adjustment_id: p.id }), 'Rejected')}>Reject</button></div>
    <Msg msg={A.msg} />
  </Card>
}
function Generate({ goals, onDone }) {
  const A = useAct(onDone), A1 = goals.find((g) => g.cls === 'A'), [mode, setMode] = useState(A1?.params?.guard_baseline || 'literal'), [cut, setCut] = useState(A1?.params?.cutback_ratio ?? 0.9), [cap, setCap] = useState(A1?.params?.peak_cap_km ?? 60)
  return <Card title="Build a season plan" right={<Chip>engine only · no AI</Chip>}>
    <p className="muted">From your actual recent volume, your goals and your availability. Nothing changes until you accept the proposal.</p>
    <div className="pe-form">
      <label>Load guard baseline<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="literal">The rule as written (previous 4 weeks)</option><option value="build">Previous 4 build weeks (down weeks excluded)</option></select></label>
      <label>Cutback week<select value={cut} onChange={(e) => setCut(+e.target.value)}>{[1, 0.9, 0.85, 0.75].map((v) => <option key={v} value={v}>{v === 1 ? 'none' : `−${Math.round((1 - v) * 100)} %`}</option>)}</select></label>
      <label>Peak cap km/week<input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
    </div>
    <p className="muted">Read literally, the load guard limits growth to about 4 % a week and every taper lowers the baseline. The second option is a decision for you, not a default.</p>
    <button className="btn primary" disabled={A.busy || !goals.length} onClick={() => A.run(() => send('POST', '/api/plan/macro', { guard_baseline: mode, cutback_ratio: cut === 1 ? undefined : cut, cutback_every: cut === 1 ? 0 : undefined, peak_cap_km: +cap || undefined }), (r) => (r.ok ? (r.no_change ? 'The plan already matches.' : r.duplicate ? 'This proposal already exists below.' : `Proposal created: peak ${r.summary?.peak_before} → ${r.summary?.peak_after} km/week.`) : r.held ? `Held: ${r.reason}` : `Not proposed: ${r.reason}`))}>{A.busy ? 'Building…' : 'Generate proposal'}</button>
    {!goals.length && <p className="muted">Add or seed your goals first (Goals tab).</p>}<Msg msg={A.msg} />
  </Card>
}
function Proposals({ rev, bump }) {
  const P = useApi('/api/plan/proposals?r=' + rev), S = useApi('/api/plan/status?r=' + rev), G = useApi('/api/plan/goals?r=' + rev)
  const list = P.data?.proposals || [], goals = G.data?.goals || [], trig = (P.data?.triggers || []).filter((t) => t.status === 'new')
  return <>
    {S.data && S.data.source !== 'engine' && <Card tone="red" title="Plan engine is not the live plan"><p>The app is still reading <b>plan.json</b> (source: {S.data.source}). Changes you accept are stored in the engine but the Calendar, Home and the coach keep showing the old plan until the engine is switched on.</p></Card>}
    <Generate goals={goals} onDone={bump} />
    {P.state === 'loading' && <div className="card skel" aria-busy="true" />}
    {P.state === 'error' && <Card tone="red" title="Could not load proposals"><p>The plan engine is not reachable (or no plan database exists yet).</p></Card>}
    {P.state === 'ok' && !list.length && <Card title="Proposals"><p className="muted">Nothing waiting for your decision.</p></Card>}
    {list.map((p) => <Proposal key={p.id} p={p} onDone={bump} />)}
    {trig.length > 0 && <Card title={`Open triggers (${trig.length})`}><ul className="pe-list">{trig.map((t) => <li key={t.id}><Chip>{t.route}</Chip> <b>{t.type}</b> · {t.at.slice(0, 10)}</li>)}</ul></Card>}
  </>
}

function Goals({ rev, bump }) {
  const G = useApi('/api/plan/goals?r=' + rev), [f, setF] = useState(null), A = useAct(() => { setF(null); bump() }), S = useAct(bump)
  const goals = G.data?.goals || [], set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = () => { const { errors, payload } = U.goalToPayload(f); if (errors.length) return A.run(async () => { throw new Error(errors.join('; ')) }); A.run(() => send('PUT', '/api/plan/goal', payload), 'Saved') }
  return <>
    <Card title="Goals" right={<button className="btn sm" onClick={() => setF(U.blankGoal())}>Add goal</button>}>
      {!goals.length && <p className="muted">No goals yet. <button className="btn sm" disabled={S.busy} onClick={() => S.run(() => send('POST', '/api/plan/goals/seed', {}), (r) => `${r.seeded} goals added from the race calendar`)}>Seed from the race calendar</button></p>}
      {goals.map((g) => <div key={g.id} className="rowbtn plain pe-goal"><Chip tone={g.cls === 'A' ? 'red' : g.cls === 'B' ? 'yellow' : undefined}>{g.cls}</Chip><span><b>{g.name}</b><small>{fmtLong(g.race_date)} · {U.fmtDist(g.distance_m)} · {U.fmtTarget(g.target_s)}{Object.keys(g.params || {}).length ? ' · ' + Object.entries(g.params).map(([k, v]) => `${k}=${v}`).join(', ') : ''}</small></span>
        <button className="btn sm" onClick={() => setF(U.goalToForm(g))}>Edit</button></div>)}<Msg msg={S.msg} />
    </Card>
    {f && <Card title={f.id ? 'Edit goal' : 'New goal'}>
      <div className="pe-form">
        <label>Race date<input type="date" value={f.race_date} onChange={set('race_date')} /></label><label>Name<input value={f.name} onChange={set('name')} maxLength={80} /></label>
        <label>Class<select value={f.cls} onChange={set('cls')}>{U.GOAL_CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Distance (km)<input inputMode="decimal" value={f.distance_km} onChange={set('distance_km')} /></label><label>Target time (hours, blank = finish)<input inputMode="decimal" value={f.target_h} onChange={set('target_h')} /></label>
        <label>Peak cap km/week (optional)<input inputMode="numeric" value={f.peak_cap_km} onChange={set('peak_cap_km')} /></label>
        <label>Load guard baseline<select value={f.guard_baseline} onChange={set('guard_baseline')}><option value="">engine default (as written)</option><option value="literal">as written</option><option value="build">previous 4 build weeks</option></select></label>
        <label>Cutback ratio (0.5–1)<input inputMode="decimal" value={f.cutback_ratio} onChange={set('cutback_ratio')} /></label>
      </div>
      <div className="row2"><button className="btn primary sm" disabled={A.busy} onClick={save}>Save</button>{f.id && <button className="btn sm" disabled={A.busy} onClick={() => A.run(() => send('PUT', '/api/plan/goal', { ...U.goalToPayload(f).payload, status: 'archived' }), 'Archived')}>Archive</button>}</div>
      <button className="btn ghost full" onClick={() => setF(null)}>Cancel</button><Msg msg={A.msg} />
      <p className="muted">Saving a goal queues a season-plan rebuild; it only becomes a proposal when you ask for one.</p>
    </Card>}
  </>
}

function Availability({ rev, bump }) {
  const D = useApi('/api/plan/availability?r=' + rev), [form, setForm] = useState(null), A = useAct(bump)
  const f = form || (D.data ? U.availabilityToForm(D.data) : null)
  if (!f) return <div className="card skel" aria-busy="true" />
  const row = (i, k) => (e) => setForm({ ...f, rows: f.rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)) })
  const exc = (i, k) => (e) => setForm({ ...f, exceptions: f.exceptions.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)) })
  const save = () => { const { errors, payload } = U.availabilityToPayload(f); if (errors.length) return A.run(async () => { throw new Error(errors.join('; ')) }); A.run(() => send('PUT', '/api/plan/availability', payload), 'Saved; a season-plan rebuild is queued').then?.(() => setForm(null)) }
  return <Card title="When can you run?" right={<Chip>minutes per day</Chip>}>
    <p className="muted">Blank = no limit. <b>0</b> = no run that day. The longest session on a day never exceeds its minutes.</p>
    <div className="pe-av">{f.rows.map((r, i) => <div key={r.dow} className="pe-avrow"><b>{U.DOW_NAMES[r.dow]}</b>
      <input aria-label={`${U.DOW_NAMES[r.dow]} minutes`} inputMode="numeric" placeholder="no limit" value={r.minutes} onChange={row(i, 'minutes')} />
      <select aria-label={`${U.DOW_NAMES[r.dow]} preference`} value={r.pref} onChange={row(i, 'pref')}>{U.PREFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>)}</div>
    <h3>Exceptions (travel, work, …)</h3>
    {f.exceptions.map((e, i) => <div key={i} className="pe-avrow"><input type="date" aria-label="exception date" value={e.date} onChange={exc(i, 'date')} /><input aria-label="exception minutes" inputMode="numeric" placeholder="0 = off" value={e.minutes} onChange={exc(i, 'minutes')} /><button className="btn sm" onClick={() => setForm({ ...f, exceptions: f.exceptions.filter((_, j) => j !== i) })}>Remove</button></div>)}
    <div className="row2"><button className="btn sm" onClick={() => setForm({ ...f, exceptions: [...f.exceptions, { date: '', minutes: '0' }] })}>Add exception</button><button className="btn primary sm" disabled={A.busy} onClick={save}>Save</button></div><Msg msg={A.msg} />
  </Card>
}

function Zones({ rev }) {
  const Z = useApi('/api/plan/zones?r=' + rev)
  if (Z.state === 'loading') return <div className="card skel" aria-busy="true" />
  if (Z.state === 'error' || !Z.data) return <Card title="Training zones"><p className="muted">No zone set yet. It is created the first time the benchmark watch runs (<code>server/plan/cli.js resolve</code>).</p></Card>
  const z = Z.data.zone_set, label = { override: 'your setting', measured: 'measured', default: 'default' }
  return <>
    <Card title={`Zone set v${z.version}`}><table className="pe-table"><thead><tr><th>Zone</th><th>Heart rate</th><th>Pace /km</th></tr></thead><tbody>{z.names.map((n, i) => <tr key={n}><td>Z{i + 1} {n}</td><td>{z.hr[i][0]}–{z.hr[i][1] >= 999 ? '+' : z.hr[i][1]}</td><td>{fmtPace(z.pace[i][0])}–{fmtPace(z.pace[i][1])}</td></tr>)}</tbody></table></Card>
    <Card title="Where the numbers come from"><ul className="pe-list">{Z.data.benchmarks.map((b) => <li key={b.id}><b>{b.metric}</b> {Array.isArray(b.value) ? b.value.join(', ') : b.value} <Chip tone={b.label === 'override' ? 'yellow' : b.label === 'measured' ? 'green' : undefined}>{label[b.label]}</Chip> <small>{b.source}</small></li>)}</ul>
      <p className="muted">A threshold-pace or LTHR setting you entered always wins over what COROS measures. If an old value is still stored, clear it in Profile › Training zones.</p></Card>
  </>
}
const fmtPace = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

function Audit({ rev, bump }) {
  const L = useApi('/api/plan/audit?limit=60&r=' + rev), A = useAct(bump)
  const rows = L.data || []
  return <Card title="Plan changes">{L.state === 'loading' && <div className="skel" />}{L.state === 'ok' && !rows.length && <p className="muted">No changes yet.</p>}
    {rows.map((a) => <div key={a.id} className="pe-audit"><div><Chip tone={a.status === 'applied' ? 'green' : a.status === 'proposed' ? 'yellow' : undefined}>{a.status}</Chip> <Chip>{a.loop}</Chip> {a.auto ? <Chip tone="yellow">auto</Chip> : null} <small>{a.created_at.slice(0, 16).replace('T', ' ')} UTC · {a.scope_from.slice(5)} → {a.scope_to.slice(5)}</small></div>
      <p>{a.rationale_det}</p>{a.status === 'applied' && a.loop !== 'import' && <button className="btn sm" disabled={A.busy} onClick={() => A.run(() => send('POST', '/api/plan/revert', { adjustment_id: a.id }), 'Reverted')}>Undo this change</button>}</div>)}<Msg msg={A.msg} /></Card>
}

const TABS = [{ id: 'proposals', label: 'Proposals' }, { id: 'goals', label: 'Goals' }, { id: 'avail', label: 'Availability' }, { id: 'zones', label: 'Zones' }, { id: 'audit', label: 'History' }]
export default function PlanEngine() {
  const [tab, setTab] = useState('proposals'), [rev, setRev] = useState(0), bump = () => setRev((r) => r + 1)
  return <Screen title="Plan engine" sub="Adaptive season plan: you decide, the engine checks every change against your rules">
    <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} label="Plan engine sections" />
    {tab === 'proposals' && <Proposals rev={rev} bump={bump} />}{tab === 'goals' && <Goals rev={rev} bump={bump} />}{tab === 'avail' && <Availability rev={rev} bump={bump} />}{tab === 'zones' && <Zones rev={rev} />}{tab === 'audit' && <Audit rev={rev} bump={bump} />}
  </Screen>
}
export { Proposal, WeekChart, DiffList, Generate, Goals, Availability }
