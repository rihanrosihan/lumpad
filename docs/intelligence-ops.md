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

## Blueprint mapping (Hybrid RAG + LTM + Digital Twin, Nov 2026)
The blueprint's design is implemented on Lumpad's own stack instead of Next.js/Prisma/PostgreSQL/pgvector/BigQuery: one Node process and SQLite on a
2 GB VPS, no new services, no cloud warehouse. Vector search is replaced by FTS5 BM25 + RRF + MMR over the memory text and a 16-D z-scored physiological
fingerprint (cosine kNN) over the FIT features — DeepSeek has no embedding API, and the fingerprint captures "runs like this" better than text for numbers.

| Blueprint | Where |
| :-- | :-- |
| Athlete baseline (LTHR 168, HRmax 189, RHR 47, TP 5:56 COROS 18 Nov 2026 — blueprint's 6:07 is older) | `src/lib/athlete.js` → zones, FIT metrics, twin, coach |
| `.fit` features: EF, Pa:HR drift, bio-fade (GCT, stride, VR, cadence), six-zone HR/pace time, % LTHR, pacing discipline | `server/intel/metrics.js` (parser v2) |
| Semantic episode card + 7-day lag context + semantic keywords (#z2_disciplined, #intensity_creep, #cardiac_drift_high, #gct_drift, #negative_split, #leg_day_72h, …) | `server/intel/card.js`, `pipeline.js` |
| Digital Twin: profile, load/readiness, 30 vs 90-day baselines (EF, HR@8:00, pace@HR150, cadence, GCT, stride, VR), intensity, strength transfer, shoes, fade curves | `server/intel/twin.js` |
| 3-tier LTM (episodic / semantic / procedural, locked rules) + write-back with citation and number checks; tags + confidence | `memory.js`, `writeback.js` |
| Correlation engine: lagged Spearman + partial + permutation + bootstrap + FDR; gym +24/+48/+72 h; aerobic speed and GCT outcomes | `server/intel/corr.js` |
| Matrices 1–4: gym→stride, (shoes in twin), threshold→aerobic speed, race fade predictors | `server/intel/matrices.js`, `GET /api/intel/matrices` |
| Query decomposition → SQL filters (dates, race, distance, type, HR, shoe, indoor) + topics; exact km splits attached | `server/intel/query.js`, `context.js`; preview `GET /api/coach/preview` |
| Runtime prompt: twin snapshot & anomaly check, correlations, historical mirroring, precise prescription; optional `twin_state_patch` (shown, never auto-applied); English or Bahasa Indonesia | `context.js` `renderPrompt`, Profile › AI Coach |

After deploying, the next nightly job (or Profile › “Run analysis now”) re-parses every FIT file at parser v2 and rebuilds cards, twin and edges.

## Phase 0 (redesign) — safety net before the rebuild
- **Retry ledger** (`jobledger.js`, table `coach_job`): a scheduled coach run is attempted at most twice per job and day, 30 min then 2 h apart; then it is left alone until the next day. Inspect: `sqlite3 memory.db "select * from coach_job order by updated_at desc limit 10"`.
- **Safety layer** (`safety.js`): red-flag symptoms in a question or severe pain in the last two check-ins → referral, no model call, cost 0, logged as `safety:referral`. When a validated gate is active, hard-session recommendations are removed from answers (`safety:answer-adjusted`). Diagnosis/clearance wording is flagged. New locked rule "Red-flag symptoms".
- **Eval suite** (`server/intel/eval/`, in `npm test`): 15 safety, 6 gate, 3 wording, 3 number-verifier scenarios + an end-to-end referral run. Prints `EVAL BASELINE {...}`. Add a scenario for every coaching mistake found.
- **Golden fixtures** (`tools/export_golden.mjs`): `DATA_DIR=server/data node tools/export_golden.mjs` writes every session's metrics, the twin, matrices and edges to `tools/golden/out/` (gitignored: health data). `GOLDEN_FIT_DIR=server/data/fit node --test src/lib/golden.test.js` re-parses the FIT files and must reproduce them; the Go engine is diffed against the same files (gate G2).
- **Contract test** (`src/lib/contract.test.js`): every `/api` path and write method used by the UI must exist on the server.
