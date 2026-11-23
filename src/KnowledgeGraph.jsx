import { useMemo, useState } from 'react'
import { Card, Chip, ProvenanceBadge, StatusPill } from './ui.jsx'
import { useApi } from './api.js'
import { layout, degrees, egoGraph, matchIds, dateRange, colorScale, MEASURES } from './lib/graphlayout.js'

const KG_NODES = [
  { id: 'twin', label: 'Digital Twin', sub: 'Central State', cat: 'core', x: 380, y: 200, r: 34, color: '#4658D6', db: 'intel.db:twin_state', summary: 'Synthesizes physiological readiness, CTL/ATL/TSB, aerobic efficiency (HR@800), and shoe OLS slopes into one structured coaching state.' },
  { id: 'fit', label: 'FIT Telemetry', sub: '1-Hz · 16-D kNN', cat: 'telemetry', x: 150, y: 85, r: 26, color: '#10B981', db: 'intel.db:fit_session', summary: '1-Hz GPS, HR, GCT, stride, pooled fade curves, and 16-dimensional cosine kNN similarity matching across past runs.' },
  { id: 'weather', label: 'WBGT Weather', sub: 'Heat Enrichment', cat: 'telemetry', x: 115, y: 215, r: 24, color: '#10B981', db: 'intel.db:run_weather', summary: 'Hourly temperature, humidity, dew point, and WBGT °C matched to run timestamps to normalize cardiac drift in tropical heat.' },
  { id: 'health', label: 'Daily Health', sub: 'HRV · RHR · Sleep', cat: 'telemetry', x: 165, y: 330, r: 25, color: '#10B981', db: 'lumpad.db:health_daily + daily_feat', summary: 'Nocturnal HRV, RHR, sleep stages, stress, and strength split tags powering readiness and lag correlations.' },
  { id: 'memory', label: 'Episode Memory', sub: 'FTS5 + RRF + MMR', cat: 'memory', x: 605, y: 85, r: 27, color: '#0EA5E9', db: 'memory.db:memory + memory_fts', summary: 'Hybrid RAG store combining SQLite FTS5 BM25, Reciprocal Rank Fusion (RRF), and MMR diversity reranking.' },
  { id: 'kb', label: 'Sports Science KB', sub: 'Curated Docs', cat: 'memory', x: 645, y: 215, r: 24, color: '#0EA5E9', db: 'intel.db:kb_docs', summary: 'Daniels VDOT formulas, marathon fueling protocols, heat acclimation, and plantar/durability rehab references.' },
  { id: 'shoes', label: 'Shoe Rotation', sub: 'OLS EF Slopes', cat: 'telemetry', x: 380, y: 65, r: 24, color: '#E28120', db: 'lumpad.db:gear + twin_state', summary: 'Strava-matched shoe mileage and 200-bootstrap OLS EF/GCT degradation curves per model (n ≥ 8 steady runs).' },
  { id: 'gates', label: 'Safety & Gates', sub: 'P0-3 · P0-4', cat: 'rules', x: 595, y: 330, r: 26, color: '#EA3A3A', db: 'server/intel/safety.js + verify.js', summary: 'Deterministic pre/post safety layer enforcing locked gates [1]/[3]/[5]/[7], red-flag symptom blocks, and citation verification.' },
  { id: 'races', label: 'Race Targets', sub: 'CP1 · Jakim · JRF', cat: 'rules', x: 380, y: 345, r: 24, color: '#EA3A3A', db: 'kv.json + plan milestones', summary: 'Chronological race roadmap linking daily readiness and weekly mileage to CP1, Jakim FM, MJM Gate, and JRF Sub-4.' },
]

