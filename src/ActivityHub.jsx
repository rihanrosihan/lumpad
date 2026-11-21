import { useState } from 'react'
import Activity from './Activity.jsx'
import FitnessPanel from './FitnessPanel.jsx'
import { SegmentedTabs } from './ui.jsx'

// Activities: Recent Activities (the catalog; opening one shows the full run analysis) and Fitness (status, baseline, progress)
export default function ActivityHub({ vdot, focus, go, settings, results, M }) {
  const [tab, setTab] = useState('recent')
  if (focus?.id) return <Activity vdot={vdot} focus={focus} go={go} settings={settings} />
  return <>
    <section className="screen" style={{ paddingBottom: 0 }}><div className="hub-tabs ahub-tabs"><SegmentedTabs tabs={[{ id: 'recent', label: 'Recent Activities' }, { id: 'fitness', label: 'Fitness' }]} value={tab} onChange={setTab} label="Activities sections" /></div></section>
    {tab === 'recent' ? <Activity vdot={vdot} focus={focus} go={go} settings={settings} /> : <section className="screen"><FitnessPanel vdot={vdot} results={results} M={M} go={go} /></section>}
  </>
}
