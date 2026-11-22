# Garmin archive ingestion blueprint

Status: **PLAN ONLY. Nothing has been imported or changed.** Discovery was read-only: the archive was unpacked into a scratchpad directory outside the repo, and the live SQLite files were opened with `mode=ro`.
Source: `/opt/lumpad/garmin_backup.zip` (46.6 MB zipped, 80.2 MB unpacked, 169 entries; 8,726 FIT files inside nested zips).

---------------------------------------------------------------------------

## 1. What is in the archive

### 1.1 Top level

| Area | Content | Verdict |
|---|---|---|
| `DI_CONNECT/` | All fitness and wellness data | **Ingest** (sections 1.2–1.5) |
| `IT_GLOBAL_EVENT/events.json` (1.5 MB) | Account and app event log | Vault only (raw); not mined |
| `customer_data`, `AVC_*`, `IT_CONSENT_HISTORY`, `INREACH/billing*`, `SUBSCRIPTIONS`, `IT_*`, `FLY_GARMIN/*` (35 CSVs plus `logbookBackup.json`) | Account, billing, consent and aviation data. Mostly empty files of 30–250 bytes. | **Exclude**: PII and not athletic. Never extracted or parsed. They stay in the original zip only. |
| `DI_GOLF`, `DI_GARMIN_TRAILS`, `DI_LIVETRACK`, `DI_CONNECT_IQ`, ~20 empty domain directories | Golf club list, 90-byte stubs | Raw vault only |

### 1.2 Activities (`DI-Connect-Fitness`)

* `summarizedActivities.json` in 2 files (21 MB, 300 rows; 1.7 MB, 97 rows) → **397 rows, 329 unique `activityId`**. The overlap is not 0, because the export is chunked by upload count. Dedup is required on `activityId` even within the archive.
* Span **2024-09-10 → 2026-01-10**. 71 in 2024, 247 in 2025, 11 in 2026. Single device (`3440807796`), manufacturer GARMIN.
* Types: running 138, walking 58, strength_training 43, treadmill_running 32, indoor_cycling 17, paddelball 10, indoor_cardio 7, pilates 4, soccer 4, trail_running 4, hiking 4, cycling 2, and 6 singletons.
* 124 distinct fields. The valuable ones are:
  * `activityTrainingLoad`, aerobic/anaerobic TE and labels.
  * `hrTimeInZone_0..6` and `powerTimeInZone_0..5`.
  * `vO2MaxValue`, `differenceBodyBattery`, `workoutFeel`, `workoutRpe`.
  * Running dynamics: GCT, vertical oscillation and ratio, stride length, normalised power.
  * Per-activity `splits` and `splitSummaries`, `summarizedExerciseSets` (strength), `avgSwolf`, stress start/end, and location.
* **Unit quirks (must be normalised in the parser; verify against FIT in Phase 0):**
  * `duration`, `elapsedDuration` and `movingDuration` are in **ms**.
  * `distance` and `elevationGain` are in **cm**.
  * `avgSpeed` and `maxSpeed` are in dm per ms, which is m/s ÷ 10.
  * Timestamps are in epoch ms, stored as floats.
  * Example: row 21507286173 reads `distance 1026898` = 10.27 km, `duration 5580397` = 93 min.
* Companions: `gear.json` (shoes with `dateBegin` and max metres), `personalRecord.json`, `workout.json` (141 KB workout library), `trainingPlan.json`, `weekly_training_report.json` (UI config only), and `ActivityPrivacyUpdateRequests`.

### 1.3 Full-resolution FIT (`DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip`)

* 44 MB zipped, **8,724 `.fit` files plus 3 CSVs and 1 GPX**, 99 MB unpacked, median 1 KB, max 2 MB.
* File type from the `file_id` message:

| FIT type | Count | Meaning |
|---|---|---|
| 4 | **329** | activity. Matches the 329 unique summarised activities exactly, so every Garmin activity has a full record stream. |
| 32 | 4,040 | monitoring_b (all-day wellness) |
| 44 | 2,680 | metrics |
| 49 | 473 | sleep |
| 41, 68, 79 | 536 / 447 / 219 | not identified. Phase 0 must decode them before deciding whether to stage or discard. |

* 2,535 of these files are under 500 bytes. Almost all of that is wellness noise with no stand-alone value.
* The 3 CSVs are Garmin split exports of a user-named long run. Their Garmin 1-km split data duplicates `splits` in the summary.
* Other zips: `device-backups-files_Part1.zip` (1 `.bak`, 74 KB), `LhaBackup_Part1.zip` (lactate-threshold-HR FIT, 8 KB), `PrimaryTrainingBackup_Part1.zip` (training-status FIT, 26 KB).
* The existing parser `server/intel/fit.js` (`fit-file-parser`, `PARSER_VERSION 4`, "speed falls back to enhanced_speed (Garmin)") already handles Garmin activity FITs.

### 1.4 Daily wellness (`DI-Connect-Aggregator`, `DI-Connect-Wellness`)

| Dataset | Rows / days | Span | Key fields |
|---|---|---|---|
| `UDSFile_*` (6 files) | 516 days | 2024-09-01 → 2026-02-01 | steps, kcal (active, BMR), intensity minutes, RHR, min/max HR, `allDayStress`, `bodyBattery`, `respiration`, floors, altitude |
| `*_sleepData.json` (5 files) | 417 nights (about 42 per file are `{"retro":false}` stubs) | 2024-09-03 → 2026-01-25 | stage seconds, `sleepScores` (overall, quality, duration, recovery, deep, REM, restfulness…), SpO2 summary, respiration, `avgSleepStress`, awake count |
| `TrainingReadinessDTO_*` (6) | 515 days | 2024-09-03 → 2026-02-01 | score, level, feedback, sleep / recovery / HRV / stress / acute-load factors |
| `healthStatusData_*` (2) | 17 + more | 2025-06-28 → 2026-01-14 | HRV, HR, SpO2, respiration, skin temperature with baselines and status |
| `HydrationLogFile_*` (5) | small | 2024-08 → 2026-01 | intake, plus **estimated sweat loss per activity** |
| `BloodPressureFile_*` (3) | about 30 | 2024-2026 | systolic, diastolic, pulse |
| `AbnormalHrEvents_*` (3), `fitnessAgeData` (393), `userBioMetrics` (273), `heartRateZones`, `powerZones`, `LifestyleLogging`, `wellnessActivities` | various | | fitness age (VO2max, BMI, body fat), weight and height timeline, zone definitions |

