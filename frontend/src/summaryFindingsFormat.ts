/**
 * Summary of Findings: peer IR evidence paragraphs only (after intake opener).
 * Canonical line: Review of a document titled "…", dated …, showed …
 */
import type { EvidenceReviewHit, InvestigationReport } from './api'
import { stripCollaboratorFromSummary } from './contentReview'
import { displayEvidenceTitle, formatDocumentDate, MISSING_DOCUMENT_DATE } from './documentReviewFormat'

const MAX_SUMMARY_FINDINGS = 12
const WA_CITE = /\b(?:WAC|RCW)\s*(246-(?:341|337)-\d{3,4}|71\.(?:05|24|34)\.\d{3,4})/i

/** Peer examples: Review of a document titled "Title", dated …, showed … */
export const SUMMARY_EVIDENCE_PARA_RE =
  /^Review of (?:a |the )?document titled\s+"[^"]+"\s*,\s*dated\s+.+?\s*,\s*showed\b/i

export const TITLE_IN_SUMMARY_EVIDENCE_RE =
  /Review of (?:a |the )?document titled\s+"([^"]+)"\s*,\s*dated\s+/i

const ALLEGATION_COPY_RE =
  /(?:^|\n\n)[^\n]*is authorized for this investigation because[^\n]*(?:\n\nThe corresponding allegation asserts:[^\n]*)?/gi

const SCOPE_BRIDGE_RE =
  /(?:^|\n\n)This summary outlines how authorized WAC\/RCW selections relate to the drafted allegations;[^\n]*/gi

export function isSummaryEvidenceParagraph(text: string): boolean {
  return SUMMARY_EVIDENCE_PARA_RE.test((text || '').trim())
}

