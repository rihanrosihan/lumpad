// NCBI E-utilities (public). Be polite: ≤3 req/s w/o key; set NCBI_API_KEY for 10/s. Never send user data.
const B = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const key = () => (process.env.NCBI_API_KEY ? '&api_key=' + process.env.NCBI_API_KEY : '')
const cache = new Map()
let last = 0
// Serialise + space requests (~3/s) and retry once on 429/non-JSON
async function ncbi(url) {
  for (let i = 0; i < 2; i++) {
    const wait = last + 400 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); last = Date.now()
    const r = await fetch(url)
    if (r.ok) { try { return await r.json() } catch {} }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw Object.assign(new Error('PubMed is rate-limiting or failing, try again'), { status: 502 })
}
export async function search(term, max = 8) {
  const k = term + max; if (cache.has(k)) return cache.get(k)
  const s = await ncbi(`${B}/esearch.fcgi?db=pubmed&retmode=json&retmax=${max}&sort=relevance&term=${encodeURIComponent(term)}${key()}`)
  const ids = s.esearchresult?.idlist ?? []
  if (!ids.length) return []
  const sm = await ncbi(`${B}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}${key()}`)
  const out = ids.filter((id) => sm.result?.[id]).map((id) => { const d = sm.result[id]; return { pmid: id, title: d.title, authors: (d.authors || []).slice(0, 3).map((a) => a.name).join(', '), journal: d.source, year: (d.pubdate || '').slice(0, 4), url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, source: 'pubmed', tag: 'LITERATURE', pulledAt: new Date().toISOString() } })
  cache.set(k, out); return out
}
