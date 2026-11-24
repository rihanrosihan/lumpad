# Old Lumpad context-absorption blueprint

Status: **PLAN ONLY. Nothing has been imported, written, or changed in any Lumpad store.** Drafted 2026-11-24.
Discovery was read-only: the archive was unpacked once into a scratch directory outside the repo (`/var/tmp/old_lumpad_x`, removed after this audit), and every live SQLite file was opened with `mode=ro` (snapshots for schema reads). No Neo4j query was run and no credential file was opened.
Source: `/opt/lumpad/old_lumpad.zip` (36.4 MB zipped, 203.0 MB unpacked, 1,507 entries = 1,410 files + 84 directories + 13 `.pyc`).
Approach: **selective absorption**. About 0.1 MB of the archive is worth keeping as-is, 0.2 MB of text is worth transforming, and 99.9 % of the bytes are skipped (section 4).

---------------------------------------------------------------------------

## 0. Summary for the reader in a hurry

1. **The archive is the *sources* of the old system, not the system.** It has no PostgreSQL dump and no activity database. What it holds: curated Markdown (profile, race history, injury log, weekly logs, plans), athlete-written context notes, an old agent workspace (code, automations, logs, 9 graphify snapshots), and crawled third-party race-result databases. The old PostgreSQL "master DB" and its 1,573-node knowledge graph exist only as counts in `logs/coach.log`.
2. **Its content horizon is 2026-08-12.** The old pipeline stopped syncing then (its own "latest activity" views read 2026-08-11). Lumpad now covers to 2026-11-24 natively. Old context may only describe the past, and nothing in it can speak to Aug 12 → Nov 24.
3. **Most of the *numbers* are already in Lumpad; the *nuggets* are not.** The Nov 17 knowledge base (`04.1`, `04.2`, `03.x`) is clearly a successor of this archive: the Jakim stop map, race-week readiness, and canonical race ledger are already there. What the current system lacks is a set of specific qualitative items (section 5), mainly: per-run athlete-stated context for 2026-06-14 → 07-12, the 2025 trail-race DNF decision factors, the 2026-02 qualification test, the July 2026 shin-pain episode, physio/medical-visit context, a May 2026 supplement snapshot, and 15 empirical rules that should be *re-tested*, not trusted.
4. **The quantitative backbone is already live.** All 12 races named in the archive have FIT-backed sessions in `fit_session`, and 15 sessions exist between 2026-06-14 and 07-12. Old context therefore *attaches* to existing sessions and days; it does not need to create them.
5. **Three hazards need decisions before any ingestion** (section 10): real database credentials sit in 6 legacy scripts and 1 export bundle; 6 SQLite files hold ~86,400 third-party participant records with names (aggregate-only absorption, or skip); and the Go graph-sync **prunes any `Memory` node that is not active in the database**, so absorbed context cannot be stored under that label.
6. **Token budget is not the constraint.** Eligible source text is only ~80 k tokens. A thorough design (3-pass extraction, claim-level novelty judge, adversarial QA, golden-set recall test) costs **~16 M tokens nominal, ~42 M at the app's own measured worst-case per-call rate**, against 449.7 M remaining. Proposed hard ceiling: **30 M (6.7 %)**. More spend would not buy more quality (section 8).

---------------------------------------------------------------------------

## 1. Audit of the archive

### 1.1 What the archive is

| Area | Content | Notes |
|---|---|---|
| `athlete-profile/`, `races/race-history.md`, `health/`, `nutrition/`, `recovery/`, `performance-analysis/`, `training/` | Curated Markdown, written Jan–Aug 2026 in Bahasa Indonesia / English mix | The old "canonical domains". Values are dated; many say "current" in text that is now stale. |
| `training/context-enrichment/` (4 files) | Athlete-answered Q&A per run, 2026-06-14 → 07-12, with completeness scores | Highest-value qualitative asset. |
| `races/events/2026-jakim/analysis/bib-44708-…/` | Marathon deep-analysis package: README, athlete answers, H-7 → H+7 report, 15 small data tables, 1-second stream (24,859 rows), 10 m / 100 m bins | The tables are small and structured; the stream duplicates the FIT file already in `server/data/fit/2026/`. |
| `races/events/*/results/` | 6 crawled SQLite DBs + CSV copies (86,387 participants, ~461 k split rows incl. Jakim 2025/2026, Guardian Run 2025, Milo ACTIV 2025) | Third-party personal data. `jrf-2025-day1.sqlite` is **empty** (0 rows). |
| `obsidian/` | 16 auto-generated daily decision cards, 11 briefings, 15 plans, 6 weekly reviews, 2 LLM "Grand Master" assessments | Cards embed an athlete-written **post-run check-in**; 5 are filled in (2026-06-23 → 07-05) and 9 carry unanswered coach questions. Everything else is generated output. |
| `exports/` (4 files, 2.4 MB) | Concatenated bundles built **2026-11-24** from the sources above | Derived, redundant. One (`jakim-2026-race-context.md`) is a good readable summary → used only as an **answer key for QA** (section 7). |
| `graphify-out/` (1,169 files, 77 MB) | 9 dated snapshots of an automatic code/doc graph (latest: 7,907 nodes, 10,912 edges, 1,046 communities) | 4,853 of 7,907 nodes are *code*; 2,451 are documents; only 113 are concepts. A map of the retired workspace, not athlete knowledge. |
| `archive/deprecated/`, `automation/`, `coach.py`, `ask.sh`, `chat.sh` | Retired scripts, cron/systemd units | **Credentials present** (section 1.3). |
| `references/` | 14 agent-chat transcripts (151 KB) and a 453 KB Markdown copy of a third-party book | See skip rationale S6, S7. |
| `logs/coach.log` | 10,712 lines of old pipeline output | Operational only; useful once for lineage (old KG node counts). |

### 1.2 Timeline and coverage

```
Athlete's data in archive   Dec 2024 ─────────────────────────────────── 2026-08-12  (horizon)
Richest qualitative window                 Mar 2026 ──────────── Jul 2026
Garmin era (native)         2024-09 ────────────────── 2026-01
COROS era (native)                                      2026-01-14 ─────────────────────────────→ now
Current Lumpad KB (Nov 17)                                              Sep ───────────── Nov 24
```

* The archive's own device account (athlete profile): Garmin 265s from Sep 2024 to Jan 2026, COROS Apex 4 + Pod 2 + Magene H303 chest strap from 2026-01-14. This matches the user's note that Garmin history was imported into COROS in Jan 2026 and Garmin is primary before 2026.
* **Reconciliation item R1:** KB `04.1` says "COROS device only active from ~Sep 2025". The archive (and the Garmin-import decision) says 2026-01-14. The Garmin import already treats pre-2026 as Garmin-native; absorbed claims must use the same era rule and flag `04.1`'s sentence as a conflict candidate, not silently "correct" it.

### 1.3 Integrity, privacy and safety findings

| # | Finding | Handling |
|---|---|---|
| F1 | **Credentials.** A PostgreSQL connection string with an embedded password appears in 6 legacy scripts and 3 times in `exports/running-workspace-context.md`. The athlete's account e-mail appears in 2 files. | Those files are quarantined (never parsed, never sent to an LLM). **Recommend rotating that password if the old Postgres instance still exists.** |
| F2 | **Third-party personal data.** 6 SQLite DBs + 6 CSV pairs hold names, bibs, ranks and splits for ~86 k other runners. `Analisis_Cuaca_vs_BTN_JAKIM_2026.md` names a deceased participant. | Names are never read into any Lumpad store. Only anonymous aggregates (section 6.5) or nothing. The weather document is skipped. |
| F3 | **Other-workspace content.** `ai_conversation_history.md` mixes this athletic workspace with unrelated employer/media-planning and invoice conversations. | Skipped entirely; not athletic context and not the user's to ship to an LLM here. |
| F4 | **Sensitive health data** (lab values, body composition, clinician names, supplements, family context). | Class S2 (section 7.4): local only, redacted before any LLM call, coarse-only in Neo4j Aura. Body composition (31 weigh-ins 2025-12-30 → 2026-07-07), BP, glucose and labs are **already in the KV store** (`lumpad.bio`, `lumpad.mcu`), so re-importing them is redundant. |
| F5 | **Internal contradictions in the old docs.** Two incompatible HR-zone schemes (decision card: Z2 126–148 / "Z3 NEVER"; profile: COROS Z2 134–151). The Grand Master assessment (generated 2026-06-21) calls a "43.27 km marathon at 9:35/km"; the official result is 42.195 km, 6:53:03 net (9:47/km). Race-day AQI in the weather note is explicitly "typical range", not measured. | Official/ledger values win. Old zone systems and AQI are not absorbed as facts. |
| F6 | **Stale "current" statements.** Taper phase, load ratio, shoe mileage, supplement "still needed" lists, plans for JAKIM/JRF/Borobudur. | Never absorbed as current. Rewritten as past-tense snapshots with a `valid_to` equal to the source date, or skipped. |
| F7 | **Archive file hygiene.** `old_lumpad.zip` is root-owned, mode 644 (world-readable), and **untracked but not in `.gitignore`**; one `git add -A` would stage 36 MB of health, credential and third-party data. (Same hazard the Garmin blueprint found for `garmin_backup.zip`.) | Phase 0: `chmod 600`, `chown lumpad`, add to `.gitignore` (a one-line change; needs approval since it is code/config). |
| F8 | **Name conflict.** The archive's "Semarak 17 Agustus Trail, 2025-08-17, DNF, fall at km 8" is, by date and distance (8.36 km + 2.59 km split activity), the ledger's "Sentul Ultra 17K (DNF)". "Semarak" has 0 hits in KB or memory. | Absorb as an alias plus the decision-factor lessons; conflict candidate against the ledger name. |

