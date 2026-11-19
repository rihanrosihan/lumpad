import { useState } from 'react'
import { Card, Chip, ProvenanceBadge } from './ui.jsx'

const KG_NODES = [
  { id: 'twin', label: 'Digital Twin v6', sub: 'Central State', cat: 'core', x: 380, y: 200, r: 34, color: '#4658D6', db: 'intel.db:twin_state', summary: 'Synthesizes physiological readiness, CTL/ATL/TSB, aerobic efficiency (HR@800), and shoe OLS slopes into one structured coaching state.' },
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
  const [selected, setSelected] = useState('twin')
  const [filter, setFilter] = useState('all')
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

  return <Card title="Athlete Coaching Knowledge Graph" right={<span className="chips" style={{ margin: 0 }}><ProvenanceBadge type="MODEL" /><Chip>9 Nodes · 14 Edges</Chip></span>}>
    <p className="muted">Click any node to inspect its backing SQLite table, connected edges, and how AI Coach retrieves it during Hybrid RAG reasoning.</p>
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
              <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} stroke="var(--surface)" strokeWidth="2.5" />
              <text x={n.x} y={n.y + 3} textAnchor="middle" fill="#fff" fontSize={n.id === 'twin' ? '10.5' : '9.5'} fontWeight="700">{n.label.split(' ')[0]}</text>
              <text x={n.x} y={n.y + n.r + 14} textAnchor="middle" className="kg-lbl">{n.label}</text>
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
            <h3 style={{ margin: '6px 0 2px', fontSize: '1rem' }}>{cur.label}</h3>
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
}
