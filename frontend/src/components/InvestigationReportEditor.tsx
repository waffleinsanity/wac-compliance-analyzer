import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Building2,
  Check,
  ClipboardList,
  Copy,
  Download,
  FileCheck,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import {
  api,
  type CaseDetail,
  type DefensibilityResult,
  type FacilityInfo,
  type InvestigationAllegation,
  type InvestigationConclusion,
  type InvestigationReport,
  type QuoteFailure,
} from '../api'
import { CaseAssistPanel } from './CaseAssistPanel'
import {
  caseStatusLabel,
  defensibilityOverallLabel,
  quoteFailureLabel,
} from '../investigatorLabels'
import { normalizeAllegationLine, normalizeReportAllegations } from '../allegationFormat'
import { PrivacyScreenBanner } from './PrivacyScreenBanner'

function caseStatusClass(status: string) {
  if (status === 'final') return 'status-chip-ready'
  if (status === 'in_review') return 'status-chip-warn'
  if (status === 'archived') return 'opacity-70'
  return ''
}

function defensibilityChipClass(overall: string) {
  if (overall === 'pass') return 'status-chip-ready'
  if (overall === 'block') return 'border-rose-400/50 bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200'
  return 'status-chip-warn'
}

function allegationAnchorId(wacCode: string) {
  return `allegation-${wacCode.replace(/[^\w.-]+/g, '_')}`
}

function wacCodeFromFailure(f: QuoteFailure): string | null {
  if (f.field.startsWith('allegation:')) return f.field.slice('allegation:'.length) || null
  return null
}

function jumpToAllegation(wacCode: string) {
  const el = document.getElementById(allegationAnchorId(wacCode))
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ring-2', 'ring-cedar-500/50')
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-cedar-500/50'), 1600)
}

type Props = {
  report: InvestigationReport
  onBack: () => void
  selectedWacs?: string[]
  caseId?: number | null
  caseDetail?: CaseDetail | null
  onCaseRefresh?: () => Promise<void>
  onReportChange?: (report: InvestigationReport) => void
  onRebuild?: () => Promise<void>
  canEdit?: boolean
  /** Download/copy/export of the finished IR product (editors/admins). */
  canExport?: boolean
}

function AllegationBadge({ a }: { a: InvestigationAllegation }) {
  if (a.quote_ok === false) {
    return (
      <span className="rounded-md bg-rose-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
        Needs statute review
      </span>
    )
  }
  if (a.low_confidence) {
    return (
      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
        Confirm subsection
      </span>
    )
  }
  if (a.quote_ok) {
    return (
      <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
        Statute verified
      </span>
    )
  }
  return null
}

const RESULT_OPTIONS = ['Pending Investigation', 'Substantiated', 'Unsubstantiated'] as const

function resultStyle(result: string) {
  if (result === 'Substantiated') return 'bg-rose-500/12 text-rose-800 border-rose-500/25 dark:text-rose-300'
  if (result === 'Unsubstantiated')
    return 'bg-emerald-500/12 text-emerald-800 border-emerald-500/25 dark:text-emerald-300'
  return 'bg-amber-500/12 text-amber-900 border-amber-500/25 dark:text-amber-300'
}

function conclusionPhrase(result: string) {
  if (result === 'Substantiated') return 'out of compliance'
  if (result === 'Unsubstantiated') return 'in compliance'
  return 'pending determination of compliance'
}