### 1.4 Audit depth (what was and was not read)

| Depth | Items |
|---|---|
| **Read in full or near-full** | athlete profile, race history, injury log, medical note, nutrition protocol, benchmarks (head), decision card (head), Jakim README / answers / phase / splits / stops / weather tables, `exports/jakim-2026-race-context.md` (head + outline), 2 context-enrichment files (head), 1 Decision card per post-run-note pattern, `AGENTS.md` (head), `SYSTEM_OVERVIEW`, `README`, `WORKSPACE_MAP` |
| **Sampled (head / outline / structure queries)** | long-run DB, sleep-HRV DB, health metrics, taper protocol, Borobudur coach review, Grand Master assessment, weather note, weekly logs, `coach.log`, `ai_conversation_history.md` (request list only), graph JSON (type/relation counts, 60 concept labels) |
| **Counted only (schema + row counts, no content read)** | 6 result SQLite DBs, CSVs, `graphify-out/cache` (1,109 files, not extracted), legacy scripts (secret-pattern scan only, values masked), the 453 KB book, 2 diagrams |
| **Not touched** | Neo4j Aura (no query), `.env*`, `tokenomixai.env`, `Neo4j-*.txt`, live production tables (read-only schema/count queries on snapshots only) |

A full Phase-0 manifest (sha256 per entry) replaces this sampling with an exact record.

---------------------------------------------------------------------------

## 2. Current Lumpad ecosystem (read-only findings that shape the design)

| Store | Facts used here |
|---|---|
| `memory.db` | `memory`: 5,791 rows. tier ∈ episodic/semantic/procedural; status ∈ candidate/active/archived/retracted/proposal; `evidence_tag` vocabulary `VALIDATED, MEASURED, CALCULATED, CLINICIAN, KB, REPORTED, LITERATURE, HYPOTHESIS`; `hash UNIQUE`; partial unique index on `(source, source_ref)`; FTS5. Sources: `kb_extract` 4,316, `kb` 567, `coach` 530, `fit` 337, `garmin` 28 (all `archived`), `rules` 11. `memory_vec` is **empty** (no embeddings; retrieval = FTS5 + local TF-IDF + bilingual synonyms in `server/intel/recall.js`). Also `session_context` (4 rows, athlete-stated per-session notes), `coach_run` (549, of which 21 race post-mortems), `token_spend`. |
| `intel.db` | `fit_session` (337, 2024-09-10 → 2026-11-22), `daily_feat` (693), `athlete_baseline`, `twin_state` (60 versions), `twin_history` (Garmin-era weekly snapshots), `corr_edge`, `corr_explore`, `kb_docs` (36). |
| `lumpad.db` | `activities` (coros 459, garmin 134, strava 9), `activity_enrichment` (329 Garmin rows), `health_daily`, `health_daily_garmin`, `health_merged` view. |
| `plan.db` | Active plan engine (sessions, versions, adjustments, benchmarks). **Must never be touched.** `plan_goal` is empty. |
| Neo4j Aura | Go engine labels incl. Session, Day, Race, Km, Lap, Checkpoint, PainSite, Rule, Memory, Document, Topic, HeatBand, PerfPoint. The sync **deletes** `Memory`/`Rule` nodes not active in SQL, `{src:'kbx'}` nodes on every sync, and rebuilds PerfPoint/Km/Lap/PlanDay. The Garmin import avoided this by writing node-side with an `era` tag on existing labels and a delete-by-era rollback. |
| KB (`server/data/kb/Running_project_export`, 36 docs) | Canonical race ledger `04.1` states "if a race number in another doc differs, this doc wins". `04.2` already contains the Jakim stop map, readiness warnings, BMKG heat reconstruction and Digital Twin rules. |
| LLM | One provider configured: `tokenomix`, model `deepseek-v4.1-flash-1017-mod`; `deepseek-v4-pro` also reachable (10 calls on 2026-11-23). Redaction (`prompt.js redact`) strips name, employer, e-mail, URL, secrets before any call. Quota gate: bulk jobs stop at `critical` (≤ 2 % left or expired); `low` at ≤ 10 % or ≤ 7 days. Existing bulk machinery in `server/intel/bulk.js`: chunked `extract` (verbatim-quote check, `candidate`/`proposal` only, resumable progress file, optional second model for agreement) and pairwise `consistency`. |
| Host | 2 vCPU, 1.9 GB RAM (~1.0 GB available, 874 MB swap in use), 24 GB free disk. Nightly job 01:30–05:00 WIB; no heavy work 07–09 WIB. |
| Precedent | The Garmin import (`docs/garmin-ingestion-blueprint.md`, `server/garmin/`) set the pattern: raw vault + staging DB, era-tagged derived layers, `archived` memories, node-side graph writes, rollback helpers, fence checks. This plan reuses it. |

### 2.1 Isolation hazards specific to this import

| # | Hazard | Consequence if ignored | Design response |
|---|---|---|---|
| H1 | Retrieval reads `status='active'` memories (Go `retrieve.go`, Node `context.js`). | Absorbed `active` rows would flood "current" coaching with May-2026 facts. | Nothing is written `active`. History reaches the coach only through a separate, labelled **history lane** (6.4). |
| H2 | Go graph-sync prunes `Memory`/`Rule` nodes absent from SQL, wipes `src:'kbx'`, **and (found during implementation) globally deletes and rebuilds every `ABOUT`, `PRECEDED`, `CONTRADICTS`, `RELATED_TO`, `SIMILAR_TO`, `IN_BAND`, `COMPARED_TO` relationship and every `Km`/`Lap`/`WeatherHour` node.** | Absorbed graph nodes vanish at the next sync, or worse, a root-run sync deletes them silently (existing memory note: graph-sync must run as the `lumpad` user). | New labels `Episode`, `Stop`, `ChipSplit` with new relationship types `DESCRIBES`, `NEXT_EPISODE`, `HAS_STOP`, `STOP_IN`, `HAS_CHIP_SPLIT`, `CONFLICTS_WITH`, `REFINES_MEMORY` (none touched by any sync delete), `era:'old_lumpad'` + `src:'olx'`, written node-side; `km_index` is a property, never an edge to `Km`. A unit test fails if the writer ever uses a relationship type the sync deletes. |
| H3 | Twin, baselines, `daily_feat`, `corr_edge` are rebuilt nightly from `fit_session`/health. | Any write to these tables is overwritten or contaminates current benchmarks. | Old context never writes there. The Digital Twin benefits only via **hypothesis seeds** re-tested on native data (6.6). |
| H4 | `athlete_baseline` has a single open row; `twin_state` versions are append-only. | An old "LTHR / HRmax / zones" claim could be mistaken for a baseline. | Zones/thresholds/targets in the old docs are Skip (S12) or stored only as dated snapshots. |
| H5 | `memory.hash UNIQUE` + `(source, source_ref)` unique index. | Re-runs create duplicates or collide. | Idempotent `source_ref = old:<doc>#<claim_hash>`; hash includes the source date. |
| H6 | Old docs describe plans (JAKIM 5:30, JRF HM 3:30, Borobudur Runna) that no longer apply. | A reader (human or LLM) treats an obsolete target as live. | Plans are Skip, or stored as `COMPLETED`/`SUPERSEDED` historical plan versions with `valid_to`. |
| H7 | Lexical redundancy with the KB (section 3). | Duplicate claims inflate retrieval and double-count evidence. | Five-layer dedup (7.2) before anything is promoted. |
| H8 | Neo4j Aura is a cloud service. | Health or family detail leaves the server. | Sensitivity classes (7.4): S2 episodes are coarse (site, dates, severity) with no clinician, family or lab detail. |

---------------------------------------------------------------------------

## 3. How much of the archive is already in Lumpad (evidence, not assumption)

