# lumpadd — Lumpad v2 backend (Go, PostgreSQL)

Redesign Phase 1 (foundation). The current Node app keeps running and coaching; this is built beside it and takes over module by module (see the audit doc, section 23).

| Command | What it does |
| --- | --- |
| `lumpadd migrate` | Applies `internal/db/migrations/*.sql`. `*.optional.sql` run only if the extension (TimescaleDB, pgvector) is installed; otherwise they are recorded as skipped. |
| `lumpadd load <server/data>` | Copies lumpad.db, coros.db, intel.db, memory.db and kv.json into Postgres and verifies **every table**: row count and a SHA-256 over all rows must match. Repeatable (truncates first). Exit code 1 on any mismatch. |
| `lumpadd shadow <server/data>` | One shadow pass (Phase 3): mirror SQLite → Postgres (verified), replay new Node pull traces, recompute new/reprocessed FIT sessions, compare the twin and correlation edges of each new Node intel job. Results → `analytics.shadow_check`; exit 1 when anything differs. |
| `lumpadd g3` | Gate G3 report: the last 30 days and the streak of identical days (needs 14). |
| `lumpadd serve` | Health endpoint `GET /api/v2/health` on 127.0.0.1:8788 (db ping, version, RSS). Real API arrives phase by phase. |
| `fitbench <fit dir>` | Decode benchmark (muktihari/fit). |
| `GOLDEN_DATABASE_URL=… GOLDEN_DIR=../tools/golden/out go test ./internal/analytics` | Diffs matrices, the correlation engine and the twin against the golden fixtures (load the snapshot they came from first). |
| `golden <sessions.json> <fit dir>` | Diffs the Go engine against the golden fixtures from the Node engine (gate G2): every session metric and per-km row. |

`DATABASE_URL=postgres://user@host/db?sslmode=disable` is required.

## Build and test
```bash
cd lumpadd
CGO_ENABLED=0 go build -ldflags="-s -w" -o lumpadd ./cmd/lumpadd      # static, ~14 MB; the VPS needs no Go
CGO_ENABLED=0 go build -ldflags="-s -w" -o fitbench ./cmd/fitbench
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5544/scratch ./scripts/test.sh   # unit + integration (use an empty scratch database)
python3 tools/gen_schema.py /path/to/server/data                          # regenerate the mirror schema + loader table list from SQLite
```
Needs Go 1.26 to build (the SQLite reader requires it). Postgres 16 server binaries are enough for the tests; TimescaleDB and pgvector are optional.

## 2 GB VPS plan (decision 18 Nov 2026: no RAM upgrade)
Budget while both systems run: Node app ~125 MB · Postgres ≤ 450 MB (`deploy/v2/postgresql-2gb.conf`) · Go server ~15 MB idle · Caddy ~30 MB · OS and cache the rest. Limits per service are in `deploy/v2/systemd/`.

**Gate G1 on the real server** (nothing there is touched; the script uses a throwaway cluster in /tmp on port 5545):
1. Install PostgreSQL 16 (pgdg apt repo), then optionally `timescaledb-2-postgresql-16` and `postgresql-16-pgvector`. Do not start tuning the live cluster yet.
2. Build or copy the static `lumpadd` and `fitbench` binaries to `/opt/lumpad/lumpadd/`.
3. `sudo bash /opt/lumpad/deploy/v2/bench-memory.sh` — prints peak memory with the live app running and `RESULT: PASS` if the peak stays under 75 % of RAM.
**Result 19 Nov 2026 (VPS, live app running): PASS.** Peak used 787 MB of 1962 MB (40 %), lowest available 1174 MB, swap unchanged at 115 MB; all 31 tables verified identical, load 1.1 s; FIT decode 207 files / 627,517 records in 954 ms, peak RSS 42 MB. PostgreSQL 16.16 + pgvector 0.8.7 installed (default cluster disabled); TimescaleDB not installed, so `0004` is skipped and native partitioning is the plan.

4. If it fails: use native partitioning instead of TimescaleDB, lower `shared_buffers`, and rerun; if still failing, stop and decide before Phase 2.

## Phase 1 measurements (sandbox, same 169 FIT files, 528,827 records)
| | Node (current) | Go |
| --- | --- | --- |
| FIT decode, all files | 8,302 ms, peak RSS 149 MB | **633 ms, peak RSS 26 MB** (13×) |
| Server idle RSS | ~124 MB | **14 MB** |
| Loader, 31 tables / 5,900+ rows | — | 0.8–1.0 s, all checksums identical |

`tormoder/fit` was rejected: it fails on 95 of 169 COROS files (`parsing definition message`). The sandbox is a 16 GB machine, so memory results for the 2 GB server must come from step 3.