const KG_EDGES = [
  { from: 'fit', to: 'twin', label: '16-D kNN & EF' },
  { from: 'weather', to: 'twin', label: 'WBGT drift adj' },
  { from: 'health', to: 'twin', label: 'HRV / strength' },
  { from: 'shoes', to: 'twin', label: 'OLS foam slope' },
  { from: 'fit', to: 'shoes', label: 'gear_id join' },
  { from: 'fit', to: 'weather', label: 'timestamp join' },
  { from: 'twin', to: 'memory', label: 'RRF + MMR' },
  { from: 'fit', to: 'memory', label: 'episode cards' },
  { from: 'kb', to: 'twin', label: 'VDOT & protocols' },
  { from: 'kb', to: 'memory', label: 'shared citations' },
  { from: 'twin', to: 'gates', label: 'gate evaluation' },
  { from: 'health', to: 'gates', label: 'pain / BP check' },
  { from: 'gates', to: 'races', label: 'readiness lock' },
  { from: 'twin', to: 'races', label: 'P(sub-4) model' },
]

const FILTERS = [['all', 'All Layers (9)'], ['telemetry', 'Telemetry'], ['memory', 'Memory & RAG'], ['rules', 'Gates & Rules']]

export default function KnowledgeGraphPanel({ twin, matrices, status }) {
  const ver = twin?.version ?? 6
  const [selected, setSelected] = useState('twin')
  const [filter, setFilter] = useState('all')
  const aura = useApi('/api/graph/overview')
  const nodeKind = selected === 'races' ? 'races' : selected === 'shoes' ? 'shoes' : selected === 'gates' ? 'rules' : 'pain'
  const auraNode = useApi(aura.data?.connected ? `/api/graph/node?kind=${nodeKind}` : '', !!aura.data?.connected)
  const t = twin?.state || twin || null
  const c = status?.counts || {}
  const memTotal = (status?.memory || []).reduce((s, m) => s + (m.n || 0), 0)
  const z2 = matrices?.z2_discipline || []
  const z2Clean = z2.find((r) => r.zone === 'z2_disciplined')
  const z2Creep = z2.find((r) => r.zone !== 'z2_disciplined')
  const gym72 = (matrices?.gym_to_stride || []).find((r) => r.grp === 'post_gym_72h')

  const meta = {
    twin: {
      count: twin?.version ? `v${twin.version}` : 'Twin v6',
      evidence: [
        t?.load ? `CTL ${Math.round(t.load.ctl ?? 0)} · ATL ${Math.round(t.load.atl ?? 0)} · TSB ${Math.round(t.load.tsb ?? 0)}` : 'Live CTL / ATL / TSB state',
        z2Clean && z2Creep ? `Z2 ≤${matrices.z2_ceiling} bpm EF ${z2Clean.ef} vs ${z2Creep.ef} creep` : 'Z2 aerobic discipline vs intensity creep',
        gym72 ? `#leg_day_72h (n=${gym72.n}) EF ${gym72.ef} · GCT ${gym72.gct_fade ?? '—'} ms` : 'Strength-to-run transfer lag matrix',
      ],
    },
    fit: {
      count: `${c.fit_sessions ?? matrices?.sessions ?? '—'} sessions`,
      evidence: [
        `${c.fit_sessions ?? matrices?.sessions ?? 99} 1-Hz FIT sessions indexed in intel.db`,
        'Top-3 similar sessions surfaced via 16-D z-score kNN',
        'Pooled km-by-km fade curves & onset_km detection',
      ],
    },
    weather: {
      count: `${c.weather ?? '—'} runs`,
      evidence: [
        `${c.weather ?? 72} runs enriched with temperature, RH & WBGT °C`,
        t?.heat?.hr_cost_bpm_per_c ? `Heat tax: ${t.heat.hr_cost_bpm_per_c.value} bpm/°C (n=${t.heat.n})` : 'Separates thermal cardiac drift from fitness loss',
        'Powers Ely 2007 WBGT thermal pace adjustments',
      ],
    },
    health: {
      count: `${c.daily_log ?? '—'} logs`,
      evidence: [
        'Overnight HRV, RHR, sleep stages & wellness checks',
        'Daily feature table links strength days to run biomechanics',
        'Feeds autonomic vs structural readiness split',
      ],
    },
    memory: {
      count: `${memTotal || '—'} items`,
      evidence: [
        'SQLite FTS5 BM25 + RRF + MMR diversity reranking',
        'Episode cards tagged with route & pattern hashtags',
        'Zero external vector daemon on 2 GB VPS',
      ],
    },
    kb: {
      count: `${c.kb_docs ?? '—'} docs`,
      evidence: [
        'Daniels VDOT formulas & fueling protocols',
        'Locked Z2 ceiling ≤ 148 bpm (LTHR 168–170 bpm)',
        'Cited via [id] and verified by P0-4 verifier',
      ],
    },
    shoes: {
      count: `${t?.shoes?.length ?? '—'} shoes`,
      evidence: [
        'Strava gear_id joined to fit_session.shoe_id',
        'OLS + 200-bootstrap EF residual slope when n ≥ 8',
        'Flags midsole wear ≥ 600 km before long runs',
      ],
    },
    gates: {
      count: 'P0-3 · P0-4',
      evidence: [
        'Red-flag symptoms or BP ≥ 180/120 → clinician referral',
        'Locked rules: Sleep HR > 67, HRV Reduced, Pain ≥ 2/10',
        'P0-4 verifies numbers, pace/time tokens & citations',
      ],
    },
    races: {
      count: '3 milestones',
      evidence: [
        'CP1 5K TT (2027-01-16): Green ≤ 29:42',
        'Jakim FM (2027-06-13 · Registered) + G-MJM Gate (Jun 16)',
        'Peak A-Race: myBCA JRF FM (2027-10-24) · Sub-4:00',
      ],
    },
  }

  const nodeMap = Object.fromEntries(KG_NODES.map((n) => [n.id, n]))
  const isVisible = (n) => filter === 'all' || n.cat === 'core' || n.cat === filter
  const cur = nodeMap[selected] || KG_NODES[0]
  const curMeta = meta[cur.id] || { count: '—', evidence: [] }
  const connected = KG_EDGES.filter((e) => e.from === cur.id || e.to === cur.id).map((e) => ({
    other: nodeMap[e.from === cur.id ? e.to : e.from],
    rel: e.label,
  }))

  return <>
  <LiveGraph overview={aura.data} />
  <Card title="Coach architecture (design schematic)" right={<span className="chips" style={{ margin: 0 }}><ProvenanceBadge type="MODEL" /><Chip>Schematic, not live data</Chip></span>}>
    <p className="muted">A fixed diagram of how the coach's data sources connect. Click any node to inspect its backing SQLite table, connected edges, and how AI Coach retrieves it during Hybrid RAG reasoning. The live knowledge graph, with its real node and edge counts, is shown below.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--line)', fontSize: '.78rem' }}>
      <StatusPill tone={aura.data?.connected ? 'green' : 'amber'}>{aura.data?.connected ? `Neo4j AuraDB Live · ${aura.data.total_nodes} nodes · ${aura.data.total_edges} edges` : aura.data?.configured ? 'Neo4j AuraDB Standby (PG16 active)' : 'Local PG16 + SQLite Graph'}</StatusPill>
      {aura.data?.connected && Object.entries(aura.data.nodes || {}).slice(0, 8).map(([k, v]) => <Chip key={k}>{k}: {v}</Chip>)}
      {auraNode.data?.rows?.length > 0 && <span className="muted" style={{ width: '100%', fontSize: '.74rem' }}>Live Cypher ({nodeKind}): {auraNode.data.rows.slice(0, 3).map((r) => r.join(' · ')).join(' | ')}</span>}
    </div>
    <div className="chiprow" role="group" aria-label="Knowledge graph layers" style={{ marginTop: 8 }}>
      {FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
    </div>
    <div className="kg-grid">
      <div className="kg-canvas">
        <svg viewBox="0 0 760 400" className="kg-svg" data-fit="1" role="img" aria-label="Interactive Lumpad Coaching Knowledge Graph">
          {KG_EDGES.map((e, idx) => {
            const a = nodeMap[e.from], b = nodeMap[e.to]
            const active = e.from === selected || e.to === selected
            const dim = !(isVisible(a) && isVisible(b))
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
            return <g key={idx}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={active ? 'var(--cobalt)' : 'var(--muted)'} strokeWidth={active ? 2.4 : 1.3} strokeOpacity={dim ? 0.14 : active ? 0.95 : 0.35} strokeDasharray={active ? undefined : '4 3'} />
              {active && !dim && <>
                <rect x={mx - 44} y={my - 9} width="88" height="17" rx="6" fill="var(--carbon)" fillOpacity="0.9" />
                <text x={mx} y={my + 3} textAnchor="middle" fill="#e2e8f0" fontSize="9.5" fontFamily="var(--f-mono)">{e.label}</text>
              </>}
            </g>
          })}
          {KG_NODES.map((n) => {
            const vis = isVisible(n), sel = n.id === selected
            return <g key={n.id} className="kg-node" opacity={vis ? 1 : 0.22} onClick={() => setSelected(n.id)} role="button" tabIndex={0} aria-label={`${n.label}: ${n.sub}`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(n.id) } }}>
              {sel && <circle cx={n.x} cy={n.y} r={n.r + 7} fill={n.color} fillOpacity="0.2" stroke={n.color} strokeWidth="2" />}
              <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} stroke="#ffffff" strokeWidth="2.2" />
              <text x={n.x} y={n.y + 3} textAnchor="middle" fill="#fff" fontSize={n.id === 'twin' ? '10.5' : '9.5'} fontWeight="700">{n.label.split(' ')[0]}</text>
              <text x={n.x} y={n.y + n.r + 14} textAnchor="middle" className="kg-lbl">{n.id === 'twin' ? `Digital Twin v${ver}` : n.label}</text>
              <text x={n.x} y={n.y + n.r + 26} textAnchor="middle" className="kg-sub">{n.sub}</text>
            </g>
          })}
        </svg>
        <div className="legend" style={{ marginTop: 6, marginBottom: 0 }}>
          <span><i className="kdot" style={{ background: '#4658D6' }} />Core Twin</span>
          <span><i className="kdot" style={{ background: '#10B981' }} />Telemetry</span>
          <span><i className="kdot" style={{ background: '#0EA5E9' }} />Memory &amp; RAG</span>
          <span><i className="kdot" style={{ background: '#EA3A3A' }} />Gates &amp; Safety</span>
        </div>
      </div>

      <div className="kg-insp">
        <div className="ch" style={{ marginBottom: 6 }}>
          <div>
            <Chip>{cur.cat.toUpperCase()}</Chip>
            <h3 style={{ margin: '6px 0 2px', fontSize: '1rem' }}>{cur.id === 'twin' ? `Digital Twin v${ver}` : cur.label}</h3>
            <code className="md-code">{cur.db}</code>
          </div>
          <Chip tone="green">{curMeta.count}</Chip>
        </div>
        <p className="muted" style={{ lineHeight: 1.45 }}>{cur.summary}</p>
        <h3>Grounded evidence signals</h3>
        <ul className="kg-evid">{curMeta.evidence.map((ev, i) => <li key={i}>{ev}</li>)}</ul>
        <h3>Connected graph edges ({connected.length})</h3>
        <div className="kg-jumps">
          {connected.map((c) => <button key={c.other.id} type="button" className="kg-jump" onClick={() => setSelected(c.other.id)}>
            <b>{c.other.label}</b> <span>({c.rel})</span>
          </button>)}
        </div>
      </div>
    </div>
  </Card>
  </>
}

