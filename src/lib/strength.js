export const STRENGTH_TAGS = new Set(['Strength', 'Upper', 'Lower', 'Lower light', 'Lower maint.', 'Unilateral', 'Full body', 'FB upper'])
export const strengthOf = (d) => (d?.tags || []).filter((t) => STRENGTH_TAGS.has(t) || t.startsWith('Plyo'))
export const isLowerDay = (d) => strengthOf(d).some((t) => t.startsWith('Lower') || t === 'Unilateral')
