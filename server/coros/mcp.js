// Calls COROS MCP tools with the official MCP SDK (Streamable HTTP) using the stored OAuth token.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getAccessToken, MCP_URL, discover } from './oauth.js'
import { db } from '../store.js'
import zlib from 'node:zlib'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// run(call) gets call(tool, args) → text. Responses are archived raw (gzip) so parsers can be re-run without calling COROS again.
export async function withCoros(run, { archive = true, delayMs = 400 } = {}) {
  const token = await getAccessToken()
  // call the resource the token was issued for (from discovery); fall back to the configured URL if discovery is unavailable
  let url = MCP_URL(); try { url = (await discover()).resource || url } catch {}
  const client = new Client({ name: 'lumpad', version: '1.0.0' }), transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  await client.connect(transport)
  let last = 0
  const call = async (tool, args = {}) => {
    const wait = last + delayMs - Date.now(); if (wait > 0) await sleep(wait); last = Date.now()
    const res = await client.callTool({ name: tool, arguments: args })
    const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    if (res.isError) throw new Error(`${tool}: ${text.slice(0, 200)}`)
    if (archive) db.prepare('INSERT INTO raw_pulls (source, tool, params, body, pulled_at) VALUES (?,?,?,?,?)').run('coros', tool, JSON.stringify(args), zlib.gzipSync(text), new Date().toISOString())
    return text
  }
  try { return await run(call) } finally { try { await client.close() } catch {} }
}
