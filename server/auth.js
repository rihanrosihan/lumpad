// App-level authentication gate (audit C1/C2). Caddy authenticates (basic auth) and stamps the verified user into X-Lumpad-User (header_up, after the login);
// it strips any client-supplied value on the public paths. Node listens on 127.0.0.1 only, so only Caddy (or a local process) can reach it.
// With LUMPAD_REQUIRE_USER=1 every route except the allow-list needs that header: if the proxy login is ever switched off or bypassed, the API answers 401
// instead of opening health data. Off by default, so enabling it is a deliberate step together with the Caddy template.
const PUBLIC = new Set(['GET /api/health', 'POST /api/ingest', 'GET /api/ingest/status'])   // the ingest routes carry their own bearer token
export const requireUser = (env = process.env) => env.LUMPAD_REQUIRE_USER === '1'
export const principal = (req) => { const v = req.headers['x-lumpad-user']; return typeof v === 'string' && /^[\w.@-]{1,64}$/.test(v) ? v : null }
export function authorize(req, pathname, env = process.env) {
  if (!requireUser(env) || PUBLIC.has(`${req.method} ${pathname}`)) return null
  return principal(req) ? null : { status: 401, error: 'authentication required' }
}
