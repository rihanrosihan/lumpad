# Lumpad Intelligence Layer — Build Plan (v1.4, 17 Nov 2026)

> **v1.4 — IMPLEMENTED 17 Nov 2026 (deployed on the VPS, not yet committed to git).** Status by phase:
>
> | Phase | Status | Notes |
> |---|---|---|
> | P0.1 pace rejection | ✅ done | pace fields are "soft": out-of-range → dropped, record kept (`server/ingest.js`) |
> | P0.2 shoe per run | ✅ code + test, ⏳ needs Strava connect | `strava.syncShoes()`, sealed Strava token, Profil → "Strava · sepatu per lari" |
> | P0.3 weather | ✅ done | 56 of 72 runs have Open-Meteo weather + WBGT; 16 indoor/no GPS |
> | P0.4 minimal check-in | ✅ done | 1 tap "Rasa badan"; pain default 0; COROS auto-applied; post-long-run card; readiness weights pain 15 + feel 12 + muscle 3 |
> | P0.6 KB import | ✅ done | 36 docs → 568 chunks (486 active, 81 archived from superseded docs) |
> | P1 `fit-to-memory` | ✅ done | `server/intel/{fit,metrics,card,pipeline}.js`; golden tests reproduce KB 04.9 numbers exactly |
> | P2 Digital Twin | ✅ done | `twin/1`, versioned in `intel.db.twin_state`; 3 projection scenarios instead of one number |
> | P3 memory + retrieval | ✅ FTS5 + fingerprints, ⏳ text vectors | semantic vectors (local e5) deferred: FTS5 + RRF + MMR + numeric fingerprints are active; `memory_vec` table and the `vectorSearch` slot exist |
> | P4 CorrelationEdge | ✅ done | SQL window lags 1–3/4–7/8–14/15–28 d; validated on planted + null data; **0 edges today** (71 sessions, FIT backlog still downloading) |
> | P5 context + DeepSeek + write-back + CLI | ✅ done | live-tested: daily brief in ~28 s; Claude Code CLI + bearer endpoints |
> | P6 UI | ✅ done | new **Coach** tab (Coach · Ketahanan · Twin · Memori), Home coach card, FIT panel in Activity, Strava card in Profil |
>
> **Deviations from v1.3 (all deliberate):** pure libs are imported from `src/lib` on the server instead of being moved to `shared/`; heavy jobs run in the API process one file at a time
> (72 FIT files in 8 s at ~120 MB) instead of child processes; text embeddings deferred (see P3). Operations: `docs/intelligence-ops.md`.

> **v1.3 (17 Nov):** Strava API application credentials saved to `.env` and Lumpad restarted; Strava is now
> **configured but not connected** — one OAuth step remains (§0.3). Credentials register added (§0.3).

> **v1.2 (17 Nov, athlete decisions):** coach model = **newest DeepSeek Flash** (today `deepseek-flash` = DeepSeek-V4.1-Flash),
> resolved automatically from `/models` so a newer Flash is picked up without a code change (§8.3 A).
> **Monthly spend cap = ¥15**, enforced from the account balance, so no price table is needed (§8.3 A). `deepseek-v4-pro` is no longer used.

> **v1.1 (17 Nov, athlete decisions):** coach LLM = DeepSeek `deepseek-v4-pro` *(superseded by v1.2: newest Flash)*, with **Claude Code** as an
> occasional second reader through a local CLI (§8.3). Weather backfill = **yes** (§3 0.3). Threshold features = **generic**
> (§1 C5). Check-in = **minimise** → redesigned to 1 tap on a normal day (§3 0.4). All four §12 decisions closed.

**Goal:** turn Lumpad from a dashboard into a monitoring → analysis → coaching system aimed at one outcome:
**sub-4:00 at JRF FM, Sun 24 Oct 2027** (MP 5:41/km; fitness line VDOT 31.7 → 39.9 per `06.5`).

Four modules were requested: (1) FIT dual-ingestion (`fit-to-memory`), (2) versioned Athlete Digital Twin,
(3) multi-lag CorrelationEdge job, (4) hybrid RAG context assembler with memory write-back. This plan keeps all four,
changes *how* several are built to fit the real stack and the 2 GB VPS, and adds the pieces the sub-4 goal needs most.

Status: **PLAN — nothing built yet.** Decisions marked **[DECIDE]** need the athlete's answer before the phase that uses them.

---

## 0. Ground truth this plan is built on

### 0.1 Actual system (checked 17 Nov 2026)

| Item | Brief assumed | Reality |
|---|---|---|
| App | Next.js | **React 18 + Vite SPA** (`src/`) + **plain Node 22 HTTP API** (`server/index.js`), 17 commits, ~3.8k lines |
| Database | Postgres + pgvector | **SQLite via `node:sqlite`** (SQLite 3.46.1): `server/data/lumpad.db` (app tables), `coros.db` (raw COROS archive), JSON kv store |
| SQLite features | — | **FTS5 available**, window functions available, `loadExtension` available (so `sqlite-vec` is an option) |
| FIT files | — | `server/data/fit/<year>/<labelId>.fit`, **130 of 456** downloaded; 40/day COROS budget → backlog done ≈ 26 Nov |
| FIT fields (Apex 4 + Pod 2) | — | per second: `heart_rate, speed, distance, altitude, cadence, step_length, power, stance_time, vertical_oscillation, vertical_ratio`, developer field **`Effort Pace` (m/s)**; session: `avg_temperature` (sensor), `avg_stance_time_balance` |
| Parser | — | `fit-file-parser` already a dependency |
| Existing analytics | — | `src/lib/load.js` (PMC τ42/τ7, ACWR, monotony), `readiness.js` (4-pillar readiness, documented in `docs/readiness-model.md`), `analysis.js` (EF, decoupling from laps, shoe stats), morning check-in with pain 0–10 (kv `lumpad.daily.<date>`) |
| LLM | — | **`DEEPSEEK_API_KEY` in `.env`** (added 17 Nov, mode 600, verified: `/models` lists `deepseek-flash` = **DeepSeek-V4.1-Flash** (1M context, 393k max output, text + image in, effort `low/high/max`) and `deepseek-v4-pro`). Also in `.env`: `DEEPSEEK_MODEL=auto-flash`, `DEEPSEEK_MONTHLY_CAP_CNY=15`. Existing pattern: a Claude routine posts to `/api/ingest` with a bearer token |
| Server | 2 vCPU / 2 GB | **~890 MB available**, 2 GB swap (177 MB used); API process ≈ 90 MB RSS; Caddy in front |

