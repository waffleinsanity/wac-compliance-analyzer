import { useState } from 'react'
import clsx from 'clsx'
import { FileDown, FileText, Link2, Loader2, Pencil, Plus } from 'lucide-react'
import {
  api,
  DPOC_ACTION_OPTIONS,
  recommendEnforcementOutcomes,
  SOD_SCOPE_OPTIONS,
  SOD_SEVERITY_OPTIONS,
  type CaseEvidence,
  type InvestigationReport,
  type SodDeficiency,
  type SodFinding,
  type StatementOfDeficiency,
} from '../api'
import { findRemovalSpans } from '../contentReview'
import {
  coverLetterParagraphs,
  formatFindingsColumn,
  FINDINGS_INCLUDED_LABEL,
  pocInstructionParagraphs,
  SOD_DISCLAIMER,
  SOD_DOH_CONTACT_LINES,
  SOD_HEADER_LABELS,
  SOD_TABLE_HEADERS,
  SOD_TITLE,
  SOD_WRITING_PRINCIPLES,
} from '../sodBlank'
import { HighlightedProse, RemovalReviewHint } from './HighlightedProse'

type Props = {
  report: InvestigationReport
  onReportChange?: (report: InvestigationReport) => void
  canEdit?: boolean
  canExport?: boolean
  busy?: boolean
  activeCaseId?: number | null
  evidence?: CaseEvidence[]
  onEnsureCase?: (report: InvestigationReport) => Promise<number>
}

function emptySod(report: InvestigationReport): StatementOfDeficiency {
  return {
    title: SOD_TITLE,
    facility_name: '',
    facility_address: report.facility_info?.facility_address || '',
    case_id: report.case_id || '',
    credential_number: report.facility_info?.credential_number || '',
    investigation_dates: report.facility_info?.investigation_dates || report.investigation_date,
    inspection_type: 'Investigation',
    deficiencies: [],
    identifier_key: [],
    poc_due_days: 14,
    is_rtf: false,
    notes: '',
    agency_services_type: '',
  }
}

function PaperBlock({ text, className }: { text: string; className?: string }) {
  if (findRemovalSpans(text).length > 0) {
    return (
      <HighlightedProse
        text={text}
        paper
        className={clsx('text-[11pt] leading-[1.4] text-black', className)}
      />
    )
  }
  return <p className={clsx('sod-body whitespace-pre-wrap', className)}>{text}</p>
}