// ---- the REAL graph (Neo4j Aura): a bounded sample from fixed read-only queries, drawn with a small force layout
const LABEL_COLOR = { PerfDomain: '#6366F1', PerfPoint: '#22C55E', PB: '#F97316', Session: '#10B981', Day: '#64748B', Memory: '#0EA5E9', Shoe: '#E28120', Weather: '#06B6D4', Race: '#EA3A3A', Rule: '#A855F7', PainSite: '#F43F5E', Decision: '#EAB308', PlanDay: '#94A3B8', Topic: '#F59E0B', Workout: '#8B5CF6', HeatBand: '#FB7185', CoachRun: '#14B8A6' }
const LIVE_VIEWS = [['performance', 'Performance'], ['sessions', 'Recent sessions'], ['topics', 'Topics'], ['chains', 'Gym → run'], ['trace', 'Coach trace'], ['plan', 'Plan vs done'], ['memory', 'Memory links'], ['days', 'Last 3 weeks'], ['races', 'All races'], ['context', 'Races, rules, shoes']]
const VIEW_HELP = { performance: 'PERFORMANCE is the hub; its domains are VDOT, COROS running fitness, cardiovascular efficiency, durability, speed & personal bests, and training load. Each dot is one measurement; personal bests point at the run that set them; races point at the VDOT they showed; the planned VDOT line sits beside what you actually ran.', races: 'Every race in the ledger (04.1), newest first: the canonical race, its ledger entry, the session you ran, the event, and the next race in the chain.', sessions: 'Your newest runs with their shoe, weather, heat band, topics, similar runs and memories.', topics: 'The shared vocabulary: each topic with the newest knowledge-base notes, findings and sessions that are about it.',
  chains: 'Strength sessions in the 72 hours before a run, with the run that followed.', trace: 'What the AI coach used: the memories it retrieved and cited, the notes it wrote and the sessions it reviewed.',
  plan: 'Planned days against the sessions actually done.', memory: 'Recent findings and how they connect: related notes, what produced them, topics, and any real contradictions.', days: 'The last three weeks as a chain of days.', context: 'Races, rules and shoes with their sessions.' }
