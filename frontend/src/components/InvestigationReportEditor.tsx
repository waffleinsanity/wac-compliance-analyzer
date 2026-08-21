import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  conclusionDeficiencyCited,
  findingPhraseToResult,
  normalizeIrConclusion,
  packProcessFields,
  resultToFindingPhrase,
  unpackProcessFields,
  type FindingPhrase,
  type ProcessFields,
} from '../processTemplate'
import {
  documentsFromEvidence,
  documentsFromLegacyProcess,
  documentReviewHasLegacyExhibitLines,
  mergeDocumentReviewLines,
  rewriteLegacyDocumentReviewLines,
} from '../documentReviewFormat'
import { findRemovalSpans, isFacilityPlaceholder } from '../contentReview'
import { HighlightedProse, RemovalReviewHint } from './HighlightedProse'
import {
  ACTION_DETERMINATION_CHOICES,
  ACTION_REFERRAL_CHOICES,
  CHOOSE_ITEM,
  FEDERAL_CERTIFICATION_PRIORITY_CHOICES,
  INVESTIGATION_TYPE_CHOICES,
  STATE_LICENSING_PRIORITY_CHOICES,
  composeActionsText,
  parseActionsFields,
} from '../irTemplateChoices'
import { IrTemplatePicker } from './IrTemplatePicker'

/** Map legacy / invalid subtitle values onto blank IR investigation-type choices. */
function normalizeInvestigationType(value: string | null | undefined): string {
  const raw = (value || '').trim()
  if (!raw || raw === CHOOSE_ITEM) return ''
  if ((INVESTIGATION_TYPE_CHOICES as readonly string[]).includes(raw)) return raw
  // Legacy schema default before On-site/Off-site choices existed
  if (/^state investigation$/i.test(raw)) return 'On-site State Investigation'
  if (/federal/i.test(raw) && /state/i.test(raw)) return 'On-site State and Federal Investigation'
  if (/federal/i.test(raw)) return 'On-site Federal Investigation'
  if (/off-?site/i.test(raw)) return 'Off-site State Investigation'
  return raw
}

function selectOptionsWithCurrent(choices: readonly string[], current: string): string[] {
  if (current && !choices.includes(current)) return [current, ...choices]
  return [...choices]
}

function allegationAnchorId(wacCode: string) {
  return `allegation-${wacCode.replace(/[^\w.-]+/g, '_')}`
}

function wacCodeFromFailure(f: QuoteFailure): string | null {
  if (f.field.startsWith('allegation:')) return f.field.slice('allegation:'.length) || null
  return null
}

function naIfEmpty(value: string | null | undefined): string {
  const s = (value ?? '').toString()
  return s.trim().length ? s : 'N/A'
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
  /** Bump when a recall restore should replace the editor buffer. */
  revision?: number
  onRestoreSnapshot?: (snapshotId: number) => void
}

function AllegationBadge({ a }: { a: InvestigationAllegation }) {
  if (a.quote_ok === false) {
    return (
      <span className="font-sans text-xs text-rose-700 dark:text-rose-300">Needs statute review</span>
    )
  }
  if (a.low_confidence) {
    return (
      <span className="font-sans text-xs text-amber-800 dark:text-amber-300">Confirm subsection</span>
    )
  }
  if (a.quote_ok) {
    return (
      <span className="font-sans text-xs text-ink-500 dark:text-ink-400">Statute verified</span>
    )
  }
  return null
}

function findingSelectClass(phrase: FindingPhrase) {
  if (phrase === 'Substantiated with deficient practice or condition cited')
    return 'border-rose-400/50 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100'
  if (phrase === 'Not Substantiated')
    return 'border-emerald-400/50 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100'
  if (phrase === 'Substantiated with no current deficient practice or condition cited')
    return 'border-amber-400/50 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
  return 'border-ink-300/60 bg-ink-50 text-ink-800 dark:border-ink-600 dark:bg-ink-900/40 dark:text-ink-100'
}

function displayFinding(phrase: FindingPhrase): string {
  return phrase || CHOOSE_ITEM
}

