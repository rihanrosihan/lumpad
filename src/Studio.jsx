import { useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { useApi, invalidate } from './api.js'
import { post } from './Coach.jsx'

// Coach Studio cards: ask the knowledge graph, audit the knowledge base, review extracted memories by document, and the next-race briefing.

export function GraphAsk() {
  const [q, setQ] = useState(''), [busy, setBusy] = useState(false), [res, setRes] = useState(null), [err, setErr] = useState('')
  const go = async () => { if (q.trim().length < 3 || busy) return; setBusy(true); setErr(''); setRes(null); try { setRes(await post('/api/graph/ask', { question: q })) } catch (e) { setErr(e.message || 'Failed') } setBusy(false) }
  return <Card title="Ask your knowledge graph" right={<Chip tone="blue">answers only from graph evidence</Chip>}>
    <form onSubmit={(e) => { e.preventDefault(); go() }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <input style={{ flex: '1 1 260px' }} value={q} maxLength={400} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What did heat do to my marathons? Which open items concern MTSS?" aria-label="Question for the knowledge graph" />
      <button type="submit" className="btn sm primary" style={{ width: 'auto' }} disabled={busy || q.trim().length < 3}>{busy ? 'Reading the graph…' : 'Ask'}</button>
    </form>
    {err && <p className="err" role="alert">{err}</p>}
    {res && !res.ok && <p className="err" role="alert">{res.error}</p>}
    {res?.ok && <div style={{ marginTop: 10 }}>
      <div style={{ whiteSpace: 'pre-wrap' }}>{res.answer_md}</div>
      {res.paths?.length > 0 && <details className="more" open><summary>Graph paths used ({res.paths.length})</summary><ul>{res.paths.map((p, i) => <li key={i}><code>{p}</code></li>)}</ul></details>}
      {res.gaps?.length > 0 && <p className="muted">Not in the graph: {res.gaps.join(' · ')}</p>}
      <small className="muted">Evidence read: {Object.entries(res.evidence || {}).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' · ') || 'none'}{res.model ? ` · ${res.model}` : ''}</small>
    </div>}
  </Card>
}

const SEV = { high: 'red', medium: 'yellow', low: 'gray' }
export function KbAudit() {
  const A = useApi('/api/kb/audit'), a = A.data
  return <Card title="Knowledge-base audit" right={a && <Chip tone={a.items.some((x) => x.severity === 'high') ? 'red' : a.findings ? 'yellow' : 'green'}>{a.findings} finding{a.findings === 1 ? '' : 's'}</Chip>}>
    {!a ? <p className="muted">Checking {A.state === 'error' ? ' failed' : '…'}</p> : !a.items.length ? <p className="muted">Nothing stale or inconsistent found in {a.docs} documents.</p> :
      <ul className="plain">{a.items.map((f, i) => <li key={i} style={{ margin: '6px 0' }}><Chip tone={SEV[f.severity]}>{f.severity}</Chip> <b>{f.title}</b>{f.detail ? <div className="muted">{f.detail}</div> : null}</li>)}</ul>}
    <small className="muted">Deterministic checks of your documents (no model): archived docs still referenced, open items older than 30 days, docs not updated for 45+ days, self-reported staleness, claims waiting for approval.</small>
  </Card>
}

export function MemoryInbox() {
  const [tick, setTick] = useState(0), [open, setOpen] = useState(null), [busy, setBusy] = useState(''), [msg, setMsg] = useState(null)
  const I = useApi(`/api/memory/inbox?docs=40&_=${tick}`), d = I.data
  const act = async (ids, action, label) => {
    if (action === 'approve' && ids.some((id) => d.groups.flatMap((g) => g.items).find((x) => x.id === id)?.tier === 'procedural') && !confirm('This includes RULES. Approved rules become binding for the coach. Approve anyway?')) return
    setBusy(label); setMsg(null)
    try { const r = await post('/api/memory/bulk', { ids, action }); setMsg({ ok: true, text: `${r.done} ${action === 'approve' ? 'approved' : 'retracted'}${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}` }); invalidate('memory'); setTick((x) => x + 1) } catch (e) { setMsg({ ok: false, text: e.message }) }
    setBusy('')
  }
  return <Card title="Memory inbox — grouped by source document" right={d && <Chip tone={d.total ? 'yellow' : 'green'}>{d.total} waiting</Chip>}>
    {!d ? <p className="muted">Loading…</p> : !d.groups.length ? <p className="muted">Nothing is waiting for your approval.</p> : d.groups.map((g) => <div key={g.doc} style={{ borderTop: '1px solid var(--line, #8883)', padding: '8px 0' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn sm" aria-expanded={open === g.doc} onClick={() => setOpen(open === g.doc ? null : g.doc)}>{open === g.doc ? '▾' : '▸'} {g.doc} · {g.title}</button>
        <Chip tone="gray">{g.count} claims</Chip>{g.rules > 0 && <Chip tone="yellow">{g.rules} rules</Chip>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm primary" style={{ width: 'auto' }} disabled={!!busy} onClick={() => act(g.items.map((x) => x.id), 'approve', g.doc)}>{busy === g.doc ? 'Saving…' : `✓ Approve ${g.count}`}</button>
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(g.items.map((x) => x.id), 'retract', g.doc)}>Retract all</button>
      </div>
      {open === g.doc && <ul className="plain" style={{ marginTop: 6 }}>{g.items.map((m) => <li key={m.id} style={{ margin: '8px 0' }}>
        <b>{m.title}</b> <Chip tone={m.tier === 'procedural' ? 'yellow' : 'gray'}>{m.tier === 'procedural' ? 'rule' : m.kind}</Chip> <Chip tone="gray">{m.tag}</Chip>
        <div>{m.body}</div>
        {m.quote && <blockquote className="muted" style={{ margin: '4px 0', paddingLeft: 8, borderLeft: '3px solid #8886' }}>“{m.quote}”</blockquote>}
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
