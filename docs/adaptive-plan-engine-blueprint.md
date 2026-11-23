# Lumpad Adaptive Plan Engine: Blueprint and Phased Rollout

| | |
|---|---|
| **Date** | 23 Nov 2026 |
| **Status** | **PROPOSAL.** Nothing is built. No production code, data or migration was changed while writing this. Items marked **[DECIDE]** need the athlete's answer before the phase that uses them |
| **Code baseline** | branch `coach-provider-settings` at `ed06a02` |
| **Discovery mode** | Read-only. Code reading, SQLite `*.snapshot.db` opened with `immutable=1`, `kv.json` keys and shapes only, `free`/`df`. Postgres and Neo4j were not queried |
| **Goal** | Replace the static season file (`src/data/plan.json`) with a versioned plan that a deterministic engine keeps safe and the AI Coach personalises. It runs two loops: daily/weekly **micro-patches** and block-level **macro-regeneration** |

---

## 1. Executive summary

**Today the plan is a build artefact, not data.** `tools/build_season.mjs` turns a COROS "plan A" text snapshot plus `src/lib/season.js` rules into a 404-day `src/data/plan.json` (23 Nov 2026 → 31 Dec 2027). Nine Node modules and the Go binary (through `go:embed`) import that file directly. Adaptation happens in three places that do not share code or storage:

1. `src/lib/scaler.js`: a 72 h gate downgrade, stored in kv `lumpad.scale`, client-side.
2. `src/lib/missed.js`: missed-run scenarios, stored in kv `lumpad.missed.<date>`. It gives advice only and never edits the plan.
3. `lumpadd/internal/decision/replan.go`: six Phase-5 rules. They are unit-tested and write to Postgres `coach.decision` and `plan.overlay`, but they are not live.

**The static plan breaks the athlete's own locked load guard.**

| Check (measured 23 Nov 2026) | Value |
|---|---|
| Actual weekly running km, last 4 weeks (twin, after Borobudur) | **15.9 km** |
| Plan week W-4 (starts 30 Nov) | **60.5 km**, 3.8× the 4-week average |
| Plan weeks over +10 % of the plan's own previous-4-week average | **29 of 54** |
| Plan peak week | 96 km (W9, W18, …) vs a 2026 actual average of ~31 km/wk |
| Benchmarks hard-coded in the plan path | VDOT 31.7 (`plan.js` TARGET), threshold pace 356 s/km (`athlete.js`). COROS now reports **355** s/km (`fitness_daily`, 23 Nov) |

Every day, the gate and missed-run rules patch around a plan that was unsafe from the start. That is the core problem this engine solves.

**Proposed architecture (hybrid, three layers, one store):**

```
           ┌──────────────── Deterministic core (pure JS, ms, no LLM) ────────────────┐
benchmarks → Benchmark Resolver → zone_set (versioned)                                │
twin/load  → Guardrail Kernel  (locked rules → executable constraints, validate+repair)│
templates  → Template Catalog  (KB 02.2 + COROS codes + Lumpad builders, symbolic zones)│
           │  Macro Generator (periodise → allocate → fill)   Micro Patcher (operators)  │
           └───────────────┬───────────────────────────────────────┬──────────────────┘
                           │ eligible menu (top-k per slot)        │ patch + rationale template
                           v                                       v
                 AI Coach (DeepSeek Flash / Claude): picks from the menu, writes the rationale.
                 Constrained JSON only, re-validated. Fallback = deterministic top pick.
                           │
                           v
            plan.db: plan_version (delta chain) · plan_session · plan_active_day (materialised)
                     plan_trigger · plan_adjustment (audit, append-only) · plan_adjustment_event
```

- **The deterministic layer owns every number**: zones, doses, weekly km, long-run caps, spacing. It also owns the final say: every candidate, whether generated, patched or LLM-picked, passes `validate()` before it can become a version.
- **The AI Coach owns choice and words**: which eligible template fills a slot, given memory, the twin, the KG's history of each template, and live context. It also writes the explanation. It never emits a free number. It picks an option id and a dose inside a range the kernel gave it.
- **Sessions store symbolic intensities** (`Z2`, `T`, `M`, `TT@line`), resolved against the current `zone_set` when read. A new threshold pace or LTHR **re-prices the whole plan with no regeneration and no LLM call**.
- **Lightweight by design**: no new process, no new dependency, no embeddings. Generating 48 weeks takes ≈ 10–50 ms in the API process at < 10 MB. The LLM is used about once per macro regeneration (≤ 14k tokens) and **zero times for routine micro-patches**, whose rationale rides along in the daily brief the system already pays for.

**Day one changes nothing visible.** Version 1 is a byte-identical import of `plan.json`, so G3 (shadow parity) and every screen stay unchanged until each consumer is cut over behind a golden test.

---

## 2. Discovery findings (ground truth)

### 2.1 Where the plan lives and who reads it

| Artefact | Role | Notes |
|---|---|---|
| `tools/data/coros-schedule.txt` + `tools/data/lumpad-2027-original.json` | inputs | COROS plan A text snapshot (18 Nov) and the original Lumpad days (races, events) |
| `src/lib/season.js` | season builder (pure) | `RACES`, `RAMADAN`, `BASE` windows, `weekSource()` maps season weeks to plan-A weeks, `phaseOf()`, `buildSeason()` |
| `src/lib/workouts.js` | template code | COROS courses `P10540/41/44/45/46/47/94` rebuilt as step arrays plus `easy/recovery/timeTrial/race` builders |
| `src/lib/plan.js` | targets and checkpoints | `TARGET`, weekly `TEMPLATE` (Mon rest … Sat long), 20 `CHECKPOINTS`, `tone()`, `killGate()` |
| `src/data/plan.json` | **the plan** (404 days) | kinds: easy 198 · rest 87 · quality 66 · long 39 · tt 9 · race 4 · gym 1. Steps use zone numbers (`z`), and only TTs and races carry absolute paces |
| `src/data/coros-plan.json` · `server/data/coros_plan.json` | COROS schedule copy | the server copy is refreshed by `server/coros/pull.js` (`queryTrainingSchedule`) |
| **Readers of `plan.json`** | | `src/lib/calendar.js`; `server/intel/{twin,context,pipeline,features,forecast,tools,matrices}.js`; `lumpadd/internal/athlete` (embed, via `tools/sync_go_data.mjs`); `tools/seed-dev.mjs` |
| kv `lumpad.scale` | gate overrides | read by `Home`, `DayPage`, `Calendar`, `ScaleCard` through `effectiveDay()`. Currently empty |
| kv `lumpad.missed.<date>` | missed-run choice | `MissedSession.jsx`. 1 key present |
| kv `lumpad.results` | checkpoint results → VDOT, kill gate | currently empty (CP1 is 19 Dec 2026) |
| Postgres `plan.day`, `plan.overlay`, `plan.adherence`, `coach.decision` | Go Phase 5 | schema exists (`0003_new_tables.sql`). Code in `decision/{replan,ledger,adherence}.go`. Not on the production path |

### 2.2 Deterministic logic that already exists (to be unified, not rewritten)

