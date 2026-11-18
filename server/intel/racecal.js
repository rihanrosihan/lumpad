// The 2027 race calendar as the app plans it (src/lib/season.js). The coach must treat this as authoritative: older notes in the imported
// knowledge base (e.g. "Jakim = C-race, run-walk from km 1, < 6:00/km, finish-first") are superseded by it.
import { RACES } from '../../src/lib/season.js'

const REG = { registered: 'registered', 'not-open': 'date confirmed, registration not open', 'no-info': 'no race info yet' }
export const raceLine = (r) => `${r.name} ${r.date} = ${r.cls}-race${r.target ? `, target ${r.target} (official time)` : ', no time target: finish before the cut-offs (COP/COT)'}${r.watchPlan ? `; plan the watch for 4:50–4:52 (6:52–6:55/km); 2026 official 6:53:03` : ''}; ${REG[r.reg]}`
export const RACE_CALENDAR = RACES.map(raceLine)
export const RACE_CALENDAR_TEXT = 'Race calendar 2027 (authoritative, supersedes older notes): ' + RACE_CALENDAR.join(' | ') + '. The G-MJM jog on Wed 16 Jun is a gate session, not a race. The JRF half marathon is cancelled: JRF is the full marathon only (Sun 24 Oct).'
