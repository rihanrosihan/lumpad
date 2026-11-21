# Server settings added after the first v2 install

All of these go in `/opt/lumpad/.env` (or `.env.v2` where noted), never in the repository. Restart with `sudo systemctl restart lumpad` (and `lumpadd-serve` for `.env.v2`).

- `GOOGLE_MAPS_API_KEY`: server-side Google key (Map Tiles, Weather, Air Quality, Elevation). Create it with an IP restriction to this server and an API restriction to those four. `GOOGLE_DAILY_CAP` (default 4000) limits upstream calls per WIB day.
- `NEO4J_SYNC_HEALTH=1` (`.env.v2`): opt in to sending sleep, HRV, resting HR, pain and how-you-feel to the Neo4j cloud graph. Unset (default): the sync removes those properties and the pain links from the graph.
- `lumpadd serve` rejects POST/PUT/DELETE without the `X-Lumpad: 1` header and caps request bodies at 64 KB.
- Shadow compares every FIT session once per WIB day, not only the sessions Node reprocessed.
- Official race results live in `src/data/officialRaces.js`; override or add one without a deploy by saving an object of the same shape under the store key `lumpad.official`.

## Off-server backup (restic to Tencent COS)

One-time setup on the server: `sudo bash /opt/lumpad/deploy/backup/setup-offsite.sh` (asks for region, bucket and the COS SecretId/SecretKey; the keys go only into `/etc/lumpad-backup.env`, mode 600). It installs restic, creates the repository, generates the repository password in `/root/.lumpad-restic-password` (copy it into your password manager: without it the backups cannot be opened) and enables `lumpad-offsite-backup.timer` (03:30 WIB). Each night: local SQLite snapshots + FIT mirror + `pg_dump` + `.env` files, encrypted and deduplicated, 30 daily / 8 weekly / 6 monthly kept, 5 % of the stored data verified. Test a restore with `sudo bash /opt/lumpad/deploy/backup/restore-test.sh` (never touches live data). Create a COS sub-account key limited to that one bucket, not your main account key.

## Google Maps Platform (all of it goes through the server; the key never reaches the browser)

Enable these APIs in the Google project and add them to the key's API restrictions: Map Tiles, Weather, Air Quality, Maps Elevation, Geocoding, Time Zone, Roads, Places (New), Routes, Maps Static, Street View Static.
- Always on once `GOOGLE_MAPS_API_KEY` is set (only a 0.1° cell, ~11 km, leaves the server): place names (`/api/geo/place`), time zone (`/api/geo/timezone`), best run window (`/api/env/window`), air quality forecast and history (`/api/env/airforecast`, `/api/env/airhistory`), map tiles with `&t=satellite|terrain|roadmap` (`/api/map/tile`).
- Route data, OFF by default: set `GOOGLE_ROUTE_DATA=1` in `/opt/lumpad/.env` to allow elevation (`/api/geo/elevation?id=`), road snapping (`/api/geo/snap?id=`), places along a route (`/api/geo/places?id=&kind=water|toilets|medical`), the static route map (`/api/map/static?id=`), Street View (`/api/geo/streetview?lat=&lon=&heading=`) and travel time (`/api/geo/route`). These send real route points or exact places to Google.
- Every upstream call counts against `GOOGLE_DAILY_CAP` (default 4000 per WIB day); `/api/map/status` shows the count per API. Results from Google are display-only: they never feed the engine's numbers.
- After deploying, `curl -s http://127.0.0.1:8787/api/google/probe` shows the real response shape of each API; response parsers tolerate missing fields, so a different shape returns empty data instead of an error.

## Screens that use the Google gateway
- Activity detail: map style switch (Clean / Street / Google Roadmap, Satellite, Terrain via `/api/map/tile`), place name of the start (coarse, 0.1° cell), air quality at the run's hour (`/api/env/airhistory`). Without the key the Google styles are hidden and the air tile says "Not pulled".
- Activity detail → **Route intel** (needs `GOOGLE_ROUTE_DATA=1`): elevation profile, water / toilets / medical along the route, static route map to save as a share image. Nothing is sent until the button is pressed.
- Readiness → Conditions Now → **Long-run route planner** (`/api/geo/loop?km=&bearing=`): a walking circuit of about N km from the last GPS run, with elevation and water points, GPX download. Distance is an estimate.
- Race → Logistics → **Race-morning travel** (`/api/geo/route` with traffic, `/api/geo/timezone`): when to leave; Race → Course → **Course photos** (Street View at the start, COPs and km 40).

## Second AI provider (Anthropic) in the Node coach
Off until configured. In `/opt/lumpad/.env` (never in chat): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (an id you pick), `ANTHROPIC_PRICE_IN_USD_PER_MTOK`, `ANTHROPIC_PRICE_OUT_USD_PER_MTOK`, `USD_CNY` (all from you; with any of them missing the provider refuses to run). `ANTHROPIC_MONTHLY_CAP_CNY` (default 15) caps its own spend, computed from those prices.
Routing is opt-in per intent: `COACH_CLAUDE_INTENTS=race_plan,session_review` (set it only after the eval). An intent routed to Claude falls back to DeepSeek when the provider is unconfigured or over its cap. The daily brief stays on DeepSeek. The Go gateway needs the same rule at cutover.

## 4 GB RAM / 60 GB disk profile
`sudo bash deploy/v2/tune-4gb.sh` installs `postgresql-4gb.conf`, higher `MemoryMax` limits for every service, and a journald size limit (500 MB, 1 month). It refuses on a machine with under 3.5 GB RAM and does not restart Postgres unless given `--restart-postgres` (do that right after a morning shadow pass; shared_buffers needs the restart). `--check` shows what is installed.

## Official race results
Built-in results live in `src/data/officialRaces.js`. Edits made on the Activity → Official Result tab are saved in the synced store key `lumpad.official` and override the built-in record field by field ("Restore built-in" removes the edit).
