# Lumpad: remaining work

Status as of 21 Nov 2026 (server on `c31503a`, all services active). Written so it can be picked up without the chat history.

## 1. Where things stand

| Area | State |
|---|---|
| Redesign phases 0–2 (fixtures, Go foundation, engine port) | Done. G1 and G2 passed. |
| Phase 3 ingestion in shadow | Running. **G3: 1 of 14 clean days** (21 Nov clean). Earliest pass about **4 Dec 2026**. |
| Phase 4 AI layer, Phase 5 decision engine | Code written and unit-tested. Gates not started (G4 needs a second AI provider). |
| Phase 6 UI cutover | Not started. UI is still on the Node API. |
| Freezes | 30 May – 20 Jun 2027 and 3 – 24 Oct 2027: no cutovers. Old app retires 17 Aug 2027. |
| Web app | 5-item mobile bottom bar, desktop side menu with sections, Season Hub, Fitness panel, activity feed and detail (v61), PWA, Google maps/weather/air quality. |
| Web login | Switchable with `deploy/login.sh on|off` (it was asked to be off; check `login.sh status`). |

## 2. G3 rules (the next 13 days)

G3 needs 14 consecutive days where every shadow check is identical **and** at least one COROS pull is replayed. A day with any difference, no shadow run, or no pull resets the streak.

- Daily check, after the morning COROS sync:
  `cd /opt/lumpad/lumpadd && sudo -u lumpad bash -c 'set -a; . /opt/lumpad/.env.v2; set +a; ./lumpadd g3 | tail -4'`
- **Do not change engine calculations** (metrics, FIT parsing, zones, load, readiness, VDOT) in Node or Go during the window. UI-only, deploy-script and Google display changes are safe. If a calculation bug must be fixed, expect the count to restart.
- The shadow now compares every FIT session once per WIB day (full sweep), not only changed ones.
- If a day fails: `psql` the `analytics.shadow_check` table for `diff`/`error` rows; `tools/fitdump.mjs` and `lumpadd/cmd/fitdump` print per-block decisions for one FIT file in both engines.

## 3. Needs you (not code)

| # | Item | Why / how |
|---|---|---|
| 1 | **Rotate exposed secrets** | DeepSeek key, Strava client secret + refresh token, `INGEST_TOKEN` were pasted in chat. Rotate; change `INGEST_TOKEN` on both sides (server `.env` and the sync client). Do not rotate `LUMPAD_TOKEN_KEY` without checking what it seals (COROS tokens). |
| 2 | **Off-server backup** | Create a Tencent COS bucket and a sub-account key limited to it, then `sudo bash /opt/lumpad/deploy/backup/setup-offsite.sh`. Save the restic password in a password manager. Then `restore-test.sh`. See `deploy/v2/SETTINGS.md`. |
| 3 | **Second AI provider** | Claude via the Anthropic API: create a key at console.anthropic.com, put it in `/opt/lumpad/.env.v2` yourself (never in chat). Prices must come from you (env), not guessed. Not implemented in the Node coach yet (see section 4). |
| 4 | **Google Cloud** | Enable and allow on the key: Map Tiles, Weather, Air Quality, Elevation, Geocoding, Time Zone, Roads, Places (New), Routes, Maps Static, Street View Static. Decide on `GOOGLE_ROUTE_DATA=1` (sends route points to Google). |
| 5 | **Decisions** | `Coach.StrictNumbers` at cutover (recommended yes); Neo4j health sync stays off unless `NEO4J_SYNC_HEALTH=1`; placeholder numbers in the Sub-4 card (section 5). |
| 6 | **COS and key hygiene** | Google key: IP restriction to the server + the API list above. Old browser-restricted key was deleted? Confirm. |

## 4. Needs code (safe during G3)

Updated 23 Nov 2026 after checking the tree against the commits. Done since the 21 Nov version of this list:

- Second AI provider in the Node coach: `server/intel/anthropic.js`, per-intent routing (opt-in), env-priced cost, own monthly cap (`e5541a0`). Still needs your key and prices in `.env.v2`, and an eval before routing is switched on.
- Readiness split into four panels, activity map styles, place and air quality at the run's hour, route planner, editable official results (`9b10974`).
- Plan engine P0 to P5 (dormant / opt-in, see `docs/` evidence and decisions DEC-8..10): plan.db and guardrail kernel, single plan read path (`PLAN_SOURCE`), zone resolution, micro-patch operators, daily menu, macro generator, AI selector, outcome evaluation, shadow report. Off by default; `PLAN_ALLOW_ANON` lets plan writes work without a login.

Still open:

1. **Google screens not found in `src`:** share card with a static route map (no `maps/static` use), race-day travel card with traffic Routes (check `RaceGoogle.jsx`, which has Street View and Time Zone), pollen declined, Isochrones not built, JS / Embed / 3D / Places UI Kit would loosen the CSP.
2. **Server tuning for 4 GB RAM / 60 GB disk.** `postgresql-4gb.conf` (shared_buffers ~1 GB, effective_cache_size ~2 GB, maintenance_work_mem 256 MB), raise `MemoryMax` of `lumpadd-serve` and the oneshot services, journald size limit, log rotation. Needs a Postgres restart: do it right after a morning shadow pass.
3. **Coach chip rows:** wrap or scroll rule if the sideways swipe is not wanted.
4. **Go parity ports** listed in section 5 (needs a Go toolchain; none in the dev container).

## 5. Known issues and risks

