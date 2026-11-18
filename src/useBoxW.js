import { useEffect, useState } from 'react'
// Drawing width = the chart's real pixel width, so SVG axis text is drawn at its true size on every screen
// (no 3x zoom on a wide desktop card, no 0.4x squeeze in a small phone tile).
export function useBoxW(ref, init = 340, min = 120) {
  const [w, setW] = useState(init)
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => { const x = Math.round(e.contentRect.width); if (x >= min) setW((p) => (Math.abs(p - x) > 1 ? x : p)) })
    ro.observe(el); return () => ro.disconnect()
  }, [ref, min])
  return w
}
