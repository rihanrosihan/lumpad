// Minimal FIT header + file_id reader (no full decode): enough to classify 8.7k files cheaply.
// FIT epoch = 1989-12-31T00:00:00Z. file_id: type(0, enum8) manufacturer(1, u16) product(2, u16) serial(3) time_created(4, u32 s)
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31)
export function fitMeta(buf) {
  if (buf.length < 14 || buf.toString('latin1', 8, 12) !== '.FIT') return null
  const hs = buf[0]; let o = hs
  if (o + 6 > buf.length) return null
  const defs = new Map()
  for (let guard = 0; o < buf.length && guard < 64; guard++) {
    const h = buf[o]
    if (h & 0x80) return null // compressed timestamp before file_id: not a normal FIT start
    const local = h & 0x0f
    if (h & 0x40) { // definition message
      const little = buf[o + 2] === 0, nf = buf[o + 5]
      const g = little ? buf.readUInt16LE(o + 3) : buf.readUInt16BE(o + 3)
      const fields = []; let size = 0
      for (let i = 0; i < nf; i++) { const n = buf[o + 6 + i * 3], s = buf[o + 7 + i * 3]; fields.push([n, s, size]); size += s }
      let next = o + 6 + nf * 3
      if (h & 0x20) next += 1 + buf[next] * 3 // developer fields (rare at file start)
      defs.set(local, { g, little, fields, size }); o = next; continue
    }
    const d = defs.get(local); if (!d) return null
    const base = o + 1
    if (d.g === 0) {
      const out = {}
      for (const [n, s, off] of d.fields) {
        const p = base + off
        if (n === 0) out.type = buf[p]
        else if (n === 1 && s === 2) out.manufacturer = d.little ? buf.readUInt16LE(p) : buf.readUInt16BE(p)
        else if (n === 2 && s === 2) out.product = d.little ? buf.readUInt16LE(p) : buf.readUInt16BE(p)
        else if (n === 4 && s === 4) { const t = d.little ? buf.readUInt32LE(p) : buf.readUInt32BE(p); if (t !== 0xffffffff) out.time_created_ms = FIT_EPOCH_MS + t * 1000 }
      }
      return out
    }
    o = base + d.size
  }
  return null
}
