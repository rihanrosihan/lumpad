// Citation library. Consensus has no verified programmatic access → entries are added manually (paste URL/title) and tagged.
import { load, save } from './db.js'
export const consensusStatus = () => ({ api: 'unverified', note: 'Consensus has no verified programmatic access yet. Add citations manually; PubMed is automatic.' })
export const list = () => load('library', [])
// only plain web links are stored: a "javascript:" or "data:" URL would run script when the saved link is clicked
export const safeUrl = (u) => { const t = String(u || '').trim().slice(0, 500); return /^https?:\/\/[^\s<>"']+$/i.test(t) ? t : '' }
export function add(e) {
  const lib = list()
  const entry = { id: Date.now().toString(36), title: String(e.title || '').slice(0, 500), url: safeUrl(e.url), pmid: e.pmid || null, source: e.source || 'manual', tag: ['LITERATURE', 'VALIDATED', 'HYPOTHESIS'].includes(e.tag) ? e.tag : 'LITERATURE', note: String(e.note || '').slice(0, 1000), addedAt: new Date().toISOString() }
  if (entry.pmid && lib.some((x) => x.pmid === entry.pmid)) return lib
  save('library', [entry, ...lib]); return list()
}
export const remove = (id) => { save('library', list().filter((x) => x.id !== id)); return list() }