### 0.2 What the athlete's data says the app must solve (from KB export + lumpad, 17 Nov)

1. **Durability, not speed, is the main gap.** FM realization ratio **0.59** (Jakim 6:53:03 vs ≈4:40 equivalent).
   In both FMs, *running* economy held (Bormar/Jakim 0–35 km: 77.7 vs 77.6 J/m, EF 0.787 vs 0.784) while **run share collapsed**
   (Bormar 81 % → 25 %). Breakdown window km 20–25 in both.
2. **Injury risk from the plan itself.** VMO (Oct), Achilles (new), plantar (Jakim), MTSS history. 2027 plan averages
   **55 km/wk** vs 2026 actual **31 km/wk**.
3. **Opening too hot** in every long race (Bormar km 1–8 HR ≈ 169, ≈ +23 bpm vs baseline at that pace).
4. **Heat** (Bormar black flag; GI events in 4 of 5 hot long races; Apr–Jun 2026 worse on every metric).
5. **Pre-race readiness red** before both FMs.
6. **Data gaps that block analysis:** shoe per run (gear_id on 3 / 464 activities), ambient temperature (4 / 464),
   pain/GI/fueling only in chat, strength *type* (Upper/Lower) not recorded as executed.

Every module below is judged by whether it helps measure or move these six.

### 0.3 Credentials & connections register

**Secret values live only in `/opt/lumpad/.env`** (owner `lumpad`, mode 600, loaded by `lumpad.service` `EnvironmentFile`),
never in this document or in git — this file sits inside the repo. To read one on the VPS: `grep '^NAME=' /opt/lumpad/.env`.

| Service | `.env` name(s) | Non-secret details | Status (17 Nov 2026) |
|---|---|---|---|
| **Strava API application** | `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Client ID **212875**; category Performance; **rate limits: overall 400 / 15 min, 4,000 / day; read 200 / 15 min, 2,000 / day**; athletes allowed 10, connected 1 | Saved 17 Nov; service restarted; `GET /api/sources` → `configured: true, connected: false` |
| Strava personal token (from the API settings page) | `STRAVA_REFRESH_TOKEN_READ` | scope **`read` only**; access token on that page expires 2026-11-17 15:41 UTC (not stored — refreshable) | Verified: `GET /athlete` → 200; `GET /athlete/activities` → **401 `activity:read_permission missing`**. Not usable for activity/shoe backfill |
| Strava OAuth token (needed) | stored by the app (`server/data/strava_token.json`) | scopes requested by `server/strava.js`: `read, activity:read_all, profile:read_all` | **Pending one-time connect** (below) |
| DeepSeek | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL=auto-flash`, `DEEPSEEK_MONTHLY_CAP_CNY=15` | newest Flash (today DeepSeek-V4.1-Flash) | Verified 17 Nov (`/models` 200, balance ¥17.49) |
| COROS (official MCP, OAuth + PKCE) | `LUMPAD_TOKEN_KEY` (seals tokens) | tokens in `lumpad.db` `oauth_tokens`, AES-256-GCM | Connected; access token expires 2026-12-11, auto-refresh |
| Ingest / monitoring bearer | `INGEST_TOKEN` | used by the Claude routine and `/api/ingest/status` | Active |
| Open-Meteo (weather) | — (no key) | coordinates rounded to 0.1° | Approved, not built |
| NCBI / PubMed | `NCBI_API_KEY` | literature lookups | Present |

**Strava one-time connect (athlete, ~1 minute):**
1. In Strava → Settings → My API Application, set **Authorization Callback Domain = `lumpad.rihan.digital`**.
2. Open **`https://lumpad.rihan.digital/api/strava/login`** (or Profil → Hubungkan Strava) and approve all requested scopes.
3. Check: `GET /api/sources` shows `strava.connected: true`; a test call to `/api/strava/activities` returns runs.
The redirect was verified on 17 Nov: `/api/strava/login` → 302 to Strava authorize with
`redirect_uri=https://lumpad.rihan.digital/api/strava/callback` and the three scopes above.

**Hardening (added to P0):** `strava_token.json` is plain JSON today, unlike COROS tokens → seal it with
`LUMPAD_TOKEN_KEY` the same way (`server/coros/oauth.js` pattern). Rotate the Strava client secret and the DeepSeek key
if they were ever shared outside the VPS (both were pasted into a chat session on 17 Nov).

**Strava rate budget for P0 backfill:** activity list ≈ 3 calls (200 per page, ~470 activities since 2025) + gear
≈ 11 calls (one per shoe) + per-activity detail only for unmatched runs → far below 200 / 15 min. Daily sync after that:
1–2 calls. Strava data is used only for shoe matching, names and weather fallback; Strava's API agreement restricts
using its data for AI model training, so Strava-sourced fields sent to DeepSeek are limited to shoe name and mileage.

---

## 1. Changes vs the brief (my recommendations)