| Logic | Location | Reuse as |
|---|---|---|
| Daniels VDOT ↔ race time ↔ training paces | `src/lib/vdot.js` | Benchmark Resolver |
| 6-zone COROS model, HR ends, `estimate()` (sec + TL), `describe()` | `src/lib/zones.js` | zone_set resolution, dose estimate |
| Readiness (4 pillars, caps, tiers) | `src/lib/readiness.js`, `docs/readiness-model.md` | trigger source |
| PMC/ACWR/monotony/progression | `src/lib/load.js` | Guardrail Kernel inputs |
| Daily gate (`evaluate`), weekly tempo gate | `src/lib/gate.js` | Guardrail Kernel (day rules) |
| Session prescription (heat-adjusted pace bands, opening HR cap, fueling) | `src/lib/prescription.js` | render-time layer on top of a plan session (unchanged) |
| 72 h scaler | `src/lib/scaler.js` | micro operator `downgrade` |
| Missed-run scenarios (evening/tomorrow/skip with 10 week checks) | `src/lib/missed.js` | micro operators `move`, `drop` plus their checks |
| Six replan rules (gate 72 h, +10 %, pain freeze, LR 110 %, low TIZ step-down, Z2 creep, taper window) | `decision/replan.go` | Guardrail Kernel constraints, ported to JS with Go golden vectors |
| Adherence score (distance 45 / TIZ 35 / pace 20) | `decision/adherence.go` | template_stats, drift triggers |
| Outcome evaluation (helped/neutral/harmed) | `decision/ledger.go` | `plan_adjustment.outcome` |

### 2.3 Knowledge Graph, Memory, Digital Twin

| Module | State (23 Nov) | What the engine takes from it |
|---|---|---|
| **Digital Twin** `server/intel/twin.js` (`twin/1`, `intel.db.twin_state`, 47 versions in the 03:15 snapshot) | live, versioned, hash-deduplicated | `load` (ctl, atl, tsb, weekly_km_4w = 15.9, longest_run_km_30d = 36.9), `readiness`, `durability` (continuous-run km, fade onset), `heat` (bpm/°C cost), `intensity` (easy runs above Z2), `injury.sites`, `projection` |
| **Memory** `memory.db` | 539 semantic, 267 episodic, 19 procedural active. 10 locked rules (`LOCKED_RULES` in `server/intel/memory.js`). Evidence ladder VALIDATED > MEASURED > … > HYPOTHESIS | Locked rules become kernel constraints (their text stays the source). Procedural and semantic memories ≥ MEASURED can weight template scores. HYPOTHESIS appears in rationale only, never in scoring |
| **KG** Neo4j Aura via `lumpadd graph-sync` (`graph/{project,kbgraph,perf,enrich}.go`) | Session, Day, PlanDay, Workout, Race, Checkpoint, Week, Phase, Exercise, Memory, Rule, PerfPoint, KB Document/Section nodes. `rag.go` expansion has a 1.5 s timeout | **offline only**: per-template personal history (Session → WorkoutTemplate) is aggregated nightly into SQLite `template_stats`. Runtime never waits on Aura |
| **KB** `server/data/kb/Running_project_export` (36 docs) | `02.2 Session Library` = 9 session types with warm-up/main/recovery/cool-down structure. The doc itself says its paces are stale twice over, so use its *structure* only. `03.3` HRV gating, `06.4/06.5/06.6` 2027 plan, gates, weekly template lock | Template Catalog seed (structure, cues, shoes, contraindications). Paces always come from zone_set |
| **Correlation edges** | 0 validated edges | none yet. The engine reads `status='validated'` edges when they appear |

### 2.4 Platform constraints that shape the design

| Constraint | Consequence |
|---|---|
| 2 vCPU, 1.96 GB RAM (≈ 1.09 GB available, 811 MB swap in use), 24 GB disk free | No new resident process, no embedding model, no Postgres dependency on the hot path |
| Production writer = **Node + SQLite**. Go + Postgres = verified shadow mirror (Phase 3, G3 needs 14 clean days, earliest ≈ 4 Dec 2026) | Build in Node/SQLite first. Mirror into Postgres `plan` schema for the Go port. **No change to existing engine calculations during G3** |
| Software freezes 30 May – 20 Jun 2027 and 3 – 24 Oct 2027 (no cutovers) | Engine cutovers finish before 30 May. During freezes only safety-direction patches are produced |
| LLM: DeepSeek Flash, monthly cap ¥15 (`DEEPSEEK_MONTHLY_CAP_CNY`), optional Claude per intent (`COACH_CLAUDE_INTENTS`), `coach_run` ledger with `req_hash` reuse | Macro review is one call per regeneration. Micro rationale rides in the daily brief. Fingerprint reuse avoids repeat calls |
| Open login risk (audit C1/C2): `PUT /api/kv` is public when login is off | Plan writes go through new authenticated endpoints only, never through kv. Approvals require the athlete session (audit item C2 must be closed before P3 auto-apply) |
| Single athlete | No multi-tenant keys. `athlete_id` columns are omitted on purpose |

---

## 3. Design principles

1. **Numbers are computed, never generated.** The LLM picks among ids and in-range doses. Every number it writes in prose is checked against the version diff (reusing `grounding.js`).
2. **Safety is a kernel, not a prompt.** Locked rules are compiled into executable constraints with stable ids (`R-LOAD-10`, `R-LR-110`, …). A candidate that fails is repaired deterministically or rejected. The LLM cannot override a constraint.
3. **Store intent, render numbers.** Sessions reference templates and symbolic zones. Paces and HR come from the active `zone_set` at read time.
4. **Every change is a version with a reason.** Versions are append-only, every activation has an audit row (trigger → diff → rules → rationale → decision → outcome), and rollback is one pointer move.
5. **Small blast radius.** Micro-patches touch ≤ 10 days. Macro regenerations never rewrite the past, and they keep a **frozen horizon** (today + 2 days) unless safety requires a change.
6. **Bias to safety without asking. Ask before adding load.** Downgrades and rests can apply automatically (with undo, [DECIDE]). Upgrades, moves of key sessions and macro versions need the athlete's tap.
7. **No thrash.** Triggers are deduplicated, have hysteresis and are rate-limited, and the engine is idempotent on `inputs_hash`.
8. **Runtime never depends on an external service.** Aura, DeepSeek, Google and COROS can all be down and the plan still resolves, validates and patches.

---

## 4. Architecture

### 4.1 Component map

```mermaid
flowchart TB
  subgraph Sources
    CO[COROS sync 07:50 WIB<br/>activities, health, fitness_daily, schedule]
    CK[Check-in / post-run card<br/>feel, pain sites, RPE, GI]
    AV[Availability<br/>weekly pattern + exceptions]
    WX[Weather / AQI forecast<br/>google_geo, Open-Meteo]
    GL[Goals and races<br/>RACES, CHECKPOINTS, results]
    FB[Coach feedback<br/>advice ledger, memory approvals]
  end
  subgraph Derived["Existing intelligence (read-only to the engine)"]
    TW[(Twin twin/1)]
    MEM[(memory.db)]
    TS[(template_stats<br/>nightly from KG + SQL)]
  end
  subgraph Engine["server/plan/ (new, pure core + thin IO)"]
    BR[Benchmark Resolver]
    ZS[(zone_set)]
    GK[Guardrail Kernel<br/>validate + repair]
    TC[(Template Catalog)]
    TR[Trigger Router<br/>dedupe, hysteresis, escalation]
    MP[Micro Patcher<br/>operators]
    MG[Macro Generator<br/>periodise, allocate, fill]
    MENU[Menu Builder<br/>top-k eligible per slot]
  end
  AI[AI Coach<br/>constrained JSON pick + rationale]
  subgraph Store["plan.db (new, not rebuildable, backed up)"]
    PV[(plan_version)]
    PS[(plan_session)]
    PAD[(plan_active_day)]
    PT[(plan_trigger)]
    PA[(plan_adjustment + events)]
  end
  UI[UI: Home, Day, Calendar, Proposal card, Plan diff]
  COW[COROS watch write-back<br/>optional, P6]

  CO & CK & AV & WX & GL & FB --> TR
  CO --> BR --> ZS
  TW & MEM & TS --> MENU
  TR -->|micro| MP
  TR -->|macro| MG
  MP & MG --> MENU --> AI --> GK
  MP & MG --> GK
  TC --> MENU
  GK -->|pass| PV & PS & PA
  PV --> PAD
  PAD & ZS --> UI
  PAD -.-> COW
```