function buildPlainText(report: InvestigationReport): string {
  // Prefer server-built blank IR text (data/templates/5. Investigation report.docx)
  if (report.report_text?.trim()) return report.report_text

  const fi = report.facility_info
  const lines: string[] = [
    'Investigative Report',
    `Facility Address: ${fi.facility_address || ''}`,
    `Laboratory Director: ${fi.laboratory_director || ''}`,
    `CLIA Number: ${fi.clia_number || ''}`,
    `Credential Number: ${fi.credential_number || ''}`,
    `Medicare Number: ${fi.medicare_number || ''}`,
    `Shell Number: ${fi.shell_number || ''}`,
    `Date(s) of Investigation: ${fi.investigation_dates || report.investigation_date || ''}`,
    `State Licensing Priority: ${fi.state_licensing_priority || ''}`,
    `Federal Certification Priority: ${fi.federal_certification_priority || ''}`,
    '',
    'Intake Details: (List of concerns reported in the original complaint.)',
    '',
    report.intake_details,
    '',
    `Allegation(s): (${report.allegation_preamble})`,
    '',
  ]

  for (const a of report.allegations) {
    const text = a.allegation_text.trim()
    lines.push(text.toLowerCase().startsWith('allegation:') ? text : `Allegation: ${text}`, '')
  }

  lines.push(
    '',
    'Investigative Process Included: (This is what the investigator did in terms of methods employed to conduct inquiry.)',
    '',
  )
  for (const step of report.investigative_process) lines.push(step)

  lines.push(
    '',
    'Summary of Findings (Narrative overview of the results of investigation.)',
    '',
    report.summary_of_findings,
    '',
    'Conclusion/ Results of Investigation',
    '',
  )
  const byCode = Object.fromEntries(report.conclusions.map((c) => [c.wac_code, c]))
  for (const a of report.allegations) {
    const c = byCode[a.wac_code]
    const result = c?.result || 'Pending Investigation'
    const finding = conclusionPhrase(result)
    const instrument = a.wac_code.startsWith('71.') ? 'RCW' : 'WAC'
    let line = `Allegation: The investigator found the facility ${finding} with ${instrument} ${a.wac_code}`
    if (a.wac_title) line += `, ${a.wac_title}`
    line += '.'
    if (c?.deficiency_cited && c.deficiency_details && finding === 'out of compliance') {
      line += ` ${c.deficiency_details}`
    }
    lines.push(line, '')
  }
  lines.push('Actions:', report.actions)
  return lines.join('\n')
}