| # | Brief | Plan | Why |
|---|---|---|---|
| C1 | Next.js app | **Keep React + Vite + Node API** | Rewriting a working app gives the athlete nothing. `next build` alone needs ~1 GB RAM on this box. |
| C2 | Postgres + pgvector | **SQLite + FTS5 + exact cosine in JS** (Float32 BLOBs); `sqlite-vec` only if a measured query exceeds 50 ms | Corpus is tiny: ≈ 500 sessions/yr + ≈ 2k KB chunks → < 20k vectors in 5 years. Exact search over 20k×384 floats ≈ 5–10 ms. Postgres would cost 150–300 MB RAM, a migration, and a second backup path. The store sits behind one `vectorSearch()` interface so pgvector stays possible. |
| C3 | One text embedding per session | **Two vectors per session:** a **numeric fingerprint** (z-scored metrics) for "find similar runs", plus a **text embedding** of the episode card for semantic queries | Text embeddings of number-heavy cards retrieve poorly ("7:31/km HR 166" vs "7:29/km HR 168" embed far apart or arbitrarily). Similar-session search must be numeric. Text vectors serve notes, KB docs and LLM insights. |
| C4 | Embedding provider unspecified | **Local `multilingual-e5-small` (384-d, int8) via `@huggingface/transformers`**, run in a short-lived child process | Health data stays on the VPS; the KB is Indonesian + English; no per-call cost; ~200–300 MB peak only while the job runs. Anthropic has no embeddings endpoint. |
| C5 | "Weekly Norwegian double-threshold load" | ✅ **Generic threshold-load features** (approved 17 Nov): threshold-zone minutes/week, quality sessions/week, double-day flag | The athlete's plan has **no double-threshold**; KB `03.6` explicitly rejected it. At 31 km/wk with three injury sites it would raise injury risk. The engine supports a double-threshold feature if one ever appears in the data. |
| C6 | 1-to-28-day lag correlations | **Lag windows (1–3, 4–7, 8–14, 15–28 d) as the default family**, with single-day lag curves for exploration only; Spearman + partial correlation, block bootstrap, **Benjamini–Hochberg FDR**, stability check | With n ≈ 120–200 runs, 10 exposures × 6 outcomes × 28 lags = 1,680 tests → ≈ 84 false "significant" edges at p < 0.05. Without these controls the coach would learn noise. |
| C7 | Auto memory write-back | **Staged write-back**: LLM writes go in as `candidate` + `HYPOTHESIS`; promotion needs evidence (n ≥ 3, matching edge) or the athlete's approval; locked rules are immutable; every number in a write is checked against measured data | Protects against hallucinated "facts" and memory poisoning. Mirrors the KB's own evidence vocabulary (`[MEASURED]`, `[VALIDATED]`, `[HYPOTHESIS]`…). |
| C8 | — | **Add a sub-4 module set** (§7): long-run durability scorecard, heat-cost model, race-realization tracker, CP/kill-gate dashboard, pain/GI/fuel log, P(sub-4) projection | These measure the six limiters in §0.2. Without them the RAG layer has nothing decisive to retrieve. |
| C9 | — | **Data foundations phase first** (§3): shoe-per-run backfill (Strava), hourly weather backfill, check-in extensions, strength-type tagging, fix of the `avg_pace_s_km invalid` rejection | Shoe-degradation and heat analysis are impossible without them. |
| C10 | — | Heavy jobs run **out of the API process**, one at a time, `nice`d, memory-capped, never 07:00–09:00 WIB and never during a COROS archive session | Protects the morning sync and the 2 GB box. |
| C11 | (v1.2) LLM provider | **Newest DeepSeek Flash** (today DeepSeek-V4.1-Flash) behind a small provider interface (`server/intel/llm.js`), capped at **¥15/month**; **Claude Code** reads the same context through a CLI | Athlete's choice. The interface keeps the context payload, validation and write-back identical whichever model reads it. |
| C12 | (v1.1) Check-in | **1 tap on a normal day**; detail appears only when something is wrong or after a long run | Athlete wants it minimal; data that is skipped every day is worse than a short form that is always filled. |

---

## 2. Architecture

```
COROS MCP ─┐                                   ┌─> /api/twin, /api/intel/*  ──> React UI (Twin, Long-run, Gates, Memory)
Strava ────┼─> coros.db / lumpad.db ──> JOBS ──┤
Open-Meteo ┘        FIT files            │      └─> retrieveRunnerContext() ─┬─> DeepSeek newest Flash (default) ─────┐
check-in (kv) ───────────────────────────┘                                   └─> CLI → Claude Code (occasional) ────┴─> write-back hook
                                                                                                                         │
                                                                                                                         v
                         intel.db (derived, rebuildable)      memory.db (memories, vectors, coach runs — NOT rebuildable)
```

- **`intel.db`** (new): everything derivable from raw data — FIT metrics, per-km splits, daily features, baselines,
  twin versions, correlation edges. Can be deleted and rebuilt.
- **`memory.db`** (new): memories (episodic/semantic/procedural), vectors, FTS index, coach runs, write-back audit.
  Episodic cards are rebuildable; semantic/procedural memories written by the athlete or the LLM are not → included in `deploy/backup.sh`.
- **Jobs** extend `server/jobs.js` (single-runner, persisted progress) with new kinds; heavy kinds run via
  `child_process.fork()` with `--max-old-space-size=256`, `nice 10`.
- Shared pure libraries move from `src/lib/` to `shared/` (ESM) so the server and the UI use **one** implementation
  (PMC, readiness, VDOT, dates, stats).

### 2.1 Resource budget

| Process | Peak RSS target | When |
|---|---|---|
| API (unchanged + new read endpoints) | ≤ 150 MB | always |
| `fit` job (parse + metrics, one file at a time) | ≤ 150 MB | after archive session, nightly |
| `embed` job (e5-small int8) | ≤ 350 MB | nightly 01:30 WIB, only if new cards/chunks |
| `twin` + `features` jobs | ≤ 100 MB | after each projection + nightly |
| `correlate` job | ≤ 120 MB | Sunday 02:00 WIB + after FIT backfill batches |
| `coach` call | ≤ 80 MB (network bound) | on demand / daily brief |

Disk: vectors ≈ 1.5 KB each → < 30 MB for 20k. New npm dep: `@huggingface/transformers` (exact version pinned).
DeepSeek is called with Node's built-in `fetch` against its OpenAI-compatible `/chat/completions` — no SDK dependency.

---

## 3. Phase 0 — Data foundations (prerequisite, ~2 days)