function buildPlainText(report: InvestigationReport): string {
  // Always rebuild from structured fields so Copy/.txt match DOCX (never stale report_text).
  const fi = report.facility_info
  const { determination, referral } = parseActionsFields(report)
  const lines: string[] = [
    'Investigative Report',
    normalizeInvestigationType(report.subtitle) || CHOOSE_ITEM,
    `Facility Address: ${fi.facility_address || ''}`,
    `Laboratory Director: ${fi.laboratory_director || 'N/A'}`,
    `CLIA Number: ${fi.clia_number || 'N/A'}`,
    `Credential Number: ${fi.credential_number || ''}`,
    `Medicare Number: ${fi.medicare_number || 'N/A'}`,
    `Shell Number: ${fi.shell_number || 'N/A'}`,
    `Date(s) of Investigation: ${fi.investigation_dates || report.investigation_date || ''}`,
    `State Licensing Priority: ${fi.state_licensing_priority || CHOOSE_ITEM}`,
    `Federal Certification Priority: ${fi.federal_certification_priority || CHOOSE_ITEM}`,
    '',
    'Intake Details: (List of concerns reported in the original complaint.)',
    '',
    report.intake_details,
    '',
    'Allegation(s): (The allegation(s) listed below is what the department has jurisdiction and authorization to investigate. An allegation is considered an assertion of improper practice or condition that could result in a violation of facility law or rule.)',
    '',
  ]

  report.allegations.forEach((a, i) => {
    const text = normalizeAllegationLine(a.allegation_text)
    const body = text.toLowerCase().startsWith('allegation:')
      ? text.replace(/^allegation:\s*/i, '')
      : text
    lines.push(`${i + 1}. Allegation: ${body}`, '')
  })

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
  report.allegations.forEach((a, i) => {
    const c = byCode[a.wac_code]
    const result = c?.result || 'Pending Investigation'
    const finding = displayFinding(normalizeIrConclusion(result))
    const instrument = a.wac_code.startsWith('71.') ? 'RCW' : 'WAC'
    const topic = (a.wac_title || a.wac_code).split(/[—–-]/)[0].trim() || a.wac_code
    let line = `${i + 1}. Allegation: Concerning ${topic} (${instrument} ${a.wac_code}): ${finding}.`
    if (c?.deficiency_details && conclusionDeficiencyCited(result)) {
      line += ` ${c.deficiency_details}`
    }
    lines.push(line, '')
  })
  lines.push('Actions:', composeActionsText(determination, referral))
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
  const spans = findRemovalSpans(step)
  if (spans.length) {
    return (
      <div className="ir-body ir-process-body">
        <HighlightedProse text={step} spans={spans} className="text-[12pt] leading-[1.45] text-black" />
      </div>
    )
  }
  return <p className="ir-body ir-process-body whitespace-pre-wrap">{step}</p>
}

