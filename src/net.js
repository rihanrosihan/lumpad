// Identical GETs issued at the same moment (App shell + page, or two cards on one page) share a single request.
// Only in-flight requests are shared: once a request settles the next caller fetches fresh data.
const inflight = new Map()
export function getJson(path) {
  if (inflight.has(path)) return inflight.get(path)
  const p = fetch(path).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() }).finally(() => setTimeout(() => inflight.delete(path), 0))
  inflight.set(path, p); return p
}