| # | Task | Output | Acceptance |
|---|---|---|---|
| 0.1 | Fix ingest rejection `avg_pace_s_km invalid` (5 records re-rejected every archive session) | pace = null when distance ≈ 0 / non-run sport, record kept | `sync_runs` shows `rejected: 0` on next session |
| 0.2 | **Shoe per run**: after the Strava one-time connect (§0.3), backfill the Strava activity list (gear_id, start time) and join to COROS activities by start time ±3 min; seal `strava_token.json` | `activities.gear_id` filled | ≥ 90 % of 2026 runs have a shoe; unmatched listed; Strava token sealed at rest |
| 0.3 | **Weather per run** ✅ approved: Open-Meteo historical hourly (temp, dew point, humidity, wind, shortwave radiation) at run start + mid + end; compute WBGT estimate. Runs without GPS (treadmill) get `indoor` and no weather | `run_weather` table | all runs with GPS since 2025 have ≥ 1 hourly row. **Privacy:** coordinates rounded to 0.1° (≈ 11 km); no route sent; no key needed |
| 0.4 | **Minimal check-in** ✅ (see 0.4a) | kv → projected into `daily_log` | normal day = **1 tap**; median taps over 30 days ≤ 2 |

#### 0.4a Minimal check-in design (replaces today's 6-input form)

Today's form: pain 0–6, energy 1–5, muscle soreness 1–5, hydration 1–5, tibia checkbox (+ body map). New flow:

| When | What the athlete sees | Taps |
|---|---|---|
| **Every morning** | One row: **Feel 1–5** (one pill). Pain defaults to **0**; a small "ada nyeri" link opens the pain row | **1** |
| Only if "ada nyeri" | Site chips (VMO kiri · Achilles · telapak · tibia · lain) → score 1–6 per chosen site | +2 per site |
| **After a run ≥ 16 km or a race** (card on Home, skippable) | GI 0–3 · gels count · "minum cukup?" yes/no | +3, once |
| Strength type | **Not asked.** Inferred from the COROS strength activity + the plan tag (`Upper`/`Lower`…); asked only when the two disagree | 0 |
| Hydration / body map | Removed from the daily form; hydration moves to the post-long-run card, muscle load comes from logged strength | 0 |

Readiness impact (to document in `docs/readiness-model.md` when built): the 30-point musculoskeletal & subjective pillar
becomes **pain 15** (worst site; ≥ 2 caps the score at 44, as today) + **Feel 12** (single wellness item; Saw 2016 supports
subjective measures) + **muscular load 3** (from strength). Missing Feel = pillar scored from pain + load only, flagged, never imputed.
| 0.5 | Activity ↔ FIT mapping (labelId) and data-source audit: 102 COROS activities with HR before 5 Sep 2025 contradict KB `04.1` ("COROS only from Sep 2025") | `activities.fit_label_id`, note in `00.3` | source of pre-Sep-2025 HR confirmed or those rows flagged `hr_source=unknown` |
| 0.6 | Import the KB export (`Running_project_export.zip`, 36 docs) into a raw `kb_docs` table with frontmatter (doc-id, status, source-date, supersedes) | `kb_docs` | 36 rows; status parsed; SUPERSEDED/ARCHIVE flagged |

---

## 4. Module 1 — FIT dual-ingestion pipeline (`fit-to-memory`) (~3 days)

**One pass per FIT file produces (a) metrics into `intel.db` and (b) an episode card + vectors into `memory.db`.**
Idempotent on `(label_id, parser_version)`; bumping `parser_version` reprocesses everything (≈ 1–2 min for 456 files).

### 4.1 Per-second cleaning and segmentation (definitions copied from KB `04.9` §5D / `04.8` §2 so numbers match)

- **Stop** = speed < 0.3 m/s. **Moving** = elapsed − stop.
- **Run** = moving and cadence ≥ 125 spm. **Walk** = moving and cadence < 125.
- **Steady block** (baseline-grade) = 60 s blocks, minute 3–60, cadence ≥ 150, |grade| < 2.5 %, speed SD < 8 %, Δpace vs previous block < 8 %; HR read after the first 10 s (optical lag).
- Grade from altitude smoothed over 30 s; **GAP** via the Minetti cost curve `[calc]`; COROS `Effort Pace` stored separately `[ALGORITHMIC]`.
- HR artefact filter: drop seconds where |ΔHR| > 15 bpm/s or HR outside 60–(maxHR+5).

### 4.2 Session metrics (`fit_session`)

| Metric | Definition | Validity rule |
|---|---|---|
| Run / walk / stop seconds, **run share** | as above | always |
| **EF (run)** | run-phase speed (m/min) ÷ HR, excluding first 10 min | ≥ 10 min run phase |
| **Net EF** | all seconds incl. walk/stop | always |
| **Pa:HR drift** | (EF first half − EF second half) / EF first half × 100, on the steady portion after warm-up | only if ≥ 45 min steady, run share ≥ 90 %, pace CV < 8 %; else `null` + reason (no fake drift on intervals) |
| **Run-phase drift** | same, run seconds only | run-walk sessions ≥ 60 min |
| **HR@8:00** and **pace@HR≈150** | KB `04.8` method (blocks 7:40–8:20 / HR 146–154, slope −0.073 bpm per s/km) | ≥ 5 steady minutes in band |
| **Biomechanical fade** | last 25 % vs first 25 % of run phase (after warm-up): Δ GCT (ms), Δ stride (m), Δ vertical ratio (%), Δ vertical oscillation, Δ cadence, Δ (actual − Effort Pace) | run phase ≥ 30 min |
| **Fade onset km** | first km where 2-km rolling run share < 85 % **or** GCT > baseline + 15 ms **or** cadence < baseline − 5 spm (the `03.9` mechanical trigger) | long runs ≥ 16 km, races |
| Economy (J/m), beats/km, power/HR | KB `04.9` §5D definitions | run phase |
| Load | COROS TL, aerobic/anaerobic TE (from activity), time in zones (pace + HR, 6-band native COROS) | always |
| Conditions | weather join (§3 0.3), device temperature, elevation gain per km, start time WIB | always |

