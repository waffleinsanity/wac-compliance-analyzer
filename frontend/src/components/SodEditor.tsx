import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { renderAsync } from 'docx-preview'
import { FileDown, FileText, Loader2, Pencil } from 'lucide-react'
import {
  api,
  type InvestigationReport,
  type SodDeficiency,
  type StatementOfDeficiency,
} from '../api'
import { findRemovalSpans } from '../contentReview'

type Props = {
  report: InvestigationReport
  onReportChange?: (report: InvestigationReport) => void
  canEdit?: boolean
  canExport?: boolean
  busy?: boolean
  activeCaseId?: number | null
  onEnsureCase?: (report: InvestigationReport) => Promise<number>
}

function emptySod(report: InvestigationReport): StatementOfDeficiency {
  const fi = report.facility_info
  return {
    title: 'Statement of Deficiency Report',
    facility_name: '',
    facility_address: fi?.facility_address || '',
    case_id: report.case_id || '',
    credential_number: fi?.credential_number || '',
    administrator: fi?.laboratory_director || '',
    inspection_type: 'Investigation',
    investigator_number: '',
    investigation_dates: fi?.investigation_dates || report.investigation_date || '',
    agency_services_type: '',
    deficiencies: [],
    identifier_key: [],
    poc_due_days: 14,
    is_rtf: false,
    notes: '',
  }
}