const sgn = (d) => (d.direction === 'improving' ? { c: '#16a34a', t: '▲ improving' } : d.direction === 'worsening' ? { c: '#dc2626', t: '▼ worsening' } : { c: '#64748b', t: '● steady' })
const mmss = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const hms = (s) => (s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : mmss(s))
function Tile({ title, value, sub, tr, fmt = (x) => x }) {
  const s = tr && tr.delta != null ? sgn(tr) : null
  return <div className="hyp-card" style={{ minWidth: 150 }}><small className="muted">{title}</small><b style={{ fontSize: '1.25rem' }}>{value ?? '—'}</b>{sub && <small className="muted">{sub}</small>}{s && <small style={{ color: s.c }}>{s.t} ({fmt(tr.prior)} → {fmt(tr.recent)})</small>}</div>
}
// Performance first: this is what Lumpad is for. Numbers come from the same sources as the Performance layer of the graph below.
export function PerformancePanel() {
  const S = useApi('/api/perf/summary'), s = S.data
  if (!s) return <Card title="Performance"><p className="muted">{S.state === 'error' ? 'Could not load performance.' : 'Loading…'}</p></Card>
  const v = s.vdot, c = s.coros, ca = s.cardio, du = s.durability, pb = s.speed.pbs, pct = v.latest_effort ? Math.max(0, Math.min(100, ((v.latest_effort.value - v.baseline) / (v.needed - v.baseline)) * 100)) : 0
  return <Card title="Performance" right={<Chip tone="green">main focus</Chip>}>
    <p className="muted" style={{ marginTop: 0 }}>Goal: {`sub-4:00 marathon needs VDOT ${v.needed} (race-equivalent ${v.race_equivalent}). Baseline ${v.baseline} (official 10K, Jul 2026).`}</p>
    <div className="bar" role="img" aria-label={`VDOT progress ${Math.round(pct)}% of the way from baseline to needed`}><i style={{ width: pct + '%', background: 'var(--accent)' }} /></div>
    <small className="muted">{v.latest_effort ? `Latest effort-implied VDOT ${v.latest_effort.value} (${v.latest_effort.date}) · best in 90 days ${v.best_effort_90d ?? '—'} · gap to needed ${v.gap_to_needed}` : 'No effort-implied VDOT yet'}. {v.note}</small>
    <div className="hyp-grid" style={{ marginTop: 10 }}>
      <Tile title="VDOT (effort-implied)" value={v.latest_effort?.value} sub={`needed ${v.needed}`} tr={v.trend} />
      <Tile title="VO₂max (COROS)" value={c?.vo2max} sub={c ? `as of ${c.date}` : 'no COROS fitness yet'} />
      <Tile title="Running fitness (COROS)" value={c?.running_level} sub={c ? `threshold ${mmss(c.threshold_pace_s_km)}/km` : ''} />
      <Tile title="Efficiency factor" value={ca.ef.recent} sub="higher = more speed per heartbeat" tr={ca.ef} />
      <Tile title="Cardiac drift (pace:HR)" value={ca.drift_pahr.recent != null ? ca.drift_pahr.recent + ' %' : null} sub="lower = steadier heart rate" tr={ca.drift_pahr} />
      <Tile title="Run share, long runs" value={du.run_share.recent != null ? Math.round(du.run_share.recent * 100) + ' %' : null} sub={`${du.long_runs} runs ≥ 16 km · longest ${du.longest_km} km`} tr={du.run_share} fmt={(x) => (x == null ? '—' : Math.round(x * 100) + '%')} />
      <Tile title="Fade starts at km" value={du.onset_km.recent} sub="later = better durability" tr={du.onset_km} />
      <Tile title="Run pace" value={s.speed.run_pace.recent != null ? mmss(s.speed.run_pace.recent) + '/km' : null} sub="average of recent runs" tr={s.speed.run_pace} fmt={mmss} />
    </div>
    {c && <p style={{ margin: '10px 0 0' }}><b>COROS race predictions:</b> 5K {hms(c.pred_5k_s)} · 10K {hms(c.pred_10k_s)} · half {hms(c.pred_hm_s)} · marathon {hms(c.pred_marathon_s)}</p>}
    {Object.keys(pb).length > 0 && <><b style={{ display: 'block', marginTop: 10 }}>Personal bests (fastest consecutive km in any run)</b>
      <div className="chiprow" style={{ marginTop: 4 }}>{Object.entries(pb).map(([k, x]) => <span key={k} className="chip">{k.replace('k', ' km')}: {hms(x.secs)} ({mmss(x.pace)}/km) · {x.date}</span>)}</div></>}
  </Card>
}

