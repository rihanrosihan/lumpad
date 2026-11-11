import { useEffect, useRef } from 'react'
import { KIND, strengthOf } from './lib/calendar.js'

const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  ready: 'M3 12h4l2-6 4 12 2-6h6',
  cal: 'M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 9h16M8 2v4M16 2v4',
  flag: 'M6 21V4m0 0h11l-2 4 2 4H6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  run: 'M13 4a1.5 1.5 0 1 0 0 .01M6 21l3-6 3 2 2-5-3-3 2-3 4 2 1 3M9 15l-3 1',
  chev: 'M9 6l6 6-6 6', left: 'M15 6l-6 6 6 6', x: 'M6 6l12 12M18 6 6 18', check: 'M5 12l5 5 9-10',
}
export const Icon = ({ n, size = 22 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]} /></svg>

export const Chip = ({ children, tone, kind, className = '' }) => <span className={`chip ${tone ? 't-' + tone : ''} ${kind ? 'k-' + kind : ''} ${className}`}>{children}</span>
export const KindDot = ({ kind }) => <span className={`kdot k-${kind}`} title={KIND[kind]?.label} />
export const StrengthChips = ({ day }) => <>{strengthOf(day).map((t) => <Chip key={t} tone="str">{t}</Chip>)}</>
export const Screen = ({ title, sub, right, children }) => <section className="screen">
  <header className="sh"><div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>{right}</header>{children}
</section>
export const Card = ({ title, right, tone, children, className = '' }) => <div className={`card ${tone ? 'c-' + tone : ''} ${className}`}>
  {(title || right) && <div className="ch"><h2>{title}</h2>{right}</div>}{children}</div>
export const Stat = ({ k, v, sub }) => <div className="stat"><span>{k}</span><b>{v}</b>{sub && <small>{sub}</small>}</div>

export function Sheet({ open, onClose, label, children }) {
  const ref = useRef(), closeRef = useRef()
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    closeRef.current?.focus()
    const f = (e) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return // keep focus inside the dialog
      const els = [...ref.current.querySelectorAll('button:not(:disabled),a[href],input,select,[tabindex]:not([tabindex="-1"])')]
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', f)
    return () => { window.removeEventListener('keydown', f); prev?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  return <div className="sheet-wrap" onClick={onClose}><div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
    <div className="grab" aria-hidden="true" /><button ref={closeRef} className="x" onClick={onClose} aria-label="Tutup"><Icon n="x" size={20} /></button>{children}</div></div>
}