Method: for each candidate file, the share of its distinct numbers and distinct long words that also occur in the KB (36 docs) plus all `memory` rows. This is a **lexical upper bound** on overlap (a shared number such as 168 may be coincidence; a paraphrase may hide a shared fact). Claim-level judgement is the job of the LLM novelty stage (section 8), not this table.

| Group | Distinct numbers found in KB/memory | Reading |
|---|---:|---|
| Injury log, medical note, taper protocol, benchmarks, training system, Jakim answers (`context_enrichment_answers.md`) | 100 % | Fully reflected. Mine only for tiny residue. |
| Race history, athlete profile, Jakim H-7 → H+7, performance analytics, long-run DB | 87–94 % | Mostly present; nuggets remain (section 5). |
| Per-run enrichment (Jun 14 → Jul 7), Jakim README, strength/cross-training, trail-touring note | 57–76 % | Meaningful new content. |
| Old agent chat, AI OS plan, Norwegian book | 50–77 % (words), irrelevant | Skipped for other reasons. |

Targeted probes of facts that matter (counts in KB files / memory rows):

| Probe | KB | memory | Verdict |
|---|---:|---:|---|
| "Semarak" (2025 trail DNF) | 0 | 0 | **Absent** |
| Cash / emergency-alert DNF factors | 0 / 0 | 0 / 3 (unrelated) | **Absent** |
| "Le Minerale" qualification (Feb 2026) | 0 | 0 | **Absent** (Balke test mentioned once in KB) |
| Beta-alanine, melatonin, citrulline | 0 | 0 | **Absent** (supplement snapshot) |
| Physio clinic visit (May 15 2026) | 0 | 0 | **Absent** |
| "Gunung Pancar" trail day (Jul 11 2026) | 0 | 0 | **Absent** |
| Total Combat Run, Made in Indonesia, Milo, JRF 2025, UI Trail, Run to Iftar | ≥ 1 | ≥ 1 | Present in the ledger |
| Plantar episode, dry needling, sports-medicine consult | 3 / 3 / 2 | many | Present; check refinements only |
| Sleep-HR → HRV rules | 21 files | 342 rows | Present; treat the old n=5 claim as a hypothesis |

---------------------------------------------------------------------------

## 4. Classification matrix: Keep / Transform / Skip

Definitions. **KEEP**: absorb nearly as written, after claim-level dedup. **TRANSFORM**: reshape into a different structure (event, aggregate, hypothesis seed, dated snapshot) before absorbing. **SKIP**: not absorbed. Skipped bytes stay only in the original zip (the "vault"); nothing is extracted wholesale in the future either.
File and size figures come from a rule-based pass over the zip manifest (every entry classified, 0 unclassified). Token figures are chars ÷ 3.6, a mixed Indonesian/English estimate.

### 4.1 Totals

| Decision | Files | Size | Est. tokens (text) |
|---|---:|---:|---:|
| KEEP | 11 | 0.10 MB | ~28 k |
| TRANSFORM (text) | 36 | 0.17 MB | ~52 k |
| TRANSFORM (6 SQLite result DBs, aggregate-only, no LLM) | 6 | 57.24 MB | n/a |
| SKIP | 1,357 | 145.16 MB | n/a |
| **LLM-eligible source text** | **47** | **~0.27 MB** | **~80 k** |

### 4.2 KEEP

| ID | Source | Files / MB | Why keep | Target |
|---|---|---:|---|---|
| K1 | `training/context-enrichment/*` (2026-06-14 → 07-12 run context, completeness scores, trail-touring note, question bank) | 4 / 0.03 | Athlete-stated intent, pain, pauses, shoe/insole response, companion, sensors per run; explains data that look like "failed runs" (family runs, tempo failures, waterfall day). Cannot be reconstructed from device data. | `session_context` rows (kind `old_lumpad`), episodic memory (archived, `REPORTED`), `Episode` nodes |
| K2 | Jakim `context_enrichment_answers.*` and `full-context-hminus7-to-hplus7.md` | 3 / 0.04 | The most deeply annotated race in the data. KB `04.2` already holds the stop map and readiness; remaining value: fuelling/hydration detail (7 gels, BCAA substitution), mental model, H+1 → H+7 recovery, athlete-stated future rules (hot-race max HR, heat-index rule, pain tolerance), and open questions. | Claim-level only (dedup against `04.2`); race reflection `Episode`; open items |
| K3 | `health/injuries/injury-log.md`, `health/medical-consultations/*` | 3 / 0.01 | Injury/recovery history is core to the Digital Twin: the 2025-08 trail fall, GI illness vs pace (JRF 2025), Mar 2026 and Apr 2026 overreach crash sequences with recovery lengths, plantar episode (May–Jun 2026), suspected shin-pain episode (Jul 2026), return-to-run gate, vulnerability factors. | Episodic + semantic memory (archived/candidate), `Episode` + existing `PainSite` links, coarse only in Neo4j |
| K4 | `races/race-history.md` | 1 / 0.01 | Per-race reflections (pacing errors, GI, heat, walk time) for the 2024–2026 races. Ledger `04.1` stays canonical for numbers; keep the **qualitative lessons** and the races missing from the ledger. | Race reflection `Episode`, lessons (candidate), alias map |

### 4.3 TRANSFORM

| ID | Source | Files / MB | Transformation | Target |
|---|---|---:|---|---|
| T1 | `athlete-profile/athlete-profile.md` | 1 / 0.02 | Split. Keep: **device/era timeline**, wrist-vs-pod/strap accuracy notes, 15 empirical rules (as `HYPOTHESIS` seeds with their stated n), supplement stack as a **dated May-2026 snapshot** (`valid_to` fixed). Drop: zones, targets, "current phase", shoe mileage (Strava gear is the SSOT), decision matrix (superseded by safety gates), identity/PII. | Hypothesis candidates → `corr_explore` seeds; device-era memory; snapshot memory |
| T2 | Jakim derived tables: stops (35 inferred + 11 labelled), official chip splits (15), checkpoints vs watch (15), weather timeline (10), phase segments (9), reconciliation JSON, README | 9 / 0.04 | Parse deterministically (no LLM) into structured events, join to the existing Jakim `Session`/`Checkpoint` by `label_id`. | `oldlumpad_event` rows; graph `Episode`/`Stop` facts only if not already in the KB-derived graph |
| T3 | `performance-analysis/benchmarks.md`, `datasets/long-run-database.md`, `reports/performance-analytics.md` | 3 / 0.03 | Raw pace/HR series are recomputed from FIT, so drop them. Keep **per-long-run fuelling/context columns**, shoe-fit observations, and the temperature-sensitivity statements (stated: ~6–10 s/km per °C; 7:27 in rain vs 8:24 at the same HR) as hypotheses to re-test. | Fuelling-history events; hypothesis seeds |
| T4 | `nutrition/nutrition-fueling.md`, `recovery/protocols/taper-protocol.md`, `recovery/metrics/sleep-hrv-data.md`, Jakim race plan | 4 / 0.04 | Stored as **dated protocol versions** ("JAKIM-2026 plan", valid to 2026-06-14) for plan-vs-actual comparison and later-protocol lineage. Sleep/HRV raw nights are redundant (COROS-native since 01-14; 113 sleep-log entries in KV); keep the stated relationships as hypothesis seeds. | `plan`-kind memory (archived, SUPERSEDED), hypothesis seeds |
| T5 | `training/methodology/*`, `training/cross-training.md`, `training/strength/strength-training.md` | 3 / 0.03 | Domain logic. Likely mostly redundant with KB `02.x`; run only through the dedup judge and keep what is new as **procedural proposals** (never active, never locked). | `proposal` memory |
| T6 | `obsidian/Decisions/*` (16 cards) | 16 / 0.03 | Discard the generated gate tables. Extract only the **athlete-written check-in notes** (5 filled cards: fatigue/soreness/stress/pain scores plus notes) and the coach's open questions (as a reminder of what was never answered). | `session_context` (scores + notes), open items |
| T7 | `races/events/*/results/*.sqlite` (6 DBs) | 6 / 57.24 | **Aggregate-only, deterministic SQL, zero LLM tokens, no names.** Per event: finish-time distribution, pace-decay curve by finish-time band, DNF/COT rate by checkpoint, and the athlete's own percentile. Optional (decision D7). | `oldlumpad_field_stat` table; optional `FieldBand` nodes |

### 4.4 SKIP