### 1.5 Performance metrics (`DI-Connect-Metrics`, 29 files in 6 date windows)

`MetricsAcuteTrainingLoad` (daily acute, chronic and ACWR), `TrainingHistory` (training status, fitness trend), `RunRacePredictions` (5K / 10K / HM / M, daily), `MaxMetData` (VO2max, sparse), `TrainingReadinessDTO` (above). Coverage 2024-09 → 2026-04-24. These are **vendor-computed Garmin metrics**. Garmin VO2max, load and "training status" are **not** on the same scale as COROS, and must never be blended with COROS values.

Also: `DI-Connect-Routing/courses` (5.6 MB of saved courses) and `pacebands`, `DI-Connect-User` (profile, goals, settings, avatars), `DI-ATP/Garmin_Coach_Pause_History`.

### 1.6 Coverage relative to what Lumpad already holds

```
Garmin activities     2024-09-10 ───────────────────────────── 2026-01-10
COROS activities (app)               2025-01-01 ─────────────────────────────────────── today
Garmin health         2024-09-01 ───────────────────────────── 2026-02-01
COROS health (app)                                      2026-01-14 ───────────────────── today
Strava                                                                    2026-10-25 → 11-10
```

* **Not dual-wear: imported copies (user clarification, 2026-11-22).** The user bought the COROS watch in January 2026 and imported their earlier Garmin history into COROS. So **Garmin is the original, primary source for everything before 2026**; the COROS rows dated 2025 are *copies* of Garmin workouts, with COROS-recomputed metrics (training load, TE and so on), not device-native recordings. 258 Garmin activities fall in the COROS window, and 195 (76 %) match a COROS row within ±5 min. **63 are Garmin-only** (padel, walks, pilates and so on, which were not imported). A naïve import would still double-count about 195 sessions in load and mileage.
* **Where COROS becomes native:** COROS health data starts 2026-01-14, and COROS fit_files exist for 2026-01 onward. COROS activities on 2026-01-02 to 01-11 are probably from the first days of ownership or still imports. The exact purchase day is not in the data, so the 2026-01-01 cutoff is a working value to confirm (section 9).
* **Health gap.** Lumpad's `health_daily` starts 2026-01-14, and `fitness_daily` has only 12 rows. Garmin supplies **about 16 months of sleep, HRV-adjacent, stress, RHR and readiness** (2024-09 → 2026-01) that Lumpad has nothing for. That is the largest new information in the archive.
* **Pre-COROS period.** The Sep–Dec 2024 activities (71 sessions) exist **only** in Garmin.

---------------------------------------------------------------------------

## 2. Current Lumpad ecosystem (read-only findings)

| Store | Notes |
|---|---|
| `lumpad.db` | `activities` (id = `source:source_id`, 468 rows: 459 coros + 9 strava), `laps`, `health_daily` (**PK = date, one row per day, `source` default `'coros'`**), `fitness_daily`, `gear`, `raw_pulls` (gzip archive of raw responses). |
| `coros.db` | Raw COROS archive (`responses`, `tasks` queue, `fit_files`, `usage`). Pattern to copy: queue of single idempotent tasks, with a sha256 per response. |
| `intel.db` | `fit_session` (PK `label_id`, per-session derived metrics, idempotent on `parser_version`), `daily_feat` (691 days), `run_weather`, `athlete_baseline` (1 row, "valid_from/valid_to" model), `twin_state` (43 versions, JSON `twin/1`), `corr_edge`, `kb_docs`, `intel_job`. |
| `memory.db` | `memory` (870 rows: tier ∈ episodic/semantic/procedural; status/valid_from/valid_to/supersedes/locked; `hash UNIQUE`), FTS5, **`memory_vec` has 0 rows**. This means that today retrieval is FTS-only. `coach_run`, `coach_job` (retry ledger), `memory_audit`, `coach_advice`. |
| Neo4j AuraDB | Nodes include Session, Day, Shoe, Race, Rule, PainSite, Weather band… Edges include HAS_SESSION, WORE, IN_WEATHER, NEXT_DAY, SIMILAR_TO, SUPERSEDES… Written by the **Go engine** (`lumpadd/`), and read from Node via fixed queries only. Credentials live in `.env.v2` and a root-level text file (gitignored). |
| Digital Twin | `server/intel/twin.js`: profile, 30- vs 90-day baselines (EF, HR@8:00, pace@HR150…), load and readiness. Current anchors: LTHR 168, HRmax 189. |
| Schedule | Nightly job 01:30–05:00 WIB; the coros archive runs in sessions with budgets and never in 07–09 WIB; coach LLM calls (DeepSeek, cost-tracked in CNY) are rate-limited by a retry ledger (2 attempts/day). |
| Host | 2 vCPU, 1.9 GB RAM (about 1.1 GB available while the app runs), 26 GB free disk, single Node process plus Go engine. |

### 2.1 Hazards in the current design that this import must respect

1. `health_daily` is **one row per date**. Writing Garmin rows into it for dates already owned by COROS would overwrite, or be overwritten by, the nightly COROS projection (`server/coros/project.js` upserts and rebuilds). → Garmin health must live in its own table (section 3), and merged on read.
2. `activities` have no cross-source link. The coach, `daily_feat`, load and mileage sum rows blindly. → Add a `canonical_id` link plus a visibility flag (section 4).
3. `fit_session.activity_id` is resolved as `'coros:' + label_id` in `pipeline.js`. Garmin FITs need a source-aware lookup.
4. `memory.hash UNIQUE` is a natural idempotency key, but coach runs read memory **by recency and similarity**. Dumping about 400 historical memories would flood retrieval and skew "similar sessions" toward 2024-25 data.
5. Twin baselines are windowed (30/90 days), so old data does not leak into the *current* twin. But `athlete_baseline` (single open row), `corr_edge`, "historical mirroring" (cosine similarity across all sessions) and any all-time aggregates **do** see everything.
6. `garmin_backup.zip` is **untracked and not gitignored** (`git status` shows it). One careless `git add -A` would commit 46 MB of health and account data.

---------------------------------------------------------------------------

## 3. Target architecture

Principle: **immutable raw → typed staging → canonical-linked projection → derived layers.** Each stage is re-runnable from the previous one with no network calls.

