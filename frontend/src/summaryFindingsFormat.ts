/**
 * Summary of Findings helpers: peer IR evidence narrative from duty-matched exhibit hits.
 * One paragraph per evidence document (all related WAC cites merged). Allegation lines stay out.
 */
import type { EvidenceReviewHit, InvestigationReport } from './api'
import { stripCollaboratorFromSummary } from './contentReview'
import { displayEvidenceTitle, formatDocumentDate } from './documentReviewFormat'

const DOC_PENDING =
  '[pending: how this record supports or does not support the authorized WAC duties]'

const COMPLETE_HINT =
  'Add interview and observation findings as developed. Refine document-review paragraphs after further evidentiary work when needed.'

const MAX_SUMMARY_FINDINGS = 12

const ALLEGATION_COPY_RE =
  /(?:^|\n\n)[^\n]*is authorized for this investigation because[^\n]*(?:\n\nThe corresponding allegation asserts:[^\n]*)?/gi

const SCOPE_BRIDGE_RE =
  /(?:^|\n\n)This summary outlines how authorized WAC\/RCW selections relate to the drafted allegations;[^\n]*/gi

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

function cleanExcerpt(excerpt: string, maxChars = 800): string {
  let body = (excerpt || '').replace(/\s+/g, ' ').trim()
  body = body.replace(/["“”]/g, '')
  if (body.length > maxChars) {
    const cut = body.slice(0, maxChars).replace(/\s+\S*$/, '')
    body = cut || body.slice(0, maxChars)
  }
  return body.replace(/\.\s*$/, '')
}

function mergeExcerptParts(parts: string[], maxChars = 800): string {
  const cleaned: string[] = []
  for (const raw of parts) {
    const body = cleanExcerpt(raw, maxChars)
    if (!body) continue
    const low = body.toLowerCase()
    let superseded = false
    for (let i = 0; i < cleaned.length; i++) {
      const kl = cleaned[i].toLowerCase()
      if (low.includes(kl) && low.length >= kl.length) {
        cleaned[i] = body
        superseded = true
        break
      }
      if (kl.includes(low)) {
        superseded = true
        break
      }
    }
    if (!superseded) cleaned.push(body)
  }
  return cleanExcerpt(cleaned.join('. '), maxChars)
}

function uniqueCites(cites: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of cites) {
    const t = (c || '').trim()
    if (!t) continue
    const key = t.toLowerCase().replace(/\s+/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

export function summaryDocumentReviewParagraph(
  title: string,
  documentDate?: string,
  excerpt?: string,
  cites?: string[],
): string {
  const shown = displayEvidenceTitle(title).replace(/["“”]/g, '') || 'document'
  const dated = formatDocumentDate(documentDate) || '[document date]'
  const body = cleanExcerpt(excerpt || '')
  if (!body) {
    return `A review of the document titled "${shown}", dated ${dated}, showed ${DOC_PENDING}.`
  }
  let para = `A review of the document titled "${shown}", dated ${dated}, showed ${body}.`
  const related = uniqueCites(cites || [])
  if (related.length) {
    para = `${para.replace(/\.\s*$/, '')} Related to ${related.join('; ')}.`
  }
  return para
}

/** SOD Writing: document review uses showed; titles after titled, in quotes. */
export function sodDocumentFinding(title: string, excerpt?: string, cites?: string[]): string {
  const shown = displayEvidenceTitle(title).replace(/["“”]/g, '') || 'document'
  const body = cleanExcerpt(excerpt || '', 900)
  if (!body) {
    return `Review of the document titled, "${shown}", showed the record was reviewed.`
  }
  let para = `Review of the document titled, "${shown}", showed ${body}.`
  const related = uniqueCites(cites || [])
  if (related.length) {
    para = `${para.replace(/\.\s*$/, '')} Related to ${related.join('; ')}.`
  }
  return para
}

type ConsolidatedExhibit = {
  evidence_id: number | string
  evidence_title: string
  document_date?: string
  excerpt: string
  cites: string[]
  score: number
}

/** One row per exhibit: merge all duty-hit excerpts and cites. */
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
        cites: [],
        score: h.score || 0,
        excerptParts: [],
      }
      byKey.set(key, row)
      order.push(key)
    }
    if (h.document_date && !row.document_date) row.document_date = h.document_date
    row.score = Math.max(row.score, h.score || 0)
    if (h.excerpt?.trim()) row.excerptParts.push(h.excerpt)
    if (h.cite?.trim()) {
      const ck = h.cite.toLowerCase().replace(/\s+/g, '')
      if (!row.cites.some((c) => c.toLowerCase().replace(/\s+/g, '') === ck)) {
        row.cites.push(h.cite)
      }
    }
  }

  return order
    .map((key) => {
      const row = byKey.get(key)!
      return {
        evidence_id: row.evidence_id,
        evidence_title: row.evidence_title,
        document_date: row.document_date,
        excerpt: mergeExcerptParts(row.excerptParts),
        cites: row.cites,
        score: row.score,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUMMARY_FINDINGS)
}

export function mergeEvidenceIntoSummary(
  report: InvestigationReport,
  documents: { title: string; documentDate?: string; excerpt?: string }[],
  evidenceHits?: EvidenceReviewHit[],
): string {
  // Collaborator notes are in-app only; never re-merge them into the document body.
  let body = cleanSummaryForDocument(report.summary_of_findings || '')
  const parts = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  let opener = parts[0] || ''
  const low = opener.toLowerCase()
  if (!(low.includes('received a complaint') || low.startsWith('the department of health'))) {
    opener = ''
  }
  const remainder = parts
    .slice(opener ? 1 : 0)
    .filter((p) => {
      const pl = p.toLowerCase()
      if (pl.startsWith('a review of the document titled')) return false
      if (pl.startsWith('this section summarizes how document review')) return false
      if (pl.startsWith('investigative findings (to be completed)')) return false
      if (pl.startsWith('complete each document-review paragraph')) return false
      if (pl.startsWith('add interview and observation findings')) return false
      if (pl.includes('is authorized for this investigation because')) return false
      if (pl.includes('the corresponding allegation asserts')) return false
      if (pl.includes('investigator collaborator')) return false
      if (pl.startsWith('areas of concern:')) return false
      if (pl.startsWith('suggested methods to begin')) return false
      return true
    })
    .join('\n\n')

  const consolidated = consolidateHitsByEvidence(evidenceHits)
  const reviewParas =
    consolidated.length > 0
      ? consolidated.map((h) =>
          summaryDocumentReviewParagraph(h.evidence_title, h.document_date, h.excerpt, h.cites),
        )
      : documents.map((d) => summaryDocumentReviewParagraph(d.title, d.documentDate, d.excerpt))

  const sections = [
    opener ||
      'The Department of Health (DOH) received a complaint alleging concerns within the scope of the authorized WAC/RCW selections.',
    ...reviewParas,
  ]
  if (consolidated.length > 0 || documents.some((d) => (d.excerpt || '').trim())) {
    sections.push(COMPLETE_HINT)
  } else if (documents.length) {
    sections.push(
      'Complete each document-review paragraph with how the record supports or does not support the authorized allegations under the selected WAC/RCW. Add interview and observation findings as developed.',
    )
  }
  if (remainder && !remainder.includes(DOC_PENDING)) {
    sections.push(remainder)
  }
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
      const eid = String(row.evidence_id)
      if (findings.some((f) => (f.evidence_ids || []).includes(eid))) continue
      findings.push({
        method: 'document review',
        text: sodDocumentFinding(row.evidence_title, row.excerpt, row.cites).slice(0, 900),
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

/**
 * True when a Summary paragraph is a document-review finding with a direct
 * Evidence ↔ allegation duty link (included evidence_review hit and/or Related to cite).
 */
export function summaryParagraphIsEvidenceLinked(
  paragraph: string,
  report: InvestigationReport,
): boolean {
  const pl = (paragraph || '').trim()
  if (!/^A review of the document titled/i.test(pl)) return false
  if (/\[pending:/i.test(pl)) return false

  const allegationKeys = allegationCiteKeys(report)
  if (!allegationKeys.size) return false

  const related = pl.match(/\bRelated to\s+(.+?)\.?\s*$/i)
  if (related) {
    const cites = related[1].split(/;|,(?=\s*(?:WAC|RCW)\b)/i).map((s) => s.trim())
    if (cites.some((c) => citesOverlapAllegation(c, allegationKeys))) return true
  }

  const titleM = pl.match(/titled\s+"([^"]+)"/i)
  const title = (titleM?.[1] || '').toLowerCase().trim()
  if (!title) return false

  const hits = (report.evidence_review || []).filter(
    (h) => h.included_by_default !== false && (h.excerpt || '').trim(),
  )
  for (const h of hits) {
    const ht = displayEvidenceTitle(h.evidence_title || '')
      .toLowerCase()
      .trim()
    if (!ht) continue
    if (!(ht === title || ht.includes(title) || title.includes(ht))) continue
    if (citesOverlapAllegation(h.cite || '', allegationKeys)) return true
  }
  return false
}
