import { useEffect, useState } from 'react'
import { fmtPace } from './lib/vdot.js'

const api = async (path, opts) => { const r = await fetch('/api' + path, opts); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j }
const km = (m) => (m / 1000).toFixed(2)

export default function Data() {
  const [src, setSrc] = useState(null), [acts, setActs] = useState(null), [fit, setFit] = useState([]), [err, setErr] = useState('')
  const [q, setQ] = useState(''), [hits, setHits] = useState([]), [lib, setLib] = useState([])
  const run = (fn) => fn().catch((e) => setErr(String(e.message || e)))
  useEffect(() => { run(async () => { setSrc(await api('/sources')); setFit(await api('/coros/activities')); setLib(await api('/library')) }) }, [])
  const upload = (e) => run(async () => { const f = e.target.files[0]; if (!f) return; const a = await api('/coros/fit', { method: 'POST', body: await f.arrayBuffer() }); setFit([a, ...fit]) })
  const add = (h) => run(async () => setLib(await api('/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(h) })))
  const [m, setM] = useState({ title: '', url: '', note: '' })
  return <>
    {err && <div className="banner" onClick={() => setErr('')}>{err}</div>}
    <section className="card">
      <h2>Strava</h2>
      {!src ? <p className="muted">Loading…</p> : !src.strava.configured ? <p className="muted">Not configured: set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env (see .env.example). Rate limits not verified.</p>
        : !src.strava.connected ? <a href="/api/strava/login">Connect Strava</a>
        : <><button onClick={() => run(async () => setActs(await api('/strava/activities')))}>Pull activities</button>
          {acts && <table><tbody>{acts.slice(0, 15).map((a) => <tr key={a.id}><td>{a.date.slice(0, 10)}</td><td>{a.name}</td><td>{km(a.distance)} km</td><td>{a.hr ? Math.round(a.hr) : '—'}</td></tr>)}</tbody></table>}
          {acts && <p className="muted">Source: Strava, pulled {acts[0]?.pulledAt?.slice(0, 16)}</p>}</>}
    </section>
    <section className="card">
      <h2>COROS (FIT import)</h2>
      <p className="muted">The COROS API for individual developers is unverified (open item 9). Upload a .fit file from the COROS app.</p>
      <input type="file" accept=".fit" onChange={upload} aria-label="Choose a FIT file from COROS" />
      {fit.slice(0, 3).map((a, i) => <div key={i}><b>{a.date?.slice(0, 10)}</b> · {km(a.distance)} km · {a.laps.length} laps
        <table><thead><tr><th>Lap</th><th>km</th><th>Pace</th><th>HR</th><th>Cad</th><th>W</th></tr></thead><tbody>
          {a.laps.map((l) => <tr key={l.lap}><td>{l.lap}</td><td>{km(l.distance)}</td><td>{l.pace ? fmtPace(l.pace) : '—'}</td><td>{l.hr ?? '—'}</td><td>{l.cadence ?? '—'}</td><td>{l.power ?? '—'}</td></tr>)}</tbody></table></div>)}
    </section>
    <section className="card">
      <h2>Literature</h2>
      <p className="muted">PubMed is automatic. Consensus: programmatic access unverified → add manually below. Results = hypothesis/prior, never overriding the athlete's own data.</p>
      <form onSubmit={(e) => { e.preventDefault(); run(async () => setHits(await api('/pubmed/search?q=' + encodeURIComponent(q)))) }} className="row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. strength training running economy" /><button>Search PubMed</button></form>
      {hits.map((h) => <p key={h.pmid}><a href={h.url} target="_blank" rel="noreferrer">{h.title}</a><br /><span className="muted">{h.authors} · {h.journal} {h.year} · PMID {h.pmid}</span> <button onClick={() => add(h)}>Save</button></p>)}
      <h3>Library ({lib.length})</h3>
      {lib.map((l) => <p key={l.id}><span className="tag">{l.tag}</span> <a href={/^https?:\/\//i.test(l.url) ? l.url : undefined} target="_blank" rel="noreferrer">{l.title}</a> <span className="muted">{l.source}{l.pmid ? ' · PMID ' + l.pmid : ''}</span> <button onClick={() => run(async () => setLib(await api('/library?id=' + l.id, { method: 'DELETE' })))}>×</button></p>)}
      <h3>Add manually (e.g. Consensus)</h3>
      <div className="grid"><input placeholder="Title" value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} /><input placeholder="URL" value={m.url} onChange={(e) => setM({ ...m, url: e.target.value })} /></div>
      <button onClick={() => { add({ ...m, source: 'consensus-manual' }); setM({ title: '', url: '', note: '' }) }}>Save</button>
    </section>
  </>
}
