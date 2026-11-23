# Plan engine screens: evidence (prepared by the implementer) — dormant, opt-in

Date: 23 Nov 2026 · new files `src/PlanEngine.jsx`, `src/PlanMenuCard.jsx`, `src/plan-engine.css`, `src/lib/planui.js`

Visible only when the plan flag is on (`?plan=api`, `localStorage.lumpad.planApi=1`, or build `VITE_PLAN_SOURCE=engine`): menu entry "Plan engine (preview)", a Calendar sub-item, and the "Today's options" card on the Day page. The page route `/planengine` exists for everyone but shows an explanatory empty state without a plan database.

Screens: **Proposals** (build a season plan with the load-guard baseline, cutback and peak-cap choices; proposal cards with a weekly km chart old vs new, peak, days changed, postponed checkpoints, per-week diff, rule ids, Accept / Reject; a red notice when the app is still reading plan.json), **Goals** (add, edit, archive, seed from the race calendar; server validation shown), **Availability** (minutes per weekday, preferences, exceptions), **Zones** (zone set with where each benchmark comes from: setting / measured / default), **History** (every change with status and "Undo this change").

## Verified
- `planui.test.js`: pure helpers (weekly series, week grouping, availability and goal form ⇄ API payloads, validation messages).
- `planengine.render.test.js`: the real components bundled with esbuild and rendered to HTML with `react-dom/server`: proposal card content and both actions, chart text alternative and one bar pair per week, micro vs season card, generate-card trade-off text and disabled state without goals, labelled controls, loading states without data, tablist role.
- `vite build` succeeds (lazy chunk about 20 kB); `contract.test.js` (every UI `/api` path exists, UI write methods match the route table) passes.
- Routes behind the screens tested in `api.test.js` (401 without a user, validation, menu choose with ordered undo).

## NOT verified
- **Nothing was looked at in a browser**: no screenshots, no phone-width layout check (360 px is a requirement, NFR-USE-3), no light/dark visual check, no keyboard or screen-reader pass beyond the static markup. There is no browser on this server.
- Chart colours and contrast are not checked against WCAG.
- The screens have never run against real data.