function groupAllegations(allegations: InvestigationAllegation[]) {
  return allegations.reduce<Record<string, InvestigationAllegation[]>>((acc, a) => {
    const key = a.case_category || 'General'
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {})
}

export function InvestigationReportEditor({
  report: initial,
  onBack,
  selectedWacs,
  caseId,
  caseDetail,
  onCaseRefresh,
  onReportChange,
  onRebuild,
  canEdit = true,
  canExport = true,
}: Props) {
  const [report, setReport] = useState(() => normalizeReportAllegations({ ...initial }))
  const [copied, setCopied] = useState(false)
  const [showFindings, setShowFindings] = useState(false)
  const [exportError, setExportError] = useState('')
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [info, setInfo] = useState('')
  const [defensibility, setDefensibility] = useState<DefensibilityResult | null>(null)

  useEffect(() => {
    setReport(normalizeReportAllegations({ ...initial }))
    setExportError('')
    setInfo('')
  }, [initial])

  useEffect(() => {
    onReportChange?.(report)
  }, [report, onReportChange])

  useEffect(() => {
    if (!caseId) {
      setDefensibility(null)
      return
    }
    let cancelled = false
    void api
      .caseDefensibility(caseId)
      .then((res) => {
        if (!cancelled) setDefensibility(res)
      })
      .catch(() => {
        if (!cancelled) setDefensibility(null)
      })
    return () => {
      cancelled = true
    }
  }, [caseId, caseDetail?.updated_at, report.quote_integrity?.ok, report.allegations.length])

  const grouped = useMemo(() => groupAllegations(report.allegations), [report.allegations])

  const topQuoteFailures = useMemo(
    () => report.quote_integrity?.failures?.slice(0, 5) ?? [],
    [report.quote_integrity?.failures],
  )

  const exportBlocked =
    defensibility?.can_export === false || report.quote_integrity?.ok === false
  const exportWarn = !exportBlocked && defensibility?.overall === 'warn'

  const selectedCodes = useMemo(() => {
    if (selectedWacs?.length) return selectedWacs
    return report.allegations.map((a) => a.wac_code)
  }, [selectedWacs, report.allegations])

  const updateFacility = useCallback((field: keyof FacilityInfo, value: string) => {
    setReport((prev) => ({
      ...prev,
      facility_info: { ...prev.facility_info, [field]: value },
    }))
  }, [])

  const updateProcess = useCallback((index: number, value: string) => {
    setReport((prev) => {
      const investigative_process = [...prev.investigative_process]
      investigative_process[index] = value
      return { ...prev, investigative_process }
    })
  }, [])

  const updateConclusion = useCallback((index: number, patch: Partial<InvestigationConclusion>) => {
    setReport((prev) => {
      const conclusions = [...prev.conclusions]
      conclusions[index] = { ...conclusions[index], ...patch }
      if (patch.result === 'Substantiated') {
        conclusions[index].deficiency_cited = true
        if (!conclusions[index].deficiency_details) {
          conclusions[index].deficiency_details = 'Substantiated with deficient practice or condition cited.'
        }
      }
      if (patch.result && patch.result !== 'Substantiated') {
        conclusions[index].deficiency_cited = false
      }
      return { ...prev, conclusions }
    })
  }, [])

  const caseDraftEditable =
    caseDetail?.status === 'draft' || caseDetail?.status === 'reopened'

  const ensureExportAllowed = async (): Promise<boolean> => {
    if (!canExport) {
      setExportError(
        'Export, download, and copy require Editor or Administrator role. Your draft remains saved in the case record.',
      )
      return false
    }
    setValidating(true)
    setExportError('')
    try {
      const res = await api.validateReport({
        selected_wacs: selectedCodes,
        allegations: report.allegations,
        regulatory_framework: report.regulatory_framework || [],
        evidentiary_examples: report.evidentiary_examples || [],
      })
      setReport((prev) => ({ ...prev, quote_integrity: res.quote_integrity }))
      const failedCodes = new Set(
        res.quote_integrity.failures
          .filter((f) => f.field.startsWith('allegation:'))
          .map((f) => f.field.replace('allegation:', '')),
      )
      setReport((prev) => ({
        ...prev,
        quote_integrity: res.quote_integrity,
        allegations: prev.allegations.map((a) => ({
          ...a,
          quote_ok: !failedCodes.has(a.wac_code),
        })),
      }))
      if (!res.can_export) {
        const detail = res.quote_integrity.failures
          .slice(0, 4)
          .map(
            (f) =>
              `${quoteFailureLabel(f.reason)}${f.cite ? ` (${f.cite})` : ''}: ${f.quote_preview}`,
          )
          .join(' · ')
        setExportError(
          `Export blocked — statute wording does not match the approved codes. ${detail}`,
        )
        return false
      }
      return true
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not validate report quotes')
      return false
    } finally {
      setValidating(false)
    }
  }

  const copyAll = async () => {
    const ok = await ensureExportAllowed()
    if (!ok) return
    await navigator.clipboard.writeText(buildPlainText(report))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const exportTxt = async () => {
    const ok = await ensureExportAllowed()
    if (!ok) return
    const blob = new Blob([buildPlainText(report)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Investigation_Report.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const saveDraft = async () => {
    if (!caseId) {
      setExportError('Create or open a case first to save a durable draft.')
      return
    }
    setSaving(true)
    setExportError('')
    setInfo('')
    try {
      await api.saveCaseDraft(caseId, report, 'Manual draft save')
      await onCaseRefresh?.()
      setInfo('Draft saved to case (working draft for investigator review).')
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportDocx = async (acknowledgeGaps: boolean) => {
    if (!caseId) {
      setExportError('Save this report to a case before exporting DOCX.')
      return
    }
    setValidating(true)
    setExportError('')
    try {
      if (caseDraftEditable) {
        await api.saveCaseDraft(caseId, report, 'Pre-export save')
      }
      const blob = await api.exportCaseDocx(caseId, acknowledgeGaps)
      downloadBlob(blob, `IR_case_${caseId}.docx`)
      setInfo(acknowledgeGaps ? 'DOCX exported with investigator acknowledgment of gaps.' : 'DOCX exported.')
      await onCaseRefresh?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'DOCX export failed'
      if (msg.includes('acknowledge_gaps')) {
        setExportError(`${msg} Use “Export DOCX anyway” if you accept the gaps.`)
      } else {
        setExportError(msg)
      }
    } finally {
      setValidating(false)
    }
  }

  const exportPack = async (acknowledgeGaps: boolean) => {
    if (!caseId) {
      setExportError('Save this report to a case before exporting a pack.')
      return
    }
    setValidating(true)
    setExportError('')
    try {
      if (caseDraftEditable) {
        await api.saveCaseDraft(caseId, report, 'Pre-pack save')
      }
      const blob = await api.exportCasePack(caseId, acknowledgeGaps)
      downloadBlob(blob, `case_${caseId}_pack.zip`)
      setInfo('Pack exported (IR + deficiency cite sheet).')
      await onCaseRefresh?.()
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Pack export failed')
    } finally {
      setValidating(false)
    }
  }

  return (
    <div className="animate-rise space-y-3 sm:space-y-5">
      <PrivacyScreenBanner variant="evidence" compact className="max-sm:hidden" />
      <div className="sticky top-0 z-20 -mx-1 space-y-2 rounded-xl border border-ink-200/70 bg-background/95 px-3 py-2 shadow-soft backdrop-blur-md sm:space-y-3 sm:px-4 sm:py-3 dark:border-ink-700">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:items-end sm:gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-tide-600 sm:text-xs dark:text-tide-400">
                Step 3 · Report
              </p>
              {caseDetail?.status && (
                <span
                  className={clsx(
                    'status-chip !px-2 !py-0.5 text-[10px]',
                    caseStatusClass(caseDetail.status),
                  )}
                >
                  {caseStatusLabel(caseDetail.status)}
                </span>
              )}
              {defensibility && (
                <span
                  className={clsx(
                    'status-chip !px-2 !py-0.5 text-[10px] sm:!px-2.5 sm:!py-1 sm:text-[11px]',
                    defensibilityChipClass(defensibility.overall),
                  )}
                  title={defensibility.summary}
                >
                  <span className="sm:hidden">{defensibilityOverallLabel(defensibility.overall)}</span>
                  <span className="hidden sm:inline">
                    Export check · {defensibilityOverallLabel(defensibility.overall)}
                  </span>
                </span>
              )}
            </div>
            <h2 className="mt-0.5 font-display text-xl tracking-tight sm:mt-1 sm:text-2xl md:text-3xl">
              Investigative Report
            </h2>
            <p className="mt-0.5 hidden max-w-2xl font-sans text-sm text-ink-500 sm:mt-1 sm:block">
              Working draft for investigator review — not an automated final. Save to a case, then export.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs sm:!px-3 sm:!py-2 sm:text-sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Compare</span>
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn-secondary !px-2.5 !py-1.5 text-xs sm:!px-3 sm:!py-2 sm:text-sm"
                disabled={saving || !caseId}
                onClick={() => void saveDraft()}
              >
                {saving ? 'Saving…' : 'Save'}
                <span className="hidden sm:inline">&nbsp;draft</span>
              </button>
            )}
            {canExport ? (
              <button
                type="button"
                className="btn-primary !px-2.5 !py-1.5 text-xs sm:!px-3 sm:!py-2 sm:text-sm"
                disabled={validating || !caseId || exportBlocked}
                title={
                  exportBlocked
                    ? 'Export blocked — fix statute wording first'
                    : exportWarn
                      ? 'Defensibility gaps remain — use Export DOCX anyway to acknowledge'
                      : undefined
                }
                onClick={() => void exportDocx(false)}
              >
                <Download className="h-4 w-4" />
                <span className="sm:hidden">DOCX</span>
                <span className="hidden sm:inline">Export DOCX</span>
              </button>
            ) : (
              <span
                className="inline-flex items-center rounded-lg border border-ink-200/80 bg-ink-50/80 px-2 py-1.5 text-[11px] text-ink-500 dark:border-ink-700 dark:bg-ink-900/40 sm:px-3 sm:py-2 sm:text-xs"
                title="Viewer accounts keep the IR in the case record without download or copy"
              >
                In-record only
              </span>
            )}
          </div>
        </div>
        <details className="border-t border-ink-200/60 pt-2 dark:border-ink-700 sm:hidden">
          <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-ink-400 marker:content-none [&::-webkit-details-marker]:hidden">
            More actions
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {canEdit && caseId && onRebuild && (
              <button
                type="button"
                className="btn-ghost !px-2.5 !py-1 text-xs"
                disabled={validating || saving}
                onClick={() => {
                  if (
                    window.confirm(
                      'Rebuild from approved WACs? Your current draft will be snapshotted, then overwritten.',
                    )
                  ) {
                    void onRebuild()
                  }
                }}
              >
                Rebuild draft
              </button>
            )}
            {canExport && (
              <>
                <button
                  type="button"
                  className="btn-ghost !px-2.5 !py-1 text-xs"
                  disabled={validating}
                  onClick={() => void copyAll()}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : validating ? 'Checking…' : 'Copy all'}
                </button>
                <button
                  type="button"
                  className="btn-ghost !px-2.5 !py-1 text-xs"
                  disabled={validating}
                  onClick={() => void exportTxt()}
                >
                  <Download className="h-3.5 w-3.5" /> .txt
                </button>
                <button
                  type="button"
                  className="btn-ghost !px-2.5 !py-1 text-xs"
                  disabled={validating || !caseId || exportBlocked}
                  onClick={() => void exportPack(true)}
                  title={
                    exportBlocked
                      ? 'Export blocked — statute wording must match approved codes first'
                      : undefined
                  }
                >
                  Export pack
                </button>
                <button
                  type="button"
                  className="btn-ghost !px-2.5 !py-1 text-xs text-amber-800 dark:text-amber-300"
                  disabled={validating || !caseId || exportBlocked}
                  onClick={() => void exportDocx(true)}
                  title={
                    exportBlocked
                      ? 'Export blocked — statute wording must match approved codes first'
                      : 'Export even when export-check warnings remain (statute wording blocks still apply)'
                  }
                >
                  Export DOCX anyway
                </button>
              </>
            )}
          </div>
          {canExport && exportBlocked && (
            <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
              Export blocked until statute wording matches the approved codes.
            </p>
          )}
          {canExport && !exportBlocked && exportWarn && (
            <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">
              Defensibility gaps remain — use “Export DOCX anyway” after review.
            </p>
          )}
          {!canExport && (
            <p className="mt-2 text-[11px] text-ink-500">
              Viewer role: edit and save in-record. Export and copy are disabled.
            </p>
          )}
        </details>
        <div className="hidden flex-wrap items-center gap-1.5 border-t border-ink-200/60 pt-2 dark:border-ink-700 sm:flex">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">More</span>
          {canEdit && caseId && onRebuild && (
            <button
              type="button"
              className="btn-ghost !px-2.5 !py-1 text-xs"
              disabled={validating || saving}
              onClick={() => {
                if (
                  window.confirm(
                    'Rebuild from approved WACs? Your current draft will be snapshotted, then overwritten.',
                  )
                ) {
                  void onRebuild()
                }
              }}
            >
              Rebuild draft
            </button>
          )}
          {canExport && (
            <>
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-xs"
            disabled={validating}
            onClick={() => void copyAll()}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : validating ? 'Checking…' : 'Copy all'}
          </button>
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-xs"
            disabled={validating}
            onClick={() => void exportTxt()}
          >
            <Download className="h-3.5 w-3.5" /> .txt
          </button>
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-xs"
            disabled={validating || !caseId || exportBlocked}
            onClick={() => void exportPack(true)}
            title={
              exportBlocked ? 'Export blocked — statute wording must match approved codes first' : undefined
            }
          >
            Export pack
          </button>
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-xs text-amber-800 dark:text-amber-300"
            disabled={validating || !caseId || exportBlocked}
            onClick={() => void exportDocx(true)}
            title={
              exportBlocked
                ? 'Export blocked — statute wording must match approved codes first'
                : 'Export even when export-check warnings remain (statute wording blocks still apply)'
            }
          >
            Export DOCX anyway
          </button>
            </>
          )}
        </div>
        {canExport && exportBlocked && (
          <p className="hidden text-[11px] text-rose-700 dark:text-rose-300 sm:block">
            Export blocked until statute wording matches the approved codes. Fix cited language, then re-check.
          </p>
        )}
        {canExport && !exportBlocked && exportWarn && (
          <p className="hidden text-[11px] text-amber-800 dark:text-amber-300 sm:block">
            Defensibility gaps remain — use “Export DOCX anyway” after investigator review.
          </p>
        )}
        {!canExport && (
          <p className="hidden text-[11px] text-ink-500 sm:block">
            Viewer role: edit and save the investigation report in this case. Export, download, and copy are disabled.
          </p>
        )}
      </div>

      {exportError && (
        <div className="rounded-xl border border-rose-300/80 bg-rose-50 px-4 py-3 text-sm text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
          {exportError}
        </div>
      )}
      {info && (
        <div className="rounded-xl border border-tide-500/25 bg-tide-500/8 px-4 py-3 text-sm text-tide-900 dark:text-tide-100">
          {info}
        </div>
      )}

      {report.quote_integrity && (
        <div
          className={clsx(
            'rounded-xl border px-4 py-3 text-sm',
            report.quote_integrity.ok
              ? 'border-emerald-300/70 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100'
              : 'border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100',
          )}
        >
          {report.quote_integrity.ok
            ? 'Statute wording matches the approved code text.'
            : `Statute wording issues (${report.quote_integrity.failures.length}). Copy/export is blocked until wording matches the approved codes.`}
          {!report.quote_integrity.ok && topQuoteFailures.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-t border-amber-300/50 pt-2 dark:border-amber-700/60">
              {topQuoteFailures.map((f, i) => {
                const code = wacCodeFromFailure(f)
                const label = f.cite || code || 'Issue'
                const jumpable =
                  !!code && report.allegations.some((a) => a.wac_code === code)
                return (
                  <li key={`${f.field}-${f.reason}-${i}`} className="text-xs leading-snug">
                    {jumpable ? (
                      <button
                        type="button"
                        className="text-left underline decoration-amber-700/40 underline-offset-2 hover:decoration-amber-800 dark:decoration-amber-400/50"
                        onClick={() => jumpToAllegation(code)}
                      >
                        <span className="font-mono font-semibold">{label}</span>
                        <span className="mx-1.5 text-amber-700/70 dark:text-amber-400/70">·</span>
                        <span>{quoteFailureLabel(f.reason)}</span>
                      </button>
                    ) : (
                      <span>
                        <span className="font-mono font-semibold">{label}</span>
                        <span className="mx-1.5 text-amber-700/70 dark:text-amber-400/70">·</span>
                        <span>{quoteFailureLabel(f.reason)}</span>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="mx-auto grid max-w-6xl gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <article className="doc-surface overflow-hidden">
        <div className="border-b border-ink-200/80 bg-gradient-to-b from-[#f3efe6] to-transparent px-6 py-8 text-center dark:border-ink-700 dark:from-ink-900/80">
          <h1 className="font-display text-2xl font-semibold tracking-[0.04em] text-ink-900 dark:text-ink-50 sm:text-3xl">
            Investigative Report
          </h1>
          <div className="mx-auto mt-3 h-px w-24 animate-draw bg-tide-500/50" />
          <p className="mt-3 font-sans text-xs text-ink-400">
            {report.selected_count} authorized codes · DOH facility IR structure ·{" "}
            {Math.round(report.duration_ms)} ms
          </p>
        </div>

        <div className="space-y-8 p-5 sm:p-8">
          {/* Facility */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 font-display text-lg">
              <Building2 className="h-4 w-4 text-tide-600" /> Facility Information
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['facility_address', 'Facility Address'],
                  ['laboratory_director', 'Laboratory Director'],
                  ['clia_number', 'CLIA Number'],
                  ['credential_number', 'Credential Number'],
                  ['medicare_number', 'Medicare Number'],
                  ['shell_number', 'Shell Number'],
                  ['investigation_dates', 'Date(s) of Investigation'],
                  ['state_licensing_priority', 'State Licensing Priority'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input
                    className="input"
                    value={report.facility_info[key] || ''}
                    onChange={(e) => updateFacility(key, e.target.value)}
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <label className="label">Federal Certification Priority</label>
                <input
                  className="input"
                  value={report.facility_info.federal_certification_priority}
                  onChange={(e) => updateFacility('federal_certification_priority', e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* Intake */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-display text-lg">
              <ClipboardList className="h-4 w-4 text-tide-600" /> Intake Details
            </h3>
            <p className="mb-3 font-sans text-xs text-ink-400">
              List of concerns reported in the original complaint.
            </p>
            <textarea
              className="input min-h-[140px] font-serif leading-relaxed"
              value={report.intake_details}
              onChange={(e) => setReport((p) => ({ ...p, intake_details: e.target.value }))}
            />
          </section>

          {report.authority_statement && (
            <section>
              <h3 className="mb-2 font-display text-lg">Authority</h3>
              <p className="rounded-xl border bg-muted/20 px-4 py-3 text-sm leading-relaxed">
                {report.authority_statement}
              </p>
            </section>
          )}

          {!!report.regulatory_framework?.length && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 font-display text-lg">
                <FileCheck className="h-4 w-4 text-tide-600" /> Regulatory Framework
              </h3>
              <p className="mb-3 font-sans text-xs text-ink-400">
                Exact subsection language from the local WAC/RCW PDFs.
              </p>
              <div className="space-y-3">
                {report.regulatory_framework.map((entry) => (
                  <div key={`${entry.instrument}-${entry.code}`} className="rounded-xl border px-4 py-3">
                    <div className="font-mono text-xs font-semibold">
                      {entry.instrument} {entry.code}
                    </div>
                    <div className="text-xs text-muted-foreground">{entry.title}</div>
                    <ul className="mt-2 space-y-2">
                      {(entry.subsections || []).map((sub, i) => (
                        <li key={`${entry.code}-${i}`} className="text-sm">
                          <div className="font-mono text-[11px] font-semibold">{sub.cite}</div>
                          <p className="mt-0.5 whitespace-pre-wrap font-serif text-xs leading-relaxed">
                            {sub.text}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Allegations */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-display text-lg">
              <FileText className="h-4 w-4 text-cedar-500" /> Allegation(s)
            </h3>
            <p className="mb-4 font-sans text-xs text-ink-400">{report.allegation_preamble}</p>
            <div className="space-y-5">
              {Object.entries(grouped).map(([category, items]) => (
                <div key={category}>
                  {Object.keys(grouped).length > 1 && (
                    <div className="mb-2 inline-block rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-1 font-sans text-xs font-semibold dark:border-ink-600 dark:bg-ink-800">
                      {report.case_id ? `${report.case_id} ${category}` : category}
                    </div>
                  )}
                  <div className="space-y-3">
                    {items.map((a) => (
                      <div
                        key={`${category}-${a.wac_code}`}
                        id={allegationAnchorId(a.wac_code)}
                        className="scroll-mt-28 rounded-xl border border-cedar-500/20 bg-cedar-500/[0.04] px-4 py-3 transition"
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-ink-900 px-2 py-0.5 font-mono text-[11px] font-semibold text-ink-50 dark:bg-ink-100 dark:text-ink-900">
                            {a.wac_code}
                          </span>
                          <span className="font-sans text-xs text-ink-500">{a.wac_title}</span>
                          <AllegationBadge a={a} />
                          <Pencil className="ml-auto h-3.5 w-3.5 text-ink-400" />
                        </div>
                        <textarea
                          className="input min-h-[88px] font-serif text-sm leading-relaxed"
                          value={normalizeAllegationLine(a.allegation_text)}
                          onChange={(e) => {
                            const value = normalizeAllegationLine(e.target.value)
                            setReport((prev) => {
                              const allegations = prev.allegations.map((item) =>
                                item.wac_code === a.wac_code && item.case_category === a.case_category
                                  ? { ...item, allegation_text: value }
                                  : item,
                              )
                              return { ...prev, allegations }
                            })
                          }}
                        />
                        {!!a.matched_subsections?.length && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {a.matched_subsections.map((s) => (
                              <span key={s} className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px]">
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {!!report.evidentiary_examples?.length && (
            <section>
              <h3 className="mb-2 font-display text-lg">Evidentiary Framework</h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                {report.evidentiary_examples.map((ex, i) => (
                  <li key={i}>
                    <textarea
                      className="input min-h-[64px] w-full font-serif text-sm"
                      value={ex}
                      onChange={(e) => {
                        const value = e.target.value
                        setReport((prev) => {
                          const evidentiary_examples = [...(prev.evidentiary_examples || [])]
                          evidentiary_examples[i] = value
                          return { ...prev, evidentiary_examples }
                        })
                      }}
                    />
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Process */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-display text-lg">
              <Search className="h-4 w-4 text-tide-600" /> Investigative Process Included
            </h3>
            <p className="mb-3 font-sans text-xs text-ink-400">
              Blank DOH shell only (Pre-investigation / Observations / Interviews / Document Review).
              Investigation activity beyond these labels is filled by the investigator.
            </p>
            <div className="space-y-2">
              {report.investigative_process.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    className="input flex-1"
                    value={item}
                    onChange={(e) => updateProcess(index, e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-ghost !px-2"
                    onClick={() =>
                      setReport((p) => ({
                        ...p,
                        investigative_process: p.investigative_process.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-secondary !py-1.5 text-xs"
                onClick={() =>
                  setReport((p) => ({
                    ...p,
                    investigative_process: [...p.investigative_process, 'The investigator '],
                  }))
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add process step
              </button>
            </div>
          </section>

          {/* Summary */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-display text-lg">
              <FileText className="h-4 w-4 text-tide-600" /> Summary of Findings
            </h3>
            <p className="mb-3 font-sans text-xs text-ink-400">
              Framework starter for authorized WAC/RCW selections — complete the findings narrative
              after investigation activities (interviews, observations, document review).
            </p>
            <textarea
              className="input min-h-[200px] font-serif leading-relaxed"
              value={report.summary_of_findings}
              onChange={(e) => setReport((p) => ({ ...p, summary_of_findings: e.target.value }))}
            />
          </section>

          {/* Conclusions */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 font-display text-lg">
              <FileCheck className="h-4 w-4 text-tide-600" /> Conclusion / Results of Investigation
            </h3>
            <div className="space-y-4">
              {Object.entries(grouped).map(([category, items]) => (
                <div key={`c-${category}`}>
                  {Object.keys(grouped).length > 1 && (
                    <div className="mb-2 font-sans text-xs font-semibold uppercase tracking-wider text-ink-400">
                      {category}
                    </div>
                  )}
                  <div className="space-y-3">
                    {items.map((a) => {
                      const idx = report.conclusions.findIndex((c) => c.wac_code === a.wac_code)
                      const conclusion = idx >= 0 ? report.conclusions[idx] : null
                      const result = conclusion?.result || 'Pending Investigation'
                      return (
                        <div
                          key={`conc-${a.wac_code}`}
                          className="rounded-xl border border-ink-200/80 bg-white/60 p-4 dark:border-ink-700 dark:bg-ink-900/40"
                        >
                          <p className="prose-report mb-3 text-sm">
                            <span className="font-semibold">Allegation:</span>{' '}
                            {normalizeAllegationLine(a.allegation_text)}
                          </p>
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="font-sans text-xs font-semibold text-ink-500">Result</label>
                            <select
                              className="input !w-auto min-w-[200px]"
                              value={result}
                              onChange={(e) => idx >= 0 && updateConclusion(idx, { result: e.target.value })}
                            >
                              {RESULT_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                            <span
                              className={clsx(
                                'rounded-lg border px-2.5 py-1 font-sans text-xs font-semibold',
                                resultStyle(result),
                              )}
                            >
                              {result}
                            </span>
                          </div>
                          {result === 'Substantiated' && idx >= 0 && (
                            <div className="mt-3">
                              <label className="label">Deficiency details</label>
                              <input
                                className="input"
                                value={conclusion?.deficiency_details || ''}
                                onChange={(e) =>
                                  updateConclusion(idx, { deficiency_details: e.target.value })
                                }
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Actions */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 font-display text-lg">
              <Pencil className="h-4 w-4 text-tide-600" /> Actions
            </h3>
            <textarea
              className="input min-h-[100px] font-serif leading-relaxed"
              value={report.actions}
              onChange={(e) => setReport((p) => ({ ...p, actions: e.target.value }))}
            />
          </section>

          {/* Supporting findings (de-emphasized) */}
          <section className="border-t border-ink-200/70 pt-6 dark:border-ink-700">
            <button
              type="button"
              className="btn-ghost !px-0 font-sans text-sm"
              onClick={() => setShowFindings((v) => !v)}
            >
              {showFindings ? 'Hide' : 'Show'} supporting compliance templates ({report.findings.length})
            </button>
            {showFindings && (
              <div className="mt-3 space-y-2">
                {report.findings.map((f) => (
                  <div
                    key={f.hierarchy_path + f.status}
                    className="rounded-xl bg-ink-50/80 p-3 font-mono text-xs leading-relaxed text-ink-700 dark:bg-ink-900/50 dark:text-ink-200"
                  >
                    {f.formatted_output}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </article>

      {caseDetail && onCaseRefresh ? (
        <div className="xl:sticky xl:top-4 xl:self-start">
          <CaseAssistPanel
            caseDetail={caseDetail}
            onRefresh={onCaseRefresh}
            onReportApplied={(detail) => {
              if (detail.report) setReport(normalizeReportAllegations({ ...detail.report }))
            }}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-ink-200/80 p-4 text-sm text-ink-500 dark:border-ink-700">
          Open or save a case to unlock evidence links, process builder, export checks, and review
          workflow.
        </div>
      )}
      </div>
    </div>
  )
}
