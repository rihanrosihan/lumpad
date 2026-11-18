// Minimal .xlsx reader (zip + XML, no formulas): returns { sheetName: [[cell, …], …] } with strings and numbers.
// Dates stay Excel serials (use serialToISO); enough for Google Sheets / Excel exports. Runs in the browser and under node --test.
import { unzipSync, strFromU8 } from 'fflate'

const ent = (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()] ?? (e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1)))))
const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => ent(m[1])).join('')

export function readXlsx(bytes) {
  const f = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), get = (p) => (f[p] ? strFromU8(f[p]) : null)
  const wb = get('xl/workbook.xml'), rels = get('xl/_rels/workbook.xml.rels')
  if (!wb || !rels) throw new Error('Not an Excel (.xlsx) file')
  const shared = (get('xl/sharedStrings.xml') ? [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [])
  const target = Object.fromEntries([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [(m[1].match(/\bId="([^"]*)"/) || [])[1], (m[1].match(/\bTarget="([^"]*)"/) || [])[1]]))
  const out = {}
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = ent((m[1].match(/\bname="([^"]*)"/) || [])[1] || ''), rid = (m[1].match(/\br:id="([^"]*)"/) || [])[1], t = target[rid]
    const xml = t && get('xl/' + t.replace(/^\/?(xl\/)?/, '')); if (!xml) continue
    const rows = []
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\sr="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = []
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1], type = (attrs.match(/\bt="([^"]*)"/) || [])[1], body = c[2] || '', v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
        let val = null
        if (type === 's') val = v != null ? shared[+v] ?? null : null
        else if (type === 'inlineStr') val = texts(body)
        else if (type === 'str') val = v != null ? ent(v) : null
        else if (type === 'b') val = v === '1'
        else if (v != null && v !== '') val = Number(v)
        if (ref) row[colIdx(ref)] = val
      }
      rows.push(Array.from(row, (x) => x ?? null))
    }
    out[name] = rows
  }
  return out
}
export { serialToISO, serialToHM } from './serial.js'
