// Coach text shown to the athlete: the model cites memory ids inline as [834] or [834, 858] (kept in the stored text as evidence for the grounding check);
// the reader must never see them. Also the one legacy wording fix.
export const stripCites = (s) => String(s ?? '').replace(/\s*\[\s*\d+(?:\s*[,;]\s*\d+)*\s*\]/g, '').replace(/\s+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
export const cleanCoachText = (s) => stripCites(String(s ?? '').replace(/\bbelum ditarik\b/gi, 'not yet extracted'))