### 4.2 Deterministic core (new `server/plan/`, pure modules importable from `src/lib` style tests)

| Module | Responsibility | Inputs → output |
|---|---|---|
| `benchmarks.js` | Choose the current value of each benchmark, with provenance | `fitness_daily`, `lumpad.results` (TT → VDOT via `vdot.js`), `lumpad.settings` (LTHR, HR ends), FIT-derived (twin `aerobic`, `races`), seeds in `athlete.js` → `benchmark` rows |
| `zoneset.js` | Build an immutable zone table from the chosen benchmarks | benchmarks → `zone_set {version, hash, hr[1..6], pace[1..6], daniels{E,M,T,I,R}, heat_model}` |
| `kernel.js` | Executable constraints, `validate(plan, ctx) → violations[]`, `repair(plan, ctx) → plan'` | plan window + twin + check-ins → pass/fail with rule ids |
| `catalog.js` | Template definitions, eligibility, dose ranges, variants | `workout_template` rows → `eligible(slot, ctx)` |
| `macro.js` | Periodisation and session allocation | goals, availability, twin, zone_set, catalog → full-horizon candidate |
| `micro.js` | Patch operators | active plan + trigger → patch candidate (≤ 10 days) |
| `menu.js` | Rank eligible templates per slot, produce the LLM menu and the deterministic default | candidate + `template_stats` + memory signals + context → `menu[]` |
| `resolve.js` | Render a session: symbolic → absolute HR/pace, heat-adjusted | `plan_session` + zone_set (+ prescription.js) → UI/watch payload |
| `store.js` | Versions, activation transaction, `plan_active_day` materialisation, audit | SQLite `plan.db` |

#### 4.2.1 Benchmark Resolver: precedence and change detection

| Metric | Precedence (highest first) | Change that counts |
|---|---|---|
| Threshold pace `tpace_s` | athlete override in Profile › Zones → TT-derived T pace (CP result, ≤ 60 days) → COROS `fitness_daily.threshold_pace_s_km` (7-day median, ≥ 3 days) → `athlete.js` seed | ≥ 6 s/km sustained for 3 days, or any TT result |
| VDOT (race-pace line) | valid TT checkpoint (not DNF, not black flag; WBGT-corrected) → FM/HM attempt with run share ≥ 0.9 → `TARGET.baseline` 31.7 | ≥ 0.5 VDOT |
| LTHR, HR ends | Profile settings (COROS app values) → `athlete.js` | any edit |
| HRmax | settings → observed 180-day max if higher by ≥ 3 bpm (flag only, no auto-change) | flag |
| Durability km (continuous-run km, fade onset) | twin `durability` | ± 2 km over 30 days |
| Heat cost | twin `heat.hr_cost_bpm_per_c` when n ≥ 15, else the `heatPenalty` model in `src/lib/pacing.js` (used by `prescription.js`) | CI change |

- A benchmark change writes a new `zone_set` and a `plan_trigger(type='benchmark')`. **That is usually all that is needed**, because sessions are symbolic.
- A **macro** escalation happens only if the change moves the *goal arithmetic*: ΔVDOT ≥ 1.0 vs the block's planning VDOT, a kill gate fires (`killGate()`), or the CP11 ratio < 0.85.
- Garmin-era device scores stay separate (memory `garmin-history-import`). FIT-derived metrics are one series, but device VO2max and thresholds are COROS only.

#### 4.2.2 Guardrail Kernel: locked rules as code

Each constraint has an id, a severity, the memory rule it implements (`memory.source_ref`), and a deterministic repair.

| Id | Constraint (scope) | Source | Repair |
|---|---|---|---|
| `R-LOAD-10` | week run km ≤ 1.10 × previous 4-week **actual** average (planned future weeks chain on planned values) | Load guard (KB), `replan.go` rule 2 | scale the week's easy sessions first, then quality dose, never the long run below its floor |
| `R-PAIN-FREEZE` | pain ≥ 2/10 in last 7 d → week km ≤ 1.00 × 4-week average, no new template intensity | Pain rule (CLINICIAN), rule 2 | freeze progression |
| `R-LR-110` | long run ≤ 1.10 × longest run in previous 30 d | Load guard, rule 3 | cap the long run distance |
| `R-48H` | ≥ 48 h between hard sessions (quality, tt, long, race) | `missed.js`, doctrine | move or downgrade the later one |
| `R-HARD-WK` | ≤ 2 hard run sessions per week plus the long run; ≤ 1 in base/recovery | weekly `TEMPLATE` in `plan.js` (Tue quality, Thu ◇ tempo only if the weekly gate passes, Sat long); check against KB 06.6 in P0 | downgrade the lowest-priority one |
| `R-STR-72` | Lower strength sessions ≥ 72 h apart, none within 24 h before a TT | Strength guardrails | move strength |
| `R-GATE-SLEEPHR` | sleep HR > 67 → no hard running today | VALIDATED rule | downgrade today (`easy_only`) |
| `R-GATE-HRV` | HRV Reduced + quality/long/race → downgrade | VALIDATED rule | downgrade |
| `R-REDFLAG` | red-flag symptoms → no training advice, referral | VALIDATED rule, `safety.js` | **block**: the plan shows rest plus the referral, and no patch is offered |
| `R-TAPER` | ≤ 21 d to A/B race: week km within 40–60 % of block peak, 1 sharp quality | rule 6 | scale |
| `R-RACE-LOCK` | race days, CP days and gate days are immutable to micro operators | `scaler.js`, `missed.js` | n/a (operators skip them) |
| `R-RAMADAN` | `RAMADAN` window: no quality after a fast, easy ≤ 45 min fasted | `season.js`, gate rule | template filter |
| `R-HEAT` | forecast WBGT ≥ 28 at the slot → hard sessions become HR-capped or move to the cooler window. WBGT ≥ 32 → no hard outdoor | heat findings (0.2 §4), `prescription.js` | heat variant, time shift, treadmill |
| `R-AQI` | AQI (UAQI or local) "unhealthy" at the slot → indoor/treadmill or easy | new | variant swap |
| `R-Z2-CREEP` | ≥ 3 easy runs above Z2 ceiling (148) in 14 d → HR-capped easy for the next 72 h | rule 5 | add `hr_max` to easy sessions |
| `R-TIZ` | 2 quality sessions with < 70 % time-in-zone → next quality one zone step easier, no extra volume | rule 4 | step down |
| `R-NO-MAKEUP` | missed volume is never added to other days | `missed.js` | n/a |
| `R-ONE-VAR` | one progression variable per step (duration *or* intensity *or* run/walk ratio) | Load guard | revert the second variable |

Validation runs on every candidate: a generated block, a micro patch, an LLM pick, or a manual edit. **Property test:** for random valid inputs, `validate(repair(x))` is empty or contains only `block`-severity items, which render as rest/referral.

#### 4.2.3 Template Catalog

One row per template version. It is seeded from three sources, and every row keeps a pointer to its source:

| Source | Templates |
|---|---|
| COROS plan A courses (`workouts.js`) | `coros.P10540` easy, `P10594` long, `P10541` steady+Z3, `P10545` long+Z3 finish, `P10547` threshold cruise, `P10544` aerobic-power alternations, `P10546` free run |
| KB `02.2` session types (structure only) | Under-T continuous, Over-T intervals, race-pace reps, easy + strides, settle-tempo, (double day is **excluded**: rejected in KB 03.6 and in C5 of `plan-intelligence-layer.md`), long-run km-by-km structure, troubleshooting cues |
| Lumpad builders | `recovery`, `timeTrial(5K/10K/HM)`, `race`, gate jog, shakeout, run-walk (for return-to-run), strength Upper / Lower / Full (from `02.3`) |