**Per-km table (`fit_km`)**: run/walk/stop s, pace, GAP, HR, power, cadence, GCT, stride, VR, EF, gain — feeds fade curves.

### 4.3 Anchoring to the athlete's baselines (`athlete_baseline`, versioned)

Each metric is reported raw **and** as a z-score vs (a) the validated baseline and (b) the trailing 90-day distribution.
Seed values (KB `04.8`, `00.2`): HR@8:00 **143.1 ± 5.0** (n = 26, Jan–Sep 2026); pace@HR150 **7:56**; cadence ≈ 170; GCT ≈ 300 ms;
LTHR 170; HRmax 189; threshold 5:50–5:56. Baselines are recomputed monthly with `valid_from/valid_to`, never overwritten.

### 4.4 Episode card (deterministic, no LLM)

Template-generated, ≤ 200 words, English with the KB's Indonesian terms kept where they are proper names. Contents:
date/time, plan phase + planned session vs executed, distance/duration/conditions (temp, WBGT, gain), run share,
EF + z, drift (or why invalid), fade metrics + onset km, HR@8:00 if available, morning readiness (HRV vs baseline, Sleep HR,
RHR, pain), shoe + its km, fuel log if any, flags fired (HR cap, mechanical trigger, pain ≥ 2), and 2–3 nearest similar
sessions (by fingerprint). Every number carries its evidence tag. Example skeleton:

```
[EPISODE run 2027-03-14 Sun 05:02 · Base W10 · planned LR 18 km @ E]
18.2 km 2:21:40 · 27.1 °C WBGT≈26 · +64 m · Clifton 10 (412 km)
Run share 100 % · EF 0.86 (z +0.9) · Pa:HR drift 4.1 % [valid] · GCT fade +9 ms, stride −0.02 m, onset none
Morning: HRV 84 (baseline 79) · Sleep HR 58 · pain 0/10 · readiness 78
Flags: none · Similar: 2027-02-28 LR 16 km (EF 0.83), 2026-08-22 LR 21.5 km (EF 0.84)
```

### 4.5 Two vectors

- **Fingerprint** (`session_vec`): ~16 z-scored features (distance, duration, pace/GAP, HR, EF, drift, run share, GCT/stride/VR fade,
  temp/WBGT, gain/km, TL, readiness, days-to-race bucket). Cosine kNN = "runs like this one".
- **Text** (`memory_vec`): e5 embedding of the card (`passage:` prefix), embedded by the nightly `embed` job.

### 4.6 Golden tests (regression against numbers the KB already validated)

| Fixture | Expected |
|---|---|
| Borobudur FM 15 Nov 2026, 0–35 km from start line | run 48.3 %, walk 48.4 %, stop 3.3 %, run pace 7:30, economy 77.7 J/m, EF 0.787, beats/km 1271 (± rounding) |
| Jakim FM 14 Jun 2026 (when its FIT lands) | run 62.7 %, EF 0.784, economy 77.6 J/m, stop 24:02 (0–35 km) |
| HR@8:00 baseline, 26 runs Jan–Sep 2026 | mean 143.1 ± 0.3, SD 5.0 |
| 10 Nov 2026 | HR@8:00 160.5 |
| km 1 of 9 Aug / 11 Aug / 1 Sep 2026 | HR 132 at 7:58–8:06 |

If a golden test fails, the pipeline or the KB number is wrong — either way the discrepancy is logged, not silently accepted.

---

## 5. Module 2 — `AthleteDigitalTwin` state engine (~2 days)

**Storage:** `twin_state(version INTEGER PK, as_of DATE, created_at, trigger, schema TEXT, inputs_hash TEXT, state JSON)`.
SQLite JSON functions give the JSONB-style querying the brief asked for. A new version is written only when `inputs_hash`
changes; daily snapshots kept 1 year, then weekly. `GET /api/twin?version=` and `/api/twin/diff?a=&b=`.

### 5.1 State schema `twin/1`

```jsonc
{
  "as_of": "2027-03-14",
  "load":       { "ctl": 0, "atl": 0, "tsb": 0, "acwr_uncoupled": 0, "monotony": 0, "ramp_7d": 0,
                  "weekly_km": [], "km_vs_4wk_avg_pct": 0, "long_run_vs_30d_max_pct": 0 },        // τ42/τ7 on COROS TL (existing shared/load.js)
  "readiness":  { "score": 0, "pillars": { "msk_subjective": 0, "autonomic": 0, "sleep": 0, "load": 0 },
                  "caps": ["sleep_hr_gt_67", "pain_ge_2"], "gate": "green|amber|red" },          // existing 4-pillar model, docs/readiness-model.md
  "aerobic":    { "hr_at_800": {"value":0,"z":0,"trend_28d":0}, "pace_at_hr150": {}, "ef_easy_28d": {}, "vdot_estimate": {} },
  "durability": { "durability_km": 0, "run_share_by_km": [], "fade_onset_km_median_90d": 0,
                  "longest_continuous_run_km_30d": 0, "gct_fade_ms_long_runs_90d": 0 },
  "heat":       { "hr_cost_bpm_per_c": {"value":0,"ci":[0,0],"n":0}, "ef_cost_per_c": {} },
  "shoes":      [ { "gear_id": "", "name": "", "km": 0, "role": "", "ef_residual_by_km_bin": [], "gct_residual_by_km_bin": [], "n": 0, "flag": null } ],
  "fade_curves":{ "by_distance": { "10k": {}, "hm": {}, "25_35": {}, "fm": {} }, "by_gain_per_km": {} },
  "races":      { "realization_ratio_last": 0.59, "ratio_history": [], "pacing_open_hr_excess_bpm": [] },
  "injury":     { "sites": { "vmo_l": {"last_pain":0,"days_pain_free":0}, "achilles": {}, "plantar": {}, "tibia": {} }, "durability_events_90d": 0 },
  "plan":       { "phase": "", "week": "", "next_cp": {}, "cp_results": [], "fitness_line_vdot": 0, "kill_gate": "ok|warn|triggered" },
  "projection": { "fm_time_p10_p50_p90": [], "p_sub4": 0, "assumptions": {} },                     // §7.5, labelled [MODEL]
  "data_gaps":  [ "shoe missing on 2 runs", "no temp for 2027-03-10" ]
}
```

