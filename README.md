# Lumpad
Sub-4 coach app. React + Vite frontend, small Node API (`server/`).

Dev: `npm i && npm run server` and `npm run dev`. Tests: `npm test`.

## Deploy (VPS, Ubuntu)
    ssh root@<server>
    git clone <private-repo-url> /opt/lumpad      # use a read-only deploy key or token
    bash /opt/lumpad/deploy/setup.sh 43-173-30-236.nip.io rihan
Update later: `bash /opt/lumpad/deploy/deploy.sh`
Secrets live only in `/opt/lumpad/.env` (never in git).

## Direct COROS connection (no Claude in the loop)
Lumpad talks to the official COROS MCP server itself (OAuth 2.0 + PKCE, dynamic client registration; verified against the
live discovery documents). Connect once in **Profil → Hubungkan COROS**; tokens are sealed (AES-256-GCM, key `LUMPAD_TOKEN_KEY`
in `.env`) and refreshed automatically. The server then pulls daily at ~07:50 WIB (`server/jobs.js`) and on demand
("Sync sekarang"); history is pulled in stages ("Tarik riwayat 2026"). Raw responses are archived (`raw_pulls`, gzip) so parsers
can be re-run without calling COROS again. Monitoring: `GET /api/ingest/status` (bearer token; counts/dates only).

## COROS archive (2025 → today, all tools)
A dedicated database `server/data/coros.db` holds the raw response of **every COROS read tool** (activities, detail, laps, custom
laps, FIT files → `server/data/fit/`, daily health, sleep, HRV, HR, stress + time series, wellness checks, recovery, fitness,
training load, workouts, user info, devices) from `COROS_ARCHIVE_FROM` (2025-01-01) to today. Work is a queue of single calls run
**newest date first**, in sessions (≤200 calls / 25 min, at most hourly, never 07–09 WIB) until the **daily budget** is used
(`COROS_BUDGET`, per tool + total). COROS publishes no quotas: a quota error stops that tool for the day and lowers its cap to what
went through; the cap grows back 10%/day when not hit. Recent days are re-pulled daily; history is pulled once. After each session the
app tables in `lumpad.db` are rebuilt from the archive (`server/coros/project.js`). Progress, budget and ETA: Profil → COROS, or
`GET /api/coros/archive`. Manual session: `POST /api/coros/archive/run`.
