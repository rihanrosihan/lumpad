# Intelligence layer — operations

**Where things live** (all under `server/data/`, owner `lumpad`, mode 600): `intel.db` (derived, rebuildable: FIT metrics, weather, twin versions, edges, kb_docs, daily_feat),
`memory.db` (NOT rebuildable: memories, coach runs, audit, balance snapshots), `kb/` (extracted KB zip). Backups: `deploy/backup.sh` snapshots both with `VACUUM INTO` (`*.snapshot.db`).

**Schedule** (`server/intel/schedule.js`, every 5 min): nightly full job 01:30–05:00 WIB (strava shoes → KB import → FIT → weather → check-in log → features → cards → twin → correlations);
quick job after every COROS job; coach: daily brief ≥ 08:00 WIB once the daily sync is done, session review for a new run ≥ 16 km, weekly review Sunday ≥ 19:00 WIB. `COACH_SCHEDULE=off` disables scheduled coach calls.

**Coach (DeepSeek)**: model = newest "Flash" from `/models` (`DEEPSEEK_MODEL=auto-flash`, or pin an id). Cap `DEEPSEEK_MONTHLY_CAP_CNY=15` measured from balance drops; ≥ 80 % → only daily brief + questions, 100 % → paused.
Answers are schema-checked (one repair retry); memory writes are citation- and number-checked and stored as candidates. Per-call cost shows ¥0 for small calls because DeepSeek reports the balance to 2 decimals; the monthly total is exact.

**Claude Code access** (as root it drops to the data owner automatically): `npm run coach:context -- --intent weekly_review [--question "…"] [--activity coros:123]` → prints a run id and a file with `system`, `user`, `output_schema`;
answer as JSON, then `npm run coach:writeback -- --run <id> --file answer.json`. `npm run intel -- full|quick` runs the job chain. Pull endpoints for a routine: `GET /api/coach/context`, `POST /api/coach/writeback` (bearer `INGEST_TOKEN`).

**Privacy**: only the coach payload (redacted: no name/employer/email/URL/secret) goes to DeepSeek; Open-Meteo gets coordinates rounded to 0.1° + a date; embeddings/analytics are local.
Strava-sourced data sent to the model is limited to shoe name and mileage.

**Tests**: `npm test` (93). Golden FIT tests read real files if present under `server/data/fit`.
