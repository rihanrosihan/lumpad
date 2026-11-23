import { useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { useApi, invalidate } from './api.js'
import { post } from './Coach.jsx'

// Coach Studio cards: ask the knowledge graph, audit the knowledge base, review extracted memories by document, and the next-race briefing.

const SUGGEST = ['What went wrong at Borobudur and which open items concern it?', 'What did heat do to my marathons?', 'Which open items concern MTSS or my thigh?', 'How did my long runs fade, km by km?', 'What do my documents say about fuelling and caffeine?', 'Which conflicts were resolved about my race targets?']
export function GraphAsk() {
  const [q, setQ] = useState(''), [busy, setBusy] = useState(false), [turns, setTurns] = useState([]), [err, setErr] = useState(''), [saved, setSaved] = useState({})
  const go = async (text) => {
    const question = (text ?? q).trim(); if (question.length < 3 || busy) return
    setBusy(true); setErr('')
    try { const r = await post('/api/graph/ask', { question, history: turns.filter((t) => t.res?.ok).slice(-2).map((t) => ({ q: t.q, a: t.res.answer_md })) }); setTurns((t) => [...t, { q: question, res: r }]); setQ('') } catch (e) { setErr(e.message || 'Failed') }
    setBusy(false)
  }
  const save = async (i) => { const t = turns[i]; try { await post('/api/graph/save', { question: t.q, answer_md: t.res.answer_md, paths: t.res.paths, evidence: t.res.evidence }); setSaved((s) => ({ ...s, [i]: true })); invalidate('memory') } catch (e) { setErr(e.message || 'Failed') } }
  return <Card title="Ask your knowledge graph" right={<><Chip tone="blue">answers only from graph evidence</Chip>{turns.length > 0 && <button type="button" className="btn sm" onClick={() => { setTurns([]); setSaved({}) }}>New conversation</button>}</>}>
    {turns.map((t, i) => <div key={i} style={{ marginBottom: 12 }}>
      <p><b>{t.q}</b></p>
      {!t.res.ok ? <p className="err" role="alert">{t.res.error}</p> : <>
        <div style={{ whiteSpace: 'pre-wrap' }}>{t.res.answer_md}</div>
        {t.res.paths?.length > 0 && <details className="more"><summary>Graph paths used ({t.res.paths.length})</summary><ul>{t.res.paths.map((p, k) => <li key={k}><code>{p}</code></li>)}</ul></details>}
        {t.res.gaps?.length > 0 && <p className="muted">Not in the graph: {t.res.gaps.join(' · ')}</p>}
        <small className="muted">Evidence read: {Object.entries(t.res.evidence || {}).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' · ') || 'none'}{t.res.model ? ` · ${t.res.model}` : ''} </small>
        {' '}<button type="button" className="btn sm" disabled={saved[i]} onClick={() => save(i)}>{saved[i] ? '✓ Saved for review' : 'Save as memory (for review)'}</button></>}
    </div>)}
    <form onSubmit={(e) => { e.preventDefault(); go() }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <input style={{ flex: '1 1 260px' }} value={q} maxLength={400} onChange={(e) => setQ(e.target.value)} placeholder={turns.length ? 'Follow-up, e.g. "and the heat?"' : 'Ask about a race, a shoe, a document, a topic…'} aria-label="Question for the knowledge graph" />
      <button type="submit" className="btn sm primary" style={{ width: 'auto' }} disabled={busy || q.trim().length < 3}>{busy ? 'Reading the graph…' : turns.length ? 'Follow up' : 'Ask'}</button>
    </form>
    {!turns.length && <div className="chiprow" role="group" aria-label="Suggested questions" style={{ marginTop: 8 }}>{SUGGEST.map((s) => <button key={s} type="button" disabled={busy} onClick={() => go(s)}>{s}</button>)}</div>}
    {err && <p className="err" role="alert">{err}</p>}
  </Card>
}

const SEV = { high: 'red', medium: 'yellow', low: 'gray' }
export function KbAudit() {
  const [tick, setTick] = useState(0), [err, setErr] = useState('')
  const A = useApi(`/api/kb/audit?_=${tick}`), a = A.data
  const ack = async (id, action, days) => { try { await post('/api/kb/audit/ack', { id, action, days }); invalidate('kb/audit'); setTick((x) => x + 1) } catch (e) { setErr(e.message) } }
  return <Card title="Knowledge-base audit" right={a && <Chip tone={a.items.some((x) => x.severity === 'high') ? 'red' : a.findings ? 'yellow' : 'green'}>{a.findings} to look at{a.hidden ? ` · ${a.hidden} hidden` : ''}</Chip>}>
    {!a ? <p className="muted">Checking {A.state === 'error' ? ' failed' : '…'}</p> : !a.items.length ? <p className="muted">Nothing left to look at in {a.docs} documents.</p> :
      <ul className="plain">{a.items.map((f) => <li key={f.id} style={{ margin: '10px 0' }}><Chip tone={SEV[f.severity]}>{f.severity}</Chip> <b>{f.title}</b>{f.detail ? <div className="muted">{f.detail}</div> : null}
        {f.action && <div><b>What to do:</b> {f.action}</div>}
        <button type="button" className="btn sm" onClick={() => ack(f.id, 'done')}>✓ Done / not an issue</button> <button type="button" className="btn sm" onClick={() => ack(f.id, 'snooze', 30)}>Snooze 30 days</button></li>)}</ul>}
    {err && <p className="err" role="alert">{err}</p>}
    <small className="muted">Deterministic checks of your documents (no model). "Done" or "Snooze" only hides the finding here; it does not change the documents themselves.</small>
  </Card>
}

export function MemoryInbox() {
  const [tick, setTick] = useState(0), [sweeping, setSweeping] = useState(false), [onlyAgreed, setOnlyAgreed] = useState(false), [open, setOpen] = useState(null), [busy, setBusy] = useState(''), [msg, setMsg] = useState(null)
  const I = useApi(`/api/memory/inbox?docs=40${onlyAgreed ? '&agreed=1' : ''}&_=${tick}`), d = I.data
  const act = async (ids, action, label) => {
    if (action === 'approve' && ids.some((id) => d.groups.flatMap((g) => g.items).find((x) => x.id === id)?.tier === 'procedural') && !confirm('This includes RULES. Approved rules become binding for the coach. Approve anyway?')) return
    setBusy(label); setMsg(null)
    try { const r = await post('/api/memory/bulk', { ids, action }); setMsg({ ok: true, text: `${r.done} ${action === 'approve' ? 'approved' : 'retracted'}${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}` }); invalidate('memory'); setTick((x) => x + 1) } catch (e) { setMsg({ ok: false, text: e.message }) }
    setBusy('')
  }
  const sweep = async () => { setSweeping(true); setMsg(null); try { const r = await post('/api/memory/sweep', {}); setMsg({ ok: true, text: `Checked ${r.checked} claims: ${r.stale} look out of date.` }); setTick((x) => x + 1) } catch (e) { setMsg({ ok: false, text: e.message }) } setSweeping(false) }
  return <Card title="Memory inbox — grouped by source document" right={d && <><button type="button" className="btn sm" disabled={sweeping} onClick={sweep} style={{ marginRight: 8 }}>{sweeping ? 'Checking…' : 'Check for stale claims'}</button><label className="muted" style={{ marginRight: 8 }}><input type="checkbox" checked={onlyAgreed} onChange={(e) => setOnlyAgreed(e.target.checked)} /> only claims two models agree on</label><Chip tone={d.total ? 'yellow' : 'green'}>{d.total} waiting</Chip></>}>
    {!d ? <p className="muted">Loading…</p> : !d.groups.length ? <p className="muted">Nothing is waiting for your approval.</p> : d.groups.map((g) => <div key={g.doc} style={{ borderTop: '1px solid var(--line, #8883)', padding: '8px 0' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn sm" aria-expanded={open === g.doc} onClick={() => setOpen(open === g.doc ? null : g.doc)}>{open === g.doc ? '▾' : '▸'} {g.doc} · {g.title}</button>
        <Chip tone="gray">{g.count} claims</Chip>{g.agreed > 0 && <Chip tone="green">{g.agreed} agreed by 2 models</Chip>}{g.stale > 0 && <Chip tone="red">{g.stale} likely out of date</Chip>}{g.rules > 0 && <Chip tone="yellow">{g.rules} rules</Chip>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm primary" style={{ width: 'auto' }} disabled={!!busy} onClick={() => act(g.items.map((x) => x.id), 'approve', g.doc)}>{busy === g.doc ? 'Saving…' : `✓ Approve ${g.count}`}</button>
        {g.stale > 0 && <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(g.items.filter((x) => x.stale).map((x) => x.id), 'retract', g.doc + 's')}>{busy === g.doc + 's' ? 'Saving…' : `✗ Retract the ${g.stale} out of date`}</button>}
        {g.agreed > 0 && g.agreed < g.count && <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(g.items.filter((x) => x.agreed).map((x) => x.id), 'approve', g.doc + 'a')}>{busy === g.doc + 'a' ? 'Saving…' : `✓ Approve the ${g.agreed} agreed`}</button>}
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(g.items.map((x) => x.id), 'retract', g.doc)}>Retract all</button>
      </div>
      {open === g.doc && <ul className="plain" style={{ marginTop: 6 }}>{g.items.map((m) => <li key={m.id} style={{ margin: '8px 0' }}>
        <b>{m.title}</b> <Chip tone={m.tier === 'procedural' ? 'yellow' : 'gray'}>{m.tier === 'procedural' ? 'rule' : m.kind}</Chip> <Chip tone="gray">{m.tag}</Chip>{m.agreed && <Chip tone="green">✓ {m.models.length} models agree</Chip>}{m.stale && <Chip tone="red">may be out of date</Chip>}
        <div>{m.body}</div>
        {m.stale && <div className="muted">⚠ {m.stale}</div>}
        {m.quote && <blockquote className="muted" style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '3px solid #8886' }}>{m.doc_b ? `${g.doc}: ` : ''}“{m.quote}”</blockquote>}
        {m.quote_b && <blockquote className="muted" style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '3px solid #8886' }}>{m.doc_b}: “{m.quote_b}”</blockquote>}
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => act([m.id], 'approve', 'one')}>✓ Approve</button> <button type="button" className="btn sm" disabled={!!busy} onClick={() => act([m.id], 'retract', 'one')}>✗ Retract</button>
      </li>)}</ul>}
    </div>)}
    {d && d.docs > d.groups.length && <p className="muted">Showing the {d.groups.length} largest of {d.docs} documents; approve or retract these to see the rest.</p>}
    {msg && <p className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</p>}
    <small className="muted">Each claim shows the exact sentence it was extracted from. Claims are only a proposal until you approve them; an approved rule binds the coach, so read rules before approving. Some claims may describe a situation that has since changed.</small>
  </Card>
}

export function RaceBrief() {
  const B = useApi('/api/race/brief'), b = B.data
  if (!b?.race) return b ? <Card title="Next race"><p className="muted">{b.suggest}</p></Card> : null
  return <Card title={`Next race: ${b.race.name}`} right={<Chip tone={b.days_to_go <= 21 ? 'red' : b.days_to_go <= 90 ? 'yellow' : 'blue'}>{b.days_to_go} days to go</Chip>}>
    <p>{b.suggest}</p>
    {b.postmortems.length > 0 && <><b>Latest race post-mortems</b><ul>{b.postmortems.map((p) => <li key={p.id}><span className="muted">{p.at}</span> {p.summary || 'saved'}</li>)}</ul></>}
    {b.lessons.length > 0 && <><b>Lessons the coach already holds</b><ul>{b.lessons.map((l) => <li key={l.id}>{l.title} <Chip tone="gray">{l.tag}</Chip><div className="muted">{l.body}</div></li>)}</ul></>}
    {b.race_plan && <p className="muted">Last race plan: {b.race_plan.at} — {b.race_plan.summary}</p>}
  </Card>
}
