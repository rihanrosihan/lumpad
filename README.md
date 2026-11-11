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