| ID | Source | Files / MB | Rationale |
|---|---|---:|---|
| S1 | Jakim analysis `data/*` not in T2 (1-second stream, 10 m / 100 m bins, laps), build script, question bank, duplicate full-context | 9 / 3.90 | Re-derivable from `fit/2026/478193614051115313.fit`; Lumpad already stores per-km splits for that session. |
| S2 | `races/events/*/results/*.csv`, crawler scripts | 37 / 55.78 | CSV duplicates of the SQLite DBs plus crawlers. Third-party data. |
| S3 | `exports/*` (4 bundles) | 4 / 2.36 | Derived concatenations built from the same sources; contain a database credential and an e-mail address. One is kept **out of the pipeline** as the QA answer key. |
| S4 | `graphify-out/*` (9 snapshots, caches, reports) | 1,169 / 77.42 | 61 % code nodes; a structural map of a retired workspace. Concept labels (113) only repeat entities Lumpad already models. Not imported. |
| S5 | `archive/deprecated/`, `automation/`, `coach.py`, `ask.sh`, `chat.sh`, `test_llm.py`, `__pycache__` | 38 / 0.33 | Obsolete code and ops; **contains credentials**. Superseded by the Go/Node stack and the Garmin pipeline. |
| S6 | `references/ai_conversation_history.md` | 1 / 0.15 | Agent-development chat, partly unrelated employer content (F3). |
| S7 | `references/norwegian-method/*` | 2 / 0.76 | Third-party published book. Lumpad's own doctrine is in KB `02.x`. Not re-hosted in the RAG corpus. |
| S8 | `logs/coach.log` | 1 / 0.42 | Operational output. One lineage fact extracted by hand (old KG had 1,573 nodes). |
| S9 | `obsidian/Briefings`, `Plans`, `Reviews`, `performance-analysis` (Grand Master ×2) | 32 / 0.07 | LLM-written narrative or generated plans over data Lumpad holds natively; Grand Master numbers pre-date the race analysis and contain errors (F5). |
| S10 | `training/logs/*` (weekly logs wk 20–26, 2026 report in md/typ/pdf/png), `training/plans/*` (Borobudur Runna plan review, PDF), `training/strength/programs/*` | 25 / 2.45 | Renderings of COROS data Lumpad has natively; the Borobudur plan assumed a Nov 1 race that was superseded (`03.9`); strength programs are superseded by KB `02.3`/`06.1`. A cheap regex pass will still pull any athlete-written notes. |
| S11 | `races/events/2026-jrf/*`, `2025-jrf/*`, `2026-jakim/plans/*`, weather note, Jakim README, empty `borobudur` dir | 7 / 0.08 | Plans that were executed or superseded (`03.1`, `03.9`); weather already reconstructed in KB `04.2 §4`. The Jakim plan is covered by T4. |
| S12 | `decision-card.md`, `health-metrics.md`, READMEs | 4 / 0.02 | Decision card: stale and internally inconsistent zones. Health metrics: data duplicated in KV `lumpad.bio`/`lumpad.mcu`; sensitive. |
| S13 | Architecture docs: `AI_COACHING_OS_PLAN.md`, `file-index.md`, `docs/retrieval-policy.md`, `AGENTS.md`, README family, diagrams, templates | 28 / 1.42 | Describes the retired system. The ideas it planned (query classes, local-first routing, KG-for-"why") are already implemented in `query.js`, `recall.js`, `DESIGN.md`. |

---------------------------------------------------------------------------

## 5. The valuable context, in detail (what will actually be absorbed)

Every row is a **candidate**; the claim-level judge (section 8, stage B) decides which survive as new, refinements, duplicates or conflicts.

### 5.1 Past race context

