# Knowledge-base cleanup — what to change in the Running project (drafted 2026-11-23)

Lumpad reads the exported project documents; it cannot edit the project itself. Paste these edits into the project, then re-import the export.
Everything below comes from the Knowledge-base audit card (Coach → Knowledge Graph) and the docs' own front-matter.

## 1. Close two open items in `00.4` (the two "high" findings)
Both are already non-blocking in their own text, so they can be closed or parked:

- **#4b Anchor threshold mana untuk preskripsi** → move to "Resolved / parked":
  > Parked 23 Nov 2026. Quality 2027 is pinned to goal pace (`06.4`), not to the threshold anchor. Training bands follow COROS; race pacing follows the conservative value. The formal fitness test is CP-W12 (Wed 24 Mar 2027, `06.4` §20.6); revisit only if a post-race test window opens earlier.
- **#4c Verifikasi zona live vs snapshot 13 Sep** → one-time task, do it in the COROS app (Settings > Zones), then close:
  > Closed <date>. Live zones checked in COROS (LTHR <bpm>, threshold pace <m:ss>); changes vs 13 Sep snapshot: <none / list>. Update `00.2` §B only if a band moved by more than 5 s/km or 3 bpm.

## 2. Repoint references to archived docs (the four "medium" pointer findings)
Only where the reference is meant as "current", not as history:

| In | Points at | Replace with | Why |
|---|---|---|---|
| `00.2`, `00.3`, `07.1` | `03.4` (SUPERSEDED) | `03.1` (its `superseded-by`) | 03.4's scenarios were replaced by the safety-first pacing revision |
| `00.3` | `03.6` (ARCHIVE) | `03.1` (target and pacing); Runna (daily plan) | 03.6's `superseded-by` says so |

Keep the `03.4` mention in `00.2` lines 63–65 as written: it names the *method* (offset-preserving) the derived bands came from, which is history on purpose.

## 3. Sync the index documents `00.1`–`00.4` (the "reports its own staleness" findings)
`00.1`, `00.3`, `00.4` and `06.4` §13 each say the indexes are not synced to the latest versions. One pass, in this order:
1. `00.4`: apply item 1 above; mark #38/#40 (Borobudur go/no-go) resolved — Borobudur ran on 15 Nov 2026 (DNF, black flag).
2. `00.3`: add the Borobudur result and the 04.1 vs HM-lap conflict to the log.
3. `00.2`: refresh the "current numbers" (HR@pace, load) from `04.8`/`04.9`.
4. `00.1`: update the navigation table and the "last synced" date; remove the "Belum disinkronkan" lines.
The other flagged docs (`03.2`, `03.5`, `03.9`, `04.4`) carry deliberate "no longer valid" notes on old sections; leave them and press **Done** in the audit card.

## 4. Archive the finished cycle (the "marked active but last dated 60–90 days ago" findings)
Set `status:` to `ARCHIVE` (history) or `REFERENCE` (still useful) in:
`02.3` (strength, FM cycle ended 15 Nov) · `03.2` (10-week schedule, ended 25 Oct) · `03.3` (load context) · `04.4` (Urbana qualifier) · `05.1` (nutrition context — REFERENCE if still current) · `06.2` (addendum log, superseded by the Nov–Dec block) · `07.1` (REFERENCE).
Lumpad treats ARCHIVE docs as history: their claims stop being used as current and the audit stops flagging them.