Notes per component:
- **Shoe degradation**: EF and GCT residuals from a small linear model (pace/GAP, temp, duration, run share, readiness)
  binned by shoe mileage. Shown only with **n ≥ 8 runs per shoe and bin**, with CI; otherwise `flag: "insufficient data"`.
  No validated shoe lifespan exists (`analysis.js` already says so) — the twin reports *change*, not "replace now".
- **Fade curves**: run share and EF vs km for races and long runs ≥ 16 km, grouped by distance and gain/km;
  `durability_km` = km where the fitted run-share curve drops below 90 %. **This is the headline sub-4 KPI.**
- **Heat cost**: HR residual at matched pace vs WBGT (mixed model across runs), bpm per °C with CI.

---

## 6. Module 3 — `CorrelationEdge` job (~2 days)

### 6.1 Feature build (SQL, window functions, `intel.db`)

`daily_features(date, …)` materialised nightly; exposures computed with windows such as
`SUM(strength_lower) OVER (ORDER BY date ROWS BETWEEN 7 PRECEDING AND 4 PRECEDING)`.

| Exposures (per window 1–3, 4–7, 8–14, 15–28 d) | Outcomes (per qualifying run) |
|---|---|
| strength sessions by type (Lower / Upper / Full) and strength TL | GCT fade (ms) |
| threshold-zone minutes, quality sessions, double-day flag | Pa:HR drift (valid runs only) |
| long-run km, weekly km, km ramp vs 4-wk avg | EF residual (conditions-adjusted) |
| shoe mileage at the run (same day, no lag) | run share and fade onset km (long runs) |
| sleep min, Sleep HR, HRV deviation from baseline | HR@8:00 residual |
| WBGT (same day) — used as a **control**, also as exposure | next-day pain ≥ 1 (logistic, once pain data exists) |

### 6.2 Statistics (JS, after SQL)

1. Spearman ρ; **partial** ρ controlling for pace/GAP, WBGT, duration (rank residualisation).
2. **Block bootstrap** by ISO week (1,000 resamples) → 95 % CI; **circular-shift permutation** p-value (keeps autocorrelation).
3. Effective n from lag-1 autocorrelation; minimum **n_eff ≥ 20**.
4. **Benjamini–Hochberg FDR** across the whole run's test family; keep q < 0.10.
5. **Stability**: same sign and |ρ| ≥ 0.2 in both halves of the time range.
6. Single-day lag curves (1…28) computed for supported edges only — shown as exploration plots, never used for a decision.

### 6.3 Edge lifecycle

`candidate` (q < 0.10) → `supported` (q < 0.10, stable, |partial ρ| ≥ 0.3, n_eff ≥ 20) → `expired` if not reconfirmed in 90 days;
`rejected` if the sign flips. Edges are **associations**; the coach prompt must word them that way.
Planned-structure confounding (e.g. Lower days scheduled before easy days) is noted per edge.

### 6.4 Validation before trusting it

- Planted-effect simulation (known lag, ρ = 0.3, n = 120) → recovery rate ≥ 80 %.
- Shuffled-null runs → false-positive rate ≤ 10 % at q < 0.10.
- Runtime < 30 s for 2 years of data.

---

## 7. Sub-4 module set (added — §1 C8)

| # | Module | What it measures | Where |
|---|---|---|---|
| 7.1 | **Long-run scorecard** | per long run: run share, continuous km, EF last third vs first, drift, GCT fade, onset km, fuel g/h, fluids, GI, WBGT, pain | Activity detail + Twin `durability` |
| 7.2 | **Heat-cost model** | bpm/°C and EF/°C, updated monthly; race-day pace adjustment table | Twin `heat` |
| 7.3 | **CP / kill-gate dashboard** | each TT vs fitness line (green ≤ line − 0.5 VDOT, red > line − 1.5), two-reds rule from CP4, CP11 ratio < 0.85 | Checkpoints tab (extends existing) |
| 7.4 | **Load-safety guard** | weekly km ≤ +10 % vs 4-wk avg, LR ≤ 110 % of 30-d max, pain ≥ 2 freezes progression for 7 days | Home gate + Calendar |
| 7.5 | **P(sub-4) projection** `[MODEL]` | Monte Carlo: current VDOT estimate × realization ratio distribution (from fade curves) × heat cost at forecast WBGT × pacing-error prior → finish-time p10/p50/p90 and P(< 4:00) | Twin `projection`; shown with assumptions, never as a promise |
| 7.6 | **Race-week pack** | readiness trend, sleep, carb plan, opening-pace cap (MP + 10 s/km, HR ≤ ~160 for km 0–10), weather | Race tab |

---

## 8. Module 4 — Hybrid RAG context assembler + coach + write-back (~3 days)

### 8.1 Memory tiers (`memory.db`)

| Tier | Content | Source | Default status |
|---|---|---|---|
| **Episodic** | session cards, race cards, daily cards (readiness + notes), coach-run summaries | Module 1, check-in, coach | `active` (derived) |
| **Semantic** | facts with evidence: baselines, PBs, validated patterns, injury history, gear, KB facts | KB import (chunked by section), twin, athlete, LLM (as candidates) | KB ACTIVE → `active`; SUPERSEDED → `archived`; LLM → `candidate` |
| **Procedural** | rules: Sleep HR > 67 = no hard run; pain ≥ 2/10 = durability event; tibialis first; no new product on race day; ≥ 90 min food buffer; HR caps; opening-pace cap; load-safety guard | KB `03.3`, `03.7` §1, `05.1`, project rules, athlete | **locked** rules immutable; others editable only by the athlete |

Row: `id, tier, kind, title, body, payload JSON, evidence_tag, n, confidence, status, supersedes, valid_from, valid_to,
source, source_ref, created_by (system|kb|athlete|llm), hash`. FTS5 over title + body; vectors in `memory_vec`.

