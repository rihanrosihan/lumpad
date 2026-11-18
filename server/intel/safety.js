// Safety layer (Phase 0 stop-gap). Deterministic, no model call. Two jobs:
//  1) red flags: symptoms that need a clinician → the coach answers with a referral and no training advice (and makes no paid call);
//  2) gate check on answers: when a validated gate is active, any recommendation of a hard session is removed and the reason is shown.
// It never diagnoses and never clears anyone to train. Rules are data (arrays below) so they can be tuned without touching the logic.

export const REFERRAL = 'This needs a doctor, not a training plan. Stop running for now and get this checked by a clinician (or urgent care / emergency services if it is severe or getting worse). The coach does not diagnose and cannot clear you to train.'

// English + Bahasa Indonesia. "urgent" = call emergency services; the rest = see a clinician before training.
export const RED_FLAGS = [
  { id: 'chest', urgent: true, label: 'chest pain or pressure', re: /\b(chest (pain|pressure|tightness)|pain in (my )?chest|nyeri dada|dada (sakit|sesak|terasa berat|nyeri))\b/i },
  { id: 'faint', urgent: true, label: 'fainting or near-fainting', re: /\b(faint(ed|ing)?|passed out|black(ed)? out|collapse[d]?|pingsan|hampir pingsan|kolaps)\b/i },
  { id: 'palpitations', urgent: false, label: 'palpitations or an irregular heartbeat', re: /\b(palpitation|irregular (heart ?beat|pulse)|(heart|pulse) (was |is |kept |keeps |felt )?(racing|skipping|pounding|fluttering)|jantung (berdebar|berhenti|tidak teratur|kencang sendiri))\b/i },
  { id: 'breath', urgent: false, label: 'breathlessness out of proportion', re: /\b(can'?t breathe|short(ness)? of breath at rest|struggling to breathe|sesak (napas|nafas))\b/i },
  { id: 'fever', urgent: false, label: 'fever or acute illness', re: /\b(fever|temperature of 3[89]|flu\b|covid|sore throat and (body )?ache|demam|meriang|sakit (tenggorokan|badan))\b/i },
  { id: 'neuro', urgent: true, label: 'numbness, weakness or severe headache', re: /\b(numb(ness)?|slurred|sudden weakness|severe headache|kebas|mati rasa|sakit kepala hebat)\b/i },
  { id: 'swelling', urgent: false, label: 'swelling, calf pain or a possible stress fracture', re: /\b(swollen|swelling|calf (pain|swelling)|stress fracture|bengkak|retak)\b/i },
  { id: 'pain-worse', urgent: false, label: 'worsening or severe pain', re: /\b(pain\b[^.?!]{0,30}\b(getting |gets |is |keeps )?(worse|worsening|more severe)\b|pain (is )?severe|worsening pain|sharp pain|unbearable|nyeri (makin|semakin) (parah|berat)|sakit (banget|sekali|parah))\b/i },
  { id: 'heat', urgent: true, label: 'heat illness symptoms', re: /\b(heat ?stroke|stopped sweating|confus(ed|ion)|disoriented|bingung|kram panas)\b/i },
]
const NEGATED = /\b(no|not|without|never|denies|tidak|tanpa|bukan)\s+(any\s+)?$/i

export function redFlags(text) {
  const t = String(text || ''), out = []
  for (const f of RED_FLAGS) {
    const m = f.re.exec(t); if (!m) continue
    if (NEGATED.test(t.slice(Math.max(0, m.index - 14), m.index))) continue // "no chest pain"
    out.push({ id: f.id, label: f.label, urgent: f.urgent, quote: m[0] })
  }
  return out
}

// structured signals (morning check-in, biometrics): pain sites 0–10, symptoms flags, blood pressure
export function checkinFlags({ pain = null, painTrend = null, symptoms = {}, bp = null } = {}) {
  const out = []
  if (pain != null && pain >= 4) out.push({ id: 'pain-high', label: `pain ${pain}/10`, urgent: false })
  if (painTrend === 'rising') out.push({ id: 'pain-rising', label: 'pain rising over 3 days', urgent: false })
  for (const k of ['chest', 'faint', 'palpitations', 'breath', 'fever', 'swelling', 'numbness']) if (symptoms[k]) out.push({ id: k, label: k, urgent: ['chest', 'faint', 'numbness'].includes(k) })
  if (bp && (bp.sys >= 180 || bp.dia >= 120)) out.push({ id: 'bp-crisis', label: `blood pressure ${bp.sys}/${bp.dia}`, urgent: true })
  return out
}

export const referralFor = (flags) => ({
  summary: `${flags.some((f) => f.urgent) ? 'Possible emergency: ' : ''}you mention ${flags.map((f) => f.label).join(', ')}. ${REFERRAL}`,
  analysis_md: `## Please get this checked first\n\nYou mentioned **${flags.map((f) => f.label).join('**, **')}**.\n\n${REFERRAL}\n\nNo training advice has been generated. Come back once a clinician has seen you and tell the coach what they advised; that guidance overrides anything the coach suggests.`,
  recommendations: [{ action: 'Stop running and see a clinician', why: 'A symptom that can need medical assessment was reported', priority: 'now' }],
  flags: flags.map((f) => ({ type: 'injury', text: f.label })), memory_writes: [], cited_ids: [], safety: { referral: true, urgent: flags.some((f) => f.urgent), ids: flags.map((f) => f.id) },
})

// ---- gate check on answers -------------------------------------------------------------------------------------------------------
// gate = { active, reasons[] } from the twin: readiness caps (Sleep HR > 67, HRV Reduced, pain ≥ 2/10), tier compromised/depleted, ACWR / km progression
export function gateFromTwin(t) {
  const reasons = [], r = t?.readiness || {}, L = t?.load || {}
  for (const c of r.caps || []) reasons.push(c)
  if (r.tier === 'depleted' || r.tier === 'compromised') reasons.push(`readiness tier ${r.tier}`)
  if (L.km_vs_4wk_avg_pct != null && L.km_vs_4wk_avg_pct > 30) reasons.push(`weekly distance +${L.km_vs_4wk_avg_pct}% (> 30%)`)
  const worst = Math.max(0, ...Object.values(t?.injury?.sites || {}).map((s) => (s.last_pain_date && s.pain_free_days != null && s.pain_free_days < 7 ? s.last_pain : 0)))
  if (worst >= 2) reasons.push(`pain ${worst}/10 in the last 7 days`)
  return { active: reasons.length > 0, reasons }
}
const HARD_RE = /\b(tempo|threshold|interval|repeats?|fartlek|strides? session|hill (repeats|sprints)|speed ?work|time trial|\btt\b|race[- ]?pace|marathon[- ]?pace|\bmp\b|progression run|quality session|long run|lari panjang|lomba|race effort|all[- ]out|vo2)\b/i
const NEGATE_HARD = /\b(no|avoid|skip|do not|don't|instead of|rather than|replace|swap|downgrade|hold off|postpone|jangan|hindari|ganti)\b[^.]{0,40}$/i

// → { parsed, removed[], flags[] }: hard-session recommendations are dropped while a gate is active; the athlete sees why
export function gateCheck(parsed, gate) {
  if (!gate?.active || !parsed) return { parsed, removed: [] }
  const removed = [], keep = (parsed.recommendations || []).filter((r) => {
    const txt = `${r.action}`, m = HARD_RE.exec(txt)
    const bad = m && !NEGATE_HARD.test(txt.slice(0, m.index + 1))
    if (bad) removed.push(r); return !bad
  })
  if (!removed.length) return { parsed, removed }
  const note = `Safety gate active (${gate.reasons.slice(0, 3).join('; ')}): ${removed.length} hard-session recommendation${removed.length > 1 ? 's were' : ' was'} removed. Easy running, walking or rest only until the gate clears.`
  return { removed, parsed: { ...parsed, recommendations: keep, flags: [...(parsed.flags || []), { type: 'gate', text: note.slice(0, 300) }], safety: { gate_removed: removed.map((r) => r.action), reasons: gate.reasons } } }
}

// wording the model must not use (diagnosis / clearance); returns the offending phrases
const DIAGNOSIS_RE = /\b(you have (a |an )?(stress fracture|tendinitis|tendinopathy|plantar fasciitis|mtss|shin splints|arrhythmia|hypertension|diabetes|infection)|you are (cleared|fit|safe) to (run|race|train)|medically cleared|you('re| are) diagnosed|this is (definitely|certainly) (a |an )?[a-z ]+(itis|osis|fracture))\b/i
export const diagnosisWording = (parsed) => { const t = [parsed?.summary, parsed?.analysis_md, ...(parsed?.recommendations || []).map((r) => `${r.action} ${r.why}`)].join('\n'), m = DIAGNOSIS_RE.exec(t); return m ? [m[0]] : [] }
