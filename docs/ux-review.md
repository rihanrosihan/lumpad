# Lumpad UX review — usability pass 1 (12 Nov 2026)

**Method and its limits.** No sessions with real users were run (single-user app, pre-season). Findings come from
(1) a heuristic evaluation against Nielsen's heuristics and WCAG 2.2 AA, (2) an automated audit (axe-core 4.10, tap-target and
font-size measurements, light + dark, 390×844), and (3) scripted walkthroughs of the key scenarios. Everything marked *measured*
was re-run after the changes. Observed-behaviour claims (e.g. "the athlete will hesitate here") are hypotheses to confirm in
the first weeks of real use. Visual identity, tokens, tab structure and component language were kept.

## Scenarios

| # | Scenario | Who / when | Success = |
|---|---|---|---|
| S1 | Pre-run check | Returning, daily, ~04:30, one hand, half awake | Verdict + what to do instead, in seconds |
| S2 | Weekly look-ahead | Returning, Sunday evening | See next week's sessions, step through days |
| S3 | Checkpoint result | CP day | Enter a TT time, get green/yellow/red |
| S4 | Is my data fresh / saved? | Any time, flaky mobile network | Trust that entries are saved and synced |
| S5 | First visit / new device | First-time | Understand the tabs, empty states explain themselves |

## Findings, fixes, priority

Impact = effect on the daily pre-run task; effort S/M/L. All P0/P1 items below are implemented.

| P | Problem (heuristic) | Evidence | Change | Scenario | Effort |
|---|---|---|---|---|---|
| P0 | Season chart = 53 tap targets 5 px wide (Fitts, 2.5.8) | *measured*: 53× `5×64` buttons | One large touch/drag target + month letters; month arrows remain the accessible path | S2 | S |
| P0 | Verdict scrolls out of view while typing (visibility of system status) | walkthrough: form starts below the fold | Sticky mini status once the big verdict scrolls away | S1 | S |
| P0 | Contrast failures: 172 nodes (1.3–4.5:1) — dimmed calendar cells, status colours as text, muted on tint, dark accent | *measured* axe | Token-level fix (text variants via `color-mix`, `--accent-bg`, no opacity dimming) → **0** | all | M |
| P0 | Optimistic "saved" with no failure path (error prevention / recovery) | code review: failed PUT dropped silently | Per-key retry queue (10 s + on `online`), offline bar that is true | S4 | M |
| P1 | COROS data is a small secondary button (recognition over recall) | review | Primary full-width "Pakai data COROS"; 2 taps Home→verdict | S1 | S |
| P1 | 8 optional-looking fields for a 15-second task; pain slider ambiguous 0 vs unanswered | review | 4 core fields; rest under "Data tambahan"; pain = 0–6+ chips, starts unanswered | S1 | M |
| P1 | Red/yellow verdict says what's wrong, not what to do | review | "Gantinya: easy di 7:01–8:21 /km, atau istirahat" (from VDOT) | S1 | S |
| P1 | TT time saved on blur; invalid input silently ignored | code review | Explicit Simpan + Enter, inline validation, plausibility check | S3 | S |
| P1 | 20-checkpoint list buries the next one under past ones | walkthrough | Past items collapsed ("Sudah lewat (n)"); next opens automatically | S3 | S |
| P1 | Calendar: no way to step between days; ambiguous "W9 34" | review | Sheet prev/next day, "Ke hari ini", "Mgg" header + legend text | S2 | S |
| P1 | Calendar a11y: invalid ARIA roles, cells labelled by date only | *measured* 53+1 violations | Roles removed, cell labels carry session + km | S2 | S |
| P1 | Sheet: no focus management | review | Focus into dialog, trap, Esc, restore | S2 | S |
| P1 | Sync failure looks the same as "no data" | code review | Separate loading / none / error states | S4 | S |
| P2 | Tap targets <44 px (strip 42, seg 40, buttons 40) | *measured* | ≥44 px everywhere except native checkboxes (48 px label row) | all | S |
| P2 | Text down to 9 px | *measured* | Floor 11.2 px (dense calendar labels), rest ≥12 px | all | S |
| P2 | Profile mixed daily-use and developer tools (env-var instructions) | review | Sync centre first; Strava API / FIT / literature collapsed as fallback tools | S5 | S |
| P2 | No skip link / focus on tab change | review | Skip link; focus moves to main on tab change | all | S |

## Before → after (measured, 5 screens × light/dark)

| Metric | Before | After |
|---|---|---|
| axe violating nodes (WCAG 2 A/AA + best practice) | 172 | 0 |
| Controls under 44 px (excl. native checkboxes) | 108 | 0 |
| Smallest font | 8.96 px | 11.2 px |
| Taps Home → verdict (COROS data present) | ~6 + scroll | 2 |
| Scripted scenario checks | – | 19/19 pass, no console errors |

## Not done (backlog, by priority)

1. **Android back button closes the sheet / returns to previous tab** (history state) — M.
2. **Swipe between months** — S, low value next to the new controls.
3. **Plan editing in-app** (move/swap a day, with reason) — L; planned for phase 4.
4. **Post-run log prompt** (pain, fuel taken, tibia) after sync — M; needs sync data (phase 3).
5. **Real-user validation:** after two weeks of use, check (a) time from opening the app to verdict, (b) how often
   "Data tambahan" is opened, (c) whether the "Gantinya" line gets followed. Cheap to instrument with local timestamps.
6. Screen-reader pass with VoiceOver/TalkBack — automated checks cannot judge reading order or wording.
