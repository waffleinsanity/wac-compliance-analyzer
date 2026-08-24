/**
 * Build / sync editable Evidence Log drafts from case uploads.
 */
import type { CaseDetail, CaseEvidence, EvidenceLogDraft, EvidenceLogRow, InvestigationReport } from './api'
import { displayEvidenceTitle } from './documentReviewFormat'

function padWacs(codes: string[] | undefined): string[] {
  const out = [...(codes || [])].map((c) => c.trim()).filter(Boolean).slice(0, 4)
  while (out.length < 4) out.push('')
  return out
}

function formatCollectedDate(raw?: string | null): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${mm}-${dd}-${yy}`
}

export function emptyEvidenceLogRow(exhibitNumber: number): EvidenceLogRow {
  return {
    exhibit_number: exhibitNumber,
    description: '',
    date_collected: '',
    collected_by: '',
    method: 'Electronic upload',
    electronic_location: '',
    wac_codes: ['', '', '', ''],
    evidence_id: null,
  }
}

export function buildEvidenceLogFromCase(
  report: InvestigationReport,
  caseDetail: CaseDetail | null,
  opts?: { investigatorName?: string },
): EvidenceLogDraft {
  const evidence = [...(caseDetail?.evidence || [])].sort((a, b) => {
    const an = a.exhibit_number ?? 0
    const bn = b.exhibit_number ?? 0
    if (an && bn) return an - bn
    return (a.created_at || '').localeCompare(b.created_at || '') || a.id - b.id
  })
  const rows: EvidenceLogRow[] = evidence.map((ev: CaseEvidence, i) => ({
    exhibit_number: ev.exhibit_number || i + 1,
    description: displayEvidenceTitle(ev.title || ev.original_filename || `document ${ev.id}`),
    date_collected: formatCollectedDate(ev.created_at),
    collected_by: opts?.investigatorName || '',
    method: 'Electronic upload',
    electronic_location: '',
    wac_codes: padWacs(ev.linked_wac_ids),
    evidence_id: ev.id,
  }))
  const fi = report.facility_info || {}
  const sod = report.sod
  return {
    investigator_name: opts?.investigatorName || '',
    case_numbers: (caseDetail?.case_id_label || report.case_id || '').trim(),
    license_numbers: (
      sod?.credential_number ||
      fi.credential_number ||
      caseDetail?.credential_number ||
      ''
    ).trim(),
    facility_name: (
      sod?.facility_name ||
      (sod?.facility_address || fi.facility_address || caseDetail?.facility_address || '')
        .split('\n')[0] ||
      ''
    ).trim(),
    rows,
  }
}

export function renumberEvidenceLogRows(rows: EvidenceLogRow[]): EvidenceLogRow[] {
  return rows.map((row, i) => ({ ...row, exhibit_number: i + 1 }))
}

export function ensureEvidenceLogOnReport(
  report: InvestigationReport,
  caseDetail: CaseDetail | null,
  opts?: { investigatorName?: string; force?: boolean },
): InvestigationReport {
  // Respect an explicit draft (including empty rows the investigator cleared).
  if (!opts?.force && report.evidence_log != null) {
    return report
  }
  return {
    ...report,
    evidence_log: buildEvidenceLogFromCase(report, caseDetail, opts),
  }
}