```
garmin_backup.zip (read only, never extracted wholesale)
   │  Stage 0  inventory + sha256 manifest
   ▼
garmin.db  (NEW, server/data/garmin.db, mode 600)       ← raw vault + staging
   │  Stage 1  typed staging (per-dataset tables)
   │  Stage 2  link & dedup  (activity_link, day_link)
   ▼
lumpad.db  (additive columns only)        intel.db / memory.db / Neo4j (tagged, isolated)
   │  Stage 3  projection: activities / laps / health_garmin
   │  Stage 4  FIT → fit_session (era = 'garmin_hist')
   │  Stage 5  baselines → daily_feat → cards → memory → graph → twin (historical branch)
```

### 3.1 New database `server/data/garmin.db` (separate file, consistent with the `coros.db` pattern)

Rationale: keeps raw bytes out of `lumpad.db`, so lumpad's snapshot/backup size and hot WAL are unaffected; can be dropped or rebuilt independently; its own `PRAGMA journal_mode=WAL`, with mode 600 like its siblings.

```sql
-- provenance of every byte that enters the system
CREATE TABLE import_manifest (
  entry TEXT PRIMARY KEY,              -- path inside zip (nested: 'zip!inner/path')
  bytes INTEGER, sha256 TEXT, kind TEXT,       -- activity_fit | wellness_fit | json_dataset | csv | gpx | excluded
  decision TEXT,                       -- ingest | vault | exclude
  archive_sha256 TEXT,                 -- of garmin_backup.zip (run identity)
  status TEXT DEFAULT 'pending', updated_at TEXT);

-- lossless raw vault: one row per source record (JSON element) or file, gzip
CREATE TABLE raw_record (
  dataset TEXT NOT NULL,               -- 'summarizedActivities', 'UDS', 'sleep', …
  rec_key TEXT NOT NULL,               -- natural key (activityId, calendarDate, uuid) else sha256(canonical json)
  day TEXT, body BLOB NOT NULL, sha256 TEXT NOT NULL, entry TEXT,
  PRIMARY KEY (dataset, rec_key));     -- duplicates across chunk files collapse here

CREATE TABLE raw_fit (                 -- ONLY the 329 activity FITs + 3 backup FITs are written to disk
  fit_id TEXT PRIMARY KEY, activity_id INTEGER, path TEXT, bytes INTEGER, sha256 TEXT, fit_type INTEGER);
```

* Typed staging tables, parsed **from `raw_record`** (so the parser can be fixed and re-run without re-reading the zip):
  `g_activity` (all 124 fields normalised to SI + original unit noted; `splits`/`sets`/zone JSON kept as columns), `g_sleep`, `g_uds_day`, `g_readiness`, `g_acwr`, `g_training_status`, `g_race_pred`, `g_maxmet`, `g_health_status`, `g_hydration`, `g_bp`, `g_bio` (weight/height/fitness age), `g_gear`, `g_pr`, `g_hr_event`.
  Each carries `dataset_rec_key`, so staging rows are traceable to the raw record.
* **Nothing lost guarantee:** every JSON element and every kept file lands in `raw_record` / `raw_fit` first, even if no typed table uses it yet (e.g. `splits`, `courses`, `fitnessAgeData`, `workout`). A completeness check (section 8) compares counts per dataset against the manifest.
* Wellness FIT (types 32/44/49, ~7,200 files, 41 and below 100 KB): **not extracted to disk.** Phase 0 decides per type whether it adds anything beyond UDS/sleep JSON (likely not). If wanted, they are streamed straight into aggregated rows and never become loose files. The zip remains the archive of record (kept, `chmod 600`).

### 3.2 Additive schema extensions in existing DBs (all `ALTER TABLE ADD COLUMN`, nullable, no rewrites)

`lumpad.db`

| Change | Why |
|---|---|
| `activities.canonical_id TEXT` | Points a duplicate to its winning row (`NULL` = it is canonical). |
| `activities.era TEXT` (`live` default / `garmin_hist`) | Isolates historical rows. Existing rows get `live` by default, so no backfill is needed. |
| `activities.dedup_reason TEXT` | Audit: `time±300s+sport+dist±5%`. |
| `activities.te_scale`/`load_scale` unnecessary: Garmin load is stored in `g_activity`, and in `activities.training_load` **only if** converted, else `NULL` | Prevents unit mixing (see 4.3). |
| New table `health_daily_garmin(date PK, …)` mirroring `health_daily` plus `body_battery_hi/lo`, `readiness_score`, `spo2`, `sleep_score`, `acwr`, `source='garmin'` | Avoids the one-row-per-date collision. |
| New view `health_merged` | `COALESCE(coros, garmin)` per field, with `source_*` columns. Used by readers during the dual-wear window. |
| `gear` rows with id prefix `garmin:` | Distinct namespace, matched to COROS/Strava shoes by normalised name (e.g. "910 Hiroshi") in `gear_link`. |

`intel.db`: `fit_session.era`, `fit_session.source`, `daily_feat.era`. `athlete_baseline` already has `valid_from/valid_to`, so historical baselines are **closed intervals**, not open rows.
`memory.db`: **no schema change.** The existing `valid_from`, `valid_to`, `source`, `source_ref`, `status` and `hash` are enough (section 6).

---------------------------------------------------------------------------

## 4. Deduplication and merge rules

### 4.1 Activities

Match Garmin ↔ COROS/Strava in this order, accept the first that passes:

1. **Exact:** same `source_id` or same start second (Strava often carries Garmin/COROS IDs in `external_id`).
2. **Fuzzy:** `|Δstart| ≤ 300 s` **and** same sport family **and** `|Δdistance| ≤ 5 %` (or both distance-less: strength, pilates, padel, with `|Δduration| ≤ 10 %`).
3. Ties go to the nearest start. One-to-one matching only (greedy by smallest Δ), so one COROS run can never absorb two Garmin rows.

Outcome per match, **never deleting a row**:

* **Winner is decided by date (user decision, 2026-11-22): the cutoff is `CANON_CUTOFF = 2026-01-01` in the activity's local date.**
  * **Before the cutoff, Garmin is canonical.** The matching COROS (or Strava) row is kept but gets `canonical_id → garmin:<id>` and drops out of sums, counts, `daily_feat`, mirroring and graph `Session` nodes.
  * **From the cutoff onward, COROS is canonical.** The Garmin row is the one that gets `canonical_id → coros:<id>`.
  * The cutoff is a single config value, applied at link time, so changing it later is a re-link, not a re-import.
  * Why this is right: before 2026 the COROS row is only an import of the Garmin original, so Garmin (with its full FIT, splits and health context) is the better record. Consequence: about 190 existing **live COROS rows dated 2025** become non-canonical. This is the first time the import touches existing rows (only the new nullable `canonical_id` column, never their data), so the "no live row is modified" claim in section 7 is narrowed accordingly.
