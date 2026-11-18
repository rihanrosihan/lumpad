import { useState } from 'react'
import { Card, Chip, Screen, Sheet } from './ui.jsx'
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
const PRIO = { now: ['red', 'sekarang'], this_week: ['yellow', 'minggu ini'], later: ['none', 'nanti'] }
const INTENTS = [['daily_brief', 'Brief hari ini'], ['weekly_review', 'Review minggu'], ['race_plan', 'Rencana race'], ['question', 'Tanya bebas']]

export function Result({ p, res }) {
  const wb = p?._writeback
  return <Card title="Hasil" right={<span className="muted">{res.model} · ¥{f1(res.cost_cny, 2)}</span>}>
    <p className="lead">{p.summary}</p>
    {p.flags?.length > 0 && <div className="chips">{p.flags.map((f, i) => <Chip key={i} tone={f.type === 'gate' || f.type === 'injury' ? 'red' : 'yellow'}>{f.text}</Chip>)}</div>}
    {p.recommendations?.length > 0 && <ol className="recs">{p.recommendations.map((r, i) => <li key={i}><div><Chip tone={PRIO[r.priority]?.[0]}>{PRIO[r.priority]?.[1] || r.priority}</Chip>{r.needs_athlete_ok && <Chip>perlu persetujuanmu</Chip>}</div><b>{r.action}</b><small>{r.why}</small></li>)}</ol>}
    <details className="more"><summary>Analisis lengkap</summary><Md text={p.analysis_md} /></details>
    {wb && (wb.stored.length + wb.merged.length + wb.rejected.length > 0) && <p className="src-note">Memori: {wb.stored.length} baru (menunggu konfirmasi) · {wb.merged.length} digabung · {wb.rejected.length} ditolak (angka/kutipan tidak terverifikasi).</p>}
  </Card>
}

const Tiles = ({ items }) => <div className="score-grid">{items.map(([k, v, e], i) => <div key={i}><small>{k}</small><b>{v}</b>{e && <em>{e}</em>}</div>)}</div>

function Status({ st }) {
  const g = st?.guard, spendPct = g ? Math.min(100, Math.round((g.spend_cny / g.cap_cny) * 100)) : 0
  return <Card title="Status sistem">
    {!st ? <p className="muted">Memuat…</p> : <>
      <Tiles items={[['Sesi FIT', st.counts.fit_sessions, 'dianalisis per detik'], ['Cuaca', st.counts.weather, 'lari ber-cuaca'], ['Dok KB', st.counts.kb_docs, 'diimpor'], ['Log harian', st.counts.daily_log, 'hari tercatat']]} />
      <div className="bar" role="img" aria-label={`Pemakaian coach ${spendPct}%`}><i style={{ width: spendPct + '%', background: spendPct >= 80 ? 'var(--red-t)' : 'var(--accent)' }} /></div>
      <p className="muted">Coach: {st.model?.name || 'belum dipilih'} · ¥{f1(g?.spend_cny, 2)} dari ¥{g?.cap_cny} bulan ini{g?.level === 'paused' ? ' · DIJEDA' : g?.level === 'limited' ? ' · dibatasi (≥80%)' : ''}{!st.key ? ' · API key belum diisi' : ''}</p>
      <p className="src-note">Job terakhir: {st.jobs[0] ? `${st.jobs[0].kind} · ${st.jobs[0].status}${st.jobs[0].finished_at ? ' · ' + new Date(st.jobs[0].finished_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : ''}` : 'belum pernah jalan'}</p>
      <button className="btn" disabled={st.busy} onClick={() => post('/api/intel/run', { kind: 'full' }).then(() => location.reload())}>{st.busy ? 'Sedang berjalan…' : 'Jalankan analisis sekarang'}</button>
    </>}
  </Card>
}