function LiveGraph({ overview }) {
  const [view, setView] = useState('performance'), [sel, setSel] = useState(null), [focus, setFocus] = useState(false), [q, setQ] = useState(''), [by, setBy] = useState('type'), [range, setRange] = useState(null)
  const on = !!overview?.connected, G = useApi(on ? `/api/graph/live?view=${view}` : '', on), full = G.data
  const g = useMemo(() => (focus && sel && full ? egoGraph(full, sel) : full), [full, focus, sel])
  const narrow = typeof window !== 'undefined' && window.innerWidth < 700, [W, H] = narrow ? [380, 540] : [760, 420]   // a taller canvas on phones keeps dots tappable
  const pos = useMemo(() => (g?.nodes?.length ? layout(g.nodes, g.edges, { W, H }) : {}), [g, W, H])
  const deg = useMemo(() => (g ? degrees(g.nodes, g.edges) : {}), [g])
  const byLabel = useMemo(() => { const c = {}; for (const n of g?.nodes || []) c[n.label] = (c[n.label] || 0) + 1; return c }, [g])
  const nb = useMemo(() => { if (!sel || !full) return []; const m = new Map(full.nodes.map((n) => [n.id, n])); return full.edges.filter((e) => e.from === sel || e.to === sel).map((e) => ({ n: m.get(e.from === sel ? e.to : e.from), type: e.type, out: e.from === sel })).filter((x) => x.n) }, [sel, full])
  const found = useMemo(() => matchIds(g?.nodes || [], q), [g, q]), dr = useMemo(() => dateRange(g?.nodes || []), [g]), color = useMemo(() => (by === 'type' ? () => null : colorScale(g?.nodes || [], by)), [g, by])
  const lo = range?.[0] ?? dr?.[0], hi = range?.[1] ?? dr?.[1], inRange = (n) => !dr || !n.date || (n.date >= lo && n.date <= hi)
  const cur = full?.nodes?.find((n) => n.id === sel), small = (g?.nodes?.length || 0) <= 30
  if (!overview) return null
  const fill = (n) => (by !== 'type' ? color(n) || '#94A3B8' : LABEL_COLOR[n.label] || '#64748B')
  const dayIdx = dr ? [Date.parse(dr[0]) / 864e5, Date.parse(dr[1]) / 864e5] : null, dayStr = (x) => new Date(x * 864e5).toISOString().slice(0, 10)
  return <Card title="Live knowledge graph" right={<StatusPill tone={on ? 'green' : 'amber'}>{on ? `${overview.total_nodes} nodes · ${overview.total_edges} edges in Neo4j` : 'not connected'}</StatusPill>}>
    {!on && <div className="muted" style={{ fontSize: '.85rem', lineHeight: 1.5 }}>
      <p style={{ margin: '0 0 6px' }}>The picture above is the system diagram. The real graph (days, sessions, weather, shoes, memories, rules, topics, gym-to-run chains and the coach's trail) appears here once Neo4j Aura is connected.</p>
      <p style={{ margin: 0 }}>Add <code>NEO4J_URI</code>, <code>NEO4J_USER</code> and <code>NEO4J_PASSWORD</code> to <code>/opt/lumpad/.env.v2</code>, restart <code>lumpadd-serve</code>, then run <code>systemctl start lumpadd-graph-sync</code>.</p>
    </div>}
    {on && <>
      <div className="chiprow" role="group" aria-label="Graph view">{LIVE_VIEWS.map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setSel(null); setFocus(false); setRange(null) }}>{l}</button>)}</div>
      <p className="muted" style={{ fontSize: '.78rem', margin: '6px 0 0' }}>{VIEW_HELP[view]}</p>
      {G.state === 'loading' && !full && <p className="muted">Loading the graph…</p>}
      {full && !full.connected && <p className="muted" role="alert">Could not read the graph{full.error ? `: ${full.error}` : ''}. Try again in a moment.</p>}
      {full?.connected && full.nodes.length === 0 && <p className="muted">This view is empty. Run <code>systemctl start lumpadd-graph-sync</code> to project the data into Neo4j.</p>}
      {g?.nodes?.length > 0 && <>
        <div className="kg-tools" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
          <input type="search" aria-label="Search the graph" placeholder="Search name, type or date" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 160px', minHeight: 36 }} />
          <label className="muted" style={{ fontSize: '.75rem', display: 'flex', gap: 6, alignItems: 'center' }}>Colour by
            <select value={by} onChange={(e) => setBy(e.target.value)} aria-label="Colour nodes by"><option value="type">Type</option>{Object.entries(MEASURES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select></label>
          <button type="button" className="link" disabled={!sel} aria-pressed={focus} onClick={() => setFocus((f) => !f)} title="Show only the selected node and its neighbours">{focus ? 'Show all' : 'Focus on selected'}</button>
        </div>
        {dayIdx && dayIdx[1] > dayIdx[0] && <div className="muted" style={{ fontSize: '.74rem', display: 'grid', gridTemplateColumns: 'auto 1fr 1fr auto', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span>{lo}</span>
          <input type="range" aria-label="Earliest date" min={dayIdx[0]} max={dayIdx[1]} value={Date.parse(lo) / 864e5} onChange={(e) => setRange([dayStr(Math.min(+e.target.value, Date.parse(hi) / 864e5)), hi])} />
          <input type="range" aria-label="Latest date" min={dayIdx[0]} max={dayIdx[1]} value={Date.parse(hi) / 864e5} onChange={(e) => setRange([lo, dayStr(Math.max(+e.target.value, Date.parse(lo) / 864e5))])} />
          <span>{hi}</span></div>}
        <div className="chips" style={{ margin: '4px 0 8px' }}>{by === 'type' ? Object.entries(byLabel).map(([k, v]) => <span key={k} className="chip" style={{ borderLeft: `4px solid ${LABEL_COLOR[k] || '#64748B'}` }}>{k} {v}</span>)
          : <span className="chip" style={{ background: 'linear-gradient(90deg, hsl(220 75% 50% / .35), hsl(110 75% 50% / .35), hsl(0 75% 50% / .35))' }}>{MEASURES[by].label}: low → high (grey = no value)</span>}
          <span className="muted" style={{ fontSize: '.75rem', alignSelf: 'center' }}>{g.nodes.length} nodes · {g.edges.length} edges shown{full?.truncated && !focus ? ' (sample, capped)' : ''}{found ? ` · ${found.size} match` : ''}</span></div>
        <div className="kg-canvas"><svg viewBox={`0 0 ${W} ${H}`} className="kg-svg" role="img" aria-label={`Live knowledge graph, ${g.nodes.length} nodes and ${g.edges.length} edges`}>
          {g.edges.map((e, i) => { const a = pos[e.from], b = pos[e.to]; if (!a || !b) return null; const act = e.from === sel || e.to === sel; return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={act ? 'var(--cobalt)' : 'var(--muted)'} strokeWidth={act ? 2 : 0.9} strokeOpacity={act ? 0.95 : sel || found ? 0.1 : 0.38}><title>{e.type.toLowerCase().replace(/_/g, ' ')}</title></line> })}
          {g.nodes.map((n) => { const p = pos[n.id]; if (!p) return null; const isSel = n.id === sel, r = 5 + Math.min(7, Math.sqrt(deg[n.id] || 0) * 1.6), dim = !inRange(n) || (found && !found.has(n.id)), hit = found?.has(n.id)
            return <g key={n.id} className="kg-node" opacity={dim ? 0.15 : 1} onClick={() => setSel(isSel ? null : n.id)} role="button" tabIndex={0} aria-label={`${n.label}: ${n.name}`} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSel(isSel ? null : n.id)}>
              {(isSel || hit) && <circle cx={p.x} cy={p.y} r={r + 6} fill={fill(n)} fillOpacity="0.22" stroke={fill(n)} strokeWidth="2" />}
              <circle cx={p.x} cy={p.y} r={r} fill={fill(n)} stroke="#fff" strokeWidth="1.4" />
              {(small || isSel || hit) && <text x={p.x} y={p.y + r + 11} textAnchor="middle" className="kg-lbl" style={{ fontSize: 9 }}>{n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name}</text>}
            </g> })}
        </svg></div>
        <div className="kg-detail" style={{ marginTop: 8, minHeight: 44 }}>
          {cur ? <><b>{cur.label}</b> · {cur.name}{cur.date ? ` · ${cur.date}` : ''} <span className="muted">({deg[cur.id] || nb.length} links in this view)</span>
            <div className="kg-jumps">{nb.slice(0, 14).map((x, i) => <button key={i} type="button" className="kg-jump" onClick={() => setSel(x.n.id)}><b>{x.n.name.length > 28 ? x.n.name.slice(0, 27) + '…' : x.n.name}</b> <span>({x.out ? '→' : '←'} {x.type.toLowerCase().replace(/_/g, ' ')})</span></button>)}</div></>
            : <span className="muted">Tap a node to see what it is connected to. Bigger dots have more links. Use Focus to show only one node and its neighbours.</span>}
        </div>
      </>}
    </>}
  </Card>
}