function SodTemplatePreview({ report }: { report: InvestigationReport }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const fillKey = JSON.stringify({
    case_id: report.case_id,
    investigation_date: report.investigation_date,
    facility: report.facility_info,
    sod: report.sod,
    comparisons: (report.comparisons || []).map((c) => ({
      code: c.code,
      duty_options: c.duty_options,
      allegation_draft: c.allegation_draft,
    })),
  })

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError('')
      setBlob(null)
      try {
        const docx = await api.previewFilledSodReport(report)
        if (!cancelled) setBlob(docx)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Preview failed')
          setLoading(false)
        }
      }
    }
    const t = window.setTimeout(() => void run(), 300)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillKey])

  useEffect(() => {
    if (!blob || !hostRef.current) return
    let cancelled = false
    const host = hostRef.current
    const styleHost = styleRef.current

    const run = async () => {
      setLoading(true)
      host.innerHTML = ''
      if (styleHost) styleHost.innerHTML = ''
      try {
        await renderAsync(blob, host, styleHost ?? undefined, {
          className: 'sod-docx-preview',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
        })
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Preview failed')
          host.innerHTML = ''
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [blob])

  return (
    <div className="sod-docx-preview-shell relative min-h-[24rem]">
      {loading && (
        <p className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-4 py-8 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading preview…
        </p>
      )}
      {error ? (
        <div className="m-4 rounded border border-ink-200 bg-card px-3 py-3 text-sm text-ink-700 dark:border-ink-700 dark:text-ink-200">
          Preview is unavailable. Use Download SOD to open the document in Word.
        </div>
      ) : null}
      <div ref={styleRef} className="sod-docx-preview-styles" aria-hidden />
      <div
        ref={hostRef}
        className="sod-docx-preview-host"
        aria-label="Statement of Deficiencies preview"
      />
    </div>
  )
}

function sodAssistSeedCount(report: InvestigationReport): number {
  const sod = report.sod
  if (!sod?.deficiencies?.length) return 0
  let n = 0
  for (const d of sod.deficiencies) {
    n += findRemovalSpans(d.based_on || '').length > 0 ? 1 : 0
    n += findRemovalSpans(d.failure_to || '').length > 0 ? 1 : 0
    for (const f of d.findings || []) {
      n += findRemovalSpans(f.text || '').length > 0 ? 1 : 0
    }
  }
  return n
}

function Field({
  label,
  value,
  onChange,
  rows = 1,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
  disabled?: boolean
}) {
  return (
    <label className="block space-y-1">
      <span className="font-sans text-[11px] font-medium uppercase tracking-wide text-ink-500">
        {label}
      </span>
      {rows > 1 ? (
        <textarea
          className="input min-h-[5rem] w-full font-serif text-sm"
          rows={rows}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input w-full font-serif text-sm"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

function SodEditForm({
  sod,
  canEdit,
  onPatch,
  onPatchDeficiency,
}: {
  sod: StatementOfDeficiency
  canEdit: boolean
  onPatch: (partial: Partial<StatementOfDeficiency>) => void
  onPatchDeficiency: (index: number, partial: Partial<SodDeficiency>) => void
}) {
  const defs = sod.deficiencies || []
  return (
    <div className="space-y-6 p-4 sm:p-5">
      <section className="space-y-3">
        <h3 className="font-display text-lg text-ink-900 dark:text-ink-50">Facility</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Facility name"
            value={sod.facility_name || ''}
            disabled={!canEdit}
            onChange={(v) => onPatch({ facility_name: v })}
          />
          <Field
            label="Administrator"
            value={sod.administrator || ''}
            disabled={!canEdit}
            onChange={(v) => onPatch({ administrator: v })}
          />
          <div className="sm:col-span-2">
            <Field
              label="Facility address"
              value={sod.facility_address || ''}
              rows={2}
              disabled={!canEdit}
              onChange={(v) => onPatch({ facility_address: v })}
            />
          </div>
          <Field
            label="Case number"
            value={sod.case_id || ''}
            disabled={!canEdit}
            onChange={(v) => onPatch({ case_id: v })}
          />
          <Field
            label="License number"
            value={sod.credential_number || ''}
            disabled={!canEdit}
            onChange={(v) => onPatch({ credential_number: v })}
          />
          <Field
            label="Investigation dates"
            value={sod.investigation_dates || ''}
            disabled={!canEdit}
            onChange={(v) => onPatch({ investigation_dates: v })}
          />
          <Field
            label="Investigator number"
            value={sod.investigator_number || ''}
            disabled={!canEdit}
            onChange={(v) => onPatch({ investigator_number: v })}
          />
          <Field
            label="Inspection type"
            value={sod.inspection_type || ''}
            disabled={!canEdit}
            onChange={(v) => onPatch({ inspection_type: v })}
          />
          <Field
            label="Agency services type"
            value={sod.agency_services_type || ''}
            disabled={!canEdit}
            onChange={(v) => onPatch({ agency_services_type: v })}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="font-display text-lg text-ink-900 dark:text-ink-50">
          Deficiencies ({defs.length})
        </h3>
        {defs.length === 0 ? (
          <p className="text-sm text-ink-500">
            No deficiencies yet. Complete Compare on the Investigation Report to add regulation
            citations here.
          </p>
        ) : (
          defs.map((d, i) => (
            <div
              key={d.id || `def-${i}`}
              className="space-y-3 rounded border border-ink-200 bg-card/40 p-3 dark:border-ink-700"
            >
              <p className="font-mono text-xs font-semibold text-ink-800 dark:text-ink-100">
                {d.regulation_cite || `Deficiency ${i + 1}`}
              </p>
              {d.regulation_text ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-600 dark:text-ink-300">
                  {d.regulation_text}
                </p>
              ) : null}
              <Field
                label="Based on"
                value={d.based_on || ''}
                rows={3}
                disabled={!canEdit}
                onChange={(v) => onPatchDeficiency(i, { based_on: v })}
              />
              <Field
                label="Failure to"
                value={d.failure_to || ''}
                rows={3}
                disabled={!canEdit}
                onChange={(v) => onPatchDeficiency(i, { failure_to: v })}
              />
              <Field
                label="Findings included"
                value={(d.findings || []).map((f) => f.text || '').filter(Boolean).join('\n\n')}
                rows={4}
                disabled={!canEdit}
                onChange={(v) => {
                  const parts = v
                    .split(/\n\s*\n/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                  onPatchDeficiency(i, {
                    findings: parts.length
                      ? parts.map((text) => ({ method: '', text, evidence_ids: [] }))
                      : [],
                  })
                }}
              />
            </div>
          ))
        )}
      </section>
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
  onEnsureCase,
}: Props) {
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const sod = report.sod || emptySod(report)
  const seedCount = useMemo(() => sodAssistSeedCount(report), [report.sod])

  const setSod = (next: StatementOfDeficiency) => {
    onReportChange?.({ ...report, sod: next })
  }

  const patchSod = (partial: Partial<StatementOfDeficiency>) => {
    setSod({ ...sod, ...partial })
  }

  const patchDeficiency = (index: number, partial: Partial<SodDeficiency>) => {
    const deficiencies = [...(sod.deficiencies || [])]
    const cur = deficiencies[index]
    if (!cur) return
    deficiencies[index] = { ...cur, ...partial }
    setSod({ ...sod, deficiencies })
  }

  const exportSod = async () => {
    setError('')
    setExporting(true)
    try {
      let id = activeCaseId
      if (!id && onEnsureCase) id = await onEnsureCase({ ...report, sod })
      if (!id) throw new Error('Save the case before downloading.')
      const blob = await api.exportCaseSod(id, true)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `SOD_${report.case_id || id}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-2.5 sm:px-3 lg:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2
            className="font-display flex min-w-0 flex-wrap items-baseline gap-x-2 text-lg text-ink-900 dark:text-ink-50"
            title="Sister Statement of Deficiencies draft. Regulation text is PDF-store backed from Compare."
          >
            <span className="compare-meta !normal-case tracking-wide">Step 3 · Documents</span>
            <span>Statement of Deficiencies</span>
            <span className="font-sans text-[11px] font-normal text-ink-500">
              {(sod.deficiencies || []).length} deficienc
              {(sod.deficiencies || []).length === 1 ? 'y' : 'ies'}
            </span>
          </h2>
          <details className="mt-0.5 max-w-2xl">
            <summary className="cursor-pointer font-sans text-[11px] font-medium text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200">
              How this works
            </summary>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 font-sans text-[11px] leading-snug text-ink-600 dark:text-ink-300">
              <li>
                <span className="font-medium text-ink-800 dark:text-ink-100">Yellow</span> = verify
                auto-filled IR fields in preview and Download SOD.
              </li>
              <li>
                <span className="font-medium text-ink-800 dark:text-ink-100">Amber seeds</span> =
                replace Based on / Failure to stubs with investigation narrative.
              </li>
              <li>
                <span className="font-medium text-ink-800 dark:text-ink-100">Findings included</span>{' '}
                stay investigator-owned. Regulation text is PDF-store backed from Compare.
              </li>
            </ul>
          </details>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div
            className="inline-flex border-b border-ink-200 text-xs dark:border-ink-700"
            role="group"
            aria-label="SOD view mode"
          >
            <button
              type="button"
              className={clsx(
                'inline-flex items-center gap-1.5 border-b-2 px-2 py-1 font-medium transition',
                viewMode === 'preview'
                  ? 'border-tide-600 text-ink-900 dark:border-tide-400 dark:text-ink-50'
                  : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
              )}
              onClick={() => setViewMode('preview')}
              title="Preview the Statement of Deficiencies as it will appear in Download SOD"
            >
              <FileText className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              type="button"
              className={clsx(
                'inline-flex items-center gap-1.5 border-b-2 px-2 py-1 font-medium transition',
                viewMode === 'edit'
                  ? 'border-tide-600 text-ink-900 dark:border-tide-400 dark:text-ink-50'
                  : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
              )}
              onClick={() => setViewMode('edit')}
              title="Edit Statement of Deficiencies fields"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>

          {canExport ? (
            <button
              type="button"
              className="btn-primary !h-7 !px-2.5 text-xs"
              disabled={busy || exporting}
              onClick={() => void exportSod()}
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
              {exporting ? 'Preparing…' : 'Download SOD'}
            </button>
          ) : (
            <span className="text-[11px] text-ink-500">In-record only</span>
          )}
        </div>
      </div>

      {error && (
        <div className="border-l-2 border-rose-600 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-950 dark:bg-rose-950/40 dark:text-rose-100">
          {error}
        </div>
      )}

      {seedCount > 0 && (
        <div className="border-l-2 border-amber-500 bg-amber-50/80 px-2.5 py-1 text-xs text-amber-950 dark:border-amber-600 dark:bg-amber-950/20 dark:text-amber-100">
          {seedCount} amber seed{seedCount === 1 ? '' : 's'} still need narrative (Based on /
          Failure to / findings stubs).
        </div>
      )}

      <article
        className={clsx(
          'min-h-0 flex-1 overflow-hidden',
          viewMode === 'preview' ? 'bg-transparent' : 'doc-surface',
        )}
      >
        {viewMode === 'preview' ? (
          <div className="ir-doc-desk min-h-0 h-full">
            <div className="ir-doc-toolbar">
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden />
              <p className="min-w-0 text-[11px] leading-snug text-ink-500 dark:text-ink-400">
                Preview matches Download SOD. Edit facility fields on the IR tab, then reopen to
                refresh.
              </p>
            </div>
            <div className="ir-doc-scroll">
              <SodTemplatePreview report={{ ...report, sod }} />
            </div>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-14rem)] overflow-y-auto">
            <SodEditForm
              sod={sod}
              canEdit={canEdit && !busy}
              onPatch={patchSod}
              onPatchDeficiency={patchDeficiency}
            />
          </div>
        )}
      </article>
    </div>
  )
}
