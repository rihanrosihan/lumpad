// Which code points does SQLite's FTS5 unicode61 tokenizer (remove_diacritics 2) treat as token characters, and how does it fold them?
// Probes the real tokenizer for every code point 0x80–0x2FFFF and writes ranges to /tmp for the Go generator. Run once: node tools/probe_fts5_unicode.mjs
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
const d = new DatabaseSync(':memory:')
d.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='unicode61 remove_diacritics 2'); CREATE VIRTUAL TABLE v USING fts5vocab(t, 'instance')")
const ins = d.prepare('INSERT INTO t(rowid, x) VALUES (?, ?)'); d.exec('BEGIN')
for (let cp = 0x80; cp <= 0x2ffff; cp++) { if (cp >= 0xd800 && cp <= 0xdfff) continue; ins.run(cp, 'a' + String.fromCodePoint(cp) + 'b') }
d.exec('COMMIT')
const per = new Map(); for (const r of d.prepare('SELECT doc, term FROM v').iterate()) { const a = per.get(r.doc) || []; a.push(r.term); per.set(r.doc, a) }
const tok = [], fold = {}
for (let cp = 0x80; cp <= 0x2ffff; cp++) { if (cp >= 0xd800 && cp <= 0xdfff) continue; const t = per.get(cp) || []; if (t.length === 1) { tok.push(cp); const mid = t[0]; if (mid.startsWith('a') && mid.endsWith('b')) fold[cp] = mid.slice(1, -1) } }
const ranges = []; for (const cp of tok) { const l = ranges.at(-1); if (l && l[1] === cp - 1) l[1] = cp; else ranges.push([cp, cp]) }
fs.writeFileSync('/tmp/fts5_probe.json', JSON.stringify({ ranges, fold }))
console.log('token code points:', tok.length, 'in', ranges.length, 'ranges; folded entries:', Object.keys(fold).length)
