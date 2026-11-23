import { useState } from 'react'
import { useApi, invalidate } from './api.js'
import { Card, Chip } from './ui.jsx'
import { send } from './PlanEngine.jsx'

// Daily workout menu: 2–3 checked options for one day. Choosing B or C is the approval, the engine applies it at once (and can undo it from Plan engine › History).
export default function PlanMenuCard({ date }) {
  const [rev, setRev] = useState(0), [msg, setMsg] = useState(null), M = useApi(`/api/plan/menu?date=${date}&r=${rev}`)
  const d = M.data
  if (!d || (!d.blocked && (d.options || []).length < 1)) return null
  const pick = async (o) => { setMsg(null); try { const r = await send('POST', '/api/plan/menu/choose', { date, option: o.id }); setMsg({ tone: 'green', text: o.id === 'A' ? 'Keeping the plan as is.' : r.changed ? `Done: ${o.title.toLowerCase()}.` : 'Already chosen.' }); invalidate('/api/plan/menu'); setRev((x) => x + 1) } catch (e) { setMsg({ tone: 'red', text: e.message }) } }
  if (d.blocked) return <Card tone="red" title="Today's options"><p><b>{d.referral}</b></p></Card>
  return <Card title="Today's options" right={<Chip>checked against your rules</Chip>}>
    {d.options.map((o) => <div key={o.id} className="rowbtn plain pe-opt"><Chip>{o.id}</Chip><span><b>{o.title}</b><small>{o.km} km{o.patch ? ' · ' + o.patch.rationale : ''}{o.warning ? ' · ' + o.warning : ''}</small></span><button className="btn sm" onClick={() => pick(o)}>{o.id === 'A' ? 'Keep' : 'Choose'}</button></div>)}
    {msg && <p className={`pe-msg ${msg.tone}`} role="status">{msg.text}</p>}
  </Card>
}
