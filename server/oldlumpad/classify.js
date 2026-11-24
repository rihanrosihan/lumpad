// Keep / Transform / Skip rules from docs/old-lumpad-context-absorption-blueprint.md section 4. First match wins; every entry gets exactly one rule id.
// Sensitivity: S0 athletic, S1 identity-adjacent, S2 health, S3 third-party personal data, S4 credentials (never parsed, never sent anywhere).
const R = [
  ['K1', 'keep', ['training/context-enrichment/*'], 'S1'],
  ['K2', 'keep', ['races/events/2026-jakim/analysis/*/context_enrichment_answers.*', 'races/events/2026-jakim/analysis/*/full-context-hminus7-to-hplus7.md'], 'S1'],
  ['K3', 'keep', ['health/injuries/injury-log.md', 'health/medical-consultations/*'], 'S2'],
  ['K4', 'keep', ['races/race-history.md'], 'S0'],
  ['T1', 'transform', ['athlete-profile/athlete-profile.md'], 'S2'],
  ['T2', 'transform', ['races/events/2026-jakim/analysis/*/data/stop_segments.csv', 'races/events/2026-jakim/analysis/*/data/manual_stop_context.csv', 'races/events/2026-jakim/analysis/*/data/official_chip_splits.csv',
    'races/events/2026-jakim/analysis/*/data/official_vs_watch_checkpoints.csv', 'races/events/2026-jakim/analysis/*/data/weather_timeline.csv', 'races/events/2026-jakim/analysis/*/data/phase_segments.csv',
    'races/events/2026-jakim/analysis/*/data/source_reconciliation.json', 'races/events/2026-jakim/analysis/*/data/manifest.json', 'races/events/2026-jakim/analysis/*/README.md'], 'S0'],
  ['T3', 'transform', ['performance-analysis/benchmarks.md', 'performance-analysis/datasets/long-run-database.md', 'performance-analysis/reports/performance-analytics.md'], 'S0'],
  ['T4', 'transform', ['nutrition/nutrition-fueling.md', 'recovery/protocols/taper-protocol.md', 'recovery/metrics/sleep-hrv-data.md', 'races/events/2026-jakim/plans/2026-06-14-jakim-full-marathon-plan.md'], 'S2'],
  ['T5', 'transform', ['training/methodology/*', 'training/cross-training.md', 'training/strength/strength-training.md'], 'S0'],
  ['T6', 'transform', ['obsidian/Decisions/*'], 'S2'],
  ['T7', 'transform', ['races/events/*/results/*.sqlite'], 'S3'],
  ['S1', 'skip', ['races/events/2026-jakim/analysis/*/data/*', 'races/events/2026-jakim/analysis/*.py', 'races/events/2026-jakim/analysis/*/context_enrichment_questions.md', 'races/events/2026-jakim/analysis/*/full-context*'], 'S0'],
  ['S2', 'skip', ['races/events/*/results/*', 'races/events/*/crawl.py'], 'S3'],
  ['S3', 'skip', ['exports/*'], 'S4'],
  ['S4', 'skip', ['graphify-out/*'], 'S0'],
  ['S5', 'skip', ['archive/*', 'automation/*', 'coach.py', 'ask.sh', 'chat.sh', 'test_llm.py', '__pycache__/*'], 'S4'],
  ['S6', 'skip', ['references/ai_conversation_history.md'], 'S1'],
  ['S7', 'skip', ['references/norwegian-method/*'], 'S0'],
  ['S8', 'skip', ['logs/*'], 'S1'],
  ['S9', 'skip', ['obsidian/Briefings/*', 'obsidian/Plans/*', 'obsidian/Reviews/*', 'obsidian/performance-analysis/*'], 'S2'],
  ['S10', 'skip', ['training/logs/*', 'training/plans/*', 'training/strength/programs/*'], 'S0'],
  ['S11', 'skip', ['races/events/2026-jrf/*', 'races/events/2025-jrf/*', 'races/Analisis_Cuaca_vs_BTN_JAKIM_2026.md', 'races/events/2026-jakim/plans/*', 'races/events/2026-jakim/README.md', 'races/events/2026-borobudur-marathon/*'], 'S3'],
  ['S12', 'skip', ['performance-analysis/decision-card.md', 'health/health-metrics.md', 'health/README.md', 'nutrition/README.md'], 'S2'],
  ['S13', 'skip', ['AI_COACHING_OS_PLAN.md', 'file-index.md', 'docs/*', '*.md', '*.yaml', '*.jpg', 'knowledge-graph.md', 'prompts/*', 'equipment/*', 'templates/*', 'health/*', 'recovery/*', 'training/*', 'races/*', 'performance-analysis/*',
    'nutrition/*', 'athlete-profile/*', 'obsidian/*'], 'S0'],
]
const re = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
const RULES = R.map(([id, decision, globs, sens]) => ({ id, decision, sens, res: globs.map(re) }))
export function classify(name) {
  for (const r of RULES) if (r.res.some((x) => x.test(name))) return { rule: r.id, decision: r.decision, sensitivity: r.sens }
  return { rule: 'UNK', decision: 'skip', sensitivity: 'S0' }
}
// only these decisions are ever read as text by the pipeline; T7 (SQLite) is read separately and only for aggregates
export const textual = (c) => (c.decision === 'keep' || c.decision === 'transform') && c.rule !== 'T7'
export const QUARANTINE = new Set(['S3', 'S4'])   // sensitivity classes whose files are never parsed as text