* The losing row is always kept. Its **unique fields are copied to the side-table `activity_enrichment`**, not into the winner's columns: TE and load labels, `hrTimeInZone_*`, `workoutFeel/RPE`, `differenceBodyBattery`, sweat loss (Garmin as loser), or COROS laps and training focus (COROS as loser). Reading code may show them as "COROS/Garmin said…" with source labels, never as the primary number.
* **Matching windows by period:** pre-cutoff duplicates (Garmin wins): about 185 of the 195 matches. Post-cutoff (2026-01-01 → 01-10, COROS wins): a handful. The dry run reports both separately.
* **Garmin-only activities (about 63 in the window + 71 pre-COROS + a few in 2026-01):** inserted as `garmin:<activityId>`, `era = 'garmin_hist'`, canonical themselves.
* Expected counts, to be confirmed by a dry run: about **195 linked + about 134 inserted** (~329 total). The dry run reports a match table and **all ambiguous pairs** (more than one candidate, or the Δdistance between 5–15 %) for manual review before anything is written.

### 4.2 Daily health

Per `(date, metric)` precedence on read follows the same cutoff: **dates before 2026-01-01 → Garmin first, COROS fallback; dates from 2026-01-01 → COROS first, Garmin fallback.** COROS health only exists from 2026-01-14, so in practice Garmin is the sole source for 2024-09 → 2026-01-13 (including 2026-01-01 → 01-13, where COROS has nothing, so the fallback applies). The two only both exist on about 12 days (2026-01-14 → 01-25), and COROS wins there. On any overlap day both values are kept and `health_merged` exposes a `disagreement` flag when they differ materially (RHR > 4 bpm, sleep > 45 min).

### 4.3 Scale isolation (vendor-computed metrics)

Garmin VO2max, `activityTrainingLoad`, acute/chronic load and ACWR, TE, readiness, race predictions and "training status" are **proprietary and not comparable** with COROS equivalents. Rules:
* Stored with `source='garmin'`, never written into COROS-owned columns (`training_load`, `fitness_daily`, `load_ratio`).
* **Effect of the cutoff rule:** for 2025 the canonical activity is now the Garmin row, but the live `training_load` for that same session is COROS's. The canonical row therefore keeps `training_load = NULL` (Garmin's value stays in `g_activity`/enrichment), unless the user wants it back-filled from the COROS twin row. Recommended: **leave it NULL and read the COROS load through `activity_enrichment`**, so load totals across 2025 still use one scale (COROS) and do not jump at the cutoff.
* Used for *Garmin-era* trend charts and as **context text** for the coach ("Garmin readiness 66, moderate"), not as numeric inputs to twin/COROS-calibrated models.
* Own-computed metrics (EF, drift, GCT fade, pace@HR150 from FIT) **are** comparable, because they derive from raw streams (section 5), which is why the FIT pass is the most valuable one.

---------------------------------------------------------------------------

## 5. Execution model: resumable, idempotent, resource-bounded

### 5.1 Job design (mirrors `coros.db` tasks and `coach_job`)

```sql
CREATE TABLE ingest_task (
  key TEXT PRIMARY KEY,           -- stage|dataset|chunk  e.g. 'fit|277601615836'
  stage TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|failed|skipped
  attempts INTEGER DEFAULT 0, error TEXT, input_hash TEXT, output_stats TEXT, updated_at TEXT);
```

* **Idempotency** by construction:
  * Raw: `INSERT … ON CONFLICT(dataset, rec_key) DO NOTHING`, with the `sha256` recorded. If the same key arrives with a *different* hash, it is logged as `conflict` and not applied silently.
  * Staging and projection: upsert on natural keys (`activityId`, `calendarDate`).
  * FIT: key `(fit_id, PARSER_VERSION)`, the same contract as `processFit` today.
  * Memory: existing `hash UNIQUE` (hash = `sha256(kind|source_ref|text)`).
  * Graph: `MERGE` on stable ids (`garmin:<activityId>`, `Day{date}`), never `CREATE`.
* **Resumable:** every unit of work is one `ingest_task` row. A crash leaves `running` rows, which are reset to `pending` at start (single-writer lock file). The run can be killed at any time and re-launched with no side effects.
* **Whole-run identity:** `archive_sha256` stored in the manifest. A different zip (a re-export) triggers a *delta* run, where unchanged `raw_record` hashes are skipped and only new records process, which is also how a future re-export is absorbed.
* **Kill switch and dry-run:** `--dry-run` computes everything and writes only a report; `--stage=N --limit=K` allows tiny canary runs.

### 5.2 Resource limits (hard rules, because the box has 1.1 GB free RAM and 2 cores)

| Resource | Limit |
|---|---|
| RAM | Process capped with `node --max-old-space-size=384`. The biggest single JSON is 21 MB (about 150 MB parsed), parsed once, split into records and released. FITs are handled **one at a time** (largest is 2 MB). Zip entries are read with `fflate` (already in `node_modules`) per entry, never a full-archive unzip. |
| CPU | `nice -n 15`, `ionice -c3`, one worker. Starts only when 1-minute load < 1.0. Pauses between batches (200–500 ms). |
| Disk | Raw vault ≈ 80 MB compressed to about 25 MB. 329 activity FITs ≈ 25 MB on disk under `server/data/fit/garmin/`. **Pre-check: abort if free disk < 5 GB.** No temp extraction of the zip; scratch is bounded to one entry at a time. |
| SQLite | Batches of about 500 rows per transaction in WAL. `wal_checkpoint(TRUNCATE)` after each stage. The new `garmin.db` is separate, so writes do not contend with the live `lumpad.db` WAL the app uses. |
| Schedule | **Never** 07–09 WIB (existing quiet window) and **never** concurrently with the 01:30–05:00 nightly intel job. Runs in 20-minute sessions in the 10:00–23:00 WIB window by a timer, or manually, stopping cleanly at the time budget (as `COROS_BUDGET` does). |
| LLM | **Zero LLM calls in stages 0–4.** Stage 5 uses deterministic templates for cards. LLM use is limited to optional monthly summaries, with a CNY cap in config and the existing retry ledger (section 6.3). |
| Backup | Run the existing `deploy/backup.sh` snapshot **before** the first write and again after stage 3. |

### 5.3 Stages

