import type { CaseEvidence, EvidenceReviewHit } from './api'

export const EXHIBIT_PROCESS_PREFIX = 'The investigator reviewed "'
export const LEGACY_EXHIBIT_PREFIX = 'Record review of exhibit'
export const DOC_REVIEW_LABEL = 'Document Review'
export const DOC_REVIEW_PLACEHOLDER =
  'The Investigator will review facility policies, procedures, and records relevant to the authorized allegations.'
export const MISSING_DOCUMENT_DATE = '[document date]'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const LEGACY_LINE =
  /^Record review of exhibit\s+(.+?)(?:\s+as applied to\s+([^:]+))?:\s*(.*)$/i
const EXHIBIT_N_LINE = /^exhibit\s+\d+\s*:\s*(.*)$/i
const QUOTED_REVIEW_LINE = /^The investigator reviewed ["“](.+?)["”] dated (.+?)\.(.*)$/i

export function isExhibitProcessLine(line: string): boolean {
  const s = (line || '').trim()
  const low = s.toLowerCase()
  if (low.startsWith('the investigator reviewed "') || low.startsWith('the investigator reviewed “')) {
    return true
  }
  if (s.startsWith(LEGACY_EXHIBIT_PREFIX)) return true
  if (EXHIBIT_N_LINE.test(s)) return true
  return false
}

