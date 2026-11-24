// Redaction for anything that leaves the server (LLM payloads). Builds on the coach's redact() (name, employer, e-mail, URL, secrets, phone) and adds what the old archive carries:
// date of birth, home area, clinic and clinician names, device serials, account strings and connection strings. Role words replace names so meaning survives.
import { redact as base } from '../intel/prompt.js'

const RULES = [
  [/\b(?:postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s"']+/gi, '[secret]'],
  [/\b(?:password|passwd|pwd|token|api[_-]?key|secret)\s*[=:]\s*\S+/gi, '[secret]'],
  [/\b(?:January|Jan|Januari)\s+19,?\s+1995\b|\b19\s+(?:January|Januari)\s+1995\b|\b1995-01-19\b|\b19[\/.-]0?1[\/.-]1995\b/gi, '[birth date]'],
  [/\bBebas Cedera(?:\s+Jatibening)?/gi, 'a physiotherapy clinic'],
  [/\bBrawijaya Hospital(?:\s*-\s*Taman Mini)?/gi, 'a hospital sports-medicine clinic'],
  [/\b(?:Jatiasih|Jatibening|Bekasi|Taman Mini|East Jakarta)\b/gi, '[area]'],
  [/\bDr\.?\s+[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,2}(?:,?\s*Sp\.?\s*[A-Z]{1,4})?/g, 'the sports-medicine physician'],
  [/\b(?:S\/N|serial)[:\s#]*[A-Z0-9]{8,}\b/gi, '[serial]'],
  [/\bAccount:\s*\S+/gi, 'Account: [account]'],
]
export function redactX(text) {
  let t = base(String(text ?? ''))
  for (const [re, to] of RULES) t = t.replace(re, to)
  return t
}
// words that must never be present in an LLM payload; used by the self-check in the extractor (a hit aborts the call)
export const FORBIDDEN = [/postgres(?:ql)?:\/\//i, /[\w.+-]+@[\w-]+\.[\w.-]+/, /\b(?:sk|pk)-[A-Za-z0-9]{16,}\b/, /\bRosihan\b/i, /Pizza Hut/i]
export const leaks = (t) => FORBIDDEN.filter((r) => r.test(t)).map(String)