| # | Stage | Writes to | Gate before next stage |
|---|---|---|---|
| 0 | Inventory: manifest of all 169 entries + nested zips, sha256, decisions; decode FIT types 41 / 68 / 79; verify unit assumptions on 5 random activities against their FIT | `garmin.db` manifest only | Report matches section 1 numbers |
| 1 | Raw vault: all `ingest` and `vault` entries → `raw_record`, activity FITs → `raw_fit` + disk | `garmin.db` | Per-dataset row counts == source counts; zero conflicts (or reviewed) |
| 2 | Typed staging + normalisation | `garmin.db` | Spot checks: 20 random activities, field-by-field vs raw; null-rate report |
| 3 | Link and dedup dry-run **report**; after approval, apply | `garmin.db` `activity_link` | **User reviews the ambiguous pairs list** |
| 4 | Projection: Garmin-only activities + laps (from `splits`) → `lumpad.db`; `health_daily_garmin`; `fitness`-like rows to a Garmin table | `lumpad.db` (additive) | Row counts; `SELECT … WHERE era='live'` before and after is byte-identical (section 7) |
| 5 | FIT → `fit_session` (329 files, `era='garmin_hist'`), weather via existing `run_weather` | `intel.db` | Diff of live sessions' rows = empty |
| 6 | AI-layer backfill (section 6) | `intel.db`, `memory.db`, Neo4j | Retrieval and twin regression tests (section 7) |

---------------------------------------------------------------------------

## 6. AI layers: backfill without polluting current state

Central idea: introduce an **era** concept. Everything derived from Garmin history carries `era='garmin_hist'` (or an equivalent tag) and the coach/twin queries **default to excluding it**, opting in explicitly where history is wanted.

### 6.1 Per-day features and baselines (`intel.db`)

* Backfill `daily_feat` for 2024-09 → 2025-12-31 from the **canonical (Garmin)** activities, tagged `era='garmin_hist'`. For 2025 dates that already have a COROS-derived row, the existing row is **kept, not overwritten** (it holds COROS-scale TL); the Garmin-based row is written only where none exists (2024-09 → 2024-12 and Garmin-only sessions), and a `daily_feat` rebuild must be told which row wins per day (same `CANON_CUTOFF`). From 2026-01-01 the COROS-derived rows stay authoritative.
* `athlete_baseline`: add **closed-interval** rows (`valid_from`, `valid_to` set, `source='garmin_hist'`) per metric per period, for example "hr800 2024-09-10 → 2024-12-31". The single open live row (`hr800 valid_from 2026-11-01`) is untouched, and the code that reads "current baseline" (`valid_to IS NULL`) cannot see the historical ones.
* Sessions that are Garmin-only get FIT-derived metrics (EF, drift, fades) computed by the same `PARSER_VERSION`. Because these come from raw streams they are comparable with COROS sessions, and that supports pre-COROS progression charts: Sep 2024 vs Nov 2026 EF at the same HR.

### 6.2 Memory / coaching (`memory.db`)

* **Tiered and capped, not 1:1.** One episodic memory per *Garmin-only or enriched run/session* (≈ 190 runs, not 329 activities; walks and padel go into a weekly roll-up), and **semantic** roll-ups by month (about 17) and by training block. All carry `source='garmin'`, `source_ref='garmin:<activityId|YYYY-MM>'`, and a stable `hash` (idempotent).
* `valid_from`/`valid_to` set to the **real historical dates**. `status='archived'` for bulk episodic history, so the "active" retrieval filter (the existing default) excludes them by design. Only a handful of distilled semantic items (for example "Garmin-era HR drift pattern", "pre-COROS volume peak") are `active`, `n` > 1 and `evidence_tag` honestly set (HYPOTHESIS until validated).
* **No `locked` rows and no procedural-tier (rule) writes.** Rules remain the user's and the coach's own.
* Embeddings: `memory_vec` is empty today (0 rows), so retrieval is FTS5-only. Do **not** start embedding 400 new rows implicitly. Decide separately: if embeddings are later turned on, they should be batched, rate-limited and resumable (`memory_vec` has `model`, `dim`), and cover old and new memory together.
* Roll-up text is **template-generated** from numbers (deterministic, zero cost). An optional LLM pass for the monthly narratives (about 17 calls) is a later opt-in, subject to the CNY cap and `coach_job` retry ledger.
* Every write goes through the existing `memory_audit` table, with `run_id = NULL` and `action='garmin_import'`, so the whole batch is revertible with one query: `UPDATE memory SET status='retracted' WHERE source='garmin' AND created_by='garmin-import'`.

### 6.3 Knowledge graph (Neo4j Aura + Go engine)

* Add `Session` nodes only for **canonical** activities (`MERGE (s:Session {label_id:'garmin:<id>'})`). Duplicates become a property (`s.also_garmin_id`) on the live node rather than a second node, so the graph never double-counts.
* Every historical node/edge gets `era:'garmin_hist'`; the existing fixed read queries (`races`, `shoes`, `rules`, `pain`) and the Knowledge Graph screen add `WHERE coalesce(n.era,'live')='live'`, except an explicit "history" view.
* Edges from the existing vocabulary only: `HAS_SESSION`, `WORE` (via `gear_link`), `NEXT_DAY`, `IN_WEATHER`, `SUPERSEDES`. No new relation types, so the Go side needs no change except the era filter.
* **Aura size check:** the live node/edge counts must be read first (the `overview()` call), and the import must stay below the plan limit with at least 30 % headroom. The projected add is about 330 Session + 516 Day + ~20 Shoe/Gear + about 1,500 edges, which is small, but it is checked, not assumed.
* The Go engine is the graph writer today, so graph backfill is a **Go-side command** reading from the staged `canonical` view, not a second writer from Node. The write is batched `UNWIND … MERGE`, 200 rows per transaction.

### 6.4 Digital twin

* The **live twin (`twin_state`, schema `twin/1`) is not recomputed from history.** It stays at version 43+ and continues from the nightly job. Windowed baselines are unaffected because all history ends 2026-01-10 and the twin's windows end at today.
* New *separate* historical series `twin_state` rows with `trigger='garmin-backfill'` and `as_of` = month-end dates (about 17), computed with the same code against `era in ('garmin_hist','live')` at that `as_of`, written to a **new table `twin_history`** (same columns), not `twin_state`. The app keeps showing `twin_state`; `twin_history` powers trend and "how I was in Nov 2024" questions via the coach's read-only `whatif`/`topic_context` tools if wired in later.
* Correlation edges (`corr_edge`, 0 rows today) are **not** run across the merged history in this project. Mixing the Garmin and COROS eras in one correlation would confound the *device* with the effect, so any correlation run gets an `era` or `source` partition.

---------------------------------------------------------------------------

## 7. Preserving current active state (acceptance tests)

