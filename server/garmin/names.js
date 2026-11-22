// Pure helpers: dataset naming and natural keys for the raw vault.
import crypto from 'node:crypto'
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

// 'DI_CONNECT/DI-Connect-Metrics/TrainingHistory_20240901_20241210_125622335.json' -> 'Metrics/TrainingHistory'
export function datasetName(entry) {
  const parts = entry.split('/'), file = parts[parts.length - 1].replace(/\.json$/i, '')
  const dir = (parts[parts.length - 2] || '').replace(/^DI-Connect-/, '').replace(/^DI-/, '')
  let n = file
    .replace(/[\w.+-]+@[\w.-]+?[_-]/, '')               // account prefix (email) — never kept in names
    .replace(/\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_?/, '') // 2024-06-13_2024-09-21_
    .replace(/_?\d{8}_\d{8}/, '').replace(/_\d{6,}$/, '') // _20240901_20241210, trailing profile id / timestamp
    .replace(/^\d+_/, "")
    .replace(/^_+|_+$/g, '')
  const m = /^(\d+_)?(.*?)(_\d{4}-\d{2}-\d{2})+$/.exec(n); if (m) n = m[2]
  return `${dir}/${n || 'unnamed'}`
}

const WRAPPERS = ['summarizedActivitiesExport', 'workoutList', 'personalRecords', 'gearDTOS', 'weeklyTrainingReportExport', 'courses', 'paceBands']
// -> array of records (a single dict is one record)
export function records(json) {
  if (Array.isArray(json)) {
    if (json.length === 1 && json[0] && typeof json[0] === 'object') for (const w of WRAPPERS) if (Array.isArray(json[0][w])) return json[0][w]
    return json
  }
  if (json && typeof json === 'object') { for (const w of WRAPPERS) if (Array.isArray(json[w])) return json[w]; return [json] }
  return []
}

const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : typeof v === 'number' && v > 1e11 ? new Date(v).toISOString().slice(0, 10) : null)
// natural key + calendar day for a record; sha-based key as the safe fallback (never collides on different content)
export function recKey(dataset, r, jsonText) {
  const h = sha256(jsonText)
  const cd = r && typeof r === 'object' ? r.calendarDate ?? r.asOfDateGmt ?? r.createTimestamp ?? r.metaData?.calendarDate : undefined
  const d = Array.isArray(cd) ? `${cd[0]}-${String(cd[1]).padStart(2, '0')}-${String(cd[2]).padStart(2, '0')}` : day(cd)
  if (r && typeof r === 'object') {
    if (r.activityId && /summarizedActivities/.test(dataset)) return { key: String(r.activityId), day: day(r.startTimeGmt), sha: h }
    if (r.retro === false && Object.keys(r).length === 1) return { key: 'stub:' + h.slice(0, 16), day: null, sha: h } // sleep placeholder
    if (/UDSFile|sleepData|HydrationLogFile|healthStatusData/.test(dataset) && d && !/Hydration/.test(dataset)) return { key: d, day: d, sha: h }
    if (/TrainingReadiness|AcuteTrainingLoad|TrainingHistory|RunRacePredictions|MaxMet/.test(dataset) && d) return { key: `${d}|${r.timestamp ?? r.updateTimestamp ?? ''}|${r.sport ?? ''}`, day: d, sha: h }
  }
  return { key: 'h:' + h.slice(0, 24), day: d || null, sha: h }
}
