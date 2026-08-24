import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Download, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  api,
  type CaseDetail,
  type EvidenceLogDraft,
  type EvidenceLogRow,
  type InvestigationReport,
} from '../api'
import { useAuth } from '../auth'
import {
  buildEvidenceLogFromCase,
  emptyEvidenceLogRow,
  ensureEvidenceLogOnReport,
  renumberEvidenceLogRows,
} from '../evidenceLogFormat'

type Props = {
  report: InvestigationReport
  caseDetail: CaseDetail | null
  caseId: number | null
  canEdit?: boolean
  canExport?: boolean
  busy?: boolean
  onReportChange: (report: InvestigationReport) => void
  onEnsureCase?: (report: InvestigationReport) => Promise<number>
  onCaseRefresh?: () => void | Promise<void>
}

function wacAt(row: EvidenceLogRow, i: number): string {
  return (row.wac_codes || [])[i] || ''
}

function setWac(row: EvidenceLogRow, i: number, value: string): EvidenceLogRow {
  const codes = [...(row.wac_codes || [])]
  while (codes.length < 4) codes.push('')
  codes[i] = value
  return { ...row, wac_codes: codes }
}

export function EvidenceLogEditor({
  report,
  caseDetail,
  caseId,
  canEdit = true,
  canExport = true,
  busy = false,
  onReportChange,
  onEnsureCase,
  onCaseRefresh,
}: Props) {
  const { user } = useAuth()
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview')
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const investigatorName = user?.display_name || user?.username || user?.email || ''

  // Hydrate editable log from uploads when missing.
  useEffect(() => {
    if (report.evidence_log != null) return
    const next = ensureEvidenceLogOnReport(report, caseDetail, {
      investigatorName,
      force: false,
    })
    if (next.evidence_log != null) {
      onReportChange(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseDetail?.id, caseDetail?.evidence?.length, report.evidence_log])

  const log: EvidenceLogDraft = useMemo(() => {
    return (
      report.evidence_log ||
      buildEvidenceLogFromCase(report, caseDetail, { investigatorName })
    )
  }, [report, caseDetail, investigatorName])

  const patchLog = (patch: Partial<EvidenceLogDraft>) => {
    onReportChange({
      ...report,
      evidence_log: { ...log, ...patch },
    })
  }

  const patchRow = (index: number, patch: Partial<EvidenceLogRow>) => {
    const rows = [...(log.rows || [])]
    rows[index] = { ...rows[index], ...patch }
    patchLog({ rows })
  }

  const addRow = () => {
    const rows = renumberEvidenceLogRows([
      ...(log.rows || []),
      emptyEvidenceLogRow((log.rows || []).length + 1),
    ])
    patchLog({ rows })
    setViewMode('edit')
  }

  const removeRow = (index: number) => {
    const rows = renumberEvidenceLogRows((log.rows || []).filter((_, i) => i !== index))
    patchLog({ rows })
  }

  const rebuildFromUploads = () => {
    if (
      !window.confirm(
        'Replace the Evidence Log with rows from attached exhibits? Unsaved edits to this log will be lost.',
      )
    ) {
      return
    }
    const rebuilt = buildEvidenceLogFromCase(report, caseDetail, { investigatorName })
    onReportChange({ ...report, evidence_log: rebuilt })
    setInfo('Evidence Log rebuilt from attached exhibits.')
    setViewMode('edit')
  }

  const resolveCaseId = async () => {
    if (caseId) return caseId
    if (!onEnsureCase) return null
    return onEnsureCase({ ...report, evidence_log: log })
  }

  const saveDraft = async () => {
    const id = await resolveCaseId()
    if (!id) {
      setError('Save this case first so the Evidence Log can be stored.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const next = { ...report, evidence_log: log }
      onReportChange(next)
      await api.saveCaseDraft(id, next, 'Evidence Log edited')
      setInfo('Evidence Log saved.')
      await onCaseRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const downloadLog = async () => {
    if (!canExport) {
      setError('Download requires Editor or Administrator role.')
      return
    }
    setExporting(true)
    setError('')
    try {
      // Persist latest edits before download so export matches the on-screen log.
      const id = await resolveCaseId()
      if (!id) {
        setError('Could not save a case for download.')
        return
      }
      await api.saveCaseDraft(id, { ...report, evidence_log: log }, 'Evidence Log before download')
      onReportChange({ ...report, evidence_log: log })
      const blob = await api.exportEvidenceLog(id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Evidence_Log_${caseDetail?.case_id_label || id}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      setInfo('Evidence Log downloaded.')
      await onCaseRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setExporting(false)
    }
  }

  const headerFields: { key: keyof EvidenceLogDraft; label: string }[] = [
    { key: 'investigator_name', label: 'Investigator Name' },
    { key: 'case_numbers', label: 'Case Numbers' },
    { key: 'license_numbers', label: 'License Numbers' },
    { key: 'facility_name', label: 'Facility/Agency Name' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 sm:px-4 lg:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 className="font-display text-xl tracking-tight text-ink-900 dark:text-ink-50 sm:text-2xl">
              Evidence Log
            </h2>
            <p className="font-sans text-[11px] text-ink-500 dark:text-ink-400">
              {(log.rows || []).length} exhibit{(log.rows || []).length === 1 ? '' : 's'}
            </p>
          </div>
          <p className="mt-1 max-w-2xl font-sans text-[11px] leading-snug text-ink-500 dark:text-ink-400">
            Editable Investigation Evidence Log. Exhibit numbers match Document Review and SOD
            superscripts. Download opens the same sheet as Excel.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div
            className="inline-flex border-b border-ink-200 text-xs dark:border-ink-700"
            role="group"
            aria-label="Evidence Log view mode"
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
              disabled={!canEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
          {canEdit && (
            <button
              type="button"
              className="btn-secondary !h-8 !px-3 text-xs"
              disabled={busy || saving}
              onClick={() => void saveDraft()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {canExport && (
            <button
              type="button"
              className="btn-primary !h-8 !px-3 text-xs"
              disabled={busy || exporting}
              onClick={() => void downloadLog()}
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? 'Preparing…' : 'Download'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}
      {info && (
        <p className="border-l-2 border-tide-600 bg-tide-500/8 px-3 py-2 text-sm text-tide-900 dark:text-tide-100">
          {info}
        </p>
      )}

      <div className="ir-doc-desk min-h-0 flex-1">
        <div className="ir-doc-toolbar flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-[11px] leading-snug text-ink-500 dark:text-ink-400">
            {viewMode === 'preview'
              ? 'Preview of the Evidence Log. Switch to Edit to correct rows, add exhibits, or change WAC columns.'
              : 'Edit header fields and rows. Add a blank row for materials not yet uploaded as files.'}
          </p>
          {canEdit && (
            <div className="flex flex-wrap gap-1">
              <button type="button" className="btn-ghost !h-7 !px-2 text-[11px]" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" /> Add row
              </button>
              <button
                type="button"
                className="btn-ghost !h-7 !px-2 text-[11px]"
                onClick={rebuildFromUploads}
                disabled={!caseDetail?.evidence?.length}
              >
                Rebuild from uploads
              </button>
            </div>
          )}
        </div>
        <div className="ir-doc-scroll">
          <div className="overflow-x-auto rounded-md border border-ink-200 bg-white p-3 dark:border-ink-700 dark:bg-ink-950">
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {headerFields.map(({ key, label }) => (
                <label key={key} className="block font-sans text-[11px] text-ink-500">
                  {label}
                  {viewMode === 'edit' && canEdit ? (
                    <input
                      className="input mt-1 !h-8 w-full !text-xs"
                      value={String(log[key] || '')}
                      onChange={(e) => patchLog({ [key]: e.target.value })}
                    />
                  ) : (
                    <div className="mt-1 rounded border border-ink-100 px-2 py-1.5 text-xs text-ink-800 dark:border-ink-800 dark:text-ink-100">
                      {String(log[key] || '-')}
                    </div>
                  )}
                </label>
              ))}
            </div>

            <table className="w-full min-w-[56rem] border-collapse text-left font-sans text-xs">
              <thead>
                <tr className="border-b border-ink-200 text-[11px] uppercase tracking-wide text-ink-500 dark:border-ink-700">
                  <th className="px-1.5 py-2">#</th>
                  <th className="px-1.5 py-2">Document description</th>
                  <th className="px-1.5 py-2">Date collected</th>
                  <th className="px-1.5 py-2">Collected by</th>
                  <th className="px-1.5 py-2">Method</th>
                  <th className="px-1.5 py-2">Electronic location</th>
                  <th className="px-1.5 py-2">WAC 1</th>
                  <th className="px-1.5 py-2">WAC 2</th>
                  <th className="px-1.5 py-2">WAC 3</th>
                  <th className="px-1.5 py-2">WAC 4</th>
                  {viewMode === 'edit' && canEdit ? <th className="px-1.5 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {(log.rows || []).length === 0 ? (
                  <tr>
                    <td
                      colSpan={viewMode === 'edit' && canEdit ? 11 : 10}
                      className="px-2 py-6 text-center text-ink-400"
                    >
                      No exhibits yet. Attach files on Evidence, or add a blank row.
                    </td>
                  </tr>
                ) : (
                  (log.rows || []).map((row, index) => (
                    <tr
                      key={`${row.evidence_id ?? 'manual'}-${index}`}
                      className="border-b border-ink-100 align-top dark:border-ink-800"
                    >
                      <td className="px-1.5 py-1.5 font-semibold text-ink-600">
                        #{row.exhibit_number || index + 1}
                      </td>
                      {(
                        [
                          ['description', 'description'],
                          ['date_collected', 'date_collected'],
                          ['collected_by', 'collected_by'],
                          ['method', 'method'],
                          ['electronic_location', 'electronic_location'],
                        ] as const
                      ).map(([field]) => (
                        <td key={field} className="px-1.5 py-1.5">
                          {viewMode === 'edit' && canEdit ? (
                            <input
                              className="input !h-8 w-full min-w-[7rem] !text-xs"
                              value={String(row[field] || '')}
                              onChange={(e) => patchRow(index, { [field]: e.target.value })}
                            />
                          ) : (
                            <span className="text-ink-800 dark:text-ink-100">
                              {String(row[field] || '-')}
                            </span>
                          )}
                        </td>
                      ))}
                      {[0, 1, 2, 3].map((wi) => (
                        <td key={wi} className="px-1.5 py-1.5">
                          {viewMode === 'edit' && canEdit ? (
                            <input
                              className="input !h-8 w-full min-w-[6rem] !text-xs"
                              value={wacAt(row, wi)}
                              onChange={(e) => patchRow(index, setWac(row, wi, e.target.value))}
                              placeholder="WAC 246-341-"
                            />
                          ) : (
                            <span className="text-ink-800 dark:text-ink-100">
                              {wacAt(row, wi) || '-'}
                            </span>
                          )}
                        </td>
                      ))}
                      {viewMode === 'edit' && canEdit ? (
                        <td className="px-1.5 py-1.5">
                          <button
                            type="button"
                            className="btn-ghost !h-7 !w-7 !px-0"
                            title="Remove row"
                            onClick={() => removeRow(index)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