Template shape (stored as JSON in `workout_template.body`):

```json
{
  "id": "thr.cruise", "version": 2, "kind": "quality", "purpose": "threshold",
  "phases": ["BUILD", "PEAK"], "priority": 2,
  "dose": { "reps": [2, 5], "rep_m": [1000, 3000], "rec_m": [400, 1600], "total_q_min": [15, 40] },
  "steps": [ {"t":"wu","sec":300}, {"rep":"$reps","steps":[{"t":"run","m":"$rec_m","z":2},{"t":"run","m":"$rep_m","z":4}]}, {"t":"cd","sec":300} ],
  "requires": { "weekly_km_4w_min": 25, "pain_free_days_min": 7, "longest_continuous_km_min": 6 },
  "contra": { "pain_sites": ["achilles"], "wbgt_max": 28, "gate": ["sleep_hr", "hrv_reduced"] },
  "variants": { "heat": "thr.cruise.hr", "indoor": "thr.cruise.treadmill", "easier": "steady.z3", "harder": "thr.cruise.long" },
  "progression": { "var": "total_q_min", "step": 5 },
  "cues": "Run by HR first, pace second. Recoveries stay in Z2.",
  "src": { "coros": "P10547", "kb": "02.2#2" }
}
```

- `$params` are bound by the generator within `dose` ranges, then stepped by `progression` (one variable).
- `z` stays symbolic. `resolve.js` turns it into HR and pace with the current `zone_set`, and `prescription.js` adds the heat adjustment at render time.
- The KG gets a `:WorkoutTemplate` node per row (graph-sync), plus `(:Session)-[:ATTEMPT_OF]->(:WorkoutTemplate)` linked through `plan_session.template_id` ↔ the activity matched by adherence.

### 4.3 The two loops

#### 4.3.1 Trigger Router

| Trigger `type` | Raised by | Default route | Dedupe key |
|---|---|---|---|
| `readiness_gate` | morning sync and check-in (`readiness`, `gate.evaluate`) | micro `downgrade` (72 h) | `gate:<date>` |
| `pain` | check-in pain ≥ 2, or a new site | micro `downgrade` + `R-PAIN-FREEZE`. If ≥ 4 or rising 3 days → red flag | `pain:<date>` |
| `missed_session` | 11:00 and 20:00 WIB checks (existing missed card) | micro `move` / `drop` (athlete picks a scenario) | `missed:<date>` |
| `availability_conflict` | availability exception overlaps a session | micro `move` / `swap` / `trim` | `avail:<date>` |
| `weather_aqi` | forecast pull for the next 48 h of sessions | micro `variant` / `time_shift` | `wx:<date>:<slot>` |
| `adherence_drift` | nightly: 14-day km deficit > 15 %, or 2 low-TIZ quality sessions | micro `step_down`, escalates if repeated | `drift:<iso-week>` |
| `benchmark` | new zone_set | **none** (re-render) or macro if ΔVDOT ≥ 1.0 | `bench:<zone_set>` |
| `goal_change` | race added/removed/re-classed, target changed, kill gate | **macro** | `goal:<hash>` |
| `availability_pattern` | weekly pattern edited | **macro** from next Monday | `availpat:<hash>` |
| `injury_block` | pain freeze > 7 d or clinician note | **macro** (return-to-run block) | `inj:<site>:<start>` |
| `coach_feedback` | athlete RPE/"too hard" ×2 on a template, explicit preference, approved memory | micro `swap_template`, or macro if structural | `fb:<id>` |
| `manual` | athlete edits a day | micro (validated) | `manual:<ts>` |

**Escalation (micro → macro):** two micro triggers of the same family within 14 days that each removed ≥ 20 % of a week; or two missed long runs in a row (`missed.js` already calls this "a plan review"); or a cumulative deficit vs plan > 25 % over 3 weeks; or the kernel cannot repair the next 14 days without violating `R-LOAD-10`.

**Anti-thrash:** frozen horizon (today + 2 d) for macro; at most one macro proposal per 7 days unless `goal_change` or `injury_block`; hysteresis on benchmarks (3-day sustain); micro patches supersede earlier open proposals for the same dates; a proposal expires at the end of its first day.

#### 4.3.2 Micro-patch operators (deterministic; scope ≤ 10 days)

| Operator | Effect | Existing logic it replaces |
|---|---|---|
| `downgrade(date, level)` | swap to the template's `easier` variant, or easy/rehab with `hr_max` | `scaler.proposeScale`, `replan.go` rule 1, `prescription.js` verdicts |
| `trim(date, pct)` | scale the dose inside its range | prescription `scale` verdict |
| `move(date → date')` | relocate a session within the ISO week, checking `R-48H`, `R-STR-72`, rest days, CP proximity | `missed.js` "tomorrow" scenario |
| `swap(d1, d2)` | exchange two sessions | new |
| `drop(date)` | remove it, no make-up | `missed.js` "let it go" |
| `variant(date, heat\|indoor\|aqi)` | same purpose, safer execution | new (heat/AQI) |
| `time_shift(date, window)` | earliest cool slot inside availability | new |
| `step_down(template)` | next quality uses the easier progression step | `replan.go` rule 4 |
| `hr_cap(range)` | add `hr_max` to easy sessions | `replan.go` rule 5 |
| `insert_recovery(date)` | rest or a recovery run after an unplanned hard effort (a race, a hard social run) | new |

Each operator returns `{changes[], rules_checked[], rationale_template}`. The rationale is a filled template string with numbers taken from the diff (for example: "Moved Long Run 18 km from Sat to Sun: Sat availability 45 min < 2:05 needed; Sun keeps 48 h after Thu quality."). **No LLM call is needed for a patch to be applied or explained.**

**The daily workout menu** is the user-facing form of the micro loop. For today, `menu.js` returns 2–3 validated options, which generalises the missed card and the prescription verdict: **A** as planned, rendered for today's zones and weather; **B** the safe variant (downgrade or heat/indoor); **C** a time/length alternative that fits today's availability. The athlete's choice becomes a `manual` trigger, so it is audited like any other change.

#### 4.3.3 Macro-regeneration (deterministic generator, LLM as constrained selector)

Scope: from `max(today + 3, next Monday)` to the end of the current goal cycle (next A/B race + recovery), or 16 weeks if no race is set. Past days and the frozen horizon are never rewritten.

1. **Periodise (weeks).** Work backward from each race in `plan_goal`: race week, taper (2–3 weeks, `R-TAPER`), peak, build, base. Ramadan and recovery windows are fixed. Start volume = twin `weekly_km_4w` (actual, not planned). Each week ≤ +10 % (`R-LOAD-10` applied forward), with a cutback every 3rd or 4th week (−20 to −30 %). The ceiling is `min(peak_cap, the volume the ramp can reach by the peak)`. `peak_cap` is a goal parameter **[DECIDE]**. Output: `week_target {km, long_km, quality_n, low_intensity_share ≥ 80 %, strength_n}`.
2. **Allocate (days).** Place key sessions in order: race/CP (locked) → long run → quality 1 → quality 2 → Lower strength → Upper strength → easy fill. Each goes on the best day allowed by the availability pattern (max minutes, earliest/latest time), `R-48H`, `R-STR-72`, and the athlete's preferences (long run Sat by default, as in the `TEMPLATE` in `plan.js`).
3. **Fill (templates and doses).** For each slot, `catalog.eligible()` filters by phase, `requires`, `contra` (injury sites, Ramadan), and `menu.js` ranks the survivors (§4.4). The deterministic default is the top-ranked option with its progression step.
4. **AI selection (optional, one call).** The coach gets the week skeleton and, per slot, the top-3 options with dose ranges and one-line evidence. It returns JSON: `{slot_id, option_id, dose{...within range}, why}` per slot, plus a ≤ 120-word block summary. Anything invalid, missing or out of range falls back to the default for that slot.
5. **Validate and repair** (kernel). The candidate is written as `plan_version(status='proposed', kind='macro')` with a diff against the active version.
6. **Approve.** The athlete sees the diff (weekly km curve old vs new, key sessions moved or added) and accepts or rejects. Accept runs one transaction: activate, re-materialise `plan_active_day`, write the audit row.

