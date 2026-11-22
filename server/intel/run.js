// Intelligence job chain. One at a time (own lock), progress persisted in intel_job. Heavy steps yield to the event loop; never starts while a COROS sync/archive session runs.
import fs from 'node:fs'
import path from 'node:path'
import { adb } from '../coros/archive.js'
import { db as app } from '../store.js'
import { idb } from './db.js'
import { fitJob, buildCards } from './pipeline.js'
import { weatherJob } from './weather.js'
import { projectLog, buildDailyFeat } from './features.js'
import { saveTwin } from './twin.js'
import { baselineJob } from './baseline.js'
import { corrJob } from './corr.js'
import { retentionJob } from './retention.js'
import { consistencyJob } from './consistency.js'
import { seedRules } from './memory.js'
import { extractZip, importKb } from './kb.js'
import * as strava from '../strava.js'

const syncRunning = () => !!app.prepare("SELECT 1 FROM sync_jobs WHERE status='running'").get() // by DB, so the CLI can check without importing jobs.js (which marks running jobs interrupted on load)
let busy = false
export const isBusy = () => busy
const ZIP = () => process.env.KB_ZIP || path.resolve('Running_project_export.zip')
const wib = () => new Date(Date.now() + 7 * 3600e3)

// kinds: 'quick' (after a sync: fit → log → features → twin) · 'full' (nightly: + strava, weather, kb, correlations)
export async function runIntel(kind = 'full', { trigger = 'manual', force = false } = {}) {
  if (busy) throw Object.assign(new Error('an intelligence job is already running'), { status: 409 })
  if (syncRunning() && !force) throw Object.assign(new Error('a COROS sync is running — try again after it finishes'), { status: 409 })
  busy = true
  const id = Number(idb.prepare('INSERT INTO intel_job (kind, status, started_at) VALUES (?,?,?)').run(kind, 'running', new Date().toISOString()).lastInsertRowid), stats = {}
  const step = async (name, fn) => { const t = Date.now(); try { stats[name] = await fn(); stats[name + '_ms'] = Date.now() - t } catch (e) { stats[name] = { error: String(e.message).slice(0, 200) } }; idb.prepare('UPDATE intel_job SET stats=? WHERE id=?').run(JSON.stringify(stats), id) }
  try {
    await step('rules', async () => seedRules())
    if (kind === 'full') {
      await step('strava', async () => (strava.status().connected ? strava.syncShoes() : { skipped: 'not connected' }))
      const zip = ZIP(); if (fs.existsSync(zip)) await step('kb', async () => importKb(extractZip(zip) + '/Running_project_export'))
    }
    await step('fit', () => fitJob(adb))
    if (kind === 'full') await step('weather', () => weatherJob())
    await step('log', () => ({ days: projectLog() }))
    await step('features', () => ({ days: buildDailyFeat() }))
    if (kind === 'full') await step('cards', () => ({ cards: buildCards() }))   // weather/shoes/pain are in the cards, so rebuild after they land
    await step('baseline', () => baselineJob(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)))   // monthly; a no-op once this month's row exists
    await step('twin', () => saveTwin(trigger))
    if (kind === 'full') await step('corr', () => corrJob())
    if (kind === 'full') await step('retention', () => retentionJob())
    if (kind === 'full') await step('consistency', () => consistencyJob())
    const failed = Object.entries(stats).filter(([, v]) => v && typeof v === 'object' && v.error).map(([k]) => k); if (failed.length) stats.failed_steps = failed
    idb.prepare("UPDATE intel_job SET status=?, finished_at=?, stats=? WHERE id=?").run(failed.length ? 'partial' : 'done', new Date().toISOString(), JSON.stringify(stats), id)
  } catch (e) { idb.prepare("UPDATE intel_job SET status='error', finished_at=?, error=?, stats=? WHERE id=?").run(new Date().toISOString(), String(e.message).slice(0, 300), JSON.stringify(stats), id); throw e }
  finally { busy = false }
  return { id, ...stats }
}
export const recentIntelJobs = (n = 6) => idb.prepare('SELECT id, kind, status, started_at, finished_at, stats, error FROM intel_job ORDER BY id DESC LIMIT ?').all(n).map((j) => ({ ...j, stats: JSON.parse(j.stats || '{}') }))
idb.prepare("UPDATE intel_job SET status='interrupted', finished_at=? WHERE status='running'").run(new Date().toISOString())

// ---- scheduler: nightly full run 01:30–05:00 WIB (never during the 07–09 morning sync), quick run after each COROS job, coach briefs
export function intelTick(now = new Date(), run = runIntel) {
  if (busy || syncRunning()) return null
  const w = new Date(now.getTime() + 7 * 3600e3), hm = w.getUTCHours() * 60 + w.getUTCMinutes()
  if (hm < 90 || hm > 300) return null
  if (idb.prepare("SELECT 1 FROM intel_job WHERE kind='full' AND status='done' AND started_at >= ?").get(new Date(now.getTime() - 20 * 3600e3).toISOString())) return null
  return run('full', { trigger: 'nightly' }).catch((e) => console.error('intel nightly', e.message))
}
export const afterSync = () => { if (!busy) runIntel('quick', { trigger: 'after-sync', force: true }).catch((e) => console.error('intel quick', e.message)) }
