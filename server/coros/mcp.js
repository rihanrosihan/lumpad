// Calls COROS MCP tools with the official MCP SDK (Streamable HTTP) using the stored OAuth token.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getAccessToken, MCP_URL, discover } from './oauth.js'
import { db } from '../store.js'
import zlib from 'node:zlib'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// COROS text tools answer with a JSON *string literal* ("Sport Records…\n…" incl. the quotes and escaped newlines).
// Unwrap it so parsers see real lines. Anything that is not a JSON string (plain text, a JSON object) is returned as is.
export function decodeText(t) {
  const s = String(t ?? '')
  if (s.length < 2 || s[0] !== '"' || s.trimEnd().slice(-1) !== '"') return s
  try { const v = JSON.parse(s); return typeof v === 'string' ? v : s } catch { return s }
}

// Errors that mean "you used up today's allowance" (vs. a one-off failure). Matched on the tool's error text / HTTP error.
export const QUOTA_RE = /quota|rate.?limit|too many|limit (?:has been )?(?:reached|exceeded)|exceed(?:ed|s)? (?:the )?(?:daily|max)|daily (?:download )?limit|\b429\b|frequen/i

// run(call) gets call(tool, args) → decoded text. call.content(tool, args) → the raw MCP content array (for binary resources).
// Responses are archived raw (gzip) so parsers can be re-run without calling COROS again.
export async function withCoros(run, { archive = true, delayMs = 400 } = {}) {
  const token = await getAccessToken()
  // call the resource the token was issued for (from discovery); fall back to the configured URL if discovery is unavailable
  let url = MCP_URL(); try { url = (await discover()).resource || url } catch {}
  const client = new Client({ name: 'lumpad', version: '1.0.0' }), transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
  let last = 0
  const invoke = async (tool, args = {}) => {
    const wait = last + delayMs - Date.now(); if (wait > 0) await sleep(wait); last = Date.now()
    let res
    try { res = await client.callTool({ name: tool, arguments: args }) } catch (e) { if (QUOTA_RE.test(e.message)) e.quota = true; throw e }
    const text = decodeText((res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'))
    if (res.isError) { const e = new Error(`${tool}: ${text.slice(0, 300)}`); e.quota = QUOTA_RE.test(text); throw e }
    if (archive) db.prepare('INSERT INTO raw_pulls (source, tool, params, body, pulled_at) VALUES (?,?,?,?,?)').run('coros', tool, JSON.stringify(args), zlib.gzipSync(text), new Date().toISOString())
    return { text, content: res.content || [] }
  }
  const call = async (tool, args) => (await invoke(tool, args)).text
  call.content = async (tool, args) => (await invoke(tool, args)).content
  try { return await run(call) } finally { try { await client.close() } catch {} }
}
