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
  Search,
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
import {
  FINDING_PHRASES,
  PROCESS_LABELS,
  findingPhraseToResult,
  packProcessFields,
  resultToFindingPhrase,
  unpackProcessFields,
  type FindingPhrase,
  type ProcessFields,
} from '../processTemplate'
import { IrTemplatePicker } from './IrTemplatePicker'

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
  /** Ensure a case exists and current draft is saved; returns case db id. */
  onEnsureCase?: (report: InvestigationReport) => Promise<number>
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

function findingSelectClass(phrase: FindingPhrase) {
  if (phrase === 'out of compliance')
    return 'border-rose-400/50 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100'
  if (phrase === 'in compliance')
    return 'border-emerald-400/50 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100'
  return 'border-amber-400/50 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
}

function buildPlainText(report: InvestigationReport): string {
  // Always rebuild from structured fields so Copy/.txt match DOCX (never stale report_text).
  const fi = report.facility_info
  const lines: string[] = [
    'Investigative Report',
    `Facility Address: ${fi.facility_address || ''}`,
    `Laboratory Director: ${fi.laboratory_director || 'N/A'}`,
    `CLIA Number: ${fi.clia_number || 'N/A'}`,
    `Credential Number: ${fi.credential_number || ''}`,
    `Medicare Number: ${fi.medicare_number || 'N/A'}`,
    `Shell Number: ${fi.shell_number || 'N/A'}`,
    `Date(s) of Investigation: ${fi.investigation_dates || report.investigation_date || ''}`,
    `State Licensing Priority: ${fi.state_licensing_priority || ''}`,
    `Federal Certification Priority: ${fi.federal_certification_priority || ''}`,
    '',
    'Intake Details: (List of concerns reported in the original complaint.)',
    '',
    report.intake_details,
    '',
    'Allegation(s): (The allegation(s) listed below is what the department has jurisdiction and authorization to investigate. An allegation is considered an assertion of improper practice or condition that could result in a violation of facility law or rule.)',
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
    const finding = resultToFindingPhrase(result)
    const instrument = a.wac_code.startsWith('71.') ? 'RCW' : 'WAC'
    let line = `Allegation: The investigator found the facility ${finding} with ${instrument} ${a.wac_code}`
    if (a.wac_title) line += `, ${a.wac_title}`
    line += '.'
    if (c?.deficiency_details && finding === 'out of compliance') {
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

/** Section title (16pt bold) + parenthetical hint (12pt italic) — matches blank DOCX. */
function IrSectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <p className="ir-section-heading">
      <span className="ir-section-title">{title} </span>
      <span className="ir-section-hint">{hint}</span>
    </p>
  )
}

function processLineKind(step: string): 'activity' | 'subhead' | 'body' {
  const key = step.trim().replace(/:$/, '').toLowerCase()
  if (key === 'pre-investigation activity' || key === 'investigation activity') return 'activity'
  if (key === 'observations' || key === 'interviews' || key === 'document review') return 'subhead'
  return 'body'
}

/** Process line with blank-template weight / underline / size. */
function IrProcessLine({ step }: { step: string }) {
  const kind = processLineKind(step)
  if (kind === 'activity') {
    const trimmed = step.trim()
    const hasColon = trimmed.endsWith(':')
    const label = hasColon ? trimmed.slice(0, -1) : trimmed
    return (
      <p className="ir-process-line">
        <span className="ir-process-activity">{label}</span>
        {hasColon ? <span className="ir-process-activity-colon">:</span> : null}
      </p>
    )
  }
  if (kind === 'subhead') {
    return <p className="ir-process-subhead">{step}</p>
  }
  return <p className="ir-body whitespace-pre-wrap">{step}</p>
}

/** On-screen IR that mirrors Download DOCX layout (blank shell + live field values). */
function DocumentPreview({ report }: { report: InvestigationReport }) {
  const fi = report.facility_info
  const byCode = Object.fromEntries(report.conclusions.map((c) => [c.wac_code, c]))
  const facilityLines: [string, string][] = [
    ['Facility Address:', fi.facility_address || ''],
    ['Laboratory Director:', fi.laboratory_director || 'N/A'],
    ['CLIA Number:', fi.clia_number || 'N/A'],
    ['Credential Number:', fi.credential_number || ''],
    ['Medicare Number:', fi.medicare_number || 'N/A'],
    ['Shell Number:', fi.shell_number || 'N/A'],
    ['Date(s) of Investigation:', fi.investigation_dates || report.investigation_date || ''],
    ['State Licensing Priority:', fi.state_licensing_priority || ''],
    ['Federal Certification Priority:', fi.federal_certification_priority || ''],
  ]

  return (
    <div className="ir-doc-desk">
      <div className="ir-doc-toolbar">
        <FileText className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden />
        <p className="min-w-0 text-[11px] leading-snug text-ink-500 dark:text-ink-400">
          Structured preview (built-in blank layout). Download uses the selected IR template when
          attached.
        </p>
      </div>
      <div className="ir-doc-scroll">
        <div className="ir-doc-page" role="document" aria-label="Investigation Report preview">
          <h1 className="ir-doc-title">Investigative Report</h1>
          <div className="mb-4 space-y-0">
            {facilityLines.map(([label, value]) => (
              <p key={label} className="ir-body">
                <span className="font-bold">{label}</span> {value}
              </p>
            ))}
          </div>
          <div className="mb-4 space-y-2">
            <IrSectionHeading
              title="Intake Details:"
              hint="(List of concerns reported in the original complaint.)"
            />
            <p className="ir-body whitespace-pre-wrap">{report.intake_details || '—'}</p>
          </div>
          <div className="mb-4 space-y-2">
            <IrSectionHeading
              title="Allegation(s):"
              hint="(The allegation(s) listed below is what the department has jurisdiction and authorization to investigate. An allegation is considered an assertion of improper practice or condition that could result in a violation of facility law or rule.)"
            />
            {report.allegations.map((a) => {
              const text = normalizeAllegationLine(a.allegation_text)
              const line = text.toLowerCase().startsWith('allegation:') ? text : `Allegation: ${text}`
              return (
                <p key={a.wac_code} className="ir-body whitespace-pre-wrap">
                  {line}
                </p>
              )
            })}
          </div>
          <div className="mb-4 space-y-1">
            <div className="mb-2">
              <IrSectionHeading
                title="Investigative Process Included:"
                hint="(This is what the investigator did in terms of methods employed to conduct inquiry.)"
              />
            </div>
            {(report.investigative_process || []).map((step, i) => (
              <IrProcessLine key={`${i}-${step.slice(0, 24)}`} step={step} />
            ))}
          </div>
          <div className="mb-4 space-y-2">
            <IrSectionHeading
              title="Summary of Findings"
              hint="(Narrative overview of the results of investigation.)"
            />
            <p className="ir-body whitespace-pre-wrap">{report.summary_of_findings || '—'}</p>
          </div>
          <div className="mb-4 space-y-2">
            <p className="ir-section-title">Conclusion/ Results of Investigation</p>
            {report.allegations.map((a) => {
              const c = byCode[a.wac_code]
              const result = c?.result || 'Pending Investigation'
              const finding = resultToFindingPhrase(result)
              const instrument = a.wac_code.startsWith('71.') ? 'RCW' : 'WAC'
              let line = `Allegation: The investigator found the facility ${finding} with ${instrument} ${a.wac_code}`
              if (a.wac_title) line += `, ${a.wac_title}`
              line += '.'
              if (c?.deficiency_details && finding === 'out of compliance') {
                line += ` ${c.deficiency_details}`
              }
              return (
                <p key={`conc-preview-${a.wac_code}`} className="ir-body whitespace-pre-wrap">
                  {line}
                </p>
              )
            })}
          </div>
          <div className="space-y-2">
            <p className="ir-section-title">Actions:</p>
            <p className="ir-body whitespace-pre-wrap">{report.actions || '—'}</p>
          </div>
        </div>
      </div>
    </div>
  )
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
  onEnsureCase,
  canEdit = true,
  canExport = true,
}: Props) {
  const [report, setReport] = useState(() => normalizeReportAllegations({ ...initial }))
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview')
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

  const exportWarn =
    defensibility?.overall === 'warn' ||
    defensibility?.overall === 'block' ||
    report.quote_integrity?.ok === false

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

  const processFields = useMemo(
    () => unpackProcessFields(report.investigative_process),
    [report.investigative_process],
  )

  const updateProcessFields = useCallback((patch: Partial<ProcessFields>) => {
    setReport((prev) => {
      const next = { ...unpackProcessFields(prev.investigative_process), ...patch }
      return { ...prev, investigative_process: packProcessFields(next) }
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

  const refreshQuoteAssist = async (): Promise<void> => {
    if (!canExport) return
    try {
      const res = await api.validateReport({
        selected_wacs: selectedCodes,
        allegations: report.allegations,
        regulatory_framework: report.regulatory_framework || [],
        evidentiary_examples: report.evidentiary_examples || [],
      })
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
    } catch {
      /* assistive only — never blocks download */
    }
  }

  const resolveCaseId = async (): Promise<number | null> => {
    if (caseId) {
      if (caseDraftEditable) {
        await api.saveCaseDraft(caseId, report, 'Pre-export save')
      }
      return caseId
    }
    if (!onEnsureCase) return null
    return onEnsureCase(report)
  }

  const copyAll = async () => {
    if (!canExport) {
      setExportError(
        'Export, download, and copy require Editor or Administrator role. Your draft remains saved in the case record.',
      )
      return
    }
    setValidating(true)
    setExportError('')
    try {
      await refreshQuoteAssist()
      await navigator.clipboard.writeText(buildPlainText(report))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } finally {
      setValidating(false)
    }
  }

  const exportTxt = async () => {
    if (!canExport) {
      setExportError(
        'Export, download, and copy require Editor or Administrator role. Your draft remains saved in the case record.',
      )
      return
    }
    setValidating(true)
    setExportError('')
    try {
      await refreshQuoteAssist()
      const blob = new Blob([buildPlainText(report)], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'Investigation_Report.txt'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setValidating(false)
    }
  }

  const saveDraft = async () => {
    if (!caseId && onEnsureCase) {
      setSaving(true)
      setExportError('')
      setInfo('')
      try {
        await onEnsureCase(report)
        await onCaseRefresh?.()
        setInfo('Draft saved to case (working draft for investigator review).')
      } catch (e) {
        setExportError(e instanceof Error ? e.message : 'Save failed')
      } finally {
        setSaving(false)
      }
      return
    }
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

  const exportDocx = async () => {
    if (!canExport) {
      setExportError(
        'Export, download, and copy require Editor or Administrator role. Your draft remains saved in the case record.',
      )
      return
    }
    setValidating(true)
    setExportError('')
    try {
      await refreshQuoteAssist()
      const id = await resolveCaseId()
      if (!id) {
        setExportError('Could not save a case for download. Try Save, then download again.')
        return
      }
      const blob = await api.exportCaseDocx(id, true)
      downloadBlob(blob, `IR_case_${id}.docx`)
      setInfo(
        exportWarn
          ? 'DOCX downloaded as a working draft. Review any flagged gaps before treating it as final.'
          : 'DOCX downloaded.',
      )
      await onCaseRefresh?.()
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'DOCX export failed')
    } finally {
      setValidating(false)
    }
  }

  const exportPack = async () => {
    if (!canExport) {
      setExportError(
        'Export, download, and copy require Editor or Administrator role. Your draft remains saved in the case record.',
      )
      return
    }
    setValidating(true)
    setExportError('')
    try {
      await refreshQuoteAssist()
      const id = await resolveCaseId()
      if (!id) {
        setExportError('Could not save a case for download. Try Save, then download again.')
        return
      }
      const blob = await api.exportCasePack(id, true)
      downloadBlob(blob, `case_${id}_pack.zip`)
      setInfo('Pack downloaded (IR + deficiency cite sheet).')
      await onCaseRefresh?.()
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Pack export failed')
    } finally {
      setValidating(false)
    }
  }

  const statusMeta = [
    caseDetail?.status ? caseStatusLabel(caseDetail.status) : null,
    defensibility ? defensibilityOverallLabel(defensibility.overall) : null,
    report.quote_integrity?.ok === true ? 'Statutes verified' : null,
  ].filter(Boolean) as string[]

  return (
    <div className="animate-rise space-y-2 lg:space-y-3">
      {/* Sit below app header (h-[4.25rem]) so chrome does not stack over the document */}
      <div className="sticky top-[4.25rem] z-20 -mx-1 border-b border-ink-200/70 bg-background/95 px-3 py-2 backdrop-blur-md dark:border-ink-700 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <h2 className="font-display text-lg tracking-tight text-ink-900 dark:text-ink-50 sm:text-xl">
                Investigative Report
              </h2>
              {statusMeta.length > 0 && (
                <p
                  className="font-sans text-[11px] text-ink-500 dark:text-ink-400"
                  title={defensibility?.summary || undefined}
                >
                  {statusMeta.join(' · ')}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <div
              className="inline-flex rounded-md bg-ink-100/80 p-0.5 text-xs dark:bg-ink-800/70"
              role="group"
              aria-label="Report view mode"
            >
              <button
                type="button"
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition',
                  viewMode === 'preview'
                    ? 'bg-background text-ink-900 shadow-sm dark:bg-ink-900 dark:text-ink-50'
                    : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
                )}
                onClick={() => setViewMode('preview')}
                title="Preview the Investigation Report as it will appear in Download DOCX"
              >
                <FileText className="h-3.5 w-3.5" />
                Preview
              </button>
              <button
                type="button"
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition',
                  viewMode === 'edit'
                    ? 'bg-background text-ink-900 shadow-sm dark:bg-ink-900 dark:text-ink-50'
                    : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
                )}
                onClick={() => setViewMode('edit')}
                title="Edit structured fields"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            </div>

            <button
              type="button"
              className="btn-ghost !h-8 !px-2.5 text-xs"
              onClick={onBack}
              title="Back to Compare"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Compare
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn-secondary !h-8 !px-3 text-xs"
                disabled={saving || (!caseId && !onEnsureCase)}
                onClick={() => void saveDraft()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            {canExport ? (
              <button
                type="button"
                className="btn-primary !h-8 !px-3 text-xs"
                disabled={validating}
                title={
                  exportWarn
                    ? 'Download working draft — review notes are not blockers'
                    : 'Download Investigation Report DOCX'
                }
                onClick={() => void exportDocx()}
              >
                <Download className="h-3.5 w-3.5" />
                {validating ? 'Preparing…' : 'Download'}
              </button>
            ) : (
              <span className="text-[11px] text-ink-500" title="Viewer: IR stays in the case record">
                In-record only
              </span>
            )}
            <details className="relative">
              <summary className="btn-ghost !h-8 !px-2 text-xs marker:content-none [&::-webkit-details-marker]:hidden">
                More
              </summary>
              <div className="absolute right-0 z-30 mt-1 min-w-[11rem] rounded-lg border border-ink-200/80 bg-card p-1 shadow-soft dark:border-ink-700">
                {canEdit && caseId && onRebuild && (
                  <button
                    type="button"
                    className="btn-ghost w-full !justify-start !px-2.5 !py-1.5 text-xs"
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
                      className="btn-ghost w-full !justify-start !px-2.5 !py-1.5 text-xs"
                      disabled={validating}
                      onClick={() => void copyAll()}
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : validating ? 'Preparing…' : 'Copy all'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost w-full !justify-start !px-2.5 !py-1.5 text-xs"
                      disabled={validating}
                      onClick={() => void exportTxt()}
                    >
                      <Download className="h-3.5 w-3.5" /> .txt
                    </button>
                    <button
                      type="button"
                      className="btn-ghost w-full !justify-start !px-2.5 !py-1.5 text-xs"
                      disabled={validating}
                      onClick={() => void exportPack()}
                    >
                      Export pack
                    </button>
                  </>
                )}
                {!canExport && (
                  <p className="px-2.5 py-1.5 text-[11px] text-ink-500">Viewer: save in-record only.</p>
                )}
              </div>
            </details>
          </div>
        </div>
      </div>

      <details className="rounded-lg border border-ink-200/70 px-3 py-2 dark:border-ink-700">
        <summary className="cursor-pointer font-sans text-xs font-medium text-ink-600 dark:text-ink-300">
          IR template · {caseDetail?.ir_template?.name || 'Built-in blank'}
        </summary>
        <div className="mt-2">
          <IrTemplatePicker
            caseId={caseId ?? null}
            caseDetail={caseDetail}
            onCaseRefresh={onCaseRefresh}
            compact
            disabled={!canEdit}
          />
        </div>
      </details>

      {exportError && (
        <div className="rounded-lg border border-rose-300/80 bg-rose-50 px-3 py-2.5 text-sm text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
          {exportError}
        </div>
      )}
      {info && (
        <div className="rounded-lg border border-tide-500/25 bg-tide-500/8 px-3 py-2.5 text-sm text-tide-900 dark:text-tide-100">
          {info}
        </div>
      )}

      {exportWarn && canExport && (
        <div className="flex gap-3 rounded-lg border border-ink-200/80 bg-ink-50/80 px-3 py-2.5 text-sm text-ink-700 dark:border-ink-700 dark:bg-ink-900/50 dark:text-ink-200">
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-ink-900 dark:text-ink-50">
              {report.quote_integrity?.ok === false
                ? `Statute wording needs a check (${report.quote_integrity.failures.length})`
                : defensibility?.summary || 'A few review notes remain'}
            </p>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              You can still download a working draft. Fix wording before treating the IR as final.
            </p>
            {report.quote_integrity?.ok === false && topQuoteFailures.length > 0 && (
              <ul className="mt-1.5 space-y-1 border-t border-ink-200/70 pt-1.5 dark:border-ink-700">
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
                          className="text-left text-tide-800 underline decoration-tide-600/30 underline-offset-2 hover:decoration-tide-600 dark:text-tide-200"
                          onClick={() => jumpToAllegation(code)}
                        >
                          <span className="font-mono font-semibold">{label}</span>
                          <span className="mx-1.5 text-ink-400">·</span>
                          <span>{quoteFailureLabel(f.reason)}</span>
                        </button>
                      ) : (
                        <span>
                          <span className="font-mono font-semibold">{label}</span>
                          <span className="mx-1.5 text-ink-400">·</span>
                          <span>{quoteFailureLabel(f.reason)}</span>
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto grid max-w-6xl gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <article className={clsx('overflow-hidden', viewMode === 'preview' ? 'doc-surface !bg-transparent !shadow-none' : 'doc-surface')}>
        {viewMode === 'preview' ? (
          <DocumentPreview report={report} />
        ) : (
        <>
        <div className="border-b border-ink-200/80 bg-gradient-to-b from-[#f3efe6] to-transparent px-6 py-8 text-center dark:border-ink-700 dark:from-ink-900/80">
          <h1 className="font-display text-2xl font-semibold tracking-[0.04em] text-ink-900 dark:text-ink-50 sm:text-3xl">
            Investigative Report
          </h1>
          <div className="mx-auto mt-3 h-px w-24 animate-draw bg-tide-500/50" />
          <p className="mt-3 font-sans text-xs text-ink-400">
            {report.selected_count} authorized codes · DOH facility IR structure ·{" "}
            {Math.round(report.duration_ms)} ms · switch to Document preview to see export layout
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

          {/* Process — fixed DOH template labels; only body text is editable */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-display text-lg">
              <Search className="h-4 w-4 text-tide-600" /> Investigative Process Included
            </h3>
            <p className="mb-4 font-sans text-xs text-ink-400">
              Section labels match the blank Investigation Report. Edit the investigator narrative under
              each heading — labels stay in the export.
            </p>
            <div className="space-y-5">
              <div>
                <p className="mb-1.5 font-serif text-sm font-bold text-ink-900 dark:text-ink-50">
                  <span className="underline">{PROCESS_LABELS.preInvestigation.replace(/:$/, '')}</span>:
                </p>
                <textarea
                  className="input min-h-[110px] font-serif text-sm leading-relaxed"
                  value={processFields.preInvestigation}
                  onChange={(e) => updateProcessFields({ preInvestigation: e.target.value })}
                />
              </div>
              <div>
                <p className="mb-3 font-serif text-sm font-bold text-ink-900 dark:text-ink-50">
                  <span className="underline">{PROCESS_LABELS.investigationActivity.replace(/:$/, '')}</span>:
                </p>
                <div className="space-y-4 border-l-2 border-ink-200/80 pl-3 dark:border-ink-700">
                  <div>
                    <p className="mb-1.5 font-serif text-sm font-bold text-ink-800 dark:text-ink-100">
                      {PROCESS_LABELS.observations}
                    </p>
                    <textarea
                      className="input min-h-[72px] font-serif text-sm leading-relaxed"
                      value={processFields.observations}
                      onChange={(e) => updateProcessFields({ observations: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 font-serif text-sm font-bold text-ink-800 dark:text-ink-100">
                      {PROCESS_LABELS.interviews}
                    </p>
                    <textarea
                      className="input min-h-[72px] font-serif text-sm leading-relaxed"
                      value={processFields.interviews}
                      onChange={(e) => updateProcessFields({ interviews: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 font-serif text-sm font-bold text-ink-800 dark:text-ink-100">
                      {PROCESS_LABELS.documentReview}
                    </p>
                    <textarea
                      className="input min-h-[72px] font-serif text-sm leading-relaxed"
                      value={processFields.documentReview}
                      onChange={(e) => updateProcessFields({ documentReview: e.target.value })}
                    />
                  </div>
                </div>
              </div>
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

          {/* Conclusions — DOH sentence with inline finding dropdown */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-display text-lg">
              <FileCheck className="h-4 w-4 text-tide-600" /> Conclusion / Results of Investigation
            </h3>
            <p className="mb-4 font-sans text-xs text-ink-400">
              Choose the finding that fills the blank: in compliance, out of compliance, or pending
              determination of compliance.
            </p>
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
                      const finding = resultToFindingPhrase(result)
                      const instrument = a.wac_code.startsWith('71.') ? 'RCW' : 'WAC'
                      const title = (a.wac_title || '').replace(/[—–]/g, ' - ')
                      return (
                        <div
                          key={`conc-${a.wac_code}`}
                          className="rounded-lg border border-ink-200/80 bg-card/40 px-3 py-3 dark:border-ink-700"
                        >
                          <p className="font-serif text-sm leading-relaxed text-ink-900 dark:text-ink-50">
                            <span className="font-semibold">Allegation:</span> The investigator found
                            the facility{' '}
                            <select
                              className={clsx(
                                'mx-0.5 inline-block max-w-full rounded border px-1.5 py-0.5 font-serif text-sm font-semibold',
                                findingSelectClass(finding),
                              )}
                              value={finding}
                              disabled={idx < 0}
                              aria-label={`Finding for ${a.wac_code}`}
                              onChange={(e) => {
                                if (idx < 0) return
                                const phrase = e.target.value as FindingPhrase
                                updateConclusion(idx, {
                                  result: findingPhraseToResult(phrase),
                                  deficiency_cited: phrase === 'out of compliance',
                                })
                              }}
                            >
                              {FINDING_PHRASES.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>{' '}
                            with {instrument} {a.wac_code}
                            {title ? `, ${title}` : ''}.
                          </p>
                          {finding === 'out of compliance' && idx >= 0 && (
                            <div className="mt-3">
                              <label className="label">Deficiency details</label>
                              <input
                                className="input"
                                value={conclusion?.deficiency_details || ''}
                                placeholder="Cited deficient practice or condition"
                                onChange={(e) =>
                                  updateConclusion(idx, {
                                    deficiency_details: e.target.value,
                                    deficiency_cited: true,
                                  })
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
        </>
        )}
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