### 8.2 `retrieveRunnerContext(req)`

```ts
retrieveRunnerContext({
  intent: 'daily_brief' | 'session_review' | 'weekly_review' | 'race_plan' | 'question',
  question?: string, date: string, activityId?: string, tokenBudget?: number   // default 24k
}) => ContextPayload  // schema "context/1"
```

Steps:
1. **Pinned (always):** locked procedural rules, athlete profile summary, metric definitions, twin snapshot (current version),
   today's plan + gates, next CP, open data gaps.
2. **SQL filters** from intent/question: date window, sport, distance band, plan phase, WBGT band, shoe.
3. **Episodic retrieval:** numeric fingerprint kNN (when an activity is in focus) + FTS5 BM25 + text-vector cosine,
   fused with **Reciprocal Rank Fusion**; recency weight; **MMR** for diversity; top 5–8 cards.
4. **Semantic retrieval:** FTS5 + vector, `status = active` only, ordered `VALIDATED > MEASURED > CALCULATED > CLINICIAN > REPORTED > LITERATURE > HYPOTHESIS`.
5. **Correlation edges:** `supported` edges whose exposure or outcome appears in the question/session.
6. **Budgeting:** priority order pinned > twin > episodes > facts > edges > literature; drop from the bottom; every item keeps its `id`.
7. Return JSON plus a rendering split into a **stable block** (rules, profile, definitions → prompt-cached) and a **volatile block**.

### 8.3 Coach providers (v1.2: DeepSeek newest Flash default, Claude Code occasional)

One interface, `server/intel/llm.js`: `complete({ stable, volatile, schema, effort }) → { json, usage, model }`.
The context payload, output schema, validation and write-back are **identical** for every provider.

**A. DeepSeek (default, server-side)**
- **Model = newest Flash, resolved at runtime** (`DEEPSEEK_MODEL=auto-flash`): once a day (and on startup) the server reads
  `GET /models`, keeps models whose `name` contains `Flash`, parses the version from the name (`DeepSeek-V4.1-Flash` → 4.1) and
  picks the highest. Today that is **`deepseek-flash` = DeepSeek-V4.1-Flash** (1M context, 393k max output, effort `low/high/max`).
  The chosen id and name are cached in kv and written to every `coach_run`; a model change is shown in the UI.
  If `/models` fails, the last resolved id is used. Setting `DEEPSEEK_MODEL` to an explicit id pins it.
- Effort per intent: `low` daily brief, `high` session review / weekly review / race plan (`max` only for a race-plan rebuild).
- Call: built-in `fetch` → `https://api.deepseek.com/chat/completions` (OpenAI-compatible), key from `DEEPSEEK_API_KEY`.
- **Output contract** `{ summary, analysis_md, recommendations[], flags[], memory_writes[], cited_ids[] }`:
  request JSON mode, then **validate against the JSON schema in our code**; on failure, one repair retry with the
  validator's error message; on a second failure, store the text answer and **drop all memory writes**.
  (JSON mode guarantees valid JSON, not schema conformance — so validation never depends on the provider.)
- **Prefix caching:** DeepSeek caches repeated prompt prefixes automatically, so the stable block (rules, profile,
  definitions) is always sent first and byte-identical (sorted keys, no timestamps); cache hits read from the response `usage`.
- Limits: per-call `max_tokens`, request timeout 120 s, 2 retries on 429/5xx with backoff.
- **Monthly cap ¥15** (`DEEPSEEK_MONTHLY_CAP_CNY=15`), measured from the account itself, so no price table is needed:
  - before and after every call, read `GET /user/balance` (CNY `total_balance`) and store a snapshot;
  - **month spend = sum of every drop between consecutive snapshots** in the calendar month (WIB); rises (top-ups) are ignored;
  - token `usage` from each response is logged too, to show cost per brief/review once a few weeks of data exist;
  - **at 80 % (¥12)**: only the daily brief and athlete-asked questions run (scheduled session/weekly reviews pause);
    **at 100 % (¥15)**: all DeepSeek calls pause until the 1st of next month; the UI shows "coach paused" and analytics keep working;
  - a call is not started if the remaining cap is below the largest single-call cost seen this month;
  - balance on 17 Nov: ¥17.49 (cap is below the balance, so the cap, not the balance, is the limit).
- Scheduled use: **daily brief** after the morning sync (~08:00 WIB), **session review** when a run ≥ 16 km or a race lands,
  **weekly review** Sunday evening; ad-hoc questions from the UI.
- `deepseek-v4-pro` also exists; not used (athlete chose Flash, 17 Nov). Pinning `DEEPSEEK_MODEL=deepseek-v4-pro` would switch.

**B. Claude Code (occasional, local CLI — no API key)**
- `npm run coach:context -- --intent weekly_review [--date … --activity …]` prints the same `context/1` payload
  (stable + volatile) to stdout / a file under `server/data/tmp/` (mode 600).
- Claude Code reads it, answers in the same output contract, and writes `memory_writes` through
  `npm run coach:writeback -- <file.json>`, which runs the **same §8.4 hook** (no shortcut around validation).
- Use: second opinion on a weekly review, a race plan, or checking a DeepSeek conclusion. Each Claude Code run is logged
  in `coach_run` with `provider: "claude-code"`, so the two can be compared over time.
- The `/api/coach/context` + `/api/coach/writeback` bearer endpoints stay available for a Claude routine.

**Privacy:** with DeepSeek as the default, the context payload (readiness, runs, pain, injury notes) is sent to
DeepSeek's API on every coach call. Embeddings, weather and all analytics stay local (weather sends only rounded
coordinates). Payloads never include name, email, exact GPS or tokens; `coach_run` keeps a copy of what was sent.

### 8.4 Write-back hook

