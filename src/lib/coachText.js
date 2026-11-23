// Coach text shown to the athlete: the model cites memory ids inline as [834] or [834, 858] (kept in the stored text as evidence for the grounding check);
// the reader must never see them. Also the one legacy wording fix.
export const stripCites = (s) => String(s ?? '').replace(/\s*\[\s*\d+(?:\s*[,;]\s*\d+)*\s*\]/g, '').replace(/\s+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
// the legacy "belum ditarik" -> "not yet extracted" fix is for English answers only: inside an Indonesian answer it left a stray English phrase
const looksIndonesian = (t) => (t.match(/\b(?:yang|dan|untuk|tidak|kamu|dengan|karena|tapi|sudah|belum|saya|hari|lari)\b/gi) || []).length >= 4
export const cleanCoachText = (s) => { const t = String(s ?? ''); return stripCites(looksIndonesian(t) ? t : t.replace(/\bbelum ditarik\b/gi, 'not yet extracted')) }