/** On-screen IR that mirrors Download DOCX layout (blank shell + live field values). */
function DocumentPreview({
  report,
  onChange,
  canEdit = false,
}: {
  report: InvestigationReport
  onChange?: (next: InvestigationReport) => void
  canEdit?: boolean
}) {
  const fi = report.facility_info
  const byCode = Object.fromEntries(report.conclusions.map((c) => [c.wac_code, c]))
  const { determination, referral } = parseActionsFields(report)
  const editable = Boolean(canEdit && onChange)

  const patch = (partial: Partial<InvestigationReport>) => {
    if (!onChange) return
    onChange({ ...report, ...partial })
  }
  const patchFacility = (key: keyof FacilityInfo, value: string) => {
    if (!onChange) return
    onChange({
      ...report,
      facility_info: { ...report.facility_info, [key]: value },
    })
  }
  const setActions = (nextDet: string, nextRef: string) => {
    patch({
      action_determination: nextDet,
      action_referral: nextRef,
      actions: composeActionsText(nextDet, nextRef),
    })
  }

  const facilityLines: [string, string, (() => ReactNode) | null][] = [
    ['Facility Address:', fi.facility_address || '', null],
    ['Laboratory Director:', fi.laboratory_director || 'N/A', null],
    ['CLIA Number:', fi.clia_number || 'N/A', null],
    ['Credential Number:', fi.credential_number || '', null],
    ['Medicare Number:', fi.medicare_number || 'N/A', null],
    ['Shell Number:', fi.shell_number || 'N/A', null],
    [
      'Date(s) of Investigation:',
      fi.investigation_dates || report.investigation_date || '',
      null,
    ],
    [
      'State Licensing Priority:',
      fi.state_licensing_priority || '',
      editable
        ? () => (
            <select
              className="ir-inline-select"
              value={fi.state_licensing_priority || ''}
              onChange={(e) => patchFacility('state_licensing_priority', e.target.value)}
              aria-label="State Licensing Priority"
            >
              <option value="">{CHOOSE_ITEM}</option>
              {selectOptionsWithCurrent(
                STATE_LICENSING_PRIORITY_CHOICES,
                fi.state_licensing_priority || '',
              ).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )
        : null,
    ],
    [
      'Federal Certification Priority:',
      fi.federal_certification_priority || '',
      editable
        ? () => (
            <select
              className="ir-inline-select"
              value={fi.federal_certification_priority || ''}
              onChange={(e) => patchFacility('federal_certification_priority', e.target.value)}
              aria-label="Federal Certification Priority"
            >
              <option value="">{CHOOSE_ITEM}</option>
              {selectOptionsWithCurrent(
                FEDERAL_CERTIFICATION_PRIORITY_CHOICES,
                fi.federal_certification_priority || '',
              ).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )
        : null,
    ],
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
          {editable ? (
            <p className="ir-body mb-4 text-center">
              <select
                className="ir-inline-select text-center italic"
                value={normalizeInvestigationType(report.subtitle)}
                onChange={(e) => patch({ subtitle: normalizeInvestigationType(e.target.value) })}
                aria-label="Investigation type"
              >
                <option value="">{CHOOSE_ITEM}</option>
                {selectOptionsWithCurrent(
                  INVESTIGATION_TYPE_CHOICES,
                  normalizeInvestigationType(report.subtitle),
                ).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </p>
          ) : (
            <p className="ir-body mb-4 text-center italic text-ink-800">
              {normalizeInvestigationType(report.subtitle) || CHOOSE_ITEM}
            </p>
          )}
          <div className="mb-4 space-y-0">
            {facilityLines.map(([label, value, control]) => {
              const shown = value || (label.includes('Priority') ? CHOOSE_ITEM : '')
              const highlightFacility =
                !control &&
                (label.startsWith('Facility Address')
                  ? isFacilityPlaceholder(shown) || findRemovalSpans(shown).length > 0
                  : findRemovalSpans(shown).length > 0)
              return (
                <p key={label} className="ir-body">
                  <span className="ir-facility-label">{label}</span>{' '}
                  <span className="ir-facility-value">
                    {control
                      ? control()
                      : highlightFacility
                        ? (
                            <HighlightedProse
                              text={shown}
                              inline
                              className="text-[12pt] leading-[1.45] text-black"
                            />
                          )
                        : shown}
                  </span>
                </p>
              )
            })}
          </div>
          <div className="mb-4 space-y-2">
            <IrSectionHeading
              title="Intake Details:"
              hint="(List of concerns reported in the original complaint.)"
            />
            <p className="ir-body ir-indent whitespace-pre-wrap">{report.intake_details || '—'}</p>
          </div>
          <div className="mb-4 space-y-2">
            <IrSectionHeading
              title="Allegation(s):"
              hint="(The allegation(s) listed below is what the department has jurisdiction and authorization to investigate. An allegation is considered an assertion of improper practice or condition that could result in a violation of facility law or rule.)"
            />
            <ol className="ir-allegation-list">
              {report.allegations.map((a) => {
                const text = normalizeAllegationLine(a.allegation_text)
                const body = text.toLowerCase().startsWith('allegation:')
                  ? text.replace(/^allegation:\s*/i, '')
                  : text
                return (
                  <li key={a.wac_code} className="whitespace-pre-wrap">
                    Allegation: {body}
                  </li>
                )
              })}
            </ol>
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
            {report.summary_of_findings ? (
              <div className="ir-body ir-indent">
                <HighlightedProse
                  text={report.summary_of_findings}
                  className="text-[12pt] leading-[1.45] text-black"
                />
              </div>
            ) : (
              <p className="ir-body ir-indent">—</p>
            )}
          </div>
          <div className="mb-4 space-y-2">
            <p className="ir-section-title">Conclusion/ Results of Investigation</p>
            <ol className="ir-allegation-list">
              {report.allegations.map((a) => {
                const c = byCode[a.wac_code]
                const idx = report.conclusions.findIndex((x) => x.wac_code === a.wac_code)
                const result = c?.result || 'Pending Investigation'
                const finding = resultToFindingPhrase(result)
                const instrument = a.wac_code.startsWith('71.') ? 'RCW' : 'WAC'
                const topic = (a.wac_title || a.wac_code).split(/[—–-]/)[0].trim() || a.wac_code
                const extra =
                  c?.deficiency_details && conclusionDeficiencyCited(result)
                    ? ` ${c.deficiency_details}`
                    : ''
                return (
                  <li key={`conc-preview-${a.wac_code}`} className="whitespace-pre-wrap">
                    Allegation: Concerning {topic} ({instrument} {a.wac_code}):{' '}
                    {editable && idx >= 0 ? (
                      <select
                        className="ir-inline-select max-w-full"
                        value={finding}
                        aria-label={`Finding for ${a.wac_code}`}
                        onChange={(e) => {
                          const phrase = e.target.value as FindingPhrase
                          const next = report.conclusions.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  result: findingPhraseToResult(phrase),
                                  deficiency_cited: conclusionDeficiencyCited(
                                    findingPhraseToResult(phrase),
                                  ),
                                }
                              : row,
                          )
                          patch({ conclusions: next })
                        }}
                      >
                        <option value="">{CHOOSE_ITEM}</option>
                        {FINDING_PHRASES.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : findRemovalSpans(result).length || findRemovalSpans(displayFinding(finding)).length ? (
                      <HighlightedProse
                        text={displayFinding(finding) || result}
                        inline
                        className="text-[12pt] leading-[1.45] text-black"
                      />
                    ) : (
                      displayFinding(finding)
                    )}
                    .{extra}
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="space-y-2">
            <p className="ir-section-title">Actions:</p>
            {editable ? (
              <>
                <p className="ir-body ir-indent">
                  <select
                    className="ir-inline-select w-full max-w-full"
                    value={determination}
                    aria-label="Action determination"
                    onChange={(e) => setActions(e.target.value, referral)}
                  >
                    <option value="">{CHOOSE_ITEM}</option>
                    {ACTION_DETERMINATION_CHOICES.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </p>
                <p className="ir-body ir-indent">
                  <select
                    className="ir-inline-select w-full max-w-full"
                    value={referral}
                    aria-label="Action referral"
                    onChange={(e) => setActions(determination, e.target.value)}
                  >
                    <option value="">{CHOOSE_ITEM}</option>
                    {ACTION_REFERRAL_CHOICES.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </p>
              </>
            ) : (
              <>
                <p className="ir-body ir-indent">
                  {findRemovalSpans(determination || CHOOSE_ITEM).length ? (
                    <HighlightedProse
                      text={determination || CHOOSE_ITEM}
                      inline
                      className="text-[12pt] leading-[1.45] text-black"
                    />
                  ) : (
                    determination || CHOOSE_ITEM
                  )}
                </p>
                <p className="ir-body ir-indent">
                  {findRemovalSpans(referral || CHOOSE_ITEM).length ? (
                    <HighlightedProse
                      text={referral || CHOOSE_ITEM}
                      inline
                      className="text-[12pt] leading-[1.45] text-black"
                    />
                  ) : (
                    referral || CHOOSE_ITEM
                  )}
                </p>
              </>
            )}
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
  revision = 0,
  onRestoreSnapshot,
}: Props) {
  const [report, setReport] = useState(() => {
    const base = normalizeReportAllegations({ ...initial })
    return { ...base, subtitle: normalizeInvestigationType(base.subtitle) }
  })
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview')
  const [copied, setCopied] = useState(false)
  const [showFindings, setShowFindings] = useState(false)
  const [exportError, setExportError] = useState('')
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [info, setInfo] = useState('')
  const [defensibility, setDefensibility] = useState<DefensibilityResult | null>(null)
  // Ignore parent echo of our own onReportChange so Edit dropdowns are not snapped back.
  const syncingFromParent = useRef(false)
  const lastExternalKey = useRef('')
  const externalKey = `${caseId ?? 'new'}|${revision}|${initial.analysis_id ?? ''}|${initial.selected_count}|${(
    initial.allegations || []
  )
    .map((a) => a.wac_code)
    .join(',')}|${Math.round(initial.duration_ms || 0)}`

  useEffect(() => {
    if (externalKey === lastExternalKey.current) return
    lastExternalKey.current = externalKey
    syncingFromParent.current = true
    const base = normalizeReportAllegations({
      ...initial,
      facility_info: { ...initial.facility_info },
    })
    setReport({ ...base, subtitle: normalizeInvestigationType(base.subtitle) })
    setExportError('')
    setInfo('')
  }, [externalKey, initial])

  useEffect(() => {
    if (syncingFromParent.current) {
      syncingFromParent.current = false
      return
    }
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

  const hasRemovalHighlights = useMemo(() => {
    const blocks = [
      report.facility_info?.facility_address || '',
      processFields.observations,
      processFields.interviews,
      processFields.documentReview,
      report.summary_of_findings || '',
      ...(report.conclusions || []).map((c) => c.result || ''),
    ]
    return blocks.some((block) => findRemovalSpans(block).length > 0)
  }, [processFields, report.conclusions, report.facility_info?.facility_address, report.summary_of_findings])

  const legacyMigrateCaseRef = useRef<number | null>(null)

  useEffect(() => {
    const caseId = caseDetail?.id ?? null
    if (caseId != null && legacyMigrateCaseRef.current === caseId) return
    const lines = report.investigative_process || []
    const hasLegacy = documentReviewHasLegacyExhibitLines(lines)
    if (!hasLegacy) {
      if (caseId != null) legacyMigrateCaseRef.current = caseId
      return
    }
    const converted = rewriteLegacyDocumentReviewLines(lines)
    const fromFiles = documentsFromEvidence(
      caseDetail?.evidence,
      (report.evidence_review || []).filter((h) => h.included_by_default),
    )
    const fromLegacy = documentsFromLegacyProcess(lines)
    const byTitle = new Map(fromLegacy.map((d) => [d.title.toLowerCase(), d]))
    for (const d of fromFiles) {
      const key = d.title.toLowerCase()
      const prev = byTitle.get(key)
      byTitle.set(key, {
        title: d.title,
        documentDate: d.documentDate || prev?.documentDate,
        excerpt: (d.excerpt || '').length >= (prev?.excerpt || '').length ? d.excerpt : prev?.excerpt,
        cite: d.cite || prev?.cite,
      })
    }
    const docs = [...byTitle.values()]
    const nextLines = docs.length ? mergeDocumentReviewLines(converted, docs) : converted
    if (caseId != null) legacyMigrateCaseRef.current = caseId
    if (nextLines.length === lines.length && nextLines.every((line, i) => line === lines[i])) return
    setReport((prev) => ({ ...prev, investigative_process: nextLines }))
    // Migrate once per case open; backend also persists on GET.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseDetail?.id, caseDetail?.evidence])

  const updateProcessFields = useCallback((patch: Partial<ProcessFields>) => {
    setReport((prev) => {
      const next = { ...unpackProcessFields(prev.investigative_process), ...patch }
      return { ...prev, investigative_process: packProcessFields(next) }
    })
  }, [])

  const updateConclusion = useCallback((index: number, patch: Partial<InvestigationConclusion>) => {
    setReport((prev) => {
      const conclusions = [...prev.conclusions]
      const next = { ...conclusions[index], ...patch }
      if (patch.result !== undefined && patch.deficiency_cited === undefined) {
        next.deficiency_cited = conclusionDeficiencyCited(patch.result)
      }
      conclusions[index] = next
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
    <div className="flex min-h-0 w-full flex-col">
      {/* Flush under Intake / Compare / Documents; outside the padded scroll pane */}
      <div className="sticky top-0 z-10 shrink-0 border-b border-ink-200 bg-card px-3 py-2 dark:border-ink-700 sm:px-4">
        <p className="compare-meta mb-1">Step 3 · Documents</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <h2 className="font-display text-xl tracking-tight text-ink-900 dark:text-ink-50 sm:text-2xl">
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
              className="inline-flex border-b border-ink-200 text-xs dark:border-ink-700"
              role="group"
              aria-label="Report view mode"
            >
              <button
                type="button"
                className={clsx(
                  'inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 font-medium transition',
                  viewMode === 'preview'
                    ? 'border-tide-600 text-ink-900 dark:border-tide-400 dark:text-ink-50'
                    : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
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
                  'inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 font-medium transition',
                  viewMode === 'edit'
                    ? 'border-tide-600 text-ink-900 dark:border-tide-400 dark:text-ink-50'
                    : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
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
              <div className="absolute right-0 z-30 mt-1 min-w-[11rem] rounded-md border border-ink-200 bg-card p-1 dark:border-ink-700">
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

      <div className="space-y-2 p-3 sm:p-4 lg:space-y-3 lg:p-5">
      <details className="border-b border-ink-200 px-0 py-2 dark:border-ink-700">
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
        <div className="border-l-2 border-rose-600 bg-rose-50 px-3 py-2.5 text-sm text-rose-950 dark:bg-rose-950/40 dark:text-rose-100">
          {exportError}
        </div>
      )}
      {info && (
        <div className="border-l-2 border-tide-600 bg-tide-500/8 px-3 py-2.5 text-sm text-tide-900 dark:text-tide-100">
          {info}
        </div>
      )}

      {hasRemovalHighlights && (
        <div className="border-l-2 border-amber-500 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/20 dark:text-amber-100">
          Amber highlights mark assistive placeholders, seed sentences, and other text that is not
          part of the IR format, your entries, or Compare selections. Delete or replace those spans
          before submission.
        </div>
      )}

      {exportWarn && canExport && (
        <div className="flex gap-3 border-l-2 border-cedar-500 bg-ink-50/80 px-3 py-2.5 text-sm text-ink-700 dark:bg-ink-900/50 dark:text-ink-200">
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-sm bg-amber-500" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-ink-900 dark:text-ink-50">
              {report.quote_integrity?.ok === false
                ? `Statute wording needs a check (${report.quote_integrity.failures.length})`
                : hasRemovalHighlights
                  ? 'Highlighted assistive text must be removed or replaced before submission.'
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
      <article className={clsx('overflow-hidden', viewMode === 'preview' ? 'doc-surface !bg-transparent !shadow-none !border-0' : 'doc-surface')}>
        {viewMode === 'preview' ? (
          <DocumentPreview
            report={report}
            canEdit={canEdit}
            onChange={(next) => setReport(normalizeReportAllegations({ ...next }))}
          />
        ) : (
        <>
        <div className="border-b border-ink-200 px-6 py-7 text-center dark:border-ink-700">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-50 sm:text-3xl">
            Investigative Report
          </h1>
          <div className="mx-auto mt-3 h-0.5 w-16 bg-tide-600/60 dark:bg-tide-400/50" />
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
              <div className="sm:col-span-2">
                <label className="label">Investigation type</label>
                <select
                  className="input"
                  value={normalizeInvestigationType(report.subtitle)}
                  onChange={(e) =>
                    setReport((p) => ({
                      ...p,
                      subtitle: normalizeInvestigationType(e.target.value),
                    }))
                  }
                >
                  <option value="">{CHOOSE_ITEM}</option>
                  {selectOptionsWithCurrent(
                    INVESTIGATION_TYPE_CHOICES,
                    normalizeInvestigationType(report.subtitle),
                  ).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              {(
                [
                  ['facility_address', 'Facility Address'],
                  ['laboratory_director', 'Laboratory Director'],
                  ['clia_number', 'CLIA Number'],
                  ['credential_number', 'Credential Number'],
                  ['medicare_number', 'Medicare Number'],
                  ['shell_number', 'Shell Number'],
                  ['investigation_dates', 'Date(s) of Investigation'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input
                    className="input"
                    value={naIfEmpty(report.facility_info[key])}
                    onChange={(e) => updateFacility(key, e.target.value)}
                  />
                </div>
              ))}
              <div>
                <label className="label">State Licensing Priority</label>
                <select
                  className="input"
                  value={report.facility_info.state_licensing_priority || ''}
                  onChange={(e) => updateFacility('state_licensing_priority', e.target.value)}
                >
                  <option value="">{CHOOSE_ITEM}</option>
                  {selectOptionsWithCurrent(
                    STATE_LICENSING_PRIORITY_CHOICES,
                    report.facility_info.state_licensing_priority || '',
                  ).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Federal Certification Priority</label>
                <select
                  className="input"
                  value={report.facility_info.federal_certification_priority || ''}
                  onChange={(e) => updateFacility('federal_certification_priority', e.target.value)}
                >
                  <option value="">{CHOOSE_ITEM}</option>
                  {selectOptionsWithCurrent(
                    FEDERAL_CERTIFICATION_PRIORITY_CHOICES,
                    report.facility_info.federal_certification_priority || '',
                  ).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
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
              value={naIfEmpty(report.intake_details)}
              onChange={(e) => setReport((p) => ({ ...p, intake_details: e.target.value }))}
            />
          </section>

          {report.authority_statement && (
            <section>
              <h3 className="mb-2 font-display text-lg">Authority</h3>
              <p className="border-l-2 border-ink-300 bg-muted/20 px-4 py-3 text-sm leading-relaxed dark:border-ink-600">
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
                  <div key={`${entry.instrument}-${entry.code}`} className="border-b border-ink-200 px-1 py-3 last:border-0 dark:border-ink-700">
                    <div className="font-mono text-xs font-semibold">
                      {entry.instrument} {entry.code}
                    </div>
                    <div className="text-xs text-muted-foreground">{entry.title}</div>
                    <ul className="mt-2 space-y-2">
                      {(entry.subsections || []).map((sub, i) => (
                        <li key={`${entry.code}-${i}`} className="text-sm">
                          <div className="font-mono text-[11px] font-semibold">{sub.cite}</div>
                          {!!sub.context?.trim() && (
                            <p className="mt-0.5 whitespace-pre-wrap font-serif text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                              {sub.context}
                            </p>
                          )}
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
                    {items.map((a) => {
                      const allegNum =
                        report.allegations.findIndex(
                          (item) =>
                            item.wac_code === a.wac_code && item.case_category === a.case_category,
                        ) + 1
                      return (
                      <div
                        key={`${category}-${a.wac_code}`}
                        id={allegationAnchorId(a.wac_code)}
                        className="scroll-mt-28 border-l-[3px] border-cedar-500/35 px-4 py-3 transition"
                      >
                        <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                          <span className="font-serif text-sm font-semibold text-ink-800 dark:text-ink-100">
                            {allegNum}. Allegation
                          </span>
                          <span className="compare-cite font-semibold text-ink-800 dark:text-ink-100">
                            {a.wac_code}
                          </span>
                          <span className="font-sans text-xs text-ink-500">{a.wac_title}</span>
                          <AllegationBadge a={a} />
                          <Pencil className="ml-auto h-3.5 w-3.5 shrink-0 self-center text-ink-400" />
                        </div>
                        <textarea
                          className="input min-h-[88px] font-serif text-sm leading-relaxed"
                          value={a.allegation_text || ''}
                          onChange={(e) => {
                            // Preserve whitespace while typing so the spacebar/backspace behave normally.
                            // We still strip forbidden legacy quotes immediately.
                            const value = e.target.value.replace(/["“”„]/g, '')
                            setReport((prev) => {
                              const allegations = prev.allegations.map((item) =>
                                item.wac_code === a.wac_code && item.case_category === a.case_category
                                  ? { ...item, allegation_text: value }
                                  : item,
                              )
                              return { ...prev, allegations }
                            })
                          }}
                          onBlur={(e) => {
                            // Enforce canonical allegation formatting only after the user leaves the field.
                            const normalized = normalizeAllegationLine(e.target.value)
                            setReport((prev) => {
                              const allegations = prev.allegations.map((item) =>
                                item.wac_code === a.wac_code && item.case_category === a.case_category
                                  ? { ...item, allegation_text: normalized }
                                  : item,
                              )
                              return { ...prev, allegations }
                            })
                          }}
                        />
                        {!!a.matched_subsections?.length && (
                          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                            {a.matched_subsections.map((s) => (
                              <span key={s} className="compare-cite">
                                {s}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      )
                    })}
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
                      value={naIfEmpty(ex)}
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
                  value={naIfEmpty(processFields.preInvestigation)}
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
                      value={naIfEmpty(processFields.observations)}
                      onChange={(e) => updateProcessFields({ observations: e.target.value })}
                    />
                    <RemovalReviewHint text={naIfEmpty(processFields.observations)} />
                  </div>
                  <div>
                    <p className="mb-1.5 font-serif text-sm font-bold text-ink-800 dark:text-ink-100">
                      {PROCESS_LABELS.interviews}
                    </p>
                    <textarea
                      className="input min-h-[72px] font-serif text-sm leading-relaxed"
                      value={naIfEmpty(processFields.interviews)}
                      onChange={(e) => updateProcessFields({ interviews: e.target.value })}
                    />
                    <RemovalReviewHint text={naIfEmpty(processFields.interviews)} />
                  </div>
                  <div>
                    <p className="mb-1.5 font-serif text-sm font-bold text-ink-800 dark:text-ink-100">
                      {PROCESS_LABELS.documentReview}
                    </p>
                    <textarea
                      className="input min-h-[72px] font-serif text-sm leading-relaxed"
                      value={naIfEmpty(processFields.documentReview)}
                      onChange={(e) => updateProcessFields({ documentReview: e.target.value })}
                    />
                    <RemovalReviewHint text={naIfEmpty(processFields.documentReview)} />
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
              after investigation activities. Collaborator notes assist your work; they are not
              compliance findings. Keep patient identifiers out of free-text pastes.
            </p>

            {(report.areas_of_concern?.length || report.investigation_methods?.length || report.clarifying_questions?.length) ? (
              <div className="mb-4 border-l-2 border-tide-600 bg-tide-500/[0.06] px-3.5 py-3 dark:border-tide-400 dark:bg-tide-500/10">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-tide-700 dark:text-tide-300">
                    Investigator collaborator
                  </p>
                  <p className="font-sans text-[11px] text-ink-500">
                    {report.llm_assist_used
                      ? `Assistive draft${report.llm_model ? ` · ${report.llm_model}` : ''}`
                      : 'Local assistive draft'}
                    {' · '}saved with this case
                  </p>
                </div>
                <p className="mb-3 font-sans text-xs text-ink-600 dark:text-ink-300">
                  Suggestions to begin or strengthen the investigation. Edit the Summary below as you
                  gather evidence; final determinations stay with the human investigator.
                </p>
                {!!report.areas_of_concern?.length && (
                  <div className="mb-3">
                    <p className="mb-1 font-sans text-xs font-semibold text-ink-800 dark:text-ink-100">
                      Areas of concern
                    </p>
                    <ul className="list-disc space-y-1 pl-5 font-serif text-sm leading-relaxed text-ink-800 dark:text-ink-100">
                      {report.areas_of_concern.map((item, i) => (
                        <li key={`concern-${i}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!report.investigation_methods?.length && (
                  <div className="mb-3">
                    <p className="mb-1 font-sans text-xs font-semibold text-ink-800 dark:text-ink-100">
                      Suggested methods
                    </p>
                    <ul className="list-disc space-y-1 pl-5 font-serif text-sm leading-relaxed text-ink-800 dark:text-ink-100">
                      {report.investigation_methods.map((item, i) => (
                        <li key={`method-${i}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!report.clarifying_questions?.length && (
                  <div>
                    <p className="mb-1 font-sans text-xs font-semibold text-ink-800 dark:text-ink-100">
                      Clarifying questions
                    </p>
                    <ul className="list-disc space-y-1 pl-5 font-serif text-sm leading-relaxed text-ink-800 dark:text-ink-100">
                      {report.clarifying_questions.map((item, i) => (
                        <li key={`q-${i}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            <textarea
              className="input min-h-[200px] font-serif leading-relaxed"
              value={naIfEmpty(report.summary_of_findings)}
              onChange={(e) => setReport((p) => ({ ...p, summary_of_findings: e.target.value }))}
            />
            <RemovalReviewHint text={naIfEmpty(report.summary_of_findings)} />
          </section>

          {/* Conclusions — DOH sentence with inline finding dropdown */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-display text-lg">
              <FileCheck className="h-4 w-4 text-tide-600" /> Conclusion / Results of Investigation
            </h3>
            <p className="mb-4 font-sans text-xs text-ink-400">
              IR Guidance outcomes: substantiated with / without deficient practice cited, or not
              substantiated. Statute cites belong in the sister SOD.
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
                      const topic =
                        (a.wac_title || a.wac_code).split(/[—–-]/)[0].trim() || a.wac_code
                      return (
                        <div
                          key={`conc-${a.wac_code}`}
                          className="rounded-lg border border-ink-200/80 bg-card/40 px-3 py-3 dark:border-ink-700"
                        >
                          <p className="font-serif text-sm leading-relaxed text-ink-900 dark:text-ink-50">
                            <span className="font-semibold">
                              {report.allegations.findIndex((item) => item.wac_code === a.wac_code) +
                                1}
                              . Allegation:
                            </span>{' '}
                            Concerning {topic} ({instrument} {a.wac_code}):{' '}
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
                                const nextResult = findingPhraseToResult(phrase)
                                updateConclusion(idx, {
                                  result: nextResult,
                                  deficiency_cited: conclusionDeficiencyCited(nextResult),
                                })
                              }}
                            >
                              <option value="">{CHOOSE_ITEM}</option>
                              {FINDING_PHRASES.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                            .
                          </p>
                          {conclusionDeficiencyCited(result) && idx >= 0 && (
                            <div className="mt-3">
                              <label className="label">Deficiency details (IR narrative)</label>
                              <input
                                className="input"
                                value={naIfEmpty(conclusion?.deficiency_details)}
                                placeholder="Optional note — full cite language lives in SOD"
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

          {/* Actions — blank template dual content controls */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 font-display text-lg">
              <Pencil className="h-4 w-4 text-tide-600" /> Actions
            </h3>
            <p className="mb-3 font-sans text-xs text-ink-400">
              Determination and referral only — name SOD presence/absence; do not dump statute
              citations here (they belong in the SOD).
            </p>
            <div className="grid gap-3 sm:grid-cols-1">
              {(() => {
                const { determination, referral } = parseActionsFields(report)
                const setActions = (nextDet: string, nextRef: string) => {
                  setReport((p) => ({
                    ...p,
                    action_determination: nextDet,
                    action_referral: nextRef,
                    actions: composeActionsText(nextDet, nextRef),
                  }))
                }
                return (
                  <>
                    <div>
                      <label className="label">Determination</label>
                      <select
                        className="input"
                        value={determination}
                        onChange={(e) => setActions(e.target.value, referral)}
                      >
                        <option value="">{CHOOSE_ITEM}</option>
                        {ACTION_DETERMINATION_CHOICES.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Referral</label>
                      <select
                        className="input"
                        value={referral}
                        onChange={(e) => setActions(determination, e.target.value)}
                      >
                        <option value="">{CHOOSE_ITEM}</option>
                        {ACTION_REFERRAL_CHOICES.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )
              })()}
            </div>
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
                    className="border-l-2 border-ink-300 bg-ink-50/80 p-3 font-mono text-xs leading-relaxed text-ink-700 dark:border-ink-600 dark:bg-ink-900/50 dark:text-ink-200"
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
            onRestoreSnapshot={onRestoreSnapshot}
            onReportApplied={(detail) => {
              if (detail.report) setReport(normalizeReportAllegations({ ...detail.report }))
            }}
          />
        </div>
      ) : (
        <div className="border border-dashed border-ink-300 p-4 text-sm text-ink-500 dark:border-ink-600">
          Open or save a case to unlock evidence links, process builder, export checks, and review
          workflow.
        </div>
      )}
      </div>
      </div>
    </div>
  )
}