For each item in `memory_writes`:
1. JSON-schema valid; tier ∈ {episodic, semantic}; procedural writes are stored as **proposals** only.
2. Must cite ≥ 1 `id` from the context it was given.
3. **Numeric check:** every number must match a value in the cited items (±1 % or ±1 unit) or be marked `[CALCULATED]` with its inputs.
4. **Dedupe:** cosine ≥ 0.92 to an existing memory → increment `n` / append evidence, not a new row.
5. Insert as `candidate` + `HYPOTHESIS`; promote to `active` when n ≥ 3 or a matching `supported` edge exists, or when the athlete approves in the Memory review screen.
6. Everything logged in `coach_run` + `memory_audit`; any write can be retracted.
Locked rules and measured data are never modified by the LLM. Text inside tool/source data is treated as data, never as instructions.

---

## 9. API and UI additions

| Endpoint | Purpose |
|---|---|
| `GET /api/twin`, `/api/twin/diff` | current twin, version diff |
| `GET /api/intel/session/:id` | FIT metrics, per-km, card, similar runs |
| `GET /api/intel/longruns` | long-run scorecard list |
| `GET /api/intel/edges` | correlation edges (status filter) |
| `GET /api/memory?tier=&status=`, `POST /api/memory/:id/approve|retract` | memory review |
| `POST /api/coach/run`, `GET /api/coach/context`, `POST /api/coach/writeback` | coach (DeepSeek server-side, or pull for a routine) |
| CLI `npm run coach:context` / `coach:writeback` | Claude Code access on the VPS (§8.3 B) |

UI (mobile-first, existing tabs): **Home** gets the load-safety guard and P(sub-4) tile; **Activity** detail gets the
FIT panel + long-run scorecard; **Readiness** gets heat cost and twin pillars; **Checkpoints** gets the kill-gate view;
**Profil** gets Memory review, Edges and Twin history.

---

## 10. Phases, order and acceptance

| Phase | Scope | Est. | Done when |
|---|---|---|---|
| **P0** | Data foundations (§3) | 2 d | 0.1–0.6 acceptance met |
| **P1** | `fit-to-memory` metrics + per-km + cards + fingerprints (§4) | 3 d | golden tests pass on available FITs; backlog processed as files arrive |
| **P2** | Twin engine + shared libs move (§5) | 2 d | twin versions written after each projection; matches existing UI PMC/readiness numbers |
| **P3** | Memory store, KB import, e5 embeddings, FTS (§8.1) | 2–3 d | 36 docs chunked; retrieval eval (20 questions) top-5 recall ≥ 0.8 |
| **P4** | Correlation job + validation (§6) | 2 d | §6.4 checks pass |
| **P5** | Context assembler, DeepSeek provider, Claude Code CLI, write-back (§8.2–8.4) | 3 d | 10 sample briefs reviewed by the athlete; schema-valid rate ≥ 95 % after repair; 0 unverifiable numbers written back; same context gives comparable answers from DeepSeek and Claude Code on 3 test cases |
| **P6** | Sub-4 modules + UI (§7, §9) | 3 d | long-run scorecard, gates, P(sub-4) visible on phone |

Order: P0 → P1 → P2; P3 can run alongside P2; P4 after P0 + P1; P5 after P2 + P3 + P4; P6 incrementally.
**Target: P0–P2 before CP1 (Sat 16 Jan 2027)** so January's baseline is measured with the new pipeline.
Tests: `node --test` as today; fixtures from §4.6; no network in tests.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Multiple-comparison noise becomes "coaching" | §6.2 controls; edges labelled associations; coach must cite n, CI, q |
| LLM invents numbers or rules | structured output, numeric check, candidate status, locked rules, athlete approval |
| RAM pressure on 2 GB | child processes with heap caps, one job at a time, nightly windows, measured peaks in job progress |
| COROS FIT quota / anomaly notices | incremental pipeline; metrics fall back to laps when FIT missing (`source: laps`) |
| Optical wrist HR noise | pace/cadence/GCT/power first, HR second (KB doctrine); artefact filter; HR-based metrics carry wider CIs |
| Small n (1 completed FM) | fade curves use long runs ≥ 16 km too; projection reports wide intervals; no single-race rules |
| Privacy | embeddings + analytics local; weather coords rounded; DeepSeek receives the coach payload (athlete's choice) — minimised, no identifiers, every payload logged |
| LLM JSON drift (DeepSeek JSON mode ≠ schema-strict) | schema validation in our code, one repair retry, writes dropped on failure |
| API balance runs out / cap hit | ¥15 monthly cap from balance drops; 80 % → only daily brief + asked questions; 100 % → paused to month end; analytics keep working |
| "Newest Flash" changes behaviour silently | model id + name logged per call; UI notice on change; pin by setting `DEEPSEEK_MODEL` explicitly |
| Plan/KB drift (index synced 10 Nov) | KB re-import is idempotent by doc-id + source-date; SUPERSEDED docs never retrieved by default |

---

## 12. Decisions

| # | Decision | Answer (17 Nov 2026) |
|---|---|---|
| 1 | Coach mode | **Newest DeepSeek Flash** (today DeepSeek-V4.1-Flash, auto-resolved) for most use; **Claude Code** occasionally via CLI (§8.3) |
| 2 | Weather (Open-Meteo, coords rounded 0.1°) | **Yes** |
| 3 | Threshold features | **Generic threshold load** (no Norwegian double-threshold) |
| 4 | Check-in | **Minimise** → 1-tap design (§3 0.4a) |
| 5 | June double (Jakim 13 Jun + MJM 20 Jun 2027) | Still open — not part of this build, but the twin and load guard will plan around whatever is chosen |
| 6 | Monthly DeepSeek spend cap | **¥15 / month** (`DEEPSEEK_MONTHLY_CAP_CNY=15`), enforced from balance drops (§8.3 A) |

---

*Sources: `/opt/lumpad` code and data as of 17 Nov 2026; KB export `Running_project_export.zip` (docs 00.1, 00.4, 01.1, 03.7, 04.1, 04.8, 04.9, 05.1, 06.1, 06.2, 06.4 v4.4, 06.5 v4.4); `docs/readiness-model.md`.*
