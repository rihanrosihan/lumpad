import { useMemo } from 'react'
import SNAP from './data/coros-plan.json'
import { useApi } from './api.js'
import { classify, byDate, allByDate } from './lib/corosplan.js'

const SNAP_ROWS = classify(SNAP)
// The COROS training schedule: the server's live copy (synced with every COROS pull) when it has one, otherwise the bundled snapshot.
export function useCorosPlan() {
  const A = useApi('/api/coros/plan')
  return useMemo(() => {
    const live = A.data?.rows?.length ? A.data : null, rows = live ? classify(live.rows) : SNAP_ROWS
    return { rows, map: byDate(rows), all: allByDate(rows), live: !!live, at: live?.at || null, loading: A.state === 'loading' }
  }, [A.data, A.state])
}