**First regeneration ("Plan v2").** Because the imported plan breaks `R-LOAD-10` in 29 of 54 weeks and starts at 3.8× the current 4-week volume, the first macro run will produce a plan that looks very different (lower weekly km, a longer base). The athlete reviews it as its own decision, with the doctrine sources (06.4, 06.5, 06.6) cited in the diff view.

### 4.4 Personalisation: how KG, Memory and Twin enter the menu

`score(option, slot) = 0.35·purpose_fit + 0.25·personal_response + 0.20·context_fit + 0.10·progression_fit + 0.10·variety − penalties`

| Term | Computed from | Notes |
|---|---|---|
| `purpose_fit` | phase × week need (for example a durability deficit pulls long-run variants with run-walk structure). The twin `durability_km` and `fade_onset` drive it | deterministic table |
| `personal_response` | `template_stats` (nightly): n, adherence mean (adherence.go weights), TIZ, HR drift, RPE, pain in the next 48 h, skipped share | needs n ≥ 3, otherwise neutral 0.5 |
| `context_fit` | slot availability (minutes) vs estimated duration (`zones.estimate`), forecast WBGT/AQI vs `contra`, shoe availability (optional) | |
| `progression_fit` | distance of the dose from the last executed dose of the same purpose (one variable, one step) | |
| `variety` | days since the same template was used | prevents monotony (`load.js` monotony) |
| penalties | active memories at ≥ MEASURED evidence that name the template or purpose negatively (for example "fast opening → km-20 fade"), validated corr edges, athlete dislikes | HYPOTHESIS = 0 weight, mentioned only in rationale |

**`template_stats` refresh (nightly, ~ms in SQLite):** join `plan_session` (template_id) ↔ the matched activity (adherence) ↔ `fit_session` metrics ↔ `daily_log` pain over the next 48 h. graph-sync projects the same aggregates onto `:WorkoutTemplate` so they can be explored in the KG UI. The KG is the *view*. SQLite is the *source* the engine reads.

**Memory write-back from the engine (staged, as today):** a macro or micro outcome evaluated 3–14 days later (`ledger.go` `EvaluateOutcome` semantics) can propose an episodic memory such as "downgrade on HRV-reduced day → next quality TIZ 82 %". It goes in as `candidate` + `HYPOTHESIS` through the existing `applyWriteback` path, and promotion follows the existing rules.

### 4.5 LLM integration and token budget

| Call | When | Input (compacted) | Output | Expected tokens |
|---|---|---|---|---|
| `plan_macro` (new intent) | per macro proposal (≈ 1–4 per month) | stable block (rules, definitions; byte-identical for prefix cache) + week skeleton + ≤ 3 options per slot (ids, dose ranges, one-line evidence) + compact twin (`compactTwin`) + ≤ 8 memory snippets | JSON picks + ≤ 120-word summary | ≤ 12k in / ≤ 2k out |
| `plan_why` (new intent) | only when the athlete taps "why?" on a patch | the adjustment row + 3 snippets | ≤ 80 words | ≤ 3k in / 300 out |
| daily brief (existing) | already daily | **+ today's open/applied adjustments** (≤ 400 tokens) | existing schema | +0.4k |
| micro patches | every patch | — | template rationale | **0** |

- **Upper bound:** about 4 × 14k + 30 × 3.3k + 30 × 0.4k ≈ 165k tokens per month. Typical use is well below that. Spend stays under the existing `guard()` / monthly cap. Prices are not assumed here; costs are computed from usage as `llm.js` already does.
- `coach_run.req_hash` reuse applies: the same skeleton and context means no new call.
- Routing: `plan_macro` → DeepSeek by default. Add it to `COACH_CLAUDE_INTENTS` after an eval if wanted **[DECIDE]**.
- Grounding: the numbers in `why`/summary must appear in the version diff or the zone_set (`grounding.js`), otherwise the text is replaced by the deterministic rationale.
- Failure: provider down, cap reached, invalid JSON after one repair → the deterministic defaults are used and the proposal is labelled "engine-only".

### 4.6 Resource budget

| Work | Where | CPU / RAM | Frequency |
|---|---|---|---|
| Trigger evaluation + micro patch + validate | API process (`server/jobs.js` single runner) | < 5 ms, < 2 MB | after each sync, check-in, missed check, forecast pull |
| Macro generation (48 weeks) + validate | API process | ≈ 10–50 ms, < 10 MB | ≤ 1 per 7 days (plus explicit triggers) |
| `plan_active_day` materialisation | SQLite transaction | 404 rows, < 5 ms | on activation |
| `template_stats` refresh | nightly job 02:30 WIB, after the existing intel jobs | < 100 ms | nightly |
| Forecast pull (48 h, slots with outdoor sessions) | existing `google_geo` caps (`GOOGLE_DAILY_CAP`) | 2–4 calls per day | daily + before evening sessions |
| Storage | `plan.db` | macro version ≈ 100 KB (404 sessions × ~250 B), micro ≈ 1–3 KB | < 20 MB per year |

No new npm or Go dependency. No new systemd unit.

---

## 5. Data model

### 5.1 Store placement

- **New SQLite file `server/data/plan.db`** (owner `lumpad`, mode 600, WAL), opened like `intel.db`/`memory.db` with the same migration helper in `server/intel/db.js`.
  - Not `intel.db`: that store is documented as *derivable and rebuildable*, and plan versions and approvals are not.
  - Not `memory.db`: it is 51 MB of FTS and memories with a different access pattern.
  - A separate file keeps backup scope explicit. `deploy/backup.sh` and the planned off-site restic job must add it (audit C3).
- **Postgres mirror:** migration `0008_plan_engine.sql` creates the same tables in schema `plan`. `lumpadd shadow` mirrors them read-only, the same way it mirrors other stores. Existing `plan.day` becomes a view over `plan.active_day`. `plan.overlay` stays for the Go Phase-5 code until the port and is then retired in favour of `plan.adjustment`.
- **kv keys retired after migration:** `lumpad.scale` (→ micro versions), `lumpad.missed.<date>` (→ triggers + adjustments). `lumpad.results` stays (it is athlete input) but is read by the Benchmark Resolver.

### 5.2 Entity relationships

```mermaid
erDiagram
  plan_goal ||--o{ plan_version : "planned for"
  plan_version ||--o{ plan_session : "contains (delta)"
  plan_version ||--o| plan_version : "parent"
  plan_version }o--|| zone_set : "priced with (at creation)"
  plan_session }o--|| workout_template : "instance of"
  plan_active_day }o--|| plan_session : "points to"
  plan_trigger ||--o{ plan_adjustment : "causes"
  plan_adjustment }o--|| plan_version : "from"
  plan_adjustment }o--|| plan_version : "to"
  plan_adjustment ||--o{ plan_adjustment_event : "lifecycle"
  benchmark }o--o{ zone_set : "inputs"
  workout_template ||--o| template_stats : "personal response"
  availability_rule ||--o{ availability_exception : ""
  session_feedback }o--|| plan_session : "about"
```