## Phase 2 progress (engine port)
| Module | Status | Check |
| --- | --- | --- |
| FIT → 1 Hz series, session metrics (classify, grade, per-km, steady blocks, drift, fades, onset, six zones, pacing) | **done** | all 99 sessions: every metric and per-km row identical to Node (`golden`, `go test ./internal/engine`); 99 sessions decode + compute in 1.4 s (Node: ~9.3 s for the nightly FIT step) |
| Load (CTL/ATL/TSB, ACWR, monotony, ramp, projection) | **done** | JS vectors (`tools/gen_engine_vectors.mjs`), 10 series incl. empty / all-zero |
| HRV / RHR / sleep states, distance progression, composite readiness (pillars, phase weights, caps) | **done** | JS vectors: 60 random cases with gaps and nulls, every field identical; mutation check catches a 1-point score change in all 34 scored cases |
| VDOT and pace formatting | **done** | JS vectors |
| Race-pace simulator (heat penalty, run-walk, COP margins), zone ranges, per-lap zone seconds, workout duration + training-load estimate | **done** | JS vectors: 40 simulator inputs (incl. invalid), 3 zone configs × 8 zones, 90 laps, 12 step lists with repeats; UI text helpers (describe/summary) stay in the client |
| Matrices (gym→stride, gym lag, Z2 discipline, modalities, threshold blocks, race fade) | **done** | golden `matrices.json`: identical (80 sessions) |
| Statistics (mulberry32 RNG, ranks, OLS, partial Spearman, shift-permutation p, block bootstrap, BH) and the correlation engine (lag SQL, dataset with EF residual, edges) | **done** | JS vectors (287 synthetic tests incl. seeded bootstrap CIs) and golden `corr.json` on real data: dataset of 97 sessions and all 136 edges identical; 0.45 s |
| Twin builder (load + readiness, profile, baselines, intensity, strength transfer, aerobic, durability, heat bootstrap, shoe bootstraps, fade curves, races, injury, plan + kill gate, Monte Carlo projection, data gaps) | **done** | golden `twin_build.json` (fresh Node build of the snapshot for its date): every field identical, incl. the seeded bootstraps and 12,000 Monte Carlo draws; 60 ms vs Node 73 ms |

**Gate G2: PASS (19 Nov 2026).** Every engine module reproduces the Node output on the golden snapshot or on JS-generated vectors.

Fixes that came out of the port (all applied to the Node app too): the twin's kill gate read `.triggered`/`.warn` but `killGate()` returns `{ fired }`, so it always showed 'ok' (now 'triggered' when it fires; unit-tested in Go); twin sessions are ordered by start time within a day. Two from the correlation port (both applied to the Node app too): same-date sessions are ordered by start time (SQLite left their order undefined, which changed split halves and permutation p), and lagged exposures are rounded to 1e-6 (SQLite's incremental window SUM left float noise such as 10.000000000000002 that split genuine rank ties).

Notes from the port: JS `Math.round` rounds halves up (Go's rounds away from zero) so `jsRound` is used; `mean()` over `null` counts null as 0 in `fadeOnset` (kept, because the golden data depends on it); the Node parser reports `speed`, not `enhanced_speed` (they differ by 1 mm/s on some seconds); COROS 'Effort Pace' is a developer field found through `field_description`.

## Phase 3 — ingestion in shadow (gate G3)
Node stays the only writer until G3 passes; the Go side proves, from the same inputs, that it writes the same rows. No extra COROS calls, no
second OAuth client (a parallel client could clash with refresh-token rotation).

| Piece | Status | Check |
| --- | --- | --- |
| COROS response parsers (11 tools) | **done** | all 1,115 archived responses parse identically |
| Ingest validation (`ingestOps`: whitelist, ranges, null rules, reject paths) | **done** | full archive projection + synthetic payloads for every reject / drop path |
| Archive projection (`buildProjection`) | **done** | 309 health days, 8 fitness, 456 activities, 2,698 laps identical |
| Daily pull (`pullRange`) | **done** | Node records a trace per run (`pull_trace`: calls + responses, the DB facts it branched on, kv writes, payloads); Go replays it — 9 scripted scenarios identical, mutations caught |
| Shadow runner + timer + G3 report | **done** | local: 99 FIT sessions identical, 9 traces identical, twin correctly marked stale after a later check-in |
| Server setup | **next** | `sudo bash deploy/v2/setup-v2.sh` (one time), then 14 days of `lumpadd g3` |
| Cutover (Go becomes the COROS writer) | after G3 | needs an off-server backup destination first |

Server: `sudo bash /opt/lumpad/deploy/v2/setup-v2.sh` once (real Postgres cluster with the 2 GB config and limits, role/db `lumpad` over the
local socket, build, migrate, shadow timer every 15 min). After that every auto-deploy rebuilds and migrates (`/etc/lumpad-v2.enabled`); a v2
failure never fails the Node deploy. Postgres is a verified mirror during Phase 3 — it can be rebuilt from SQLite at any time.
