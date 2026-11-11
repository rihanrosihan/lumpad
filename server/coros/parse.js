// Parsers for the text formats returned by the COROS MCP tools (verified against real responses, 11 Nov 2026).
// Rule: a field that cannot be read is omitted — never guessed.
const mins = (s) => { if (!s) return undefined; const h = /(\d+)\s*h/.exec(s), m = /(\d+)\s*min/.exec(s); if (!h && !m) return undefined; return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) }
const num = (re, s) => { const m = re.exec(s); return m ? +m[1].replace(/,/g, '') : undefined }
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !Number.isNaN(v)))
const iso8 = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`

// queryDailyHealthData → [{date, steps, stress_avg, sleep_*_min, sleep_hr_*}]   (dates are wake-up days)
export function parseDailyHealth(text) {
  const out = []
  for (const blk of String(text).split(/^--- (\d{8}) ---$/m).slice(1).reduce((a, x, i, arr) => (i % 2 === 0 ? [...a, [x, arr[i + 1]]] : a), [])) {
    const [d, b] = blk
    out.push(clean({
      date: iso8(d), steps: num(/Steps:\s*([\d,]+)/, b), stress_avg: num(/Stress:\s*Avg\s*(\d+)/, b),
      sleep_total_min: mins(/Total:\s*([^|\n]+)/.exec(b)?.[1]), sleep_deep_min: mins(/Deep:\s*([^|\n]+)/.exec(b)?.[1]), sleep_light_min: mins(/Light:\s*([^|\n]+)/.exec(b)?.[1]),
      sleep_rem_min: mins(/REM:\s*([^|\n]+)/.exec(b)?.[1]), sleep_awake_min: mins(/Awake:\s*([^|\n]+)/.exec(b)?.[1]),
      sleep_hr_avg: num(/Sleep HR:\s*Avg\s*(\d+)/, b), sleep_hr_min: num(/Sleep HR:[^\n]*Min\s*(\d+)/, b), sleep_hr_max: num(/Sleep HR:[^\n]*Max\s*(\d+)/, b),
    }))
  }
  return out
}
// querySleepHrv → official 'HRV Assessment' block only (the raw time series is ignored)
export function parseSleepHrv(text) {
  const t = String(text), a = t.indexOf('HRV Assessment'), b = t.indexOf('Sleep HRV Time Series'), blk = t.slice(a < 0 ? 0 : a, b < 0 ? undefined : b), out = []
  const re = /(\d{4}-\d{2}-\d{2}):\s*\n\s*HRV Avg:\s*(\d+)\s*ms\s*[—–-]\s*([^\n]+?)\s*\n\s*Normal Range:\s*(\d+)\s*[-–]\s*(\d+)\s*ms\s*\n\s*Baseline:\s*(\d+)\s*ms/g
  for (let m; (m = re.exec(blk)); ) out.push({ date: m[1], hrv_avg: +m[2], hrv_status: m[3].trim().slice(0, 40), hrv_range_lo: +m[4], hrv_range_hi: +m[5], hrv_baseline: +m[6] })
  return out
}
export function parseResting(text) { const out = [], re = /(\d{4}-\d{2}-\d{2}):\s*(\d+)\s*bpm/g; for (let m; (m = re.exec(String(text))); ) out.push({ date: m[1], resting_hr: +m[2] }); return out }

const SPORT = { 100: 'Run', 101: 'Run', 102: 'Run', 103: 'Run', 104: 'Hike', 900: 'Walk', 402: 'Strength', 400: 'Cardio', 200: 'Ride', 201: 'Ride', 300: 'Swim' }
const clock = (s) => { if (!s) return undefined; const p = s.split(':').map(Number); if (p.some(Number.isNaN)) return undefined; return p.reduce((a, n) => a * 60 + n, 0) }
// querySportRecords → activities (distance: km or m; duration h:mm:ss or mm:ss)
export function parseSportRecords(text) {
  const out = []
  for (const b of String(text).split(/^\s*\d+\.\s+/m).slice(1)) {
    const head = /^(.+?)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})/.exec(b); if (!head) continue
    const label = /LabelId:\s*(\d+)/.exec(b)?.[1], st = num(/SportType:\s*(\d+)/, b); if (!label) continue
    const dist = /Distance:\s*([\d.,]+)\s*(km|m)\b/.exec(b), pace = /Average Pace:\s*(\d+:\d{2})/.exec(b)
    out.push(clean({
      source: 'coros', source_id: label, date: head[2], sport: SPORT[st] || head[1].trim().slice(0, 40), name: head[1].trim().slice(0, 200), sport_code: st,
      distance_m: dist ? Math.round(+dist[1].replace(/,/g, '') * (dist[2] === 'km' ? 1000 : 1)) : undefined,
      duration_s: clock(/Duration:\s*([\d:]+)/.exec(b)?.[1]), avg_pace_s_km: pace ? clock(pace[1]) : undefined,
      avg_hr: num(/Avg HR:\s*(\d+)/, b), calories: num(/Calories:\s*([\d,]+)/, b), start_ts: num(/startTimestamp=(\d+)/, b),
      location: /Location:\s*([^\n]+)/.exec(b)?.[1].trim().slice(0, 120),
    }))
  }
  return out
}
// queryActivityLapData (JSON) → laps from the 1-km auto-lap group (type 2) + whole-activity cadence/power (type -1)
export function parseLaps(text) {
  let j; try { j = typeof text === 'string' ? JSON.parse(text) : text } catch { return null }
  const groups = j?.lapGroups; if (!Array.isArray(groups)) return null
  const g = groups.find((x) => x.type === 2), all = groups.find((x) => x.type === -1)?.laps?.[0]
  const laps = (g?.laps || []).map((l) => clean({
    distance_m: l.distance / 100, duration_s: l.time, avg_pace_s_km: l.avgPace, avg_hr: l.avgHr, cadence: l.avgCadence || undefined, power: l.avgPower || undefined, gct_ms: l.groundTime || undefined,
  })) // COROS lap distances are in centimetres
  return { laps, cadence: all?.avgCadence || undefined, power: all?.avgPower || undefined }
}