function Ask({ st }) {
  const [intent, setIntent] = useState('daily_brief'), [q, setQ] = useState(''), [busy, setBusy] = useState(false), [res, setRes] = useState(null), [err, setErr] = useState('')
  const run = () => { setBusy(true); setErr(''); setRes(null); post('/api/coach/run', { intent, question: q }).then(setRes).catch((e) => setErr(e.message)).finally(() => setBusy(false)) }
  const p = res?.parsed, wb = p?._writeback
  return <>
    <Card title="Tanya coach" right={st?.model && <Chip>{st.model.name}</Chip>}>
      <div className="chiprow" role="group" aria-label="Jenis analisis">{INTENTS.map(([k, l]) => <button key={k} aria-pressed={intent === k} onClick={() => setIntent(k)}>{l}</button>)}</div>
      {intent === 'question' && <textarea className="ask" rows={3} value={q} placeholder="Mis. kenapa HR@8:00 naik minggu ini?" onChange={(e) => setQ(e.target.value)} maxLength={1000} aria-label="Pertanyaan" />}
      <button className="btn primary" disabled={busy || (intent === 'question' && q.trim().length < 5) || st?.guard?.level === 'paused'} onClick={run}>{busy ? 'Coach menganalisis… (±30–90 dtk)' : 'Jalankan'}</button>
      {st?.guard?.level === 'paused' && <p className="muted">Batas bulanan tercapai — analisis tetap jalan, coach kembali tanggal 1.</p>}
      {err && <p className="err" role="alert">{err}</p>}
    </Card>
    {res && !res.ok && <Card title="Jawaban tidak valid"><p className="muted">Format jawaban model tidak lolos validasi, memori tidak ditulis. {res.errors?.[0]}</p></Card>}
    {p && <Result p={p} res={res} />}
  </>
}
function Recent() {
  const R = useApi('/api/coach/runs'), [open, setOpen] = useState(null), D = useApi(open ? `/api/coach/run?id=${open}` : '', !!open)
  if (!R.data?.length) return null
  return <Card title="Riwayat coach">
    <div className="alist">{R.data.slice(0, 8).map((r) => <button key={r.id} className="arow" onClick={() => setOpen(r.id)}><div className="t"><b>{INTENTS.find((i) => i[0] === r.intent)?.[1] || r.intent}</b><small>{new Date(r.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {r.provider}{r.model ? ' · ' + r.model : ''}</small></div><div className="n"><small>{r.ok ? 'ok' : 'gagal'}</small></div></button>)}</div>
    <Sheet open={!!open} onClose={() => setOpen(null)} label="Detail coach">{D.data?.parsed ? <><h2 className="sess-title">{D.data.intent}</h2><p className="lead">{D.data.parsed.summary}</p><Md text={D.data.parsed.analysis_md} /></> : <p className="muted">{D.data?.error || 'Memuat…'}</p>}</Sheet>
  </Card>
}

// ---- Ketahanan: the long-run scorecard (the limiter behind both marathon DNFs)
function RunBars({ km }) {
  if (!km?.length) return null; const W = 300, H = 70, bw = W / Math.max(km.length, 1)
  return <svg viewBox={`0 0 ${W} ${H}`} className="runbars" role="img" aria-label="Porsi berlari per km">{km.map((k, i) => <rect key={i} x={i * bw + 0.5} width={Math.max(1, bw - 1.5)} y={H - H * (k.runShare ?? 0)} height={H * (k.runShare ?? 0)} rx="1.5" fill={k.runShare >= 0.9 ? 'var(--green)' : k.runShare >= 0.6 ? 'var(--yellow)' : 'var(--red)'} />)}</svg>
}
function Durability() {
  const L = useApi('/api/intel/longruns'), [sel, setSel] = useState(null), S = useApi(sel ? `/api/intel/session?id=${sel}` : '', !!sel), s = S.data
  return <>
    <Card title="Run share · lari ≥ 16 km"><p className="muted">Porsi waktu yang benar-benar berlari (bukan jalan/berhenti). Ini penghalang utama kedua marathon-mu: kecepatan saat berlari bertahan, yang turun adalah porsi berlari setelah km 20.</p>
      {L.state === 'ok' && !L.data.length && <p className="muted">Belum ada lari ≥ 16 km dengan file FIT. FIT lama masih diunduh bertahap (40 per hari).</p>}</Card>
    <div className="alist">{(L.data || []).map((r) => <button key={r.label_id} className="arow" onClick={() => setSel(r.label_id)} aria-label={`Lari ${r.date} ${f1(r.distance_m / 1000)} km, run share ${pct(r.run_share)}`}>
      <div className="t"><b>{fmtShort(r.date)} · {f1(r.distance_m / 1000)} km</b><small>onset km {r.onset_km ?? '—'} · EF {f1(r.ef, 3)}{r.wbgt != null ? ` · WBGT ${f1(r.wbgt)}` : ''}</small>
        <div className="bar" aria-hidden="true"><i style={{ width: pct(r.run_share), background: r.run_share >= 0.9 ? 'var(--green)' : r.run_share >= 0.6 ? 'var(--yellow)' : 'var(--red)' }} /></div></div>
      <div className="n"><b>{pct(r.run_share)}</b><small>berlari</small></div></button>)}</div>
    <Sheet open={!!sel} onClose={() => setSel(null)} label="Detail sesi">
      {S.state === 'loading' && <div className="skel" style={{ height: 120 }} />}
      {s?.found && <><p className="muted">{s.date}</p><h2 className="sess-title">{f1(s.distance_m / 1000, 2)} km · {fmtDur(s.elapsed_s)}</h2>
        <Tiles items={[['Run share', pct(s.run_share)], ['EF', f1(s.ef, 3), 'km/jam per bpm'], ['Drift', s.drift_pahr != null ? f1(s.drift_pahr) + '%' : s.run_drift != null ? f1(s.run_drift) + '% (lari)' : '—', s.metrics.drift_pahr?.why || ''], ['Onset fade', s.onset_km ? 'km ' + s.onset_km : 'tidak ada', s.metrics.fade_onset?.trigger],
          ['GCT fade', s.gct_fade != null ? f1(s.gct_fade, 0) + ' ms' : '—', 'akhir vs awal'], ['Stride', s.stride_fade != null ? f1(s.stride_fade, 3) + ' m' : '—'], ['HR@8:00', s.hr800 ?? '—', s.hr800 ? `z ${f1((s.hr800 - 143.1) / 5)}` : ''], ['Ekonomi', f1(s.economy_jm), 'J/m']]} />
        <RunBars km={s.km} /><p className="src-note">Tiap batang = 1 km: hijau ≥ 90% berlari, kuning ≥ 60%, merah di bawahnya.</p>
        {s.weather && !s.weather.indoor && <p className="muted">Cuaca: {s.weather.temp_c}°C · RH {s.weather.rh}% · WBGT≈{s.weather.wbgt} [calc]</p>}
        {s.card && <details className="more"><summary>Kartu episode (memori)</summary><pre className="card-pre">{s.card}</pre></details>}</>}
    </Sheet>
  </>
}

// ---- Twin
function Twin() {
  const T = useApi('/api/twin'), t = T.data?.state
  if (T.state === 'loading') return <div className="skel" style={{ height: 140 }} />
  if (!t) return <Card title="Digital Twin"><p className="muted">Belum dibangun. Tekan “Jalankan analisis sekarang” di tab Coach.</p></Card>
  const L = t.load, A = t.aerobic, D = t.durability, H = t.heat, P = t.projection
  const kmGuard = L.km_vs_4wk_avg_pct == null ? ['none', '—'] : L.km_vs_4wk_avg_pct > 10 ? ['red', `+${L.km_vs_4wk_avg_pct}% (batas +10%)`] : ['green', `${L.km_vs_4wk_avg_pct > 0 ? '+' : ''}${L.km_vs_4wk_avg_pct}%`]
  return <>
    <Card title="Guard beban" right={<Chip tone={kmGuard[0]}>{kmGuard[0] === 'red' ? 'melebihi' : kmGuard[0] === 'green' ? 'aman' : 'belum ada data'}</Chip>}>
      <Tiles items={[['Km vs rata-rata 4 mgg', kmGuard[1], 'aturan ≤ +10%'], ['Lari terpanjang 30 hr', f1(L.longest_run_km_30d) + ' km', 'LR ≤ 110% dari ini'], ['CTL / ATL / TSB', `${f1(L.ctl, 0)} / ${f1(L.atl, 0)} / ${f1(L.tsb, 0)}`], ['ACWR', f1(L.acwr_ewma, 2), `COROS ${f1(L.coros_ratio, 2)}`]]} />
      <p className="src-note">Pasca-Borobudur lonjakan beban 15 Nov membuat rasio tinggi sementara — bukan sinyal progresi.</p></Card>
    <Card title="Aerobik"><Tiles items={[['HR@8:00 (28 hr)', f1(A.hr_at_800.value), A.hr_at_800.n ? `z ${f1(A.hr_at_800.z)} · n=${A.hr_at_800.n}` : 'belum ada lari steady'], ['Baseline', '143.1 ± 5.0', 'Jan–Sep 2026'], ['EF easy 28 hr', f1(A.ef_easy_28d.value, 3), `n=${A.ef_easy_28d.n}`], ['Pace@HR150', A.pace_at_hr150.value ? fmtPaceS(A.pace_at_hr150.value) : '—', `n=${A.pace_at_hr150.n}`]]} /></Card>
    <Card title="Ketahanan (90 hari)"><Tiles items={[['Lari ≥ 16 km', D.long_runs_90d], ['Lari kontinu terpanjang', D.longest_continuous_run_km + ' km', '≥ 90% berlari'], ['Durability km', D.durability_km ?? '—', 'run share < 90%'], ['Onset fade median', D.fade_onset_km_median_90d ?? '—', 'km']]} /></Card>
    <Card title="Panas">{H.hr_cost_bpm_per_c ? <Tiles items={[['Biaya HR', `${H.hr_cost_bpm_per_c.value} bpm/°C`, `CI ${H.hr_cost_bpm_per_c.ci.join(' … ')}`], ['Biaya EF', f1(H.ef_cost_per_c.value, 4) + '/°C'], ['Sampel', H.n, `WBGT ${H.wbgt_range?.join('–')}`]]} /> : <p className="muted">{H.note || 'Menunggu data cuaca.'} (n={H.n ?? 0})</p>}</Card>
    <Card title="Sepatu"><table className="lapt"><thead><tr><th>Sepatu</th><th>km</th><th>n</th><th>EF vs km</th></tr></thead><tbody>{t.shoes.filter((s) => !s.retired || s.n).slice(0, 7).map((s) => <tr key={s.gear_id}><td>{s.name}</td><td>{s.km}</td><td>{s.n}</td><td><small className="muted">{s.flag}</small></td></tr>)}</tbody></table>
      <p className="src-note">Hanya dinilai bila n ≥ 8 lari per sepatu; tidak ada umur sepatu tervalidasi.</p></Card>
    <Card title="Proyeksi sub-4:00 [MODEL]"><p className="muted">Skenario ilustratif berbasis asumsi yang tertulis — bukan prediksi. Rasio realisasi marathon adalah faktor terbesar (teramati 0,59, n=1).</p>
      <table className="lapt"><thead><tr><th>Skenario</th><th>Median</th><th>P(&lt;4:00)</th></tr></thead><tbody>{P.scenarios.map((s) => <tr key={s.name}><td>{s.name}</td><td>{fmtDur(s.fm_time_p10_p50_p90[1])}</td><td><b>{pct(s.p_sub4)}</b></td></tr>)}</tbody></table>
      <p className="src-note">Butuh kenaikan VDOT ≥ {P.required_gain_per_month['ratio 0.95']}/bulan (rasio 0,95) atau ≥ {P.required_gain_per_month['ratio 0.90']}/bulan (rasio 0,90). {P.months_to_race} bulan menuju race.</p></Card>
    {t.data_gaps?.length > 0 && <Card title="Data belum lengkap"><ul className="plainlist">{t.data_gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></Card>}
  </>
}

// ---- Memori & korelasi
function Memory() {
  const [tick, setTick] = useState(0), C = useApi(`/api/memory?status=candidate&limit=30&_=${tick}`), P = useApi(`/api/memory?status=proposal&limit=30&_=${tick}`), E = useApi('/api/intel/edges')
  const act = (id, action) => post('/api/memory/action', { id, action }).then(() => setTick((x) => x + 1)).catch((e) => alert(e.message))
  const Item = ({ m }) => <div className="memitem"><b>{m.title}</b><small>{m.body}</small><div className="chips"><Chip>{m.tier}</Chip><Chip>{m.evidence_tag}</Chip><Chip>×{m.n}</Chip></div>
    <div className="seg" role="group" aria-label="Tindakan"><button onClick={() => act(m.id, 'approve')}>Setujui</button><button onClick={() => act(m.id, 'retract')}>Tolak</button></div></div>
  return <>
    <Card title="Menunggu konfirmasi" right={<Chip>{(C.data?.length || 0) + (P.data?.length || 0)}</Chip>}><p className="muted">Temuan dari coach disimpan sebagai hipotesis. Hanya yang kamu setujui (atau yang terulang 3×) jadi aktif. Aturan terkunci tidak bisa diubah coach.</p>
      {[...(P.data || []), ...(C.data || [])].map((m) => <Item key={m.id} m={m} />)}{C.state === 'ok' && P.state === 'ok' && !C.data.length && !P.data.length && <p className="muted">Tidak ada yang menunggu.</p>}</Card>
    <Card title="Korelasi (asosiasi, bukan sebab)">{E.state === 'ok' && !E.data.length ? <p className="muted">Belum ada hubungan yang lolos kontrol statistik. Wajar saat ini: baru {'~'}70 sesi FIT yang dianalisis; makin banyak FIT, makin kuat uji ini.</p> :
      (E.data || []).map((e) => <div key={e.id} className="memitem"><b>{e.exposure} → {e.outcome}</b><small>{e.lag_lo}–{e.lag_hi} hari sebelum lari · ρ parsial {e.partial_rho} (CI {e.ci_lo}…{e.ci_hi}) · n={e.n} · q={e.q}</small><div className="chips"><Chip tone={e.status === 'supported' ? 'green' : 'yellow'}>{e.status === 'supported' ? 'didukung' : e.status === 'candidate' ? 'kandidat' : e.status}</Chip></div></div>)}</Card>
  </>
}

const VIEWS = [['coach', 'Coach'], ['dur', 'Ketahanan'], ['twin', 'Twin'], ['mem', 'Memori']]
export default function Coach() {
  const [v, setV] = useState('coach'), st = useApi('/api/intel/status')
  return <Screen title="Coach" sub="Monitoring · analisis · arahan menuju sub-4:00">
    <div className="seg3" role="tablist" aria-label="Bagian coach">{VIEWS.map(([k, l]) => <button key={k} role="tab" aria-selected={v === k} onClick={() => setV(k)}>{l}</button>)}</div>
    {v === 'coach' && <><Ask st={st.data} /><Recent /><Status st={st.data} /></>}
    {v === 'dur' && <Durability />}
    {v === 'twin' && <Twin />}
    {v === 'mem' && <Memory />}
  </Screen>
}

// ---- Home card: today's brief + the two numbers that matter (load guard, sub-4 scenarios)
export function HomeCoach({ go }) {
  const R = useApi('/api/coach/runs'), T = useApi('/api/twin'), t = T.data?.state
  const brief = (R.data || []).find((r) => r.intent === 'daily_brief' && r.ok && r.created_at.slice(0, 10) >= new Date(Date.now() - 20 * 3600e3).toISOString().slice(0, 10)), B = useApi(brief ? `/api/coach/run?id=${brief.id}` : '', !!brief)
  const g = t?.load?.km_vs_4wk_avg_pct, sc = t?.projection?.scenarios
  return <button className="card hero-btn" onClick={() => go('coach')} aria-label="Buka Coach">
    <div className="ch"><h2>Coach</h2><Chip>{brief ? 'brief hari ini' : 'belum ada brief'}</Chip></div>
    {B.data?.parsed ? <p className="lead">{B.data.parsed.summary}</p> : <p className="muted">{t ? 'Belum ada brief hari ini — dibuat otomatis setelah sync pagi, atau minta manual di tab Coach.' : 'Digital Twin belum dibangun.'}</p>}
    {t && <div className="chips">
      {g != null && <Chip tone={g > 10 ? 'red' : 'green'}>Km vs 4 mgg: {g > 0 ? '+' : ''}{g}% (batas +10%)</Chip>}
      {sc && <Chip>Sub-4: {pct(sc[0].p_sub4)} · {pct(sc[1].p_sub4)} · {pct(sc[2].p_sub4)} [MODEL]</Chip>}
    </div>}
  </button>
}
