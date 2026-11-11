# Information architecture (5 tabs)

| Tab | Purpose | Contents | Data source |
|---|---|---|---|
| **Home** | One-screen summary, ordered by the pre-run decision | sync freshness · gate · today's session · 4 readiness tiles (Recovery, Sleep, HRV, Form·ACWR) · week plan vs actual · last activity · next checkpoint + race · VDOT progress | all of the below, condensed |
| **Readiness** | Everything about recovery and load | gate + morning check-in · Recovery · Sleep (stages, score) · HRV (range, 7-day vs baseline) · Resting HR · Acute/Chronic/ACWR (zones) · daily training load · Fitness/Fatigue/Form/Ramp · weekly-km ramp + long-run 110 % rule · 7-day Sleep HR · weekly ◇ tempo gate | COROS (published numbers) · `[calc]` fitness/fatigue/form/ramp from COROS long/short-term load |
| **Aktivitas** | All activities | month list, filter (all/run/walk/strength), totals; detail: metrics, TE, load, weather, shoe, laps, plan vs actual | COROS (primary) merged with Strava (shoe, weather, name) |
| **Kalender** | The plan | Kalender (month grid, ✓ for days run, day details) · Checkpoint (20 CP, kill gate, fitness path) · Race (countdown, projection, race week, C-races, rules) | plan v4.5 + results + settings |
| **Profil** | Setup and reference | Shoes (+roles) · Race date · VDOT (+COROS assessment) · Connections (COROS direct, Strava, daily sync, fallback tools) · athlete, locked rules, theme, system | Strava gear, COROS, settings |

Metric definitions (Readiness)
- **Acute / Chronic / ACWR**: COROS short-term load, long-term load, load ratio — as published. Zones 0.8 / 1.3 / 1.5 are a literature prior (Gabbett 2016, PMID 26758673) shown for information, not as a gate; ACWR has methodological critiques (Impellizzeri 2020, PMID 32502973).
- **Fitness / Fatigue / Form / Ramp**: CTL/ATL/TSB idea applied to COROS long/short-term load: fitness = long-term, fatigue = short-term, form = fitness − fatigue, ramp = fitness now − fitness 7 days ago. Not on the TrainingPeaks TSS scale; no "good/bad" form thresholds are invented.
- **Volume ramp**: weekly run km vs the average of the previous 4 weeks, and the project's rule: a long run ≤ 110 % of the longest run in the previous 30 days.
- Missing data is shown as "belum ditarik" — never estimated.
