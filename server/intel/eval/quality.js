// Coaching answer quality (deterministic, free): does an answer follow the coach voice and the structure its task asks for, and is it grounded and actionable?
// Used three ways: at write time (parsed.quality, shown in /api/health/deep), by the replay CLI over stored real answers, and by tests with fixtures.
// Not an LLM judge: it measures what can be measured exactly (jargon, number count, length, structure, grounding). Tone and correctness still need a human.

export const JARGON = [/\bTSB\b/, /\bCTL\b/, /\bATL\b/, /\bACWR\b/, /\bEF\b/, /\bGCT\b/, /\bPa:?HR\b/i, /\bWBGT\b/, /\bVDOT\b/, /HR\s*@\s*8/i, /\bz-?scores?\b/i, /\bSD\b/, /\bn\s*=\s*\d/i, /\bp\s*[<=]\s*0?\.\d/i, /\bR²\b/, /\bstandard deviations?\b/i]
const SUMMARY_MAX = { daily_brief: 360, weekly_review: 520, session_review: 250, race_plan: 520, question: 520 }
const LIMITS = { summary_numbers: 4, analysis_numbers: 8 }   // the voice rule says at most 3 and at most 6; one and two of slack for how numbers are counted
const HEADINGS = { daily_brief: [/how you are today|today.s run and load/i, /what i would do/i], weekly_review: [/next week/i], session_review: [/what went well/i, /next steps/i], race_plan: [], question: [] }
const ID_WORDS = /\b(yang|dan|kamu|untuk|dengan|tidak|akan|atau|pada|dari|sudah|karena|lebih|saat|hari|lari)\b/gi

const strip = (t) => String(t || '').replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\[\d+\]/g, ' ').replace(/^#+.*$/gm, ' ').replace(/^\s*\d+\.\s/gm, ' ')
// numbers a reader has to take in: distances, paces, limits, counts. Dates, citations, headings and list numbering are not counted.
export const countNumbers = (t) => (strip(t).match(/\d+(?:[.,]\d+)?(?::\d{2})?/g) || []).length

export function readerText(p) {
  return [p?.summary, p?.analysis_md, ...(p?.recommendations || []).flatMap((r) => [r?.action, r?.why]), ...(p?.flags || []).map((f) => f?.text)].filter(Boolean).join('\n')
}

export function scoreAnswer(p, { intent = 'daily_brief', lang = 'en' } = {}) {
  const sum = String(p?.summary || ''), ana = String(p?.analysis_md || ''), all = readerText(p), checks = {}
  const add = (name, pass, value, limit) => { checks[name] = { pass: !!pass, value, ...(limit != null ? { limit } : {}) } }
  const jargon = JARGON.filter((re) => re.test(all)).map((re) => String(re.source).replace(/\\b/g, ''))
  add('plain_words', jargon.length === 0, jargon.length ? jargon.join(' ') : 0)
  const sn = countNumbers(sum); add('summary_numbers', sn <= LIMITS.summary_numbers, sn, LIMITS.summary_numbers)
  const an = countNumbers(ana); add('analysis_numbers', an <= LIMITS.analysis_numbers, an, LIMITS.analysis_numbers)
  const max = SUMMARY_MAX[intent] || 520; add('summary_length', sum.length > 0 && sum.length <= max, sum.length, max)
  const heads = HEADINGS[intent] || []; add('structure', heads.every((re) => re.test(ana)), heads.length ? `${heads.filter((re) => re.test(ana)).length}/${heads.length}` : 'n/a')
  const first = p?.recommendations?.[0]?.action || ''; add('actionable', /\d|\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|besok|hari ini|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/i.test(first), first.slice(0, 60))
  const g = p?.grounding; if (g) add('grounded', !(g.unverified?.length || g.bad_ids?.length), `${g.unverified?.length || 0} unverified, ${g.bad_ids?.length || 0} bad ids`)
  const idShare = ((all.match(ID_WORDS) || []).length / Math.max(1, all.split(/\s+/).length)); add('language', lang === 'id' ? idShare >= 0.04 : idShare < 0.04, Math.round(idShare * 100) + '% Indonesian words')
  const names = Object.keys(checks), passed = names.filter((n) => checks[n].pass)
  return { pass: passed.length === names.length, score: Math.round((passed.length / names.length) * 100) / 100, failed: names.filter((n) => !checks[n].pass), checks }
}

// aggregate many scored answers: pass rate per check and overall, per intent
export function summarize(rows) {
  const by = {}
  for (const r of rows) { const k = r.intent, b = (by[k] ||= { n: 0, pass: 0, checks: {} }); b.n++; if (r.quality.pass) b.pass++
    for (const [c, v] of Object.entries(r.quality.checks)) { const x = (b.checks[c] ||= { n: 0, pass: 0 }); x.n++; if (v.pass) x.pass++ } }
  return by
}
