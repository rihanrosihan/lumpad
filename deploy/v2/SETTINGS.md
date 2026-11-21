# Server settings added after the first v2 install

All of these go in `/opt/lumpad/.env` (or `.env.v2` where noted), never in the repository. Restart with `sudo systemctl restart lumpad` (and `lumpadd-serve` for `.env.v2`).

- `GOOGLE_MAPS_API_KEY`: server-side Google key (Map Tiles, Weather, Air Quality, Elevation). Create it with an IP restriction to this server and an API restriction to those four. `GOOGLE_DAILY_CAP` (default 4000) limits upstream calls per WIB day.
- `NEO4J_SYNC_HEALTH=1` (`.env.v2`): opt in to sending sleep, HRV, resting HR, pain and how-you-feel to the Neo4j cloud graph. Unset (default): the sync removes those properties and the pain links from the graph.
- `lumpadd serve` rejects POST/PUT/DELETE without the `X-Lumpad: 1` header and caps request bodies at 64 KB.
- Shadow compares every FIT session once per WIB day, not only the sessions Node reprocessed.
- Official race results live in `src/data/officialRaces.js`; override or add one without a deploy by saving an object of the same shape under the store key `lumpad.official`.

## Off-server backup (restic to Tencent COS)

One-time setup on the server: `sudo bash /opt/lumpad/deploy/backup/setup-offsite.sh` (asks for region, bucket and the COS SecretId/SecretKey; the keys go only into `/etc/lumpad-backup.env`, mode 600). It installs restic, creates the repository, generates the repository password in `/root/.lumpad-restic-password` (copy it into your password manager: without it the backups cannot be opened) and enables `lumpad-offsite-backup.timer` (03:30 WIB). Each night: local SQLite snapshots + FIT mirror + `pg_dump` + `.env` files, encrypted and deduplicated, 30 daily / 8 weekly / 6 monthly kept, 5 % of the stored data verified. Test a restore with `sudo bash /opt/lumpad/deploy/backup/restore-test.sh` (never touches live data). Create a COS sub-account key limited to that one bucket, not your main account key.