### 5.3 DDL (SQLite; the Postgres mirror uses the same names in schema `plan`, `JSONB` for JSON and `TIMESTAMPTZ` for times)

```sql
-- ── goals and constraints ─────────────────────────────────────────────────────────
CREATE TABLE plan_goal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_date TEXT NOT NULL, name TEXT NOT NULL, cls TEXT NOT NULL CHECK (cls IN ('A','B','C','D')),
  distance_m REAL NOT NULL, target_s INTEGER,               -- NULL = finish before cut-offs
  params TEXT NOT NULL DEFAULT '{}',                         -- JSON: peak_cap_km, taper_weeks, long_run_max_km, cutback_every
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  valid_from TEXT NOT NULL, valid_to TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE availability_rule (                             -- weekly pattern; a new row supersedes by valid_from
  id INTEGER PRIMARY KEY AUTOINCREMENT, dow INTEGER NOT NULL CHECK (dow BETWEEN 0 AND 6),
  windows TEXT NOT NULL,                                     -- JSON [{from:"05:00", to:"06:30", max_min:90, kinds:["any"]}]
  pref TEXT,                                                 -- JSON {long:true} | {rest:true} | {quality:true}
  valid_from TEXT NOT NULL, valid_to TEXT, created_at TEXT NOT NULL
);
CREATE TABLE availability_exception (
  date TEXT NOT NULL, windows TEXT NOT NULL,                 -- [] = unavailable all day
  reason TEXT, source TEXT NOT NULL DEFAULT 'athlete', created_at TEXT NOT NULL, PRIMARY KEY (date, source)
);

-- ── benchmarks and zones ──────────────────────────────────────────────────────────
CREATE TABLE benchmark (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric TEXT NOT NULL,                                      -- tpace_s | vdot | lthr | hr_ends | hrmax | durability_km | heat_bpm_c
  value TEXT NOT NULL,                                       -- JSON scalar or array (hr_ends)
  source TEXT NOT NULL,                                      -- override | tt:CP4 | coros:fitness_daily | fit:twin/1@v52 | seed:athlete.js
  evidence_tag TEXT NOT NULL,                                -- MEASURED | CALCULATED | REPORTED | …
  measured_on TEXT NOT NULL, valid_from TEXT NOT NULL, superseded_by INTEGER REFERENCES benchmark(id),
  ref TEXT, created_at TEXT NOT NULL
);
CREATE INDEX benchmark_cur ON benchmark(metric, valid_from DESC);
CREATE TABLE zone_set (
  version INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
  benchmark_ids TEXT NOT NULL,                               -- JSON [ids]
  body TEXT NOT NULL,                                        -- JSON {hr:[[lo,hi]×6], pace:[[fast,slow]×6], daniels:{E,M,T,I,R}, heat:{model,coef}}
  hash TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX zone_set_one_active ON zone_set(active) WHERE active = 1;

-- ── templates ─────────────────────────────────────────────────────────────────────
CREATE TABLE workout_template (
  id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, purpose TEXT NOT NULL,
  body TEXT NOT NULL,                                        -- JSON (see §4.2.3)
  src TEXT NOT NULL,                                         -- coros:P10547 | kb:02.2#2 | lumpad:timeTrial
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (id, version)
);
CREATE TABLE template_stats (                                -- derived nightly; rebuildable
  template_id TEXT PRIMARY KEY, n INTEGER NOT NULL, adherence REAL, tiz REAL, hr_drift REAL, rpe REAL,
  pain48h_rate REAL, skip_rate REAL, last_done TEXT, updated_at TEXT NOT NULL
);

-- ── versioned, mutable plan ───────────────────────────────────────────────────────
CREATE TABLE plan_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES plan_version(id),             -- NULL only for the import
  base_macro_id INTEGER REFERENCES plan_version(id),         -- the macro version this delta chain sits on
  kind TEXT NOT NULL CHECK (kind IN ('import','macro','micro','manual','revert')),
  status TEXT NOT NULL CHECK (status IN ('draft','proposed','active','superseded','rejected','expired')),
  horizon_from TEXT NOT NULL, horizon_to TEXT NOT NULL,      -- dates this version (re)defines
  goal_id INTEGER REFERENCES plan_goal(id), zone_set_version INTEGER REFERENCES zone_set(version),
  engine_version TEXT NOT NULL,                              -- e.g. plan-engine/1.0.0 (+ kernel rule-set hash)
  inputs_hash TEXT NOT NULL,                                 -- idempotency: same inputs → no new version
  summary TEXT NOT NULL DEFAULT '{}',                        -- JSON weekly targets [{week, km, long_km, quality_n}]
  created_by TEXT NOT NULL CHECK (created_by IN ('engine','coach','athlete','import')),
  created_at TEXT NOT NULL, activated_at TEXT, superseded_at TEXT
);
CREATE UNIQUE INDEX plan_version_one_active ON plan_version(status) WHERE status = 'active';
CREATE INDEX plan_version_inputs ON plan_version(inputs_hash);

CREATE TABLE plan_session (                                  -- immutable rows; a change is a new row in a new version
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES plan_version(id),
  date TEXT NOT NULL, slot INTEGER NOT NULL DEFAULT 0,       -- 0 = main, 1 = second (strength PM)
  op TEXT NOT NULL DEFAULT 'set' CHECK (op IN ('set','clear')),  -- 'clear' = the version removes this date/slot
  template_id TEXT, template_version INTEGER,
  kind TEXT NOT NULL, label TEXT NOT NULL, week TEXT, phase TEXT,
  dose TEXT NOT NULL DEFAULT '{}',                           -- JSON bound params {km, reps, rep_m, …}
  steps TEXT NOT NULL DEFAULT '[]',                          -- JSON symbolic steps (z / daniels key / pace only for TT & race)
  est TEXT,                                                  -- JSON {sec, tl, km} at creation zone_set (display hint only)
  tags TEXT NOT NULL DEFAULT '[]', is_key INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
  note TEXT, origin TEXT NOT NULL,                           -- import | generated | patched | manual | coach_pick
  legacy TEXT,                                               -- JSON of the plan.json day (import only) for byte-identical rendering
  hash TEXT NOT NULL, UNIQUE (version_id, date, slot)
);
CREATE INDEX plan_session_date ON plan_session(date, slot, version_id);

CREATE TABLE plan_active_day (                               -- materialised effective plan; the ONLY table consumers read
  date TEXT NOT NULL, slot INTEGER NOT NULL DEFAULT 0,
  session_id INTEGER NOT NULL REFERENCES plan_session(id), version_id INTEGER NOT NULL REFERENCES plan_version(id),
  PRIMARY KEY (date, slot)
);

-- ── triggers and the adjustment audit log ──────────────────────────────────────────
CREATE TABLE plan_trigger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
  type TEXT NOT NULL, source TEXT NOT NULL,                  -- sync | checkin | missed_check | forecast | nightly | athlete | coach
  dedupe_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,                                     -- JSON: the measured inputs that fired it (values + their row refs)
  route TEXT CHECK (route IN ('micro','macro','render','none')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled','ignored','escalated')),
  handled_at TEXT, note TEXT
);
CREATE TABLE plan_adjustment (                               -- append-only (triggers below)
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
  trigger_id INTEGER REFERENCES plan_trigger(id),
  from_version INTEGER NOT NULL REFERENCES plan_version(id), to_version INTEGER NOT NULL REFERENCES plan_version(id),
  loop TEXT NOT NULL CHECK (loop IN ('micro','macro','manual','revert')),
  scope_from TEXT NOT NULL, scope_to TEXT NOT NULL,
  operators TEXT NOT NULL,                                   -- JSON ["move","downgrade"]
  diff TEXT NOT NULL,                                        -- JSON [{date, slot, before:{template,label,dose,kind}, after:{…}}] + weekly km before/after
  rules TEXT NOT NULL,                                       -- JSON kernel report: [{id, status:'pass'|'repaired'|'block', detail}]
  inputs TEXT NOT NULL,                                      -- JSON snapshot: twin version, zone_set, readiness, forecast, availability
  rationale_det TEXT NOT NULL,                               -- deterministic explanation (always present)
  rationale_llm TEXT,                                        -- coach text after grounding (nullable)
  coach_run_id INTEGER,                                      -- memory.db coach_run.id (cross-db ref)
  llm_tokens INTEGER, auto INTEGER NOT NULL DEFAULT 0,       -- 1 = applied without approval (safety direction)
  expected TEXT                                              -- JSON checks for outcome evaluation (pain_max, tiz_min, …)
);
CREATE TABLE plan_adjustment_event (                         -- lifecycle; the adjustment row itself never changes
  id INTEGER PRIMARY KEY AUTOINCREMENT, adjustment_id INTEGER NOT NULL REFERENCES plan_adjustment(id),
  at TEXT NOT NULL, event TEXT NOT NULL CHECK (event IN ('proposed','applied','rejected','expired','reverted','evaluated')),
  by TEXT NOT NULL,                                          -- athlete | engine | system
  detail TEXT                                                -- JSON (outcome {verdict: helped|neutral|harmed|unknown, observed})
);
CREATE TRIGGER plan_adjustment_no_update BEFORE UPDATE ON plan_adjustment BEGIN SELECT RAISE(ABORT, 'plan_adjustment is append-only'); END;
CREATE TRIGGER plan_adjustment_no_delete BEFORE DELETE ON plan_adjustment BEGIN SELECT RAISE(ABORT, 'plan_adjustment is append-only'); END;
CREATE TRIGGER plan_session_no_update BEFORE UPDATE ON plan_session BEGIN SELECT RAISE(ABORT, 'plan_session rows are immutable'); END;

-- ── feedback ──────────────────────────────────────────────────────────────────────
CREATE TABLE session_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, session_id INTEGER REFERENCES plan_session(id),
  activity_id TEXT, rpe INTEGER CHECK (rpe BETWEEN 1 AND 10), verdict TEXT CHECK (verdict IN ('too_easy','right','too_hard')),
  text TEXT, tags TEXT, created_at TEXT NOT NULL
);
```