export function stripAllegationCopiesFromSummary(text: string): string {
  return (text || '')
    .replace(ALLEGATION_COPY_RE, '')
    .replace(SCOPE_BRIDGE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Form preview / Copy / persist: no collaborator notes, no pasted allegation paragraphs. */
export function cleanSummaryForDocument(text: string | null | undefined): string {
  return stripAllegationCopiesFromSummary(stripCollaboratorFromSummary(text))
}

function stripStatuteSentences(text: string): string {
  const parts = (text || '')
    .split(/(?<=[.!;:])\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const kept = parts.filter((part) => !WA_CITE.test(part) || part.replace(WA_CITE, '').trim().length >= 40)
  return kept.join(' ').trim()
}

const RELATED_TAIL = /\s*Related to\s+(?:WAC|RCW)\b.*$/i
const LIST_MARKER_SPLIT =
  /(?:^|[\n;:])\s*(?:[•●▪◦‣∙·]|\*\s+|-+\s+)?(?:[a-z]\.|\d{1,2}\.|\([a-z]\))\s+|(?<=[a-z0-9"”'])\s+(?:[•●▪◦‣∙·]|[a-z]\.|\d{1,2}\.)\s+(?=[A-Z("“'])|(?:^|[\n;:\s])[•●▪◦‣∙·]\s*/gi

function joinListPartsAsProse(parts: string[]): string {
  const cleaned = parts
    .map((raw) => (raw || '').replace(/\s+/g, ' ').replace(/^[\s\-–—*•●]+|[\s.;:]+$/g, '').trim())
    .filter(Boolean)
  if (!cleaned.length) return ''
  if (cleaned.length === 1) return cleaned[0]
  const longish = cleaned.filter((p) => p.length >= 55).length
  if (longish >= Math.max(2, Math.floor(cleaned.length / 2))) {
    return cleaned.join('. ')
  }
  const phraseCase = (item: string, first: boolean) => {
    if (first || !item) return item
    if (/^[A-Z][a-z]/.test(item)) return item[0].toLowerCase() + item.slice(1)
    return item
  }
  const phrased = cleaned.map((p, i) => phraseCase(p, i === 0))
  if (phrased.length >= 2 && /\b(?:to|including|include|includes|follows|following)$/i.test(phrased[0])) {
    const rest = phrased.slice(1)
    if (rest.length === 1) return `${phrased[0]} ${rest[0]}`
    if (rest.length === 2) return `${phrased[0]} ${rest[0]}, and ${rest[1]}`
    return `${phrased[0]} ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`
  }
  if (phrased.length === 2) return `${phrased[0]}, and ${phrased[1]}`
  return `${phrased.slice(0, -1).join(', ')}, and ${phrased[phrased.length - 1]}`
}

/** Strip a./b./9./bullet outline markers into seamless sentences (peer IR style). */
function toNarrativeProse(text: string): string {
  let body = (text || '').replace(RELATED_TAIL, '').trim()
  if (!body) return ''
  body = body.replace(/[•●▪◦‣∙·]/g, ' • ')
  let parts = body.split(LIST_MARKER_SPLIT).filter((p) => (p || '').trim())
  if (
    parts.length <= 1 &&
    !body.includes(' • ') &&
    !/\b[a-z]\.\s+[A-Z]/.test(body)
  ) {
    return body.replace(/\s+/g, ' ').trim()
  }
  if (parts.length <= 1) {
    parts = body
      .split(/(?:^|\s+)(?:[a-z]\.|\d{1,2}\.|[•●▪◦‣∙·])\s+(?=[A-Z("“'])/i)
      .filter((p) => (p || '').trim())
  }
  let prose = joinListPartsAsProse(parts).replace(/\s+/g, ' ').trim()
  if (prose && /^[A-Z][a-z]/.test(prose)) {
    prose = prose[0].toLowerCase() + prose.slice(1)
  }
  return prose
}

function cleanExcerpt(excerpt: string, maxChars = 800): string {
  let body = toNarrativeProse(stripStatuteSentences(excerpt))
  body = body.replace(/\s+/g, ' ').trim()
  if (!body) return ''
  if (body.length > maxChars) {
    const cut = body.slice(0, maxChars).replace(/\s+\S*$/, '')
    body = cut || body.slice(0, maxChars)
  }
  return body.replace(/\.\s*$/, '')
}

function pickBestExcerpt(parts: string[], maxChars = 800): string {
  let best = ''
  for (const raw of parts) {
    const body = cleanExcerpt(raw, maxChars)
    if (body.length > best.length) best = body
  }
  return best
}

function summaryDisplayDate(raw?: string | null): string {
  const text = (raw || '').trim()
  if (!text || text === MISSING_DOCUMENT_DATE) return MISSING_DOCUMENT_DATE
  const parsed = formatDocumentDate(text)
  if (parsed !== MISSING_DOCUMENT_DATE) return parsed
  return text
}

/** Canonical Summary finding line (peer IR DOCX examples). */
export function summaryDocumentReviewParagraph(
  title: string,
  documentDate?: string,
  excerpt?: string,
): string {
  const shown = displayEvidenceTitle(title).replace(/["“”]/g, '') || 'document'
  const dated = summaryDisplayDate(documentDate)
  const body = cleanExcerpt(excerpt || '')
  if (!body) return ''
  return `Review of a document titled "${shown}", dated ${dated}, showed ${body}.`
}

/** SOD Writing: document review uses showed; titles after titled, in quotes. */
export function sodDocumentFinding(title: string, excerpt?: string): string {
  const shown = displayEvidenceTitle(title).replace(/["“”]/g, '') || 'document'
  const body = cleanExcerpt(excerpt || '', 900)
  if (!body) return ''
  return `Review of the document titled, "${shown}", showed ${body}.`
}

type ConsolidatedExhibit = {
  evidence_id: number | string
  evidence_title: string
  document_date?: string
  excerpt: string
  score: number
}

/** One row per exhibit: pick the best verbatim excerpt span. */
export function consolidateHitsByEvidence(hits: EvidenceReviewHit[] | undefined): ConsolidatedExhibit[] {
  const selected = (hits || [])
    .filter((h) => h.included_by_default !== false && (h.excerpt || '').trim())
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))

  const byKey = new Map<string, ConsolidatedExhibit & { excerptParts: string[] }>()
  const order: string[] = []
  for (const h of selected) {
    const key =
      h.evidence_id != null && String(h.evidence_id) !== ''
        ? `id:${h.evidence_id}`
        : `title:${(h.evidence_title || '').toLowerCase()}`
    let row = byKey.get(key)
    if (!row) {
      row = {
        evidence_id: h.evidence_id,
        evidence_title: h.evidence_title,
        document_date: h.document_date,
        excerpt: '',
        score: h.score || 0,
        excerptParts: [],
      }
      byKey.set(key, row)
      order.push(key)
    }
    if (h.document_date && !row.document_date) row.document_date = h.document_date
    row.score = Math.max(row.score, h.score || 0)
    if (h.excerpt?.trim()) row.excerptParts.push(h.excerpt)
  }

  return order
    .map((key) => {
      const row = byKey.get(key)!
      return {
        evidence_id: row.evidence_id,
        evidence_title: row.evidence_title,
        document_date: row.document_date,
        excerpt: pickBestExcerpt(row.excerptParts),
        score: row.score,
      }
    })
    .filter((row) => row.excerpt.trim())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUMMARY_FINDINGS)
}

export function mergeEvidenceIntoSummary(
  report: InvestigationReport,
  documents: { title: string; documentDate?: string; excerpt?: string }[],
  evidenceHits?: EvidenceReviewHit[],
): string {
  let body = cleanSummaryForDocument(report.summary_of_findings || '')
  const parts = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  let opener = parts[0] || ''
  const low = opener.toLowerCase()
  if (!(low.includes('received a complaint') || low.startsWith('the department of health'))) {
    opener = ''
  }

  const consolidated = consolidateHitsByEvidence(evidenceHits)
  const reviewParas =
    consolidated.length > 0
      ? consolidated.map((h) =>
          summaryDocumentReviewParagraph(h.evidence_title, h.document_date, h.excerpt),
        )
      : documents
          .map((d) => summaryDocumentReviewParagraph(d.title, d.documentDate, d.excerpt))
          .filter(Boolean)

  const sections = [
    opener ||
      'The Department of Health (DOH) received a complaint alleging concerns within the scope of the authorized WAC/RCW selections.',
    ...reviewParas,
  ]
  return sections.filter(Boolean).join('\n\n')
}

/** Link duty-RAG hits into SOD Findings included (one row per exhibit per deficiency). */
export function linkEvidenceHitsToSod(
  report: InvestigationReport,
  hits: EvidenceReviewHit[],
): InvestigationReport['sod'] {
  const sod = report.sod
  if (!sod?.deficiencies?.length) return sod
  const citeKey = (v: string) =>
    (v || '').toLowerCase().replace(/\s+/g, '').replace(/wac/g, '').replace(/rcw/g, '')
  const deficiencies = sod.deficiencies.map((d) => {
    const findings = [...(d.findings || [])]
    const regK = citeKey(d.regulation_cite || '')
    if (!regK) return { ...d, findings }
    const matching = (hits || []).filter((h) => {
      if (h.included_by_default === false || !(h.excerpt || '').trim()) return false
      const ck = citeKey(h.cite || '')
      return Boolean(ck && (ck.includes(regK) || regK.includes(ck)))
    })
    for (const row of consolidateHitsByEvidence(matching)) {
      const text = sodDocumentFinding(row.evidence_title, row.excerpt)
      if (!text) continue
      const eid = String(row.evidence_id)
      if (findings.some((f) => (f.evidence_ids || []).includes(eid))) continue
      findings.push({
        method: 'document review',
        text: text.slice(0, 900),
        evidence_ids: [eid],
      })
    }
    return { ...d, findings }
  })
  return { ...sod, deficiencies }
}

function citeKey(value: string): string {
  return (value || '').toLowerCase().replace(/\s+/g, '').replace(/wac/g, '').replace(/rcw/g, '')
}

/** Authorized allegation / Compare WAC-RCW codes for this draft. */
export function allegationCiteKeys(report: InvestigationReport): Set<string> {
  const keys = new Set<string>()
  for (const a of report.allegations || []) {
    const k = citeKey(a.wac_code || '')
    if (k) keys.add(k)
  }
  for (const c of report.comparisons || []) {
    const k = citeKey(c.code || c.wac_id || '')
    if (k) keys.add(k)
  }
  return keys
}

function citesOverlapAllegation(cite: string, allegationKeys: Set<string>): boolean {
  const ck = citeKey(cite)
  if (!ck) return false
  for (const a of allegationKeys) {
    if (!a) continue
    if (ck.includes(a) || a.includes(ck)) return true
  }
  return false
}

export function splitSummaryParagraphs(text: string): string[] {
  return (text || '')
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** True when a Summary paragraph matches the peer evidence finding format. */
export function summaryParagraphIsEvidenceLinked(
  paragraph: string,
  report: InvestigationReport,
): boolean {
  if (!isSummaryEvidenceParagraph(paragraph)) return false
  if (/\[pending:/i.test(paragraph)) return false

  const titleM = TITLE_IN_SUMMARY_EVIDENCE_RE.exec(paragraph || '')
  const title = (titleM?.[1] || '').toLowerCase().trim()
  if (!title) return false

  const allegationKeys = allegationCiteKeys(report)
  const hits = (report.evidence_review || []).filter(
    (h) => h.included_by_default !== false && (h.excerpt || '').trim(),
  )
  for (const h of hits) {
    const ht = displayEvidenceTitle(h.evidence_title || '')
      .toLowerCase()
      .trim()
    if (!ht) continue
    if (!(ht === title || ht.includes(title) || title.includes(ht))) continue
    if (!allegationKeys.size || citesOverlapAllegation(h.cite || '', allegationKeys)) return true
  }
  return false
}

const SUPER_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'

export type SummaryEvidenceCite = {
  evidenceId: number
  exhibitNo: number
  title: string
  excerpt: string
  pageLabel: string
  tooltip: string
}

/** Match Summary paragraph to case exhibit + duty-review excerpt for superscript / tooltip. */
export function resolveSummaryEvidenceCite(
  paragraph: string,
  report: InvestigationReport,
  evidence: { id: number; title?: string; original_filename?: string; exhibit_number?: number | null }[],
): SummaryEvidenceCite | null {
  const m = TITLE_IN_SUMMARY_EVIDENCE_RE.exec(paragraph || '')
  if (!m) return null
  const title = displayEvidenceTitle(m[1]).toLowerCase()
  const sorted = [...(evidence || [])].sort(
    (a, b) => (a.exhibit_number || 0) - (b.exhibit_number || 0) || a.id - b.id,
  )
  let match:
    | { id: number; title?: string; original_filename?: string; exhibit_number?: number | null }
    | undefined
  for (const ev of sorted) {
    const t = displayEvidenceTitle(ev.title || ev.original_filename || '').toLowerCase()
    const stem = (ev.original_filename || '').replace(/\.[^.]+$/, '').toLowerCase()
    if (t === title || stem === title || t.includes(title) || title.includes(t)) {
      match = ev
      break
    }
  }
  if (!match) return null
  const exhibitNo =
    match.exhibit_number && match.exhibit_number > 0
      ? match.exhibit_number
      : sorted.findIndex((e) => e.id === match!.id) + 1
  const hits = (report.evidence_review || []).filter(
    (h) => h.evidence_id === match!.id && h.included_by_default !== false && (h.excerpt || '').trim(),
  )
  hits.sort((a, b) => (b.score || 0) - (a.score || 0))
  const excerpt = hits[0]?.excerpt || ''
  const shown = displayEvidenceTitle(match.title || match.original_filename || `document ${match.id}`)
  const sample =
    excerpt.length > 280 ? `${excerpt.slice(0, 277).replace(/\s+\S*$/, '')}…` : excerpt
  const tooltip = [`Exhibit #${exhibitNo}: ${shown}`, sample].filter(Boolean).join(' · ')
  return {
    evidenceId: match.id,
    exhibitNo,
    title: shown,
    excerpt,
    pageLabel: '',
    tooltip,
  }
}

export function stripTrailingSuperscripts(text: string): { body: string; marks: string } {
  let body = text || ''
  let marks = ''
  while (body && SUPER_DIGITS.includes(body[body.length - 1]!)) {
    marks = body[body.length - 1]! + marks
    body = body.slice(0, -1)
  }
  return { body: body.trimEnd(), marks }
}

export function toSuperscriptDigits(n: number): string {
  if (n <= 0) return ''
  return String(n)
    .split('')
    .map((d) => SUPER_DIGITS[Number(d)] || d)
    .join('')
}