export function displayEvidenceTitle(title: string): string {
  let name = (title || 'document').trim()
  name = name.replace(/\.(pdf|docx?|txt|md|png|jpe?g|webp)$/i, '')
  name = name.replace(/[“”"]+/g, '').trim()
  return name || 'document'
}

function formatYmd(year: number, month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  return `${MONTHS[month - 1]} ${day}, ${year}`
}

export function extractDocumentDate(text: string): string {
  const body = (text || '').slice(0, 4000)
  if (!body.trim()) return ''
  const named =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i.exec(
      body,
    )
  if (named) {
    const month = MONTHS.findIndex((m) => m.toLowerCase() === named[1].toLowerCase()) + 1
    return formatYmd(Number(named[3]), month, Number(named[2]))
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(body)
  if (iso) return formatYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(body)
  if (slash) {
    let year = Number(slash[3])
    if (year < 100) year += year < 70 ? 2000 : 1900
    return formatYmd(year, Number(slash[1]), Number(slash[2]))
  }
  return ''
}

export function formatDocumentDate(raw?: string | null): string {
  const text = (raw || '').trim()
  if (!text || text === MISSING_DOCUMENT_DATE) return MISSING_DOCUMENT_DATE
  return extractDocumentDate(text) || (/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(text) ? text : MISSING_DOCUMENT_DATE)
}

export function completeSentenceExcerpt(text: string, maxChars = 800): string {
  let body = (text || '').replace(/\s+/g, ' ').trim().replace(/[…]/g, ' ').replace(/\.\.\./g, ' ')
  if (!body) return ''
  const parts = body.split(/(?<=[.!;:])\s+/).map((p) => p.trim()).filter(Boolean)
  const kept: string[] = []
  for (const part of parts) {
    const trial = [...kept, part].join(' ').trim()
    if (trial.length > maxChars) break
    kept.push(part)
    if (trial.length >= 180 && /[.!?]$/.test(trial)) break
  }
  let out = kept.join(' ').trim()
  if (!out) return ''
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, '').trim()
  if (!/[.!?]$/.test(out)) out = `${out.replace(/[ :,;]+$/, '')}.`
  return out
}

export function formatDocumentReviewLine(input: {
  title: string
  documentDate?: string
  excerpt?: string
  cite?: string
}): string {
  const title = displayEvidenceTitle(input.title)
  const dated = formatDocumentDate(input.documentDate)
  return `The investigator reviewed "${title}" dated ${dated}.`
}

export function mergeDocumentReviewLines(
  process: string[],
  documents: { title: string; documentDate?: string; excerpt?: string; cite?: string }[],
): string[] {
  const added = documents.map((d) => formatDocumentReviewLine(d))
  const src = (process || []).filter((p) => !isExhibitProcessLine(p))
  const labelIdx = src.findIndex((p) => (p || '').trim().toLowerCase() === DOC_REVIEW_LABEL.toLowerCase())
  const isPlaceholder = (p: string) =>
    p.replace(/\s+/g, ' ').trim().toLowerCase() === DOC_REVIEW_PLACEHOLDER.replace(/\s+/g, ' ').trim().toLowerCase()
  if (labelIdx < 0) {
    return added.length ? [...src, DOC_REVIEW_LABEL, ...added] : src
  }
  const head = src.slice(0, labelIdx + 1)
  const tail = src.slice(labelIdx + 1).filter((p) => !isPlaceholder(p))
  if (added.length) return [...head, ...added, ...tail]
  if (tail.length) return [...head, ...tail]
  return [...head, DOC_REVIEW_PLACEHOLDER]
}

export function documentsFromEvidence(
  evidence: CaseEvidence[] | undefined,
  selectedHits: EvidenceReviewHit[],
): { title: string; documentDate?: string; excerpt?: string; cite?: string }[] {
  const byId = new Map<number, { title: string; documentDate?: string; excerpt: string; cite?: string }>()
  for (const ev of evidence || []) {
    byId.set(ev.id, {
      title: displayEvidenceTitle(ev.title || ev.original_filename || `document ${ev.id}`),
      documentDate: '',
      excerpt: '',
    })
  }
  for (const hit of selectedHits) {
    const row = byId.get(hit.evidence_id) || {
      title: hit.evidence_title || 'document',
      documentDate: '',
      excerpt: '',
    }
    if (hit.document_date) row.documentDate = hit.document_date
    if ((hit.excerpt || '').length > row.excerpt.length) {
      row.excerpt = hit.excerpt || ''
      if (hit.cite) row.cite = hit.cite
    }
    if (hit.cite && !row.cite) row.cite = hit.cite
    if (!row.title) row.title = hit.evidence_title
    byId.set(hit.evidence_id, row)
  }
  return [...byId.values()]
}

export function documentsFromLegacyProcess(
  process: string[],
): { title: string; documentDate?: string; excerpt?: string; cite?: string }[] {
  const byTitle = new Map<string, { title: string; documentDate?: string; excerpt?: string; cite?: string }>()
  const remember = (title: string, extra?: { documentDate?: string; excerpt?: string; cite?: string }) => {
    const shown = displayEvidenceTitle(title)
    const key = shown.toLowerCase()
    const prev = byTitle.get(key)
    byTitle.set(key, {
      title: shown,
      documentDate: extra?.documentDate || prev?.documentDate,
      excerpt: (extra?.excerpt || '').length >= (prev?.excerpt || '').length ? extra?.excerpt : prev?.excerpt,
      cite: extra?.cite || prev?.cite,
    })
  }
  for (const line of process || []) {
    const s = (line || '').trim()
    const legacy = LEGACY_LINE.exec(s)
    if (legacy) {
      remember(legacy[1], {
        excerpt: legacy[3] || '',
        cite: (legacy[2] || '').trim(),
        documentDate: extractDocumentDate(legacy[3] || ''),
      })
      continue
    }
    const quoted = QUOTED_REVIEW_LINE.exec(s)
    if (quoted) {
      remember(quoted[1], { documentDate: quoted[2].trim() })
      continue
    }
    const exhibit = EXHIBIT_N_LINE.exec(s)
    if (exhibit) {
      remember(exhibit[1])
      continue
    }
    if (s.startsWith(LEGACY_EXHIBIT_PREFIX)) {
      remember(s.slice(LEGACY_EXHIBIT_PREFIX.length).trim().split(/\s+as applied to\s+/i)[0])
    }
  }
  return [...byTitle.values()]
}

export function documentReviewHasLegacyExhibitLines(lines: string[] | string): boolean {
  const list = Array.isArray(lines) ? lines : (lines || '').split(/\r?\n/)
  return list.some((line) => {
    const t = (line || '').trim()
    return t.startsWith(LEGACY_EXHIBIT_PREFIX) || EXHIBIT_N_LINE.test(t)
  })
}

/** Convert leftover Record-review / Exhibit-N lines without dropping already-correct review sentences. */
export function rewriteLegacyDocumentReviewLines(process: string[]): string[] {
  if (!documentReviewHasLegacyExhibitLines(process)) return process
  const docs = documentsFromLegacyProcess(process)
  return mergeDocumentReviewLines(process, docs)
}