### 5.4 Version semantics

- **Effective plan** = the base macro (or import) sessions, overlaid in order by each later active-chain version's `set`/`clear` rows for its horizon. `plan_active_day` stores the result. It is recomputed in the same transaction that flips `status='active'`, so readers never see a half state.
- **Activation transaction:** `BEGIN IMMEDIATE` → check `expected_parent == current active` (optimistic concurrency) → old active becomes `superseded` → new one becomes `active` → rebuild `plan_active_day` for `[horizon_from, horizon_to]` → `plan_adjustment` + event `applied` → `COMMIT`.
- **Revert** = a new `revert` version whose rows copy the target version's sessions for the affected dates. History is never deleted.
- **Past days are immutable:** the kernel rejects any version that changes a date `< today` (WIB). Exception: a `manual` correction, which is audited.
- **Idempotency:** `inputs_hash = sha256(engine_version, rule-set hash, active version id, zone_set, twin.inputs_hash, availability rows, goal rows, trigger payload)`. The same hash means the existing proposal is returned and nothing new is written.

### 5.5 API (new routes; authenticated athlete session or bearer only, never public kv)

| Route | Purpose |
|---|---|
| `GET /api/plan/range?from&to` | effective sessions, **resolved** against the active zone_set (replaces `plan.json` imports for the UI) |
| `GET /api/plan/day/:date` | one day + the daily menu (A/B/C) + open proposals |
| `GET /api/plan/versions` · `GET /api/plan/versions/:id/diff?against=` | history and diffs |
| `POST /api/plan/proposals/:id/accept` · `/reject` | approval (body: `expected_parent`) |
| `POST /api/plan/menu/:date/choose` | athlete picks option B/C → `manual` trigger |
| `POST /api/plan/revert/:adjustmentId` | undo |
| `PUT /api/plan/availability` · `PUT /api/plan/goal` | constraint edits (each raises a trigger) |
| `POST /api/plan/feedback` | RPE / too hard / text |
| `GET /api/plan/audit?from&to` | the adjustment log (UI "Plan changes" list) |

Server-side readers (`twin.js`, `context.js`, `pipeline.js`, `features.js`, `forecast.js`, `tools.js`, `matrices.js`) switch from `import PLAN from plan.json` to `planRange()`/`planDay()` from `server/plan/store.js`. Go gets the same data through the Postgres mirror, which replaces the embed.

---

## 6. Phased rollout

Each phase has an exit gate. Phases P0–P1 change **no** calculation and are safe during G3. P1's consumer cutover waits until G3 has passed.

| Phase | Window (target) | Scope | Exit gate |
|---|---|---|---|
| **P0 Foundations (shadow)** | 24 Nov – 5 Dec 2026 | `plan.db` + migrations; import `plan.json` as version 1 (`kind='import'`, `legacy` column keeps each original day); Template Catalog seeded (COROS codes, Lumpad builders; KB 02.2 structure transcribed with `src` pointers); Benchmark Resolver + zone_set in **read-only** mode (computes, nobody reads); Guardrail Kernel runs on the imported plan and produces a **report** (expect the 29/54 `R-LOAD-10` weeks). Backup scripts include `plan.db` | (a) `plan_active_day` rendered as days equals `plan.json` byte for byte (golden test); (b) kernel property tests green; (c) the JS kernel matches Go `replan.go` on its existing test vectors; (d) no change to any existing endpoint output |
| **P1 Read-path cutover** | after G3 passes (≈ 5 – 19 Dec) | `/api/plan/*` read routes. Replace the 9 `plan.json` imports with `planRange/planDay`. `calendar.js` and the UI read the API (with an offline cache in the PWA). The Go embed is replaced by the mirror. `tools/build_season.mjs` is kept only as an import tool | golden UI crawl (Home, Day, Calendar, Checkpoints, SeasonHub) identical; twin `plan` section identical; shadow mirror parity; p95 `/api/plan/range` < 20 ms |
| **P2 Symbolic zones live** | Dec 2026 – early Jan 2027 | `resolve.js` renders HR/pace from the active zone_set. A benchmark change → new zone_set → re-render. CP1 (19 Dec 5K TT) is the first real benchmark event. Profile shows "zones since …" with provenance | a zone_set change produces a `render` trigger and **no** version. Displayed paces match `zones.js`/`vdot.js` for the same inputs |
| **P3 Micro loop (deterministic)** | Jan 2027 (2 weeks shadow, then live) | Trigger Router + operators. `scaler.js` and `missed.js` are re-implemented as operators (same checks, same texts; their unit tests are ported). `plan_adjustment` audit. Proposal card replaces ScaleCard. Daily menu A/B/C on Home. **Shadow first:** proposals are logged, not applied, and reviewed against what the athlete did. Requires audit C1/C2 closed (login on) before any auto-apply | 14 shadow days: 0 kernel violations in applied output; every missed-card scenario reproduced; athlete agrees with ≥ 80 % of proposals; no proposal on race/CP/gate days |
| **P4 Macro regeneration (deterministic)** | late Jan – Feb 2027 | Periodise/allocate/fill generator. Availability screen. Goals table seeded from `RACES` + `CHECKPOINTS`. **Plan v2 proposal** reviewed with the athlete (diff view, weekly km curve). Escalation rules on | Plan v2 approved or rejected by the athlete; generator property tests (any goal/availability → a valid plan); regeneration is idempotent; frozen horizon respected |
| **P5 AI Coach in the loop** | Mar – Apr 2027 (Ramadan Feb–Mar: deterministic only) | `menu.js` scoring with `template_stats` (needs ~6–8 weeks of P3/P4 data), the `plan_macro` intent (constrained JSON), and `plan_why`. Patch summaries in the daily brief. KG `:WorkoutTemplate` projection. Eval: replay 2026-11 → 2027-03 days | eval: ≥ 95 % of LLM picks valid without fallback, 0 kernel violations after validation, rationale grounding 100 % (numbers in diff), token use within §4.5 |
| **P6 COROS watch write-back (optional)** | Apr – mid-May 2027 | push **approved** sessions for the next ≤ 14 days via COROS `createScheduledWorkout` / `updateScheduledWorkout`. The plan-A course on the watch is replaced by Lumpad sessions **[DECIDE]** | write-back dry-run log matches the plan for 14 days; one-tap rollback to the COROS plan-A schedule |
| **P7 Go port** | with redesign Phase 5/6 (after 20 Jun 2027 freeze) | port the kernel/operators/generator to `lumpadd/internal/decision` with golden vectors from JS (the same pattern as G1/G2); `plan.overlay` retired | G5 (property tests + 2 weeks of reviewed shadow proposals) |

