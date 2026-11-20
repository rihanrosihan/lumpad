import test from 'node:test'
import assert from 'node:assert/strict'
process.env.GOOGLE_MAPS_API_KEY = 'AIzaTESTKEYTESTKEYTESTKEYTESTKEY12'
process.env.GOOGLE_DAILY_CAP = '5'
const G = await import('./google.js')
const hdr = (t) => ({ get: () => t })
test('tile: creates one session, reuses it, passes the image through; the key goes only upstream', async () => {
  const urls = []
  const fetchFn = async (url, opt) => {
    urls.push(String(url))
    if (String(url).includes('createSession')) return { ok: true, status: 200, json: async () => ({ session: 'S1', expiry: String(Math.floor(Date.now() / 1000) + 3600) }) }
    return { ok: true, status: 200, headers: hdr('image/png'), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
  }
  G.resetSession()
  const a = await G.tile(new URLSearchParams('z=14&x=13000&y=8000'), { fetchFn }), b = await G.tile(new URLSearchParams('z=14&x=13001&y=8000'), { fetchFn })
  assert.deepEqual([...a.body], [1, 2, 3]); assert.equal(a.type, 'image/png'); assert.equal(urls.filter((u) => u.includes('createSession')).length, 1)
  assert.ok(urls[1].startsWith('https://tile.googleapis.com/v1/2dtiles/14/13000/8000?session=S1&key=')); assert.ok(b)
})
test('tile: bad coordinates are rejected before any upstream call', async () => {
  const fetchFn = async () => { throw new Error('must not be called') }
  for (const qs of ['z=99&x=1&y=1', 'z=3&x=8&y=0', 'z=3&x=-1&y=0', 'z=a&x=1&y=1', 'z=3&x=1.5&y=1', 'z=3&x=1/../../y&y=1']) await assert.rejects(G.tile(new URLSearchParams(qs), { fetchFn }), (e) => e.status === 400)
})
test('daily cap stops upstream calls', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, headers: hdr('image/png'), arrayBuffer: async () => new ArrayBuffer(1), json: async () => ({ session: 'S2', expiry: String(Math.floor(Date.now() / 1000) + 3600) }) })
  G.resetSession(); let err
  for (let i = 0; i < 10 && !err; i++) { try { await G.tile(new URLSearchParams('z=5&x=1&y=1'), { fetchFn }) } catch (e) { err = e } }
  assert.equal(err?.status, 429); assert.ok(G.status().used_today <= 5)
})