| Item | What is new relative to Lumpad | Where it attaches |
|---|---|---|
| 11 races Dec 2024 → Feb 2026 with per-race reflections: first-ever race (29:54 of walking), first half-marathon (untested gel → nausea at km 9, start 40 s/km too fast), JRF HM 2025 (**GI illness began H-3**, not pace-induced; lesson: DNS if GI symptoms at H-2), TOTALCOMBAT and Milo 2025 (same pacing error: km-2 sprint at HR ~180 → km-6 collapse), UI Trail, Milo year-on-year (−17:01) | Causal framing and lessons; the ledger holds results, not reflections | `Race`/`Session` by date match (all 12 have FIT sessions); `Episode(kind=race_reflection)` |
| **2025-08-17 trail fall / DNF** — three decision factors (activity split after the fall, wish to reassure family after the watch's auto emergency alert, no cash for water on the mountain) plus gear lessons | Absent in KB and memory (F8) | `Episode(kind=race_reflection)`, alias `Semarak ↔ Sentul Ultra 17K` |
| **2026-02-08 qualification test** (strength test + 15-min Balke, 2.81 km; lowest ground-contact time in the whole dataset on lap 1) | Absent | Session reflection |
| Race-day empirical patterns (race HR 5–10 bpm above training; sleep > 7 h before race improves outcome; 2-h pre-race routine for 04:00 starts; sprint starts always blow up) | Stated patterns, n small | Hypothesis seeds |
| Jakim 2026: fuelling/hydration detail, stated mental model, recovery H+1 → H+7, athlete-stated rules (hot-race max HR 170–175, heat-index > 33 → finish-first, marathon pain tolerance), open questions never answered | Partly in `04.2`; the residue is judged claim by claim | Race reflection, open items |

### 5.2 Long-term training and physiological response patterns

* **Overreach → crash sequence, 3 confirmed events** (Mar 2026, Apr 2026) and a counter-example showing the protective factor is pre-run HRV status, not session load. Stated recovery lengths 5–9 days. Present in spirit in KB; the *event-level evidence and counter-example* are the residue.
* **15 empirical rules** from 103–121 nights (e.g. sleep-HR → next-day HRV; bedtime → HRV; temperature as the dominant Z2 factor; GCT range as neuromuscular signal). Stored as `HYPOTHESIS`, and used only to **seed** the correlation engine on COROS-native data (6.6). The old n values (often 3–5) are below the engine's own thresholds, so they cannot be trusted as written.
* Temperature penalty, sodium-gap → drift, shoe/pace compatibility notes (plate shoes at slow pace), cadence-for-plantar-load. Same treatment.

### 5.3 Injury and recovery history

* Plantar (left medial arch) episode May–Jun 2026: onset in long-run terms (65–70 % of distance), return-to-run gate cleared 2026-05-19, flare 2026-05-27 under extra load, professional treatment (physio 2026-05-15, sports-medicine physician 2026-06-16, with the lesson not to receive needling right before prolonged standing).
* Suspected shin-pain (MTSS-type) episode, 2026-07-09 → 07-12 (not diagnosed; focal tenderness 1/10 after a trail day). Relevant as a **recurrence signal**; to be linked to later lower-leg notes in KB only after a manual check (dates must not be conflated).
* Earlier episodes: 2025-08 fall, 2025 GI illness, Mar and Apr 2026 overreach. Return-to-run protocol and vulnerability factors.
* Stored coarse for Neo4j (site, dates, severity); clinician and clinic names are kept only in the local staging record, and are replaced by role words ("physiotherapist", "sports-medicine physician") in any LLM payload.

### 5.4 Per-run context, 2026-06-14 → 07-12 (K1, T6)

14 scored run entries (2026-06-14 → 07-08) plus the 07-11 trail day, with athlete-provided intent and circumstance: family runs (stroller, child pacing), a tempo set that was not completed and why, treadmill sessions, social runs, the 07-08 double, and the 2026-07-11 trail day (~9.0 km trail, ~+865 m, chest strap battery died, waterfall and motorbike segments recorded separately). These explain historical sessions that look like under-performance and should be **pre-attached** to the 15 existing `fit_session` rows in that window; the athlete-written check-ins from Jun 23 → Jul 5 add fatigue/soreness/stress/pain scores.

### 5.5 Fuelling and supplements

Per-long-run fuelling columns, the JAKIM-2026 race-day protocol (pre-race, per-km sodium schedule) and what was actually done, versus later races. The May-2026 supplement stack is stored as a **dated snapshot (S2, local only)**. It is not current, and `05.1` is the authority for what is current.

### 5.6 Domain logic still relevant

Return-to-run gate; "GI at H-2 → DNS"; "start ≤ 05:15 for > 15 km outdoor"; sodium schedule logic; taper structure and its stated rationale; crash-sequence recognition. Each becomes a **procedural `proposal`** only if the judge finds it not already covered by a locked rule or KB doctrine.

### 5.7 Field context (optional, deterministic)

From the Jakim 2026 day-2 marathon DB (7,579 marathon entrants: 6,992 finished, 459 DNF, 64 DQ, 56 cut-off, 8 DNS) and three 2025 events: finish-time distribution, pace-decay by finish band, checkpoint attrition. The athlete's own rank is already recorded in KB `04.2`. This supports "was this race hard for everybody?" questions and COT-pattern work (KB `04.3` did n=100 for JRF only).

---------------------------------------------------------------------------

## 6. Target schema and AI-layer mapping

Principle (same as Garmin): **immutable source → typed staging → claim ledger → era-tagged projections → derived layers, each re-runnable with no network calls.** Constants: `OLD_SOURCE='old_lumpad'`, `OLD_ERA='old_lumpad'`, `OLD_HORIZON='2026-08-12'`, `batch_id='olx-<yyyymmdd>-<n>'`.

```
old_lumpad.zip (36 MB, read-only, chmod 600, never extracted wholesale)
   │ Phase 0  manifest + sha256, extract ONLY K/T files (~0.3 MB) to a 0700 dir
   ▼
server/data/oldlumpad.db (NEW, mode 600, gitignored by `server/data`)
   │ Phase 1  deterministic parse → ol_doc / ol_event / ol_field_stat
   │ Phase 2  LLM claim extraction → ol_claim (verbatim quote, resumable)
   │ Phase 3  dedup / novelty / conflict verdicts on ol_claim
   │ Phase 4  QA gate
   ▼ Phase 5  promotion (approved batches only)
memory.db (archived/candidate/proposal)   lumpad.db session_context   Neo4j Episode nodes
   │ Phase 6–7  history lane in coach context; hypothesis seeds → corr_explore
```

### 6.1 Staging DB `server/data/oldlumpad.db`

```sql
CREATE TABLE ol_manifest (entry TEXT PRIMARY KEY, bytes INT, sha256 TEXT, decision TEXT,   -- keep|transform|skip
  rule_id TEXT, archive_sha256 TEXT, sensitivity TEXT);                                     -- S0..S4
CREATE TABLE ol_doc (doc_id TEXT PRIMARY KEY, entry TEXT, doc_date TEXT, horizon_ok INT, lang TEXT, body TEXT, sha256 TEXT);
CREATE TABLE ol_chunk (chunk_id TEXT PRIMARY KEY, doc_id TEXT, idx INT, char_from INT, char_to INT, sha256 TEXT);
CREATE TABLE ol_claim (
  claim_id TEXT PRIMARY KEY,          -- sha256(doc_id|normalised quote)[:24]
  doc_id TEXT, chunk_id TEXT, quote TEXT NOT NULL, text TEXT NOT NULL,          -- quote verbatim, text normalised
  kind TEXT,                          -- fact|lesson|rule|hypothesis|constraint|episode|decision|conflict
  event_date TEXT, valid_from TEXT, valid_to TEXT,                              -- always bounded; valid_to <= OLD_HORIZON
  subject_key TEXT,                   -- race_key=date+dist | injury_key=site+onset | run_key=date+label | topic
  sensitivity TEXT,                   -- S0..S2
  models TEXT, confidence REAL,       -- model ids that produced it; agreement raises confidence
  novelty TEXT,                       -- new|refines|duplicate|contradicts|stale|unjudged
  matched_memory_id INT, judge_note TEXT,
  qa_status TEXT,                     -- pending|pass|fail|needs_human
  target TEXT, promoted_memory_id INT, batch_id TEXT);
CREATE TABLE ol_event (event_id TEXT PRIMARY KEY, kind TEXT, event_date TEXT, label_id TEXT, payload TEXT, doc_id TEXT, batch_id TEXT);
CREATE TABLE ol_field_stat (event TEXT, scope TEXT, band TEXT, metric TEXT, value REAL, n INT, PRIMARY KEY (event, scope, band, metric)); -- no names, no bibs
CREATE TABLE ol_run (batch_id TEXT PRIMARY KEY, phase TEXT, started_at TEXT, finished_at TEXT, tokens_in INT, tokens_out INT, notes TEXT);
```

### 6.2 `memory.db` (additive rows only; no schema change)

| Claim class | tier / kind | status | evidence_tag | valid window |
|---|---|---|---|---|
| Dated event or reflection ("JRF 2025 diarrhea began H-3") | episodic / `old_reflection` | **`archived`** | `REPORTED` (athlete) or `MEASURED` (device-backed) | `valid_from = valid_to = event date` |
| Injury / illness episode | episodic / `old_episode` | `archived` | `CLINICIAN` where a clinician note exists, else `REPORTED` | episode span |
| Lesson or pattern that survived the judge | semantic / `lesson` | `candidate` | `REPORTED` | event date |
| Empirical rule from the old profile | semantic / `hypothesis` | `candidate` | `HYPOTHESIS` | `valid_to = 2026-05-27` (doc date) |
| Reusable protocol or doctrine not already covered | procedural / `rule` | **`proposal`** | `HYPOTHESIS` | n/a |
| Protocol version (fuelling, taper, supplement snapshot) | semantic / `plan` | `archived` | `REPORTED` | bounded by the event it served |

* `source='old_lumpad'`, `source_ref='old:<doc_id>#<claim_id>'` (the existing partial unique index makes every promotion idempotent), `created_by='old_lumpad_import'`, `payload` carries `{era, doc, quote, batch_id, models, novelty, matched_memory_id, sensitivity}`.
* `locked` is never set; `supersedes` is never set automatically.
* **Nothing is written `active`.** A person promotes a reviewed batch to `candidate` → `active` through the existing Studio flow, one batch at a time.

### 6.3 `lumpad.db` and the live pipeline (what is deliberately *not* touched)

* **Written:** `session_context` rows for K1/T6 per-session notes (purpose, note, `intentional_walking`, `run_km`/`walk_km`, `kind='old_lumpad'`), `counts_for_fitness` left at its default so historical fitness math is not reinterpreted without review. These are date-keyed to Jun 14 → Jul 12 2026, so they cannot influence current windows.
* **Never written:** `activities`, `activity_enrichment`, `health_daily*`, `fit_session`, `daily_feat`, `athlete_baseline`, `twin_state`, `twin_history`, everything in `plan.db`, KB documents, `kv.json`, locked/active memories, `.env*`.

### 6.4 GraphRAG: a separate, labelled history lane

* Retrieval stays as is for current intents. A new **history lane** (Node `context.js` + Go `retrieve.go`) activates only when the question or time frame is historical (`timeframe.js` already classifies `past`), or when the athlete asks about a named past race, injury or period.
* Lane contents: `archived` `old_lumpad` memories matched by date window, entity key (race, injury site, shoe) and the existing bilingual TF-IDF recall. Each item is rendered as `[HISTORICAL · old_lumpad · <date> · REPORTED] …` and capped (default 6 items, 1.2 k tokens) so the prompt cost stays flat.
* Hard rule in the system prompt and eval suite: a historical item is context, never a source for current thresholds, targets, zones or plans. New eval scenarios (section 9, Phase 7) assert the coach does **not** cite a May-2026 target or taper as current.

### 6.5 Knowledge Graph (Neo4j Aura, node-side writer like `server/garmin/graph.js`)

* New label **`Episode`** `{id, kind: race_reflection|injury|illness|overreach|run_context|checkin|lesson|hypothesis, date_from, date_to, title, summary (S0/S1 only), memory_id, era:'old_lumpad', src:'olx', batch_id}`, plus `Stop` (Jakim labelled stops, with `km_index`, class, duration) and `ChipSplit` (official timing-mat splits with watch-minus-official seconds). Never `Memory`, `Rule`, or any `{src:'kbx'}` node (H2).
* Edges use relationship types the Go sync never deletes: `(Episode)-[:DESCRIBES]->(Race|Session|Day)`, `(Episode)-[:NEXT_EPISODE]->(Episode)`, `(Session)-[:HAS_STOP]->(Stop)`, `(Stop)-[:STOP_IN]->(Race)`, `(Race)-[:HAS_CHIP_SPLIT]->(ChipSplit)`, `(Episode)-[:CONFLICTS_WITH|REFINES_MEMORY]->(Memory)`. (The first draft of this section named `ABOUT`/`PRECEDED`, which the sync wipes. The live graph has no `PainSite` nodes, so the injury site is a property.) Every edge carries `era:'old_lumpad'`.
* Live nodes are never rewritten (no `SET` on existing Session/Race properties; MERGE `Episode` only). Rollback: `MATCH (n {era:'old_lumpad'}) DETACH DELETE n`, exactly like the Garmin rollback.
* Optional `FieldBand` aggregates (T7, decision D7). S2 detail is excluded (H8).

### 6.6 Digital Twin and Memory Coaching

* **Twin state is never written.** Old context influences the twin in two safe ways: (1) the history lane above (explanations of past sessions); (2) **hypothesis seeds**: each old rule becomes a pair of named exposure/outcome variables queued for `corr.js`/`corr_explore` on COROS-native data (`health_daily` from 2026-01-14, sleep log, FIT features). A rule only influences anything if the native data reproduces it at the engine's own thresholds. Output lands in `corr_edge` through the normal path.
* **Memory coaching:** the "tell-the-coach" notes and the coach's unanswered questions (the old decision cards list them) become **open items** for the athlete, not facts. A single Studio queue shows absorbed claims grouped by batch with the matched existing memory side by side.

---------------------------------------------------------------------------

## 7. Temporal isolation, deduplication and safety (the invariants)

### 7.1 Isolation invariants (checked mechanically in Phase 8)

| ID | Invariant | Check |
|---|---|---|
| I1 | **Write fence.** Only `oldlumpad.db`, `memory.db` (new rows with `source='old_lumpad'`), `session_context` (rows with `kind='old_lumpad'`), and Neo4j `Episode` nodes may change. | Before/after row counts and content hashes of every protected table (`activities`, `fit_session`, `daily_feat`, `health_*`, `athlete_baseline`, `twin_*`, all `plan.db`, `kb_docs`, memory rows not from `old_lumpad`) must be identical. |
| I2 | **Horizon.** Every absorbed item has `event_date ≤ 2026-08-12`; anything undated gets `valid_from = valid_to = doc date`. No open-ended validity. | SQL assertion over `ol_claim`/`memory`. |
| I3 | **Authority order.** KB (Nov 17) and live data beat old claims wherever they overlap in time or subject. Differences become `conflict` candidates; nothing overwrites. | Zero `UPDATE` on non-`old_lumpad` rows. |
| I4 | **No auto-activation.** | `SELECT count(*) FROM memory WHERE source='old_lumpad' AND status='active'` = 0 until a human promotes. |
| I5 | **Twin stability.** `twin_state` `inputs_hash` for the latest version and the active plan hash are unchanged. A coach context preview for 5 canonical current-intent questions is byte-identical (history lane off). | Golden diff. |
| I6 | **Idempotent and reversible.** Re-running any phase is a no-op; `batch_id` allows delete-by-batch in all three stores; graph rollback by era. | Rollback drill in Phase 8. |
| I7 | **Provenance.** Every claim has a verbatim quote found in the source chunk, the source file's sha256, and the archive's sha256. | Existing quote-in-text check (as `bulk.js claimsToMemories`) plus manifest join. |

### 7.2 Why dedup is layered (the lexical numbers cannot be trusted alone)

| Layer | Mechanism | Tokens |
|---|---|---:|
| L0 exact | normalised-quote sha256 vs `memory.hash` and `payload.quote` of existing `kb_extract` rows | 0 |
| L1 lexical | FTS5 BM25 top-k on `memory_fts`; existing `sameClaim` quote matcher | 0 |
| L2 semantic (local) | `recall.js` TF-IDF cosine, bilingual synonyms (no embedding model exists; none is added) | 0 |
| L3 judge | LLM verdict per claim against its top 8 candidates: `duplicate / refines / contradicts / stale / new`, with the matched memory id and a one-line reason | yes |
| L4 entity key | `race_key`, `injury_key`, `run_key` joined to existing `Race`/`Session`/`PainSite`, so an event is *attached* to the live entity instead of re-described | 0 |

### 7.3 Dedup outcomes

`duplicate` → recorded in `ol_claim` only (no memory row; the existing memory gains nothing). `refines` → new `candidate` that cites the matched id. `contradicts` → `conflict` candidate citing both quotes (the `consistency` job's format). `stale` → kept only as a bounded, `archived` history item. `new` → proceeds to QA.

### 7.4 Sensitivity classes

| Class | Examples | Rules |
|---|---|---|
| **S0** | Race results, pace, HR, splits, weather | May go to the coach LLM and Neo4j. |
| **S1** | Identity-adjacent (name, employer, family, address) | Existing `redact()` plus an extension for DOB, address, spouse/child terms, clinic names. Neo4j: none. |
| **S2** | Injury detail, clinician names, supplements, labs, body composition | Local only. Redacted before any LLM call. Neo4j: coarse episode only. |
| **S3** | Other people (race-result participants, named individuals in news) | Never read into Lumpad. Aggregates only (T7). |
| **S4** | Credentials | Never parsed or sent anywhere. Files listed in the quarantine manifest. Recommend rotation. |

### 7.5 Resource limits (archive inspection and processing)

* Read the zip in streaming mode; extract only the ~47 K/T files (~0.3 MB) to a 0700 directory under `/var/tmp`, never wholesale again; delete after Phase 1.
* `nice -n 19 ionice -c3`, one CPU worker, ≤ 3 concurrent LLM calls (existing `pool`), RSS cap 200 MB (nothing here needs more than a few MB), disk use < 50 MB for staging.
* T7 aggregation uses SQLite directly on the vault copy, with `PRAGMA query_only=ON`, streaming; no CSV is loaded into memory. Never during 07–09 WIB or the 01:30–05:00 nightly window.

---------------------------------------------------------------------------

## 8. Token-utilization plan

### 8.1 Position

* Quota: **449.7 M of 600 M remaining, valid to Dec 21 (27–28 days)**. Single provider `tokenomix`; extraction/judge on `deepseek-v4.1-flash-1017-mod`; adjudication, cross-model agreement and QA on `deepseek-v4-pro` (confirm the id with `/models` in Phase 0).
* **Eligible source is only ~80 k tokens.** Quality will be set by agreement between passes, the claim-level novelty judge and adversarial QA, not by volume. Past a point, extra tokens only produce more low-value claims. Therefore the plan **uses ~3.5 % nominally, with a 6.7 % ceiling, and deliberately leaves the rest for production coaching through Dec 21.**
* Per-call cost must be **measured, not assumed**. The app's own counter shows 45 calls on 2026-11-23 totalling 2.56 M (avg 47 k per flash call, 93 k per pro call: reasoning-heavy and long coach contexts). Extraction/judge calls have far shorter inputs, so the nominal column assumes 15–40 k; the worst-case column applies the measured averages. A 10-call pilot (Phase 2) replaces both with a real number before the rest is scheduled.
* Quota bookkeeping discrepancy to fix first: the quota file reads 140.4 M used (as of 2026-11-23) and the counter has logged 2.56 M since, ~143 M against the 150.3 M the user reports. Update via `saveQuota` before running so the `low`/`critical` gates are honest.

### 8.2 Itemised plan

| Stage | What | Calls (model) | Nominal tokens | Worst case |
|---|---|---:|---:|---:|
| A1 | Extraction pass 1, 6,000-char chunks (existing `extract`, adapted to `ol_doc`) | 50 (flash) | 0.75 M | 2.4 M |
| A2 | Extraction pass 2, 2,500-char chunks (finer; sentences already claimed are skipped) | 116 (flash) | 1.74 M | 5.5 M |
| A3 | Cross-model pass (`--model` pro); agreement between models raises confidence | 50 (pro) | 2.0 M | 4.7 M |
| B1 | Novelty judge: ~900 claims, 5 per call, each with its top-8 existing memories | 180 (flash) | 3.6 M | 8.5 M |
| B2 | Adjudication of ambiguous verdicts (~15 %) | 30 (pro) | 1.2 M | 2.8 M |
| C | Per-run episode synthesis joining enrichment to `fit_session` features (Jun 14 → Jul 12) | 40 (flash) | 1.0 M | 1.9 M |
| D | Race reflections for the 12 + 2 races, using existing post-mortem outputs where they exist (21 already run) | 14 (pro) | 0.56 M | 1.3 M |
| E1 | Adversarial QA: all injury/medical/rule claims + 20 % sample of the rest | 120 (pro) | 3.0 M | 11.2 M |
| E2 | Golden-set recall test (answer key = `exports/jakim-2026-race-context.md`) | 20 (pro) | 0.5 M | 1.9 M |
| F | Conflict check of promoted candidates against KB documents (existing `consistency` machinery) | 40 (flash) | 1.0 M | 1.9 M |
| G | Monthly era digests Jan → Aug 2026 (qualitative only; numbers come from Lumpad) | 8 (flash) | 0.24 M | 0.4 M |
| | **Total** | **668** | **≈ 15.6 M (3.5 %)** | **≈ 42 M (9.4 %)** |

* **Hard ceiling 30 M (6.7 %)**; per-stage ceiling 2× nominal; the job aborts at the quota gate `low` (≤ 10 % left) and at any ceiling. Reserve **≥ 400 M** for production use.
* Deterministic work that costs **0 tokens**: manifest, sha256, structured table parsing (T2), field aggregates (T7), L0–L2 dedup, verbatim-quote and number verification (existing `grounding.js`/`writeback.js` checks), fence/rollback checks.
* Where more tokens *would* help (opt-in, later): a second full cross-model pass over K1/K2 only (~2 M) if QA recall falls below target.

### 8.3 Privacy for LLM calls

Only redacted chunk text leaves the server (existing `redact()` plus the S1/S2 extension). S3 and S4 content is never chunked. The existing privacy statement ("embeddings/analytics are local; Open-Meteo gets rounded coordinates") is unchanged.

---------------------------------------------------------------------------

## 9. Phased execution roadmap

Each phase has an exit gate. Nothing proceeds on a failed gate. Work happens on a new branch `old-lumpad-absorption` with code under `server/oldlumpad/` (mirrors `server/garmin/`), tests alongside, and a CLI `server/oldlumpad/cli.js` (`inventory | stage | parse | extract | judge | qa | promote | graph | verify | rollback`). Run as the `lumpad` user (existing behaviour: root drops to the data owner), outside 07–09 WIB.

| Phase | Work | LLM | Exit gate |
|---|---|:-:|---|
| **P0 Safety and staging** | `chmod 600`/`chown lumpad` the zip; add it to `.gitignore` (needs your approval); full sha256 manifest + decision per entry; quarantine list for S3/S4; extract only K/T files to a 0700 dir; secret scan with masked output; extend the redactor (tests); create `oldlumpad.db`; snapshot hashes of protected tables; sync the quota file; confirm model ids | No | Manifest covers 1,410 files with 0 unclassified; protected-table baseline stored; redactor tests pass; **no real credential or participant name in `oldlumpad.db`** |
| **P1 Deterministic parse** | T2 tables → `ol_event`; race-history table → alias map and race keys; decision-card check-ins → per-day notes; enrichment docs → dated chunks; T7 aggregates (if D7 approved) | No | Event counts match the source (35 + 11 stops, 15 splits, 10 weather rows, 11 races); every event joins to an existing `Session`/`Race` or is flagged unmatched |
| **P2 Claim extraction** | 10-call pilot → measure tokens/call → set stage ceilings → run A1, A2, A3 | Yes (~4.5 M) | 100 % of kept claims have a verbatim quote; agreement rate reported; spend ≤ stage ceiling |
| **P3 Novelty, dedup, conflicts** | L0–L4, B1/B2, F | Yes (~5.8 M) | Every claim has a verdict; duplicate rate of survivors < 2 % when re-checked; conflicts listed with both quotes |
| **P4 QA gate** | Verbatim and number checks (0 tokens); E1 adversarial review; E2 golden-set recall; you spot-check ≤ 60 claims (all medical/rule + a random sample) | Yes (~3.5 M) | Recall ≥ 90 % of golden facts; no fabricated claim in the human sample; every medical claim `pass` |
| **P5 Promotion** | Write approved batches to `memory.db` (`archived`/`candidate`/`proposal`) and `session_context`; Studio review queue | No | I1–I4 hold; row counts equal approved counts; zero `active` |
| **P6 Graph** | Node-side `Episode` writer; **prune test**: run the sync (as `lumpad`) against a copy/dry-run and confirm `Episode` nodes survive; confirm Memory ≈ 800 after sync as today | No | Graph snapshot shows new nodes only under `era='old_lumpad'`; live node counts unchanged |
| **P7 Coach and Twin utilisation** | History lane; hypothesis seeds to `corr_explore`; 6 new eval scenarios (cite old plan as current → must fail; historical question → must use lane; red-flag path unchanged); era digests | Small | `npm test` and eval suite green; I5 golden diff empty; lane cost ≤ 1.2 k tokens |
| **P8 Verification and close-out** | Run all invariants; rollback drill on a copy (delete by `batch_id` and by era, then re-apply); write the execution log into this file; delete the scratch directory; update the project memory note; optional archive of the zip | No | All checks green; rollback leaves protected tables bit-identical; spend report ≤ ceiling |

Estimated effort: P0–P1 about 1 day of work, P2–P4 about 1 day plus LLM wall-clock (conc ≤ 3, so hours not minutes), P5–P8 about 1–2 days including review time.

### 9.1 Acceptance criteria (summary)

* 0 changes to protected tables (hash-equal).
* 0 `active` rows from this import; every row bounded by `valid_to ≤ 2026-08-12`.
* 100 % verbatim-quote provenance; ≥ 90 % golden-fact recall; < 2 % duplicates among promoted claims.
* Neo4j: `Episode` nodes survive a normal graph-sync; live counts unchanged.
* Current-intent coach previews unchanged; historical questions use the lane.
* Token spend ≤ 30 M with the quota gate intact.

---------------------------------------------------------------------------

## 10. Decisions needed before any code or ingestion

| # | Decision | Recommended default |
|---|---|---|
| D1 | Approve **P0 hygiene**: `chmod 600` + `chown lumpad` on the zip, and a `.gitignore` entry for `old_lumpad.zip`. | Yes. It costs nothing and removes a real commit risk. |
| D2 | **Rotate the old Postgres password** (present in 6 scripts and an export) if that instance is still reachable. | Yes, if it exists. |
| D3 | Horizon and authority: confirm the absorption horizon is 2026-08-12 and the KB/live data always win. | Yes. |
| D4 | Neo4j exposure: allow coarse `Episode` nodes (injury site, dates, severity; no clinician, family or lab detail) in Aura? | Yes, coarse only. |
| D5 | Supplement snapshot: store as a dated, local-only history memory, or skip? | Store, local-only (S2). |
| D6 | Name reconciliation: treat "Semarak 17 Agustus Trail" as an alias of the ledger's "Sentul Ultra 17K (DNF)", and log the "COROS active from Sep 2025" sentence in `04.1` as a conflict (R1)? | Yes; both as conflict candidates, not edits. |
| D7 | Field aggregates from the 6 result DBs (T7): include as anonymous aggregates, or skip entirely? | Include for Jakim 2026 FM + the athlete's own 2025 events; skip Jakim 2025 and the empty JRF DB. Aggregates only, no names. |
| D8 | Second model for agreement/QA: use `deepseek-v4-pro` (already reachable) subject to the ceiling above? | Yes. |
| D9 | Token ceiling: 30 M hard, ~16 M expected. | Approve, or set your own. |
| D10 | Review model: batch review in the Studio queue (≤ 60 claims sampled by you), or full manual review? | Sampled, with all medical/rule claims reviewed. |

---------------------------------------------------------------------------

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Absorbed memory contaminates "current" retrieval | Medium | High | Nothing `active`; separate lane; eval scenarios; I5 golden diff. |
| Graph-sync prune removes the new nodes (or a root-run sync deletes them) | High if ignored | Medium | Distinct label/era/`src`; Phase 6 prune test; run sync as `lumpad` only. |
| LLM invents a claim (injury, medical, rule) | Medium | High | Verbatim-quote rule, adversarial QA on all medical/rule claims, human sample. |
| Third-party or credential data leaks to an LLM/graph | Low | High | S3/S4 never chunked; manifest quarantine; redactor tests; secret scan with masked output. |
| Double counting of Jakim facts already in `04.2` | High | Low | L0–L4 dedup; attach to existing keys. |
| Token overrun | Low | Medium | Pilot calibration, stage ceilings, quota gate at `low`. |
| RAM/CPU pressure on the 2 GB host | Low | Medium | Streaming, `nice/ionice`, conc ≤ 3, no heavy file loaded. |
| Old numbers treated as truth (zones, targets, shoe mileage) | Medium | Medium | Skipped by design (S12) or bounded snapshot with `valid_to`. |
| Scope creep into rebuilding the old KG | Medium | Low | The archive has no KG to rebuild; graphify is Skip (S4). |

---------------------------------------------------------------------------

## 12. Appendix: read-only command record

* `python3 -I` over the zip (`zipfile`) for the manifest, sizes and classification; extraction to `/var/tmp/old_lumpad_x` excluding `graphify-out/cache` and `.pyc` (removed at the end of this audit).
* `sqlite3 -readonly "file:…?mode=ro"` on `*.snapshot.db` (schema, counts, date ranges) and on `coros.db`/`garmin.db` (table lists only); `sqlite3 -readonly` on the 6 result DBs for table names and row counts.
* Lexical-overlap script: scratchpad `overlap.py` (4-gram shingles, then number/word coverage); it showed that 4-grams under-detect paraphrase, which is why section 3 reports coverage and section 7 requires a claim-level judge.
* Secret scan: pattern grep with output masked; no value was printed or stored.
* No Neo4j query, no network call, no LLM call, no write to any store or to the repo other than this file.

---------------------------------------------------------------------------

## 13. Execution log (2026-11-24) — decisions D1–D10 approved as recommended

Code: branch `old-lumpad-absorption`, `server/oldlumpad/` (16 unit tests, in `npm test`; full suite 583 pass / 0 fail / 2 skipped). **Nothing is committed**; run `git status` and commit when you are satisfied. Staging DB `server/data/oldlumpad.db` (mode 600, gitignored) is rebuildable from the zip; a pre-write backup of `memory.db` is at `server/data/tmp/memory.pre-olx.db`.

### 13.1 Results by phase

| Phase | Result |
|---|---|
| P0 | Zip `chmod 600`, owner `lumpad`, `.gitignore` entry added (D1). 1,410 files hashed, 0 unclassified (11 keep / 42 transform / 1,357 skip, matching section 4). 47 text docs loaded; nothing extracted to disk (in-memory zip reader). No credential in the staged set; the one e-mail (profile) is stripped by the redactor. Quota file synced to 150.3 M used. Fence baseline: 33 protected tables. |
| P1 | Deterministic parse → 131 events: 11 races (all joined to a live `fit_session`), 11 labelled + 35 inferred Jakim stops, 14 official splits, 15 checkpoints, 10 weather rows, 9 phases, 12 run-context rows, 5 filled check-ins, 9 coach questions. |
| P2 | 3 extraction passes (6,000-char flash, 2,500-char flash, 6,000-char `deepseek-v4-pro`): **1,461 claims**, every one with a verbatim quote; 308 produced by both models. 18 quote-not-in-text drops. 3.5 M tokens. |
| P3 | Judge (pro): 105 duplicate, 1,098 new, 176 refines, 64 stale, 18 contradicts. 1.1 M tokens. |
| P4 | Deterministic checks + adversarial review (pro): **1,166 pass, 169 held for a human, 21 fail**. Golden-set recall **0.90** (32 yes / 8 partial / 0 missed of 40; 15 yes from existing memory, 13 from claims, 4 from events). |
| P5 | **1,166 memory rows + 17 `session_context` notes**, all `archived`; 576 S0, 17 S1, 573 S2. |
| P6 | Aura: **+515 `Episode`, +11 `Stop`, +14 `ChipSplit`, +15 `FieldBand`, +1,213 edges**; live nodes/edges unchanged (0 drift). Survived a real run of the Go `graph-sync`. |
| P7 | History lane live in `context.js` (retrospective free questions only); write-back guard; 6 sample previews. |
| P8 | `verify`: 8/8 checks pass, **33/33 protected tables identical**. Rollback drill on copies: non-import rows bit-identical, import rows fully removed. |

Tokens: **6.2 M** total (extraction 3.5 M, judge 1.1 M, QA 1.6 M incl. re-review, golden 0.15 M); 443.5 M left. Per-call cost measured: flash ≈ 21 k (flat, mostly fixed overhead), pro ≈ 8 k. The plan's 16 M nominal / 30 M ceiling was never approached.

### 13.2 Where reality differed from the plan (and what was done)

1. **All promoted memory is `archived`, not candidate/proposal.** Both coach engines merge fresh findings into candidate/proposal rows (Node `writeback.js` and Go `writeback.go`), and both review queues list them. The Go engine cannot be changed on this host, so only `archived` isolates both. Hypotheses, lessons, rules and conflicts keep their role in the row kind (`old_hypothesis`, `old_lesson`, `old_rule`, `old_conflict`). The athlete can restore any row to `candidate` in the Studio. Node `writeback.js` also now ignores `old_lumpad` rows (regression test).
2. **Graph vocabulary changed** (section 6.5): the Go sync deletes `ABOUT`, `PRECEDED`, `CONTRADICTS` and rebuilds `Km`/`Lap`; the layer uses `DESCRIBES`, `NEXT_EPISODE`, `HAS_STOP`, `STOP_IN`, `HAS_CHIP_SPLIT`, `CONFLICTS_WITH`, `REFINES_MEMORY`. The live graph has no `PainSite` nodes, so the injury site is an `Episode` property.
3. **KB-sourced `Race` nodes are recreated every sync**, which orphaned 15 `DESCRIBES` edges after the test sync. Fixed with a stored `race_id` and an idempotent `graph-relink`; `Day` and `Session` links never needed it. An optional systemd drop-in is in `deploy/v2/systemd/lumpadd-graph-sync.service.d/` and is **not installed** (the harness blocked a change under `/etc`; install is one `sudo cp` + `daemon-reload`, command in the file).
4. **QA bugs found and fixed during the run:** (a) date parts (`05`, `14`) in claim text were counted as unsupported numbers (119 false failures); (b) the reviewer saw only the first 2,600 characters of a 6,000-character chunk and wrongly failed claims whose quote came later (window is now centred on the quote; 169 claims re-reviewed). (c) The first golden harness silently returned no memory evidence (ambiguous SQL column) and compared against a different fact list each run; both fixed (list frozen, 8-way retrieval).
5. **A prompt leaked a clinician's name** through a file path in the first design of the extractor message; caught before any call; the message now carries only a document type and date.
6. **Hypothesis seeds are not wired into `corr_explore`.** The engine has a fixed variable catalog (lower-body strength, threshold minutes, sleep minutes, HRV deviation, run load/km, quality sessions). Of 106 old hypotheses, 30 touch sleep/HRV, 5 threshold work, 17 heat/temperature, 0 strength; sleep HR, bedtime and temperature are not engine variables. Extending the catalog changes live derived tables and is left as a separate decision.
7. **The Go retrieval lane is not implemented** (the Go binary cannot be rebuilt here); the history lane is Node-only.

### 13.3 Open items for you

* 169 claims are held as `needs_human` (partial support, overreach, current-tense, or treatment-style wording) and 21 failed; none were promoted. They remain in `ol_claim` with the reviewer's note.
* 15 `contradicts` claims (old notes disagree with an existing memory) are stored as `old_conflict` rows; worth a skim.
* The 9 unanswered coach questions from the old decision cards (for example the single most important Digital Twin rule from Jakim) are in `ol_event` (`coach_question`), not yet put to you.
* Rotate the old Postgres password (D2) if that instance still exists.
* D7 field aggregates **were run** (anonymous; 0 tokens): Jakim 2026 marathon (6,965 finishers; the athlete's 6:53:03 = rank 6,678, faster than 4.1 %), Milo 2025 10K (faster than 67.9 %), Guardian 2025 10K (faster than 1.1 %). The athlete's 6–7 h band slowed a median 14.6 % between km 10 and km 40 (8:00 → 9:12 /km). Stored in `ol_field_stat` and as 15 `FieldBand` nodes. Skipped: Jakim 2025 and the empty JRF 2025 DB. The per-checkpoint "attrition" metric was dropped: the crawl holds splits for every starter, so it read 100 % everywhere.

### 13.4 Follow-up (2026-11-24, later)

* Committed on `old-lumpad-absorption` (26 files). A first commit accidentally swept in 10 `docs/` deletions that someone else had staged; it was undone and recommitted without them. Those deletions and an edit to `server/garmin/db.js` are still in the working tree, unstaged and not from this work.
* The 15 `old_conflict` rows were reviewed: 10 are stale old plans/snapshots superseded by later facts (shoe timeline, Hydroplus plan, plantar-resolved date, onset window, heat as "decisive"), 3 are old claims that Garmin/FIT data show to be wrong (2024 volume, Strava stream as native source, sodium as cause), 2 are not contradictions (device vs ambient temperature; the 2026-06-09 run: FIT elapsed 1:06:37, the old 43:12 was running time only). Nothing needed changing; all stay archived.
* Of 169 held claims, 58 were source-faithful (reviewer flagged tense/advice only) and were promoted as archived: memory now 1,224 old_lumpad rows, graph 526 `Episode`. 111 remain held (95 partial, 11 unsupported, 5 other).
* `verify` showed a one-time I1 diff after the morning COROS sync (09:00 WIB: activities, twin v62, daily_feat, health/fitness, 2 system ledger memories); attributed to that job via timestamps and the write log, then re-baselined; 33/33 identical.
* The 9 old "coach questions" (2026-06-22 → 07-09) are auto-generated daily prompts 4–5 months stale; most are answered by the absorbed enrichment notes. Recommend retiring them rather than answering.

### 13.5 Follow-up (2026-11-24, continued)

* Of the 111 claims held as `needs_human`, **11 had never actually been reviewed**: a batch response from the adversarial reviewer dropped them, and the code's catch-all ("no review returned") was mis-read in the earlier triage as "unsupported" because its note also starts with "no". Re-queued and genuinely re-reviewed: **9 passed and were promoted** (memory now 1,233 `old_lumpad` rows, 102 still held, 21 failed, unchanged). The remaining 102 are real partial/overreach/other verdicts, not a processing gap.
* The 9 `coach_question` events were formally retired (`payload.retired=1` with a dated reason), not deleted, so nothing is left looking like an unanswered open item and the raw text is still there if wanted.
* `verify` re-run clean after both changes: 8/8 invariants, 33/33 protected tables identical.
* Fixed the CLI's default archive path (the zip moved from `/opt/lumpad/old_lumpad.zip` to `/opt/lumpad/old_lumpad_full/old_lumpad.zip`): it now tries the current location first, falls back to the old root path, and `--zip=` still overrides both. Tightened `old_lumpad_full/` to owner `lumpad`, mode 700 (the file itself already was).