- **Sub-4 report uses placeholders.** `buildSub4Report` in `lumpadd/cmd/lumpadd/main.go` hard-codes VDOT 31.7, run share 0.28, WBGT forecasts 27.5 / 26.5 and realization ratios 0.59 / 0.75 / 0.95. Replace with data before relying on that card.
- **Shadow blind spot (reduced).** Per-pass checks only cover what changed; the daily full sweep covers all FIT sessions. Twin and correlation checks still follow Node jobs.
- **Node and Go rule parity to port at cutover:** truncated-brief retry (2x budget), `softClamp` of over-long answer text.
- **Correlations view parity to port at cutover:** `corrJob` now also keeps the 30 strongest tests that fail the gate in `corr_explore` (intel.db migration 3; exploratory only, never given to the coach), `correlationGraph` / `OUTCOME_DOMAIN` in `server/intel/corr.js` build the view (served by `GET /api/graph/live?view=correlations`, no Neo4j needed), and `sessionDataset` leaves out sessions the athlete marked `counts_for_fitness=0`. Test safety: in a `node --test` process `server/intel/db.js`, `server/store.js`, `server/db.js` and `server/garmin/db.js` fall back to in-memory or throwaway storage when no database / `DATA_DIR` is set, so a test can never open the real data.
- **Live graph anchoring parity to port at cutover:** `anchorGraph` / `raceDomain` / `ANCHORED_VIEWS` in `server/neo4j.js` (derived INFORMS links tie races, personal bests and sessions to the PERFORMANCE hub; the Performance, All races and Races/rules/shoes views return `hub` and `unlinked`) and `radialLayout` in `src/lib/graphlayout.js`. The stored graph itself still links a race to performance only through a VDOT point; adding real `INFORMS` edges in the Go projection (`lumpad graph-sync`) would remove the need for derived links.
- **Athlete context parity to port at cutover:** `session_context` (memory.db migration 5), `server/intel/sessionctx.js`, the `athlete_context` recall block (first key, never shed), exclusion of `counts_for_fitness=0` dates from `durability()` / `fadeCurves()` in the twin, and the dual official/watch PB in `rankBlock`. `server/intel/anomalies.js` (per-km slow / fast / walk / pause / heart-rate-spike detector; `GET /api/session-anomalies`), `sessionBackground` (`GET /api/session-background`: weather, body, pain / injury history, shoe, plan, earlier notes for a day) and the km columns of `session_context` (memory.db migration 6) need the same port. The `tell` tab (`src/TellCoach.jsx`) writes through `/api/session-context` and `/api/athlete-fact`; the Go server needs the same routes.
- **Retrieval parity to port at cutover:** `server/intel/recall.js` (bilingual synonym expansion, local TF-IDF cosine ranker, journal / daily / plan / earlier-answer recall block) and the pinned-rules change in `server/intel/context.js` (only locked rules are pinned; unlocked rules are retrieved; `COACH_PIN_ALL_RULES=1` restores the old behaviour). `lumpadd/internal/coach/retrieve.go` still pins every active procedural rule and has no recall block; `Volatile` needs a `recall` field and `RenderPrompt` the same key order.
- **Activity v61 loads ArcGIS tiles** and widened the CSP for it, which contradicts the earlier "no outside tiles" policy; the Google tile proxy exists as the alternative.
- **Two PWA implementations overlapped** (`58d6a13` mine, `c31503a` yours). It deployed and runs; test install on a phone and tell me if it misbehaves.
- **Open login:** if the login is off, anyone with the address can read health data and trigger paid calls. Caps: DeepSeek `¥15`/month, Google `GOOGLE_DAILY_CAP` 4000/day; `/api/ingest` still needs its token. `deploy/login.sh on` restores it.
- **Deploy safety:** `deploy.sh` now pulls `origin main` explicitly. Do not run a manual deploy while auto-deploy may be running; auto-deploy deploys within 5 minutes. A failed rollback was caused by a bare `git pull --ff-only`.
- **Local data caveat:** the container used for development has no real data snapshot; UI checks use mock data. Check new screens on the real server.

## 6. Redesign roadmap still ahead

| Phase | What | Gate |
|---|---|---|
| 3 | Ingestion shadow (running) | G3: 14 clean days with a replayed pull |
| 4 | AI layer on Go: memory domains, retrieval on Postgres, gateway with routing, safety, verifier, ledger | G4: eval >= current, 100 % safety scenarios, >= 95 % successful calls over 14 days in shadow |
| 5 | Decision engine: adherence, decision ledger, re-plan proposals, race-readiness ranges | G5: property tests + 2 weeks of reviewed shadow proposals |
| 6 | UI cutover page by page, old server read-only | G6: UI regression crawl, accessibility and font audits, 30 days read-only |

Branch `phase4e-local` on GitHub holds an exact FTS5/BM25 reproduction and retrieval vectors that were not merged (the remote has its own `retrieve.go`); compare before Phase 4 work.

## 7. Command cheat sheet (server)

```bash
# deploy: just wait for auto-deploy (<= 5 min); manual, only when it is not running:
cd /opt/lumpad && sudo git fetch origin main && sudo git merge --ff-only origin/main && sudo bash deploy/deploy.sh
journalctl -u lumpad-autodeploy -n 6 --no-pager

# health
systemctl is-active lumpad lumpadd-serve lumpad-autodeploy.timer; curl -s http://127.0.0.1:8787/api/health

# G3
cd /opt/lumpad/lumpadd && sudo -u lumpad bash -c 'set -a; . /opt/lumpad/.env.v2; set +a; ./lumpadd g3 | tail -4'

# Google
curl -s http://127.0.0.1:8787/api/map/status
curl -s http://127.0.0.1:8787/api/google/probe | head -c 8000

# login on/off/status; backup
sudo bash /opt/lumpad/deploy/login.sh status
sudo systemctl start lumpad-offsite-backup.service; journalctl -u lumpad-offsite-backup -n 30 --no-pager
```

Settings reference: `deploy/v2/SETTINGS.md`. Never paste `.env` contents or API keys in chat or commit them.