**Freeze handling:** no software cutover between **30 May – 20 Jun 2027** and **3 – 24 Oct 2027**. During those windows (and in any taper) the engine produces only safety-direction micro patches (`downgrade`, `trim`, `drop`, `variant`, `time_shift`). Macro proposals are held until the window ends.

### 6.1 Test strategy

| Test | What it proves |
|---|---|
| Import golden | version 1 renders exactly `plan.json` (every field, 404 days) |
| Kernel property tests (`node --test`, seeded random plans and contexts) | `validate(repair(x))` holds; repairs never increase load; locked days are never touched |
| Operator parity | each `missed.js`/`scaler.js` test case gives the same scenario/verdict through the new operators |
| Go parity vectors | `replan.go` test vectors match the JS kernel; later, JS-generated vectors drive the Go port |
| Generator properties | ramp ≤ +10 %, cutback cadence, taper window, ≥ 80 % low intensity, 48 h spacing, availability respected, for random goals/availability |
| Idempotency and anti-thrash | the same inputs produce no new version; a flapping readiness signal produces ≤ 1 proposal per day |
| Replay eval | for each day of 2026 history with check-ins, generate the triggers and patches the engine *would* have made. Review the sample by hand and score it against what happened |
| LLM contract | invalid/out-of-range/missing picks fall back; ungrounded numbers are removed; the cap reached → engine-only |

### 6.2 Observability

- `GET /api/plan/status`: active version, zone_set, open proposals, last trigger per type, kernel report summary, token use this month for `plan_*` intents.
- Weekly line in the weekly review: adjustments applied/rejected, outcome verdicts, adherence by template.
- Alert in the existing ops view if the kernel blocks a version three times in a row (a sign of a broken input such as missing health data).

### 6.3 Rollback

- **P1–P2:** the env flag `PLAN_SOURCE=json|engine` (default `json` until the P1 gate passes) switches readers back to `plan.json`.
- **P3+:** `POST /api/plan/revert/:id` for single changes. Re-activating the import version restores the original season.
- `plan.db` is in the nightly backup; the restore is tested with the off-site job (audit C3).

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Plan v2 looks very different (much lower volume), and the athlete distrusts it | The diff view cites the guard and the 4-week actual volume. The athlete can keep the import active and only take the micro loop (P3) |
| Too many proposals (notification fatigue) | dedupe, one proposal per date, safety-direction auto-apply **[DECIDE]**, the daily menu instead of a separate prompt |
| LLM hallucinated rationale | grounding check, with the deterministic rationale always stored and shown when grounding fails |
| Public write paths (audit C1/C2) used to change the plan | plan writes only through authenticated routes; P3 auto-apply blocked until login is enforced |
| G3 reset by an accidental calculation change | P0/P1 add tables and readers only; existing `src/lib` math is untouched; the P1 cutover starts after G3 |
| Garmin-era metrics leaking into benchmarks | Benchmark Resolver reads COROS device scores only; FIT-derived metrics follow the combined series as decided on 23 Nov |
| Aura or provider outage | the runtime path uses SQLite only; KG and LLM are optional enrichers |
| Template catalog drift from KB updates | each template keeps `src` and the hash of its KB section; a nightly check against `kb_docs.hash` flags changed sources for review |

---

## 8. Decisions needed [DECIDE]

| # | Decision | Recommendation |
|---|---|---|
| D1 | Safety-direction micro patches (downgrade, trim, rest, heat/indoor variant): auto-apply with undo, or always ask? | **Auto-apply with undo and a Home notice**, after login is enforced. Moves of key sessions and any load increase always ask |
| D2 | `peak_cap_km` for the JRF 2027 cycle (the imported plan peaks at 96 km/wk) | let the ramp decide, with a ceiling of **60 km/wk** until two consecutive pain-free 8-week blocks; revisit at CP6 (15 May 2027) |
| D3 | COROS watch: keep COROS plan A on the watch, or push Lumpad sessions (P6)? | push Lumpad sessions for the next 14 days after P5 passes; until then, Lumpad is the source of truth and the watch shows plan A + Lumpad notes |
| D4 | Availability source: manual weekly pattern + exceptions, or calendar import? | **manual first** (privacy, no new OAuth); calendar import later as a read-only exception source |
| D5 | Coach provider for `plan_macro` | DeepSeek Flash by default; Claude after an eval if the picks are measurably better |
| D6 | Store: SQLite `plan.db` now with a Postgres mirror, or Postgres-native now? | **SQLite now** (production writer is Node; no hot-path dependency on Postgres); Postgres-native at the Go cutover |
| D7 | Strength sessions inside the engine (Upper/Lower/Full scheduling) or display-only? | inside the engine from P4 (`R-STR-72` needs them), with templates from KB 02.3 |

---

## 9. Files this plan will touch (for review, not yet changed)

| New | Changed (from P1 on) |
|---|---|
| `server/plan/{benchmarks,zoneset,kernel,catalog,macro,micro,menu,resolve,store,triggers}.js` + `*.test.js` | `server/intel/{twin,context,pipeline,features,forecast,tools,matrices}.js` (PLAN import → store) |
| `server/plan/templates/*.json` (catalog seed) | `src/lib/calendar.js`, `src/Home.jsx`, `src/DayPage.jsx`, `src/Calendar.jsx`, `src/ScaleCard.jsx` → Proposal card, `src/MissedSession.jsx` → menu |
| `server/plan/db.js` (plan.db migrations) | `server/index.js` (routes), `server/jobs.js` (trigger hooks, nightly stats) |
| `lumpadd/internal/db/migrations/0008_plan_engine.sql` (mirror) | `lumpadd/internal/shadow` (mirror list), `lumpadd/internal/graph/project.go` (`:WorkoutTemplate`, PlanDay from `active_day`) |
| `src/PlanDiff.jsx`, `src/Availability.jsx`, `src/PlanAudit.jsx` | `deploy/backup.sh` (+ `plan.db`), `package.json` test glob (+ `server/plan/*.test.js`) |
| | `tools/build_season.mjs` → import-only; `tools/sync_go_data.mjs` (drop the plan embed after P1) |

Nothing in `src/lib/{vdot,zones,load,readiness,gate,prescription}.js` changes. The engine calls those functions.
