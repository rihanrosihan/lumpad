import { useEffect, useRef, useState } from 'react'
import { KIND, strengthOf } from './lib/calendar.js'
import { GLOSSARY } from './lib/glossary.js'

const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  ready: 'M3 12h4l2-6 4 12 2-6h6',
  cal: 'M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 9h16M8 2v4M16 2v4',
  flag: 'M6 21V4m0 0h11l-2 4 2 4H6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  run: 'M13 4a1.5 1.5 0 1 0 0 .01M6 21l3-6 3 2 2-5-3-3 2-3 4 2 1 3M9 15l-3 1',
  coach: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 10h8M8 13h5',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', sync: 'M21 3v6h-6M3 21v-6h6M20 9a8 8 0 0 0-14-3L3 9M4 15a8 8 0 0 0 14 3l3-3',
  menu: 'M4 6h16M4 12h16M4 18h16', bars: 'M5 21V11m7 10V4m7 17v-7', heart: 'M12 21s-7-4.6-9.2-9A5.4 5.4 0 0 1 12 6a5.4 5.4 0 0 1 9.2 6C19 16.4 12 21 12 21z', day: 'M5 4h14v17H5zM9 9h6M9 13h6M9 17h3',
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

// "?" next to a metric: opens a one-sentence definition. The button keeps a 44px target but takes little room (negative margins).
export function Info({ k }) {
  const [open, setOpen] = useState(false), g = GLOSSARY[k]; if (!g) return null
  return <><button className="info" onClick={() => setOpen(true)} aria-label={`Apa itu ${g[0]}?`}><span aria-hidden="true">?</span></button>
    <Sheet open={open} onClose={() => setOpen(false)} label={g[0]}><h2 className="sess-title">{g[0]}</h2><p>{g[1]}</p></Sheet></>
}
// evidence / source notes stay available but collapsed so numbers, not paragraphs, lead
export const Evidence = ({ children }) => <details className="evid"><summary>Dasar bukti</summary><p className="src-note">{children}</p></details>