function SodDocumentPreview({
  report,
  sod,
}: {
  report: InvestigationReport
  sod: StatementOfDeficiency
}) {
  const facilityName = sod.facility_name || ''
  const facilityAddress = sod.facility_address || report.facility_info?.facility_address || ''
  const administrator = sod.administrator || ''
  const investigator = sod.investigator_number || ''
  const dates = sod.investigation_dates || report.investigation_date || ''
  const caseId = sod.case_id || report.case_id || ''
  const license = sod.credential_number || report.facility_info?.credential_number || ''
  const inspection = sod.inspection_type || 'Investigation'
  const services = sod.agency_services_type || ''
  const defs = sod.deficiencies || []

  const cover = coverLetterParagraphs({
    facilityName,
    facilityAddress,
    administrator,
    completedOn: dates,
    investigatorNumber: investigator,
    pocDueDays: sod.poc_due_days ?? 14,
  })
  const poc = pocInstructionParagraphs()

  const headerCells: [string, string][] = [
    [
      SOD_HEADER_LABELS.agency,
      `${facilityName || 'N/A'}\n${facilityAddress || 'N/A'}`,
    ],
    [SOD_HEADER_LABELS.administrator, administrator || 'N/A'],
    [SOD_HEADER_LABELS.inspection_type, inspection],
    [SOD_HEADER_LABELS.investigation_start, dates || 'N/A'],
    [SOD_HEADER_LABELS.investigator_number, investigator || 'N/A'],
    [SOD_HEADER_LABELS.case_number, caseId || 'N/A'],
    [SOD_HEADER_LABELS.license_number, license || 'N/A'],
    [SOD_HEADER_LABELS.services_type, services || 'N/A'],
  ]

  return (
    <div className="ir-doc-desk">
      <div className="ir-doc-toolbar">
        <FileText className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden />
        <p className="min-w-0 text-[11px] leading-snug text-ink-500 dark:text-ink-400">
          Structured preview (DOH SOD pack layout from blank + writing guide). Export DOCX uses the
          same shell. Plan of Correction stays blank for the facility.
        </p>
      </div>
      <div className="ir-doc-scroll">
        {/* Page 1: cover letter */}
        <div className="ir-doc-page sod-doc-page mb-6" role="document" aria-label="SOD cover letter">
          {cover.map((line, i) => {
            if (!line) {
              return <p key={`cover-${i}`} className="sod-body h-3" aria-hidden />
            }
            const isLetterhead = line === 'STATE OF WASHINGTON' || line === 'DEPARTMENT OF HEALTH'
            const isDear = line.startsWith('Dear ')
            const isInvestigator = line.startsWith('Investigator:')
            const isEnclosure = line.startsWith('Enclosures:')
            return (
              <p
                key={`cover-${i}`}
                className={clsx(
                  'sod-body',
                  isLetterhead && 'text-center font-bold uppercase tracking-wide',
                  isDear && 'mt-1',
                  isInvestigator && 'mt-2',
                  isEnclosure && 'mt-4',
                  !isLetterhead && !isDear && 'mt-1',
                )}
              >
                {line}
              </p>
            )
          })}
        </div>

        {/* Page 2: Statement of Deficiency Report */}
        <div
          className="ir-doc-page sod-doc-page mb-6"
          role="document"
          aria-label="Statement of Deficiency Report"
        >
          <h1 className="ir-doc-title">{sod.title || SOD_TITLE}</h1>
          <div className="mb-4 space-y-0">
            {SOD_DOH_CONTACT_LINES.map((line) => (
              <p key={line} className="sod-body">
                {line}
              </p>
            ))}
          </div>

          <table className="sod-meta-table mb-4">
            <tbody>
              {Array.from({ length: Math.ceil(headerCells.length / 2) }, (_, row) => {
                const left = headerCells[row * 2]
                const right = headerCells[row * 2 + 1]
                return (
                  <tr key={`meta-${row}`}>
                    <td>
                      <span className="sod-meta-label">{left[0]}</span>
                      <span className="sod-meta-value whitespace-pre-wrap">{left[1]}</span>
                    </td>
                    <td>
                      {right ? (
                        <>
                          <span className="sod-meta-label">{right[0]}</span>
                          <span className="sod-meta-value whitespace-pre-wrap">{right[1]}</span>
                        </>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <p className="sod-body mb-4 italic">{SOD_DISCLAIMER}</p>

          {!defs.length ? (
            <p className="sod-body italic">
              No deficiencies drafted yet. Complete Compare with approved WACs so duties seed this
              pack.
            </p>
          ) : (
            <table className="sod-def-table">
              <thead>
                <tr>
                  {SOD_TABLE_HEADERS.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {defs.map((d, i) => {
                  const cite = d.regulation_cite || 'Cite pending'
                  const ruleCol = [cite, (d.regulation_text || '').trim()].filter(Boolean).join('\n\n')
                  const findings = formatFindingsColumn(d)
                  return (
                    <tr key={d.id || i}>
                      <td>
                        <PaperBlock text={ruleCol} className="!mb-0" />
                      </td>
                      <td>
                        <PaperBlock text={findings || '—'} className="!mb-0" />
                      </td>
                      <td className="sod-poc-blank">
                        <span className="sr-only">Plan of Correction left blank for facility</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Page 3+: Plan of Correction Instructions */}
        <div
          className="ir-doc-page sod-doc-page"
          role="document"
          aria-label="Plan of Correction Instructions"
        >
          {poc.map((line, i) => {
            const isTitle = i === 0
            const isSection =
              line === 'Introduction' ||
              line === 'Descriptive Content' ||
              line === 'Completion Dates' ||
              line === 'Continued Monitoring' ||
              line === 'Checklist:' ||
              line === 'Approval of POC' ||
              line === 'Questions?'
            const isBullet = line.startsWith('- ')
            return (
              <p
                key={`poc-${i}`}
                className={clsx(
                  'sod-body',
                  isTitle && 'mb-3 text-center text-[14pt] font-bold underline',
                  isSection && 'mt-3 font-bold',
                  isBullet && 'pl-4',
                  !isTitle && !isSection && 'mt-1.5',
                )}
              >
                {line}
              </p>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SodStructuredEdit({
  report,
  sod,
  canEdit,
  busy,
  evidence,
  linkTarget,
  setLinkTarget,
  patchSod,
  patchDeficiency,
  addFinding,
  patchFinding,
  linkEvidence,
}: {
  report: InvestigationReport
  sod: StatementOfDeficiency
  canEdit: boolean
  busy: boolean
  evidence: CaseEvidence[]
  linkTarget: string
  setLinkTarget: (v: string) => void
  patchSod: (partial: Partial<StatementOfDeficiency>) => void
  patchDeficiency: (id: string, partial: Partial<SodDeficiency>) => void
  addFinding: (defId: string, finding?: SodFinding) => void
  patchFinding: (defId: string, idx: number, partial: Partial<SodFinding>) => void
  linkEvidence: (defId: string) => void
}) {
  const defs = sod.deficiencies || []
  return (
    <div className="space-y-6 px-6 py-6">
      <header className="border-b border-ink-200 pb-4 text-center dark:border-ink-700">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-50">
          {sod.title || SOD_TITLE}
        </h1>
        <p className="mt-2 text-xs italic text-ink-500">
          Edit pack fields. Preview matches the facility DOCX shell. Regulation text stays PDF-backed.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-400">
          Cover / header fields
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['facility_name', 'Facility name'],
              ['facility_address', 'Facility address'],
              ['administrator', 'Administrator'],
              ['investigator_number', 'Investigator number'],
              ['inspection_type', 'Inspection type'],
              ['investigation_dates', 'Investigation start / dates'],
              ['case_id', 'Case number(s)'],
              ['credential_number', 'License number'],
              ['agency_services_type', 'BHA/RTF facility services type'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-sm sm:col-span-1">
              <span className="text-ink-500">{label}</span>
              <input
                className="input mt-1"
                disabled={!canEdit || busy}
                value={(sod[key] as string) || ''}
                onChange={(e) => patchSod({ [key]: e.target.value })}
              />
            </label>
          ))}
          <label className="block text-sm">
            <span className="text-ink-500">POC due (days)</span>
            <input
              type="number"
              className="input mt-1"
              disabled={!canEdit || busy}
              value={sod.poc_due_days ?? 14}
              onChange={(e) => patchSod({ poc_due_days: Number(e.target.value) || 14 })}
            />
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-400">
          Observation findings (per deficiency)
        </h2>
        {!defs.length && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            No SOD deficiency blocks yet. Draft from Intake with approved WACs so Compare duties seed
            this pack.
          </p>
        )}
        {defs.map((d, i) => (
          <div
            key={d.id || i}
            className="border-l-2 border-tide-600/40 pl-4 dark:border-tide-400/40"
          >
            <p className="font-mono text-xs text-ink-400">Deficiency {i + 1}</p>
            <p className="mt-1 font-semibold text-ink-900 dark:text-ink-50">
              {d.regulation_cite || 'Cite pending'}
            </p>
            {d.regulation_text ? (
              <p className="mt-2 font-serif text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                {d.regulation_text}
              </p>
            ) : null}

            <label className="mt-3 block text-sm">
              <span className="text-ink-500">Based on…</span>
              <textarea
                className="input mt-1 min-h-[72px]"
                disabled={!canEdit || busy}
                value={d.based_on || ''}
                onChange={(e) => patchDeficiency(d.id || '', { based_on: e.target.value })}
              />
              <RemovalReviewHint text={d.based_on || ''} />
            </label>
            <label className="mt-3 block text-sm">
              <span className="text-ink-500">Failure to…</span>
              <textarea
                className="input mt-1 min-h-[72px]"
                disabled={!canEdit || busy}
                value={d.failure_to || ''}
                onChange={(e) => patchDeficiency(d.id || '', { failure_to: e.target.value })}
              />
              <RemovalReviewHint text={d.failure_to || ''} />
            </label>
            <label className="mt-3 block text-sm">
              <span className="text-ink-500">Reference (optional)</span>
              <input
                className="input mt-1"
                disabled={!canEdit || busy}
                value={d.reference || ''}
                onChange={(e) => patchDeficiency(d.id || '', { reference: e.target.value })}
                placeholder="ASAM, DSM-5, CDC…"
              />
            </label>

            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-700 dark:text-ink-200">
                  {FINDINGS_INCLUDED_LABEL}
                </p>
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 text-xs"
                  disabled={!canEdit || busy}
                  onClick={() => addFinding(d.id || '')}
                >
                  <Plus className="h-3.5 w-3.5" /> Add finding
                </button>
              </div>
              <ul className="mt-2 space-y-2">
                {(d.findings || []).map((f, fi) => (
                  <li key={fi} className="grid gap-2 sm:grid-cols-[150px_1fr]">
                    <select
                      className="input"
                      disabled={!canEdit || busy}
                      value={f.method || 'document review'}
                      onChange={(e) => patchFinding(d.id || '', fi, { method: e.target.value })}
                    >
                      {[
                        'observation',
                        'interview',
                        'document review',
                        'record review',
                        'policy and procedure review',
                      ].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className="input min-h-[56px]"
                      disabled={!canEdit || busy}
                      value={f.text || ''}
                      onChange={(e) => patchFinding(d.id || '', fi, { text: e.target.value })}
                    />
                    <div className="sm:col-span-2">
                      <RemovalReviewHint text={f.text || ''} />
                    </div>
                  </li>
                ))}
              </ul>

              {evidence.length > 0 && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="block min-w-[200px] flex-1 text-sm">
                    <span className="text-ink-500">Link case evidence into a finding</span>
                    <select
                      className="input mt-1"
                      disabled={!canEdit || busy}
                      value={linkTarget}
                      onChange={(e) => setLinkTarget(e.target.value)}
                    >
                      <option value="">Choose evidence…</option>
                      {evidence.map((ev) => (
                        <option key={ev.id} value={String(ev.id)}>
                          {ev.title || `Evidence ${ev.id}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-1.5 text-xs"
                    disabled={!canEdit || busy || !linkTarget}
                    onClick={() => linkEvidence(d.id || '')}
                  >
                    <Link2 className="h-3.5 w-3.5" /> Link
                  </button>
                </div>
              )}
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-ink-500">
                Internal advisory (not on facility export)
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-ink-500">Scope</span>
                  <select
                    className="input mt-1"
                    disabled={!canEdit || busy}
                    value={d.scope || ''}
                    onChange={(e) => {
                      const scope = e.target.value
                      patchDeficiency(d.id || '', {
                        scope,
                        recommended_outcomes: recommendEnforcementOutcomes(
                          scope,
                          d.severity,
                          !!sod.is_rtf,
                        ),
                      })
                    }}
                  >
                    <option value="">—</option>
                    {SOD_SCOPE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-ink-500">Severity</span>
                  <select
                    className="input mt-1"
                    disabled={!canEdit || busy}
                    value={d.severity || ''}
                    onChange={(e) => {
                      const severity = e.target.value
                      patchDeficiency(d.id || '', {
                        severity,
                        recommended_outcomes: recommendEnforcementOutcomes(
                          d.scope,
                          severity,
                          !!sod.is_rtf,
                        ),
                      })
                    }}
                  >
                    <option value="">—</option>
                    {SOD_SEVERITY_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {(d.recommended_outcomes || []).length > 0 && (
                <p className="mt-2 text-xs text-ink-500">
                  Enforcement tool (advisory): {(d.recommended_outcomes || []).join(', ')}
                </p>
              )}
              <fieldset className="mt-3">
                <legend className="text-xs uppercase tracking-wide text-ink-400">
                  DPOC checklist (RTF advisory)
                </legend>
                <ul className="mt-1 space-y-1">
                  {DPOC_ACTION_OPTIONS.map((action) => {
                    const checked = (d.dpoc_actions || []).includes(action)
                    return (
                      <li key={action}>
                        <label className="flex items-start gap-2 text-sm text-ink-700 dark:text-ink-200">
                          <input
                            type="checkbox"
                            className="mt-1"
                            disabled={!canEdit || busy}
                            checked={checked}
                            onChange={() => {
                              const cur = new Set(d.dpoc_actions || [])
                              if (checked) cur.delete(action)
                              else cur.add(action)
                              patchDeficiency(d.id || '', { dpoc_actions: [...cur] })
                            }}
                          />
                          {action}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </fieldset>
            </details>
          </div>
        ))}
      </section>

      <label className="block text-sm">
        <span className="text-ink-500">Internal notes (not exported to facility)</span>
        <textarea
          className="input mt-1 min-h-[64px]"
          disabled={!canEdit || busy}
          value={sod.notes || ''}
          onChange={(e) => patchSod({ notes: e.target.value })}
        />
      </label>

      {(sod.identifier_key || []).length > 0 && (
        <p className="text-xs text-ink-500">
          Identifier key has {(sod.identifier_key || []).length} entries (internal only; never on
          facility export). Case: {report.case_id || '—'}.
        </p>
      )}
    </div>
  )
}

export function SodEditor({
  report,
  onReportChange,
  canEdit = true,
  canExport = true,
  busy = false,
  activeCaseId = null,
  evidence = [],
  onEnsureCase,
}: Props) {
  const sod = report.sod || emptySod(report)
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [linkTarget, setLinkTarget] = useState('')

  const sodHasRemovalHighlights = (report.sod?.deficiencies || []).some((d) => {
    const blocks = [d.based_on || '', d.failure_to || '', ...(d.findings || []).map((f) => f.text || '')]
    return blocks.some((block) => findRemovalSpans(block).length > 0)
  })

  const patchSod = (partial: Partial<StatementOfDeficiency>) => {
    if (!onReportChange) return
    onReportChange({ ...report, sod: { ...sod, ...partial } })
  }

  const patchDeficiency = (id: string, partial: Partial<SodDeficiency>) => {
    const deficiencies = (sod.deficiencies || []).map((d) =>
      d.id === id ? { ...d, ...partial } : d,
    )
    patchSod({ deficiencies })
  }

  const addFinding = (defId: string, finding?: SodFinding) => {
    const deficiencies = (sod.deficiencies || []).map((d) => {
      if (d.id !== defId) return d
      return {
        ...d,
        findings: [
          ...(d.findings || []),
          finding || { method: 'document review', text: '', evidence_ids: [] },
        ],
      }
    })
    patchSod({ deficiencies })
  }

  const patchFinding = (defId: string, idx: number, partial: Partial<SodFinding>) => {
    const deficiencies = (sod.deficiencies || []).map((d) => {
      if (d.id !== defId) return d
      const findings = [...(d.findings || [])]
      findings[idx] = { ...findings[idx], ...partial }
      return { ...d, findings }
    })
    patchSod({ deficiencies })
  }

  const linkEvidence = (defId: string) => {
    if (!linkTarget) return
    const ev = evidence.find((e) => String(e.id) === linkTarget)
    addFinding(defId, {
      method: 'document review',
      text: `Review of case evidence ${ev?.title || linkTarget} showed [describe the failed practice].`,
      evidence_ids: [linkTarget],
    })
    setLinkTarget('')
  }

  const exportSod = async () => {
    setError('')
    setExporting(true)
    try {
      let id = activeCaseId
      if (!id && onEnsureCase) id = await onEnsureCase(report)
      if (!id) throw new Error('Save the case before exporting the SOD.')
      if (onReportChange) onReportChange({ ...report, sod })
      const blob = await api.exportCaseSod(id, true)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `SOD_${report.case_id || id}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SOD export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="compare-meta">Sister document · facility-facing pack</p>
          <h2 className="font-display mt-0.5 text-xl text-ink-900 dark:text-ink-50 sm:text-2xl">
            Statement of Deficiency Report
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded border border-ink-200 dark:border-ink-700"
            role="group"
            aria-label="SOD view mode"
          >
            <button
              type="button"
              className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium',
                viewMode === 'preview'
                  ? 'bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-ink-50'
                  : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
              )}
              onClick={() => setViewMode('preview')}
              title="Preview the SOD pack as it will appear in Export DOCX"
            >
              <FileText className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              type="button"
              className={clsx(
                'inline-flex items-center gap-1.5 border-l border-ink-200 px-2.5 py-1.5 text-xs font-medium dark:border-ink-700',
                viewMode === 'edit'
                  ? 'bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-ink-50'
                  : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
              )}
              onClick={() => setViewMode('edit')}
              title="Edit SOD pack fields"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
          <button
            type="button"
            className="btn-primary !h-8 !px-3 text-xs"
            disabled={!canExport || busy || exporting}
            onClick={() => void exportSod()}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Export SOD
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {sodHasRemovalHighlights && (
        <p className="border-l-2 border-amber-500 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/20 dark:text-amber-100">
          Amber highlights mark Compare seed text and other assistive placeholders. Replace them with
          investigation narrative before treating the SOD as final.
        </p>
      )}

      <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <article
          className={clsx(
            'min-h-0 overflow-hidden',
            viewMode === 'preview' ? 'bg-transparent' : 'doc-surface',
          )}
        >
          {viewMode === 'preview' ? (
            <SodDocumentPreview report={report} sod={sod} />
          ) : (
            <SodStructuredEdit
              report={report}
              sod={sod}
              canEdit={canEdit}
              busy={busy}
              evidence={evidence}
              linkTarget={linkTarget}
              setLinkTarget={setLinkTarget}
              patchSod={patchSod}
              patchDeficiency={patchDeficiency}
              addFinding={addFinding}
              patchFinding={patchFinding}
              linkEvidence={linkEvidence}
            />
          )}
        </article>

        <aside className="space-y-3 xl:sticky xl:top-2 xl:self-start">
          <div className="rounded border border-ink-200 bg-card px-3 py-3 dark:border-ink-700">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-wide text-ink-400">
              SOD writing guide
            </p>
            <ul className="mt-2 space-y-1.5 text-xs leading-snug text-ink-600 dark:text-ink-300">
              {SOD_WRITING_PRINCIPLES.map((p) => (
                <li key={p} className="border-l-2 border-ink-200 pl-2 dark:border-ink-700">
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded border border-ink-200 bg-card px-3 py-3 text-xs text-ink-500 dark:border-ink-700 dark:text-ink-400">
            <p>
              Pack layout follows uploaded SOD samples and blank standards. Regulation language comes
              from the local PDF store only. Identifier key is never exported.
            </p>
            <p className="mt-2">
              Deficiencies: <span className="font-mono text-ink-700 dark:text-ink-200">{(sod.deficiencies || []).length}</span>
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
