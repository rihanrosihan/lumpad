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

1. **Second AI provider in the Node coach.** Anthropic Messages API behind the existing `complete()`; per-intent routing (race plan and session review to Claude, daily brief stays DeepSeek); JSON via instructions + parse; cost from env prices (`ANTHROPIC_PRICE_IN/OUT_USD_PER_MTOK`, `USD_CNY`) and refuse to run if unset so the monthly cap stays meaningful; eval before routing. Port the same rule to Go at cutover.
2. **Google screens.** The server endpoints exist and are tested (`server/google_geo.js`); most have no screen:
   - Long-run route planner (loop + water points + elevation): Routes, Elevation, Places.
   - Race-day travel card (when to leave): Routes with traffic, Time Zone for non-WIB races.
   - Share card with a static route map; Street View photos in the race guide.
   - Roadmap / Satellite / Terrain switch (`/api/map/tile?t=`); the v61 activity map still uses ArcGIS.
   - Place names on activity cards (`/api/geo/place`), air quality at the run's hour (`/api/env/airhistory`).
   - Not built: Isochrones API (response shape unknown), pollen (declined), JavaScript/Embed/3D/Places UI Kit (would load Google code and loosen the CSP).
3. **Server tuning for 4 GB RAM / 60 GB disk.** `postgresql-4gb.conf` (shared_buffers ~1 GB, effective_cache_size ~2 GB, maintenance_work_mem 256 MB), raise `MemoryMax` of `lumpadd-serve` and the oneshot services, journald size limit, log rotation. Needs a Postgres restart: do it right after a morning shadow pass.
4. **Readiness page:** split Load / PMC / ACWR and HRV / Autonomic into separate panels (they are built together today).
5. **Pending UI polish:** wrap or scroll rule for Coach chip rows if the sideways swipe is not wanted; official race results move from `src/data/officialRaces.js` to stored data with an edit screen.

## 5. Known issues and risks

- **Sub-4 report uses placeholders.** `buildSub4Report` in `lumpadd/cmd/lumpadd/main.go` hard-codes VDOT 31.7, run share 0.28, WBGT forecasts 27.5 / 26.5 and realization ratios 0.59 / 0.75 / 0.95. Replace with data before relying on that card.
- **Shadow blind spot (reduced).** Per-pass checks only cover what changed; the daily full sweep covers all FIT sessions. Twin and correlation checks still follow Node jobs.
- **Node and Go rule parity to port at cutover:** truncated-brief retry (2x budget), `softClamp` of over-long answer text.
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
