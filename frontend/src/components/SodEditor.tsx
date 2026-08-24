import { useEffect, useMemo, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { FileDown, FileText, Loader2 } from 'lucide-react'
import { api, type InvestigationReport } from '../api'
import { findRemovalSpans } from '../contentReview'

type Props = {
  report: InvestigationReport
  canExport?: boolean
  busy?: boolean
  activeCaseId?: number | null
  onEnsureCase?: (report: InvestigationReport) => Promise<number>
}

/** Renders filled Investigation SOD Template.docx (same bytes as Download SOD). */
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
          setError(e instanceof Error ? e.message : 'SOD preview failed')
          setLoading(false)
        }
      }
    }
    const t = window.setTimeout(() => void run(), 300)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fillKey captures report fields used for fill
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
          setError(e instanceof Error ? e.message : 'SOD preview failed')
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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading filled SOD preview…
        </p>
      )}
      {error ? (
        <div className="m-4 space-y-2 rounded border border-ink-200 bg-card px-3 py-3 text-sm dark:border-ink-700">
          <p className="text-ink-700 dark:text-ink-200">
            Preview is unavailable. Use Download SOD for the filled Investigation SOD Template.
          </p>
          <p className="text-xs text-ink-500 dark:text-ink-400">{error}</p>
        </div>
      ) : null}
      <div ref={styleRef} className="sod-docx-preview-styles" aria-hidden />
      <div
        ref={hostRef}
        className="sod-docx-preview-host"
        aria-label="Statement of Deficiencies filled template preview"
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

export function SodEditor({
  report,
  canExport = true,
  busy = false,
  activeCaseId = null,
  onEnsureCase,
}: Props) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const seedCount = useMemo(() => sodAssistSeedCount(report), [report.sod])

  const exportSod = async () => {
    setError('')
    setExporting(true)
    try {
      let id = activeCaseId
      if (!id && onEnsureCase) id = await onEnsureCase(report)
      if (!id) throw new Error('Save the case before downloading the SOD.')
      const blob = await api.exportCaseSod(id, true)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `SOD_${report.case_id || id}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SOD download failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="compare-meta">Sister draft to the Investigation Report · same assist rules</p>
          <h2 className="font-display mt-0.5 text-xl text-ink-900 dark:text-ink-50 sm:text-2xl">
            Statement of Deficiencies
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-500 dark:text-ink-400">
            Fills Investigation SOD Template.docx from this IR: facility fields, investigation date,
            Compare cites, and PDF-backed regulation text. Findings narrative stays investigator-owned
            (same as IR evidentiary sections). Yellow shading in the preview and download marks
            auto-filled IR fields to verify for accuracy.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary !h-8 !px-3 text-xs"
          disabled={!canExport || busy || exporting}
          onClick={() => void exportSod()}
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileDown className="h-3.5 w-3.5" />
          )}
          Download SOD
        </button>
      </div>

      {error && (
        <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="rounded border border-ink-200 bg-card px-3 py-2 text-xs leading-snug text-ink-600 dark:border-ink-700 dark:text-ink-300">
        <p className="font-medium text-ink-800 dark:text-ink-100">Verify highlights</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            <span className="font-medium">Yellow shading</span> in the preview and Download SOD marks
            auto-filled fields from the IR. Check each for accuracy before treating the SOD as final.
          </li>
          <li>
            <span className="font-medium">Amber banner</span> (same content-review seeds as the IR)
            marks Based on / Failure to / finding stubs that must be replaced with investigation
            narrative. Statute cites and Compare-selected duties are not amber-flagged.
          </li>
        </ul>
      </div>

      {seedCount > 0 && (
        <div className="border-l-2 border-amber-500 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/20 dark:text-amber-100">
          Amber assist rules (same as the Investigation Report): {seedCount} SOD seed span
          {seedCount === 1 ? '' : 's'} (Based on / Failure to / finding stubs) are still assistive
          placeholders. Replace them with investigation narrative before treating the SOD as final.
          Statute cites and Compare-selected duties are not flagged.
        </div>
      )}

      <div className="rounded border border-ink-200 bg-card px-3 py-2 text-xs leading-snug text-ink-600 dark:border-ink-700 dark:text-ink-300">
        <p className="font-medium text-ink-800 dark:text-ink-100">How IR and SOD relate</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            <span className="font-medium">Shared from IR:</span> facility address, credential, dates,
            case id, Compare duties → regulation cite/text, Based on / Failure to seeds (yellow when
            auto-filled in the Word template).
          </li>
          <li>
            <span className="font-medium">Human-owned (both):</span> investigation activity, findings
            narrative, Plan of Correction column, Dear/administrator when not on the IR.
          </li>
          <li>
            <span className="font-medium">Preview = Download:</span> same filled Word template (logo,
            landscape pages with visible page breaks, lists). Edit facility/director on the IR
            Documents tab to refresh SOD fill.
          </li>
        </ul>
      </div>

      <div className="ir-doc-desk min-h-0 flex-1">
        <div className="ir-doc-toolbar">
          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden />
          <p className="min-w-0 text-[11px] leading-snug text-ink-500 dark:text-ink-400">
            Official Investigation SOD Template with IR fields filled. Yellow = verify auto-fill;
            amber seeds = replace with narrative. Landscape page breaks are labeled between pages.
            Update the IR facility block, then reopen this tab to refresh.
          </p>
        </div>
        <div className="ir-doc-scroll">
          <SodTemplatePreview report={report} />
        </div>
      </div>
    </div>
  )
}