Before stage 4, capture a **fingerprint** of the live system. With the cutoff rule, the only permitted change to existing rows is the new `canonical_id` on 2025 COROS/Strava activities, so the hash covers every *other* column and the set of rows dated from 2026-01-01 must be unchanged. Row counts and a hash over `activities` (all columns except `canonical_id`), `health_daily`, `fitness_daily`, `daily_feat`, `athlete_baseline`, `memory WHERE status='active'`, and the latest `twin_state.state`. After every later stage, recompute and require a **byte-identical match**; any diff stops the run.

Additional gates:
* `GET` of the coach prompt context for **today** (`context.js` render) before vs after: identical token-for-token except for explicitly intended new, labelled sections.
* The existing test suite (`npm test`) passes, plus new tests for: dedup matcher (fixtures incl. the 195/63 split), unit normalisation, `health_merged` precedence, era filtering in memory retrieval and graph queries, idempotent re-run (second run = zero writes), crash-resume (kill mid-stage, resume, same result).
* Dated-cutoff test: for every matched pair, assert the winner's date is on the right side of `CANON_CUTOFF`; assert that the sum of canonical km per week is unchanged versus the pre-import COROS-only sum for 2025 within the expected Garmin vs COROS distance tolerance.
* Rollback is table-scoped: `DELETE … WHERE era='garmin_hist'` / `source='garmin'`, `DROP TABLE` the new tables, and restore from the pre-run snapshot as the last resort. No stage ever updates or deletes a live row.
* Neo4j: pre-run `overview()` counts stored in the manifest; rollback is `MATCH (n {era:'garmin_hist'}) DETACH DELETE n` in batches.

---------------------------------------------------------------------------

## 8. Completeness and quality verification

* **Per-dataset reconciliation table** in the final report: source rows → raw rows → staged rows → projected rows, with the reason for every gap (dedup, stub `{"retro":false}`, excluded).
* Unique activity IDs 329 = `activity_link` rows 329 = activity FIT files 329.
* Null-rate and range checks per column (e.g. `avgHr` within 30–230, distance ≥ 0, no activity starting in the future).
* Timezone: `startTimeGmt` is the key; local time is derived with the `timeZoneId` field, **not** the server's zone (the user was in Jakarta, UTC+7, but travel is possible, so verify).
* Sleep `calendarDate` is the wake date, and `UDS.calendarDate` is the local day. Stage 2 asserts this against `sleepEndTimestampGMT`, so nights are not shifted by one day.
* Stubs (`{"retro":false}`) are counted and reported, not dropped silently.

---------------------------------------------------------------------------

## 9. Risks and open decisions

