import { useEffect, useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { useApi, invalidate } from './api.js'
import { post } from './Coach.jsx'

// Tell the coach: the athlete's own account of what a session was really about (the watch cannot know why someone walked) and standing facts.
// Stated by the athlete = fact for the coach; a session marked "not a fitness test" stays out of durability / fade statistics at the next twin rebuild.
const PURPOSES = [['social_walk', 'Walking or an easy outing with someone'], ['cheering_content', 'Cheering zone, filming or making content'], ['helping_others', 'Helping other runners'], ['planned_run_walk', 'Planned run-walk (my strategy)'], ['warmup_cooldown', 'Warm-up or cool-down'], ['other', 'Something else']]
const LABEL = { ...Object.fromEntries(PURPOSES), stop_for_need: 'Toilet, water, traffic or gear', felt_tired: 'Felt tired', heat: 'Heat or sun', pain_or_niggle: 'Pain or a niggle', terrain_or_climb: 'Hill or terrain', planned_pace_change: 'Planned pace change' }
const CHOSEN = ['social_walk', 'cheering_content', 'helping_others', 'planned_run_walk', 'planned_pace_change']
const KIND = { walk: 'Walking', pause: 'Stopped', slow: 'Slowed down', fast: 'Sped up', hr_spike: 'Heart-rate spike' }
const BREAK = ['social_walk', 'cheering_content', 'helping_others', 'planned_run_walk', 'stop_for_need', 'felt_tired', 'heat', 'pain_or_niggle', 'other']
const REASONS = { walk: BREAK, pause: BREAK, slow: ['planned_run_walk', 'terrain_or_climb', 'felt_tired', 'heat', 'pain_or_niggle', 'stop_for_need', 'other'], fast: ['planned_pace_change', 'terrain_or_climb', 'other'], hr_spike: ['heat', 'felt_tired', 'pain_or_niggle', 'planned_pace_change', 'other'] }
const FLAG_COLOR = { walk: '#d98a00', pause: '#d98a00', slow: '#c9b100', fast: '#3b82f6', hr_spike: '#d6453d' }
const rng = (a) => (a.km_to > a.km_from ? `km ${a.km_from}–${a.km_to}` : `km ${a.km_from}`)
const COUNTS_BY_DEFAULT = (p) => ['planned_run_walk', 'warmup_cooldown', 'other'].includes(p)
const wib = (off = 0) => new Date(Date.now() + 7 * 3600e3 - off * 864e5).toISOString().slice(0, 10)
const km = (m) => (m ? (m / 1000).toFixed(1) + ' km' : '')
const dur = (s) => (s ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : '')

function PaceBars({ series, base }) {
  if (!series?.length) return null
  const top = Math.max(...series.map((x) => x.pace || 0).filter((p) => p < (base || 400) * 1.8), base || 400), W = Math.max(series.length * 14, 120), H = 46
  return <svg viewBox={`0 0 ${W} ${H + 12}`} role="img" aria-label="Pace per kilometre, with flagged kilometres coloured" style={{ width: '100%', maxWidth: 560, height: 'auto' }}>
    {series.map((x, i) => { const h = x.pace ? Math.max(3, Math.min(H, (Math.min(x.pace, top) / top) * H)) : 3; return <g key={x.km}><rect x={i * 14 + 1} y={H - h} width={11} height={h} rx={2} fill={x.flag ? FLAG_COLOR[x.flag] : 'currentColor'} opacity={x.flag ? 1 : 0.28} /></g> })}
    <text x={1} y={H + 10} fontSize="8" fill="currentColor" opacity="0.6">km 1</text><text x={W - 1} y={H + 10} fontSize="8" textAnchor="end" fill="currentColor" opacity="0.6">km {series.at(-1).km}</text>
  </svg>
}

function AnomalyCard({ a, date, labelId, saved, onSaved }) {
  const [reason, setReason] = useState(saved?.purpose || ''), [text, setText] = useState(saved && saved.note && !/^km /.test(saved.note) ? saved.note : ''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const save = async () => {
    setBusy(true); setErr('')
    try { await post('/api/session-context', { date, label_id: labelId, km_from: a.km_from, km_to: a.km_to, kind: a.kind, purpose: reason || 'other', note: text }); invalidate('session-context'); onSaved?.() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return <li className="mod" style={{ margin: '8px 0', borderLeft: `4px solid ${FLAG_COLOR[a.kind] || 'var(--border)'}`, paddingLeft: 10 }}>
    <b>{rng(a)} · {KIND[a.kind]}</b> {saved && <Chip tone="green">saved: {LABEL[saved.purpose] || saved.purpose}</Chip>}
    <div className="muted">{a.detail}</div>
    <div className="chiprow" role="group" aria-label={`What happened at ${rng(a)}`}>{(REASONS[a.kind] || BREAK).map((k) => <button key={k} type="button" aria-pressed={reason === k} onClick={() => setReason(reason === k ? '' : k)}>{LABEL[k]}</button>)}</div>
    <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="A few words (optional)" aria-label={`Note for ${rng(a)}`} style={{ width: '100%', marginTop: 4 }} />
    <div className="row2" style={{ gap: 8, marginTop: 6 }}><button type="button" className="btn sm primary" disabled={busy || (!reason && text.trim().length < 3)} onClick={save}>{busy ? 'Saving…' : saved ? 'Update' : 'Save'}</button></div>
    {err && <p className="err" role="alert">{err}</p>}
  </li>
}


// ---- step 2: what stands out in the chosen run (only after "Fetch data")
function Anomalies({ id, date, go, onChosenWalking }) {
  const [tick, setTick] = useState(0), url = go ? (id ? `/api/session-anomalies?id=${encodeURIComponent(id)}` : `/api/session-anomalies?date=${date}`) : '', R = useApi(url ? `${url}&_=${tick}` : '', !!url), d = R.data
  if (!go) return <p className="muted">Press <b>Fetch data</b> to check the kilometres of this session.</p>
  if (R.state === 'error' && !d) return <p className="muted">Could not check the kilometres right now. You can still describe the session below.</p>
  if (R.state === 'loading' || !d) return <p className="muted">Checking the kilometres…</p>
  if (!d.found) return <p className="muted">{d.reason}</p>
  const ask = d.anomalies.filter((a) => a.needs_context), auto = d.anomalies.filter((a) => !a.needs_context), savedFor = (a) => d.saved.find((x) => x.km_from === a.km_from && x.km_to === a.km_to)
  const chosenNote = d.saved.find((x) => CHOSEN.includes(x.purpose) && ['walk', 'pause'].includes(x.kind))
  return <div>
    <PaceBars series={d.series} base={d.base_pace_s_km} />
    <p className="muted">{d.km_total} km · usual running pace {d.base_pace_s_km ? `${Math.floor(d.base_pace_s_km / 60)}:${String(d.base_pace_s_km % 60).padStart(2, '0')}/km` : '—'}</p>
    {!ask.length ? <p className="muted">Nothing unusual to explain: the pace was even and the heart rate rose gradually. You can still describe the session in step 3.</p>
      : <><p className="muted">An even pace and a gradual heart-rate rise are skipped. A heart-rate jump is only listed when neither a climb nor a faster pace explains it.</p>
        <ul className="plain">{ask.map((a) => <AnomalyCard key={`${a.kind}-${a.km_from}`} a={a} date={d.date} labelId={d.label_id} saved={savedFor(a)} onSaved={() => { setTick((x) => x + 1); invalidate('session-anomalies'); invalidate('session-background') }} />)}</ul></>}
    {auto.length > 0 && <details className="more"><summary>{auto.length} heart-rate jump{auto.length > 1 ? 's' : ''} already explained by the data</summary><ul>{auto.map((a) => <li key={a.km_from}>{rng(a)}: {a.detail} <Chip>{a.explained_by}</Chip></li>)}</ul></details>}
    {chosenNote && <div className="mod yellow"><b>You said some of the walking was your choice.</b><div className="muted">The watch still counts it as lost running when it measures durability. Leave the whole session out of fitness and durability statistics?</div>
      <button type="button" className="btn sm" onClick={() => onChosenWalking?.(d.date, chosenNote)}>Leave this session out of fitness stats</button></div>}
  </div>
}

// ---- LEFT column: 1 pick the session, 2 what stands out, 3 your context
function Left({ date, setDate, sel, setSel, fetched, setFetched, sessionNote, edit, setEdit }) {
  const S = useApi(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `/api/activities/merged?from=${date}&to=${date}` : '', /^\d{4}-\d{2}-\d{2}$/.test(date))
  const acts = (S.data || []).filter((a) => ['Run', 'Walk', 'Hike'].includes(a.sport) && a.distance_m > 300).sort((a, b) => (b.distance_m || 0) - (a.distance_m || 0))
  // the longest session of the day is chosen for you; a different day clears the choice
  useEffect(() => { if (acts.length && !acts.some((a) => a.id === sel)) setSel(acts[0].id); if (S.state === 'ok' && !acts.length && sel) setSel('') }, [S.data, date]) // eslint-disable-line
  const [purpose, setPurpose] = useState('social_walk'), [runKm, setRunKm] = useState(''), [walkKm, setWalkKm] = useState(''), [note, setNote] = useState(''), [count, setCount] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState(null)
  useEffect(() => { if (edit) { setPurpose(edit.purpose); setNote(edit.note || ''); setRunKm(edit.run_km ?? ''); setWalkKm(edit.walk_km ?? ''); setCount(!!edit.counts_for_fitness) } }, [edit?.id]) // eslint-disable-line
  const reset = () => { setEdit(null); setNote(''); setRunKm(''); setWalkKm(''); setPurpose('social_walk'); setCount(false) }
  const choose = (p) => { setPurpose(p); setCount(COUNTS_BY_DEFAULT(p)) }
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && note.trim().length >= 5
  const save = async () => {
    setBusy(true); setMsg(null)
    try { await post('/api/session-context', { id: edit?.id, date, purpose, note, run_km: runKm, walk_km: walkKm, intentional_walking: purpose !== 'other', counts_for_fitness: count }); invalidate('session-context'); invalidate('session-background'); reset(); setMsg({ ok: true, text: 'Saved. The coach uses it from its next answer; the twin picks it up at the next analysis run.' }) }
    catch (e) { setMsg({ ok: false, text: e.message }) }
    setBusy(false)
  }
  const key = sel || date
  return <div>
    <Card title="1 · Pick the session">
      <label>Date<input type="date" value={date} max={wib()} onChange={(e) => { setDate(e.target.value); setSel(''); setFetched('') }} aria-label="Date" /></label>
      <label>Session<select value={sel} onChange={(e) => { setSel(e.target.value); setFetched('') }} aria-label="Session" disabled={!acts.length}>
        {!acts.length ? <option value="">{S.state === 'loading' ? 'Looking for sessions…' : 'No run, walk or hike on this date'}</option> : acts.map((a) => <option key={a.id} value={a.id}>{a.sport} · {km(a.distance_m)} · {dur(a.duration_s)}{a.name ? ` · ${a.name}` : ''}</option>)}</select></label>
      <div className="row2" style={{ gap: 8, marginTop: 6 }}><button type="button" className="btn primary" disabled={!date || S.state === 'loading'} onClick={() => setFetched(key)}>Fetch data</button>{fetched && fetched === key && <Chip tone="green">checked</Chip>}</div>
    </Card>
    <Card title="2 · What stands out in this run">
      <Anomalies id={sel} date={date} go={!!fetched && fetched === key} onChosenWalking={async (d, k) => { try { await post('/api/session-context', { date: d, purpose: k?.purpose || 'other', note: 'Part of the walking in this session was my choice (see the notes per kilometre).', intentional_walking: true, counts_for_fitness: false }); invalidate('session-context'); invalidate('session-background'); setMsg({ ok: true, text: 'Saved: this session stays out of fitness and durability statistics.' }) } catch (e) { setMsg({ ok: false, text: e.message }) } }} />
    </Card>
    <Card title={edit ? '3 · Edit your context' : '3 · Add your context'} right={<Chip tone="blue">your words count as fact</Chip>}>
      {sessionNote && !edit ? <div><p className="muted">You already gave context for this day:</p><p><b>{LABEL[sessionNote.purpose] || sessionNote.purpose}</b>: {sessionNote.note}</p><button type="button" className="btn" onClick={() => setEdit(sessionNote)}>Edit</button></div> : <>
        {edit && <p className="muted">Editing a saved note. <button type="button" className="link" onClick={reset}>Cancel</button></p>}
        <div className="chiprow" role="group" aria-label="What it was">{PURPOSES.map(([k, l]) => <button key={k} type="button" aria-pressed={purpose === k} onClick={() => choose(k)}>{l}</button>)}</div>
        <div className="row2" style={{ gap: 8 }}>
          <label style={{ flex: 1 }}>Running km (optional)<input inputMode="decimal" value={runKm} onChange={(e) => setRunKm(e.target.value)} placeholder="e.g. 8" aria-label="Running km" /></label>
          <label style={{ flex: 1 }}>Walking km (optional)<input inputMode="decimal" value={walkKm} onChange={(e) => setWalkKm(e.target.value)} placeholder="e.g. 3" aria-label="Walking km" /></label>
        </div>
        <textarea className="ask" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="In your own words, e.g. “Ran about 8 km, then walked 3 km with my partner. Easy social outing, not fatigue.”" aria-label="What happened" />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={count} onChange={(e) => setCount(e.target.checked)} />Count this session in my fitness and durability statistics</label>
        <small className="muted">Leave it unticked when the walking was your choice: the session then stays out of fade and durability numbers.</small>
        <div className="row2" style={{ gap: 8, marginTop: 8 }}><button type="button" className="btn primary" disabled={!ok || busy} onClick={save}>{busy ? 'Saving…' : edit ? 'Save changes' : 'Save for the coach'}</button></div></>}
      {msg && <p className={msg.ok ? 'muted' : 'err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </Card>
  </div>
}

// ---- RIGHT column: what is saved for this day, and what the data knows about the day
const f = (x, u = '') => (x == null ? '—' : `${x}${u}`)
function Right({ date, onEdit, onOpenKm }) {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date), B = useApi(ok ? `/api/session-background?date=${date}` : '', ok), b = B.data
  const del = async (id) => { if (!confirm('Remove this note? The coach will read this part of the session from the watch data again.')) return; try { await post('/api/session-context/delete', { id }); invalidate('session-context'); invalidate('session-background'); invalidate('session-anomalies') } catch (e) { alert(e.message) } }
  if (!ok) return <Card title="Saved context"><p className="muted">Pick a date to see what is saved and what the data knows about that day.</p></Card>
  const saved = b?.saved || []
  return <div>
    <Card title={`Saved context · ${date}`} right={<Chip>{saved.length} {saved.length === 1 ? 'note' : 'notes'}</Chip>}>
      {!b ? <p className="muted">Loading…</p> : !saved.length ? <p className="muted">Nothing saved for this day yet. Below is what the data shows, to help you recall what happened.</p>
        : <ul className="plain">{saved.map((r) => <li key={r.id} style={{ margin: '10px 0' }}><b>{r.km_from != null ? `${rng(r)}${r.kind ? ' · ' + KIND[r.kind] : ''}` : 'Whole session'}</b> · {LABEL[r.purpose] || r.purpose}
          <div>{r.note}</div>
          <div className="chips" style={{ marginTop: 2 }}>{r.intentional_walking ? <Chip>walking by choice</Chip> : null}{r.km_from == null && (r.counts_for_fitness ? <Chip tone="green">counts in fitness stats</Chip> : <Chip tone="yellow">not a fitness test</Chip>)}{r.run_km != null && <Chip>{r.run_km} km run</Chip>}{r.walk_km != null && <Chip>{r.walk_km} km walk</Chip>}</div>
          <button type="button" className="btn sm" onClick={() => (r.km_from == null ? onEdit(r) : onOpenKm())}>Edit</button> <button type="button" className="btn sm" onClick={() => del(r.id)}>Remove</button></li>)}</ul>}
    </Card>
    <Card title="Background for the day" right={<Chip>from your data</Chip>}>
      {!b ? <p className="muted">Loading…</p> : <ul className="plain" style={{ margin: 0 }}>
        <li><b>Weather</b>: {b.weather ? (b.weather.indoor ? 'indoor' : `${f(b.weather.temp_c, ' °C')} · ${f(b.weather.humidity_pct, '% humidity')} · WBGT ${f(b.weather.wbgt)}${b.weather.hot_for_running ? ' (hot for running)' : ''} · wind ${f(b.weather.wind_ms, ' m/s')}`) : 'not pulled for this session'}</li>
        <li><b>Body that morning</b>: {b.body?.that_morning ? `sleep ${f(b.body.that_morning.sleep_h, ' h')} · sleep HR ${f(b.body.that_morning.sleep_hr)} · HRV ${f(b.body.that_morning.hrv_vs_baseline)} vs baseline · resting HR ${f(b.body.that_morning.resting_hr)} · felt ${f(b.body.that_morning.feel_1_5, '/5')}` : 'no sleep or HRV data'}</li>
        <li><b>Load</b>: {b.body?.last_7_days ? `last 7 days ${f(b.body.last_7_days.run_km, ' km')}, load ${f(b.body.last_7_days.load)}` : '—'}{b.body?.day_before ? ` · day before ${f(b.body.day_before.run_km, ' km')}${b.body.day_before.lower_body_gym ? ' + lower-body gym' : ''}` : ''}</li>
        <li><b>Shoe</b>: {b.shoe || 'not recorded'} · <b>Plan</b>: {b.plan ? `${b.plan.kind}${b.plan.km ? ` ${b.plan.km} km` : ''}${b.plan.label ? ` · ${b.plan.label}` : ''}` : 'none kept for this day'}</li>
        <li><b>Pain log (±3 days)</b>: {b.pain_log?.length ? b.pain_log.map((p) => `${p.date.slice(5)} ${p.pain ?? 'not logged'}`).join(' · ') : 'no check-ins around this day'}</li>
        <li><b>Injury history</b>: {b.injury?.tracked ? `last pain logged ${f(b.injury.tracked.last_pain_date) === '—' ? 'never' : b.injury.tracked.last_pain_date} · ${f(b.injury.tracked.pain_events_90d)} pain events in 90 days (${f(b.injury.tracked.days_logged_90d)} days logged, so the log is thin)` : '—'}
          {b.injury?.notes?.length > 0 && <ul>{b.injury.notes.map((n) => <li key={n.id}><code>#{n.id}</code> {n.title} <span className="muted">{n.tag}{n.valid_from ? ` · ${n.valid_from}` : ''}</span></li>)}</ul>}</li>
        <li><b>Your earlier notes</b>: {b.previous_context?.length ? <ul>{b.previous_context.map((p) => <li key={p.date}>{p.date} · {LABEL[p.purpose] || p.purpose}: {p.note}{p.counts_for_fitness ? '' : ' (not a fitness test)'}</li>)}</ul> : 'none before this day'}</li>
      </ul>}
    </Card>
  </div>
}

function AllNotes({ onEdit }) {
  const C = useApi('/api/session-context'), items = C.data?.items || []
  return <details className="more"><summary>All notes you have given ({items.length})</summary>
    {!items.length ? <p className="muted">Nothing yet.</p> : <ul className="plain">{items.map((r) => <li key={r.id} style={{ margin: '6px 0' }}><button type="button" className="link" onClick={() => onEdit(r)}><b>{r.date}</b></button>{r.km_from != null ? ` · ${rng(r)}${r.kind ? ' · ' + KIND[r.kind] : ''}` : ''} · {LABEL[r.purpose] || r.purpose}: {r.note}</li>)}</ul>}</details>
}

function Facts() {
  const F = useApi('/api/athlete-fact'), items = F.data?.items || [], [text, setText] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const add = async () => { setBusy(true); setErr(''); try { await post('/api/athlete-fact', { text }); setText(''); invalidate('athlete-fact') } catch (e) { setErr(e.message) } setBusy(false) }
  const drop = async (id) => { if (!confirm('Remove this fact?')) return; try { await post('/api/memory/action', { id, action: 'retract' }); invalidate('athlete-fact') } catch (e) { alert(e.message) } }
  return <Card title="Add a lasting fact" right={<Chip tone="blue">kept as your statement</Chip>}>
    <p className="muted">Things that stay true and the watch cannot show: how you like to race, who you run with, what you do at events.</p>
    <textarea className="ask" rows={2} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. “At events I often stop to cheer, film content or help other runners; walking there is a choice, not fatigue.”" aria-label="A lasting fact" />
    <div className="row2" style={{ gap: 8 }}><button type="button" className="btn primary" disabled={busy || text.trim().length < 8} onClick={add}>{busy ? 'Saving…' : 'Save fact'}</button></div>
    {err && <p className="err" role="alert">{err}</p>}
    {items.length > 0 && <ul className="plain" style={{ marginTop: 10 }}>{items.map((f) => <li key={f.id} style={{ margin: '8px 0' }}>{f.body} <button type="button" className="btn sm" onClick={() => drop(f.id)}>Remove</button></li>)}</ul>}
  </Card>
}


export default function TellCoach() {
  const R = useApi(`/api/activities/merged?from=${wib(60)}&to=${wib()}`)
  const [date, setDate] = useState(''), [sel, setSel] = useState(''), [fetched, setFetched] = useState(''), [edit, setEdit] = useState(null)
  // start on the most recent run so there is something to look at straight away
  useEffect(() => { if (!date && R.data) { const last = (R.data || []).filter((a) => a.sport === 'Run').sort((a, b) => (a.date < b.date ? 1 : -1))[0]; setDate(last?.date || wib()) } }, [R.data]) // eslint-disable-line
  const B = useApi(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `/api/session-background?date=${date}` : '', /^\d{4}-\d{2}-\d{2}$/.test(date)), sessionNote = (B.data?.saved || []).find((x) => x.km_from == null) || null
  const openKm = () => { const el = document.getElementById('tell-left'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setFetched(sel || date) }
  const editNote = (r) => { setDate(r.date); setSel(''); setFetched(''); if (r.km_from == null) setEdit(r); else setFetched(r.date); document.getElementById('tell-left')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  return <div className="rgrid">
    <div id="tell-left"><Left date={date} setDate={setDate} sel={sel} setSel={setSel} fetched={fetched} setFetched={setFetched} sessionNote={sessionNote} edit={edit} setEdit={setEdit} /></div>
    <div><Right date={date} onEdit={(r) => setEdit(r)} onOpenKm={openKm} /><Facts /><AllNotes onEdit={editNote} /></div>
  </div>
}
export { Left, Right }
