// Minimal read-only ZIP reader (central directory + inflate). Entries are read into memory by name and NEVER written to disk or used as a path,
// so a hostile archive cannot traverse directories. Zip64 and encryption are refused. CRC32 and size are verified on every read.
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

export function openZip(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size
  const tailLen = Math.min(size, 65557), tail = Buffer.alloc(tailLen); fs.readSync(fd, tail, 0, tailLen, size - tailLen)
  const e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); if (e < 0) throw new Error('not a zip (no end-of-central-directory)')
  const total = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16)
  if (total === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw new Error('zip64 is not supported')
  const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff)
  const entries = []
  for (let p = 0; p + 46 <= cdSize && cd.readUInt32LE(p) === 0x02014b50;) {
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24)
    const dosT = cd.readUInt16LE(p + 12), dosD = cd.readUInt16LE(p + 14)
    const nlen = cd.readUInt16LE(p + 28), elen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), lho = cd.readUInt32LE(p + 42)
    const name = cd.toString('utf8', p + 46, p + 46 + nlen)
    const mtime = `${1980 + (dosD >> 9)}-${String((dosD >> 5) & 15).padStart(2, '0')}-${String(dosD & 31).padStart(2, '0')}`
    entries.push({ name, mtime, method, crc, csize, usize, lho, encrypted: !!(flags & 1), dir: name.endsWith('/') })
    p += 46 + nlen + elen + clen
  }
  const byName = new Map(entries.map((x) => [x.name, x]))
  const read = (name) => {
    const x = byName.get(name); if (!x) throw new Error('no such entry: ' + name)
    if (x.encrypted) throw new Error('encrypted entry: ' + name)
    const h = Buffer.alloc(30); fs.readSync(fd, h, 0, 30, x.lho); if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header: ' + name)
    const start = x.lho + 30 + h.readUInt16LE(26) + h.readUInt16LE(28), raw = Buffer.alloc(x.csize); fs.readSync(fd, raw, 0, x.csize, start)
    const out = x.method === 0 ? raw : x.method === 8 ? zlib.inflateRawSync(raw) : (() => { throw new Error('unsupported method ' + x.method) })()
    if (out.length !== x.usize) throw new Error('size mismatch: ' + name)
    if (zlib.crc32(out) !== x.crc) throw new Error('crc mismatch: ' + name)
    return out
  }
  return { entries, has: (n) => byName.has(n), read, text: (n) => read(n).toString('utf8'), close: () => fs.closeSync(fd) }
}
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
export const fileSha256 = (file) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej) })