**Priority of value (from the user's objective):** (1) 16 months of Garmin health, sleep, stress, RHR and readiness for 2024-09 → 2025-12, which Lumpad has none of; (2) 71 sessions from 2024-09 → 2024-12 plus about 63 Garmin-only sessions in 2025; (3) richer detail (FIT streams, zones, splits, gear) for the 2025 sessions that exist only as COROS imports; (4) historical baselines and twin history. Stages are ordered so that health and staging come first and the graph and memory work last.

| # | Risk / decision | Mitigation / recommendation |
|---|---|---|
| R1 | **Double counting** of about 195 dual-recorded sessions would inflate load/mileage and skew the coach. | Canonical link + exclusion, dry-run report, manual review of ambiguous pairs. |
| R1b | **Cutoff flips the winner for 2025**: Garmin becomes canonical, so existing COROS rows, their FIT-derived `fit_session` rows, cards, memory episodes and graph Session nodes for those ~190 sessions are shadowed. A mid-history source switch also puts a discontinuity at 2026-01-01 in any series that uses source-specific fields (GCT, stride, power, load). | `fit_session` is kept for **both** (it is keyed by `label_id`); the session-level reads pick the canonical one. Series that need one scale use FIT-derived metrics (both watches) or `activity_enrichment`. Memory episodes and graph nodes already created from COROS 2025 sessions are re-pointed (`SUPERSEDES`, `status='archived'` with `valid_to`) rather than deleted. Fully reversible by clearing `canonical_id`. |
| R2 | **Health overwrite**: `health_daily` PK is date, and the COROS projection rebuilds it. | Separate `health_daily_garmin` + `health_merged` view. |
| R3 | **Vendor-metric scale mixing** (Garmin load, TE, VO2max vs COROS). | Stored separately, never into COROS columns; FIT-derived metrics are the comparable ones. |
| R4 | **Retrieval pollution / skew** of the coach by ~400 old memories. | `archived` status + real `valid_*` dates + era filters; only a few distilled `active` items. |
| R5 | **RAM/CPU/disk exhaustion** on a 2 GB box. | Single worker, 384 MB heap cap, per-entry streaming, nice/ionice, load gate, disk pre-check, time-boxed sessions. |
| R6 | **Privacy**: the archive contains account, billing and health data; `garmin_backup.zip` is untracked and **not gitignored**. | Add `garmin_backup.zip`, `garmin.db*` and `server/data/fit/garmin/` to `.gitignore` as the first change (needs your OK). Excluded domains are never parsed. Output reports contain counts only, no content. |
| R7 | Unit assumptions (cm / ms / dm-per-ms) inferred from one sample. | Phase 0 validates on several activities against FIT before any write. |
| R8 | Unknown FIT types 41/68/79 (1,202 files) and the 7,200 wellness FITs. | Decode in Phase 0; default is "vault only, not extracted". |
| R9 | Garmin export ends 2026-01-10 (activities) and 2026-04-24 (metrics windows), so there is a **gap Jan 2026 → today for Garmin**; COROS covers it. | By design. The `era` boundary is the earliest live date, not a fixed date. |
| R10 | Neo4j Aura capacity and the Go writer being a separate codebase. | Read live counts first; graph backfill implemented in Go and gated by the dry-run. |
| R11 | Embeddings are absent today (0 `memory_vec` rows). | Out of scope; flagged so nobody assumes vector retrieval exists. |
| R12 | A credentials text file for Neo4j sits in the repo root (gitignored, but plaintext). | Not part of this work; consider moving it to `.env.v2` only. |

### Decisions needed from you

1. ~~Winner on duplicates~~ **Decided (2026-11-22): Garmin is the primary source before 2026-01-01 (COROS 2025 rows are imports of it), COROS is native from 2026-01-01 onward.** Objective stated by the user: enrich Lumpad, especially the period before January 2026. Open: the exact COROS purchase date (to refine the cutoff, since runs on 2026-01-02 to 01-11 exist in both). Still open inside that rule: should the shadowed 2025 COROS rows' `training_load` stay the load of record (recommended, see 4.3), and should their existing episodic memories and graph nodes be archived/re-pointed to the Garmin session (recommended) or left as they are?
2. **Scope of memory backfill**: deterministic templated episodes and monthly roll-ups only (recommended), or also LLM monthly narratives (about 17 calls, small cost)?
3. **Wellness FITs** (about 7,200 files): vault-only inside the zip (recommended) or extract?
4. **Graph backfill** into the production Aura instance now, or after the SQLite stages have been reviewed?
5. **Gitignore** the zip and new data paths now?

---------------------------------------------------------------------------

## 10. Work breakdown (after approval; nothing here has been started)

| Phase | Deliverable | Rough size |
|---|---|---|
| P0 | Read-only inventory tool + unit/FIT-type verification + dry-run dedup report | ~1 day |
| P1 | `garmin.db` schema, raw vault loader, completeness report | ~1 day |
| P2 | Typed staging parsers + tests | ~1–2 days |
| P3 | Linker + apply + `era`/`canonical_id` migrations + fingerprint tests | ~1–2 days |
| P4 | Projection to `lumpad.db`, `health_merged`, FIT → `fit_session` | ~1–2 days |
| P5 | Baselines, `daily_feat`, memory roll-ups, `twin_history` | ~2 days |
| P6 | Go-side graph backfill with era tags + UI filters | ~1–2 days |
| P7 | Resumable runner, timer/budget, runbook in `docs/intelligence-ops.md` | ~1 day |

Each phase ends with a stop for review. **No imports run until you approve the plan and answer the decisions above.**

---------------------------------------------------------------------------

## 11. Approved decisions (2026-11-22, "approve all")

1. Blueprint approved; implementation proceeds phase by phase, each ending in a verification report.
2. Cutoff `CANON_CUTOFF = 2026-01-01` (config value; refine if the COROS purchase date is given). Garmin primary before it, COROS from it.
3. 2025 `training_load` stays COROS (canonical Garmin rows keep it NULL, Garmin value in staging/enrichment).
4. Shadowed 2025 COROS memories and graph nodes are archived and re-pointed, never deleted.
5. Memory backfill is template-generated only (no LLM narratives for now).
6. Wellness FITs (types 32/44/49/…) stay inside the zip; only the 329 activity FITs and 3 backup FITs are extracted.
7. Graph (Neo4j) backfill runs **after** the SQLite stages (P0 to P5) have been reviewed.
8. `garmin_backup.zip`, `garmin.db*` and `server/data/fit/garmin/` are gitignored.

## 12. Execution log

### P0 + P1 done (2026-11-22)
* Pre-run snapshot: `/var/backups/lumpad/lumpad-20261122-1925.tar.gz`. Live DBs untouched (only the new `server/data/garmin.db`, 15 MB, and `server/data/fit/garmin/`, 64 MB, were created).
* Code: `server/garmin/{db,names,fitmeta,vault,cli}.js` + tests (`node --test server/garmin/vault.test.js`, 5/5). Run: `sudo -u lumpad env DATA_DIR=/opt/lumpad/server/data nice -n 15 ionice -c3 node --max-old-space-size=384 server/garmin/cli.js <inventory|vault|report|guard>`.
* Inventory: 144 top-level entries (87 JSON, 4 nested zips, 50 excluded other-domain, 3 images) + 8,731 nested entries. Vault run: 44 s, peak RSS 309 MB, **0 conflicts**, 146 exact duplicate records collapsed (overlapping export windows).
* Reconciliation: 329 unique activities = 329 activity FITs on disk (+2 backup FITs); 516 daily summaries; 423 sleep records (417 nights + stubs); 1,335 readiness rows.
* **Unit verification (5 runs vs their FIT):** `distance` = cm (÷100), `duration` = ms (÷1000), `avgSpeed` = m/s ÷ 10, `elevationGain` = cm (÷100). FIT start time == summary `startTimeGmt` to the second, so activity↔FIT linking is exact (`raw_fit.time_created_ms`).
* **FIT types 41 / 68 / 79:** contain only `file_id` + device info (no data). Types 44 / 49: device info / a few events. Confirms the decision to leave all wellness FITs in the zip. Nothing lost.
* Deviation from section 1.1: `IT_GLOBAL_EVENT/events.json` is **excluded** (account log, no athletic value), not vaulted.

### Design change vs sections 3.2 / 4.1 / 6.2 (decided during P4, 2026-11-22)
Findings that forced it: (a) the Activity tab's `mergeActivities` only knows COROS and Strava rows, so Garmin rows were silently dropped; (b) every intelligence reader (twin, features, coach, advice, tools) filters `source='coros'`, so marking the 2025 COROS rows as shadowed would have erased a year of history from them; (c) the dry run showed the 2025 COROS rows are exact imports of Garmin sessions (distance deviation p95 0.14 %, 195 of 195 matched, no COROS-only row in the Garmin span).
So instead of `canonical_id` on COROS rows:
* **Matched sessions (195):** the existing COROS row stays the app row (stable id, laps, gear, memories, graph nodes: nothing to re-point). It gets `garmin_id` and `primary_source` (`garmin` before `CANON_CUTOFF`: 187 rows; `coros` from it: 8 rows), and the Garmin data attaches in `activity_enrichment`. COROS `training_load` stays the load of record.
* **Garmin-only sessions (134):** new rows `garmin:<id>`, `source='garmin'`, `era='garmin_hist'`. Readers filtering `source='coros'` ignore them by construction.
* No memory/graph archiving of 2025 COROS episodes is needed. Section 6.2's "re-point" decision is therefore moot.

### P2 staging done
`server/garmin/stage.js`: 17 typed `g_*` tables rebuilt from the vault (329 activities, 516 UDS days, 417 sleep nights, 49 naps, 1,335 readiness, 1,275 ACWR, 1,654 race predictions, 580 health-status rows, 327 hydration, 32 BP, 52 weights, 393 fitness-age, 9 gear, 58 PRs, 46 HR events). Every activity is linked to its FIT (329/329; one-to-one, ≤120 s tolerance, 15 were 1–50 s off). Stress −1 (not measured) becomes NULL.

### P3/P4 done: link + projection into lumpad.db
* Run: `cli.js link-dry` (report), `cli.js apply` (dry), `cli.js apply --yes` (transaction; aborts and rolls back if the frozen-history fingerprint changes).
* Pre-apply snapshot `/var/backups/lumpad/lumpad-20261122-1933.tar.gz`. **Fingerprint identical before/after** for activities (453), laps (2,663), health_daily (291), fitness_daily, gear. Re-run is a no-op.
* Result: `activities` 468 → 602 (+134 Garmin-only), `activity_enrichment` 329, `health_daily_garmin` 519 days, view `health_merged` (500 Garmin-only days, 19 both, 294 COROS-only; Garmin first before the cutoff).
* Reader changes (uncommitted): `server/activities.js` (Garmin rows listed; `garmin` enrichment attached in `listMerged`), `server/intel/matrices.js` (gym days exclude `source='garmin'`). Tests added; `npm test` 364 pass / 0 fail (2 skipped, pre-existing).

### P5a/b done: FIT metrics and the historical baseline layer
* `fit-sessions`: 326 Garmin FITs through the existing metrics code into **`intel.db.fit_session_hist`** (separate from `fit_session`, which 17 modules read). 245 sessions in 2025 (there were none before). 3 failed as near-empty recordings. Validated: the 3 sessions already present in `fit_session` give identical EF to 3 digits. Peak 175 MB, 31 s. Caveat: zones/thresholds use the current athlete baseline, not the period's.
* `history`: `daily_feat_hist` (487 days 2024-09-01 → 2025-12-31), `history_month` (16 months), closed `athlete_baseline` rows named `garmin:hr800` / `garmin:ef` (10; the twin only reads `hr800`).
* `memory`: 28 rows, all `status='archived'`, `created_by='garmin-import'`, never locked (16 monthly semantic roll-ups, 12 long-run episodes). Active/candidate counts unchanged (778/7); all pre-existing rows hash-identical; re-run is a no-op. Retrieval defaults to `status='active'`, so the coach does not see them unless it asks for archived.

### P6 done: knowledge graph (Neo4j Aura), 2026-11-22
* Node-side writer `server/garmin/graph.js` (the Go projector cannot be rebuilt on the VPS: no Go compiler; its daily 02:15 WIB sync only prunes Memory/Rule/pain, never Session/Day, so these nodes survive it). Run: `cli.js graph` (dry), `cli.js graph --yes`, `cli.js graph-rollback`.
* Written: **+83 Day** (2024-09 → 2024-12 days that had no node), **+275 Session** (`label_id = garmin:<id>`), **+122 NEXT_DAY**, **+275 HAS_SESSION**; all `era='garmin_hist'`, `source='garmin'`. 42 existing Session nodes that a Garmin FIT duplicates got an additive `garmin_id`. Totals 2,188 → 2,546 nodes, 4,910 → 5,307 edges (Aura Free limit 200k/400k).
* Checks: live (non-era) node and edge counts unchanged per label/type; re-run is a no-op; no health or GPS properties (project policy: health stays out of the graph unless NEO4J_SYNC_HEALTH=1); the Day chain is continuous 2024-09-01 → 2025-12-31; no orphan sessions; 2025 went from 0 to 245 Sessions. Before/after counts stored in `garmin.db.graph_snapshot`.
* Not in the graph by design: archived memories (the Go sync prunes any non-active Memory), SIMILAR_TO / IN_WEATHER / WORE for history (needs weather and shoe links), the 2026-01 Garmin sessions (COROS is canonical there and already has nodes).
* The existing KG screen queries were left unchanged: history sessions have no WORE edge and are older than the "newest N" views, so they do not appear there; only the overview counts grow.
* **Go matrices gym-day query** (`lumpadd/internal/analytics/matrices.go`) got the same `source <> 'garmin'` filter as the Node one. Source only: it takes effect after the binary is rebuilt elsewhere. Until then the Go shadow matrices could differ from Node's (twin, features and graph sync already filter `source='coros'`).

### P7 done: `twin_history` and laps (2026-11-22)
* **`twin_history`** (`server/garmin/twinhist.js`, `cli.js twin-history`): 67 weekly snapshots 2024-09-29 → 2025-12-31 in `intel.db`, schema `twin_hist/1`. Deliberately NOT the live `buildTwin`: that module is bound to live module state, the 2026 plan/race projection and the Node/Go shadow comparison; refactoring production code to feed it history would be risky and a "marathon projection" for 2024 is meaningless. Instead the snapshot reuses the same pure library functions (`pmc`, `acwrRolling`, `monotonyStrain`, `distanceProgression`, `hrvState`, `rhrState`, `sleepState`) and the same field names for shared sections (load, recovery, aerobic, baselines, profile). Strictly point-in-time (unit-tested: rows after `as_of` never change a snapshot); the aerobic z-score baseline is the trailing window ending 28 days earlier (no look-ahead). Load and race predictions are Garmin-scale. Each snapshot lists its `gaps` (e.g. HRV baseline unavailable before 2025-09; aerobic z needs ≥5 steady runs). Idempotent via `inputs_hash`. The live `twin_state` is untouched.
* **Laps** (`apply.js projectLaps`, `cli.js laps --yes`): 212 per-km laps for the 40 Garmin-only runs, computed from the FIT stream (the Garmin `splits` field is a messy measurement-array format; the FIT-derived per-km rows have exactly the shape of COROS laps). INSERT OR IGNORE, guarded by the frozen-history fingerprint (identical to the first run's hashes), idempotent. A shadow pass right after verified the Postgres mirror (0 not identical).
* **Shoe linking: Strava only** (the Garmin export has no activity→gear mapping, so `g_gear` stays staged and unused). Done via the app's own `syncShoes` with new options (`sources=['garmin']`, `writeGear=false`, `dry`; defaults keep the nightly behaviour): Strava runs since 2024-09-01 matched to Garmin-era rows by start time ±3 min → 39 Garmin-only runs got a `gear_id` (20 Strava runs have no shoe set; no COROS row and no gear mileage touched); 164 of 173 historical runs now carry `fit_session_hist.shoe_id`; 120 `WORE` edges added to the graph (`cli.js shoes --yes`, `cli.js graph-wore --yes`), all idempotent, live WORE edges unchanged (156).

### Not done (and why)
* Rebuild of the Go binary (matrices source filter, see P6): needs a Go 1.26 toolchain elsewhere.
* Merge of branch `garmin-history-import` to `main` (auto-deploy is paused until then).
* UI for the history (monthly view, `twin_history` trend charts, Garmin enrichment on the Activity detail): the data is available (`listMerged` attaches `garmin`); no new screens.
* Embeddings: `memory_vec` is still empty app-wide, so history memories are FTS-only like everything else.
* Optional: LLM-written monthly narratives (decision 5: templated only for now).
