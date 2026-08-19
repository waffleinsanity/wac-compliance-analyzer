import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, FileUp, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import {
  api,
  type CaseDetail,
  type EvidenceReviewHit,
  type InvestigationReport,
} from '../api'
import { ApplicationStrengthBadge } from './ApplicationStrengthBadge'

type Props = {
  report: InvestigationReport
  caseDetail: CaseDetail | null
  caseId: number | null
  busy?: boolean
  canEdit?: boolean
  onReportChange: (report: InvestigationReport) => void
  onCaseRefresh?: () => void | Promise<void>
  onBack: () => void
  onContinue: (report: InvestigationReport) => void
}

const EXHIBIT_PREFIX = 'Record review of exhibit'

function formatProcessLine(hit: EvidenceReviewHit): string {
  const excerpt = (hit.excerpt || '').replace(/\s+/g, ' ').trim().replace(/[ ;,]+$/g, '')
  const clipped = excerpt.length > 320 ? `${excerpt.slice(0, 317).trimEnd()}…` : excerpt
  return `${EXHIBIT_PREFIX} ${hit.evidence_title} as applied to ${hit.cite}: ${clipped}`
}

export function EvidenceStep({
  report,
  caseDetail,
  caseId,
  busy = false,
  canEdit = true,
  onReportChange,
  onCaseRefresh,
  onBack,
  onContinue,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [hits, setHits] = useState<EvidenceReviewHit[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [scanned, setScanned] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeCite, setActiveCite] = useState('')

  const evidenceCount = caseDetail?.evidence?.length ?? 0

  const loadReview = async () => {
    if (!caseId) {
      setHits([])
      setMessage('Save this case first so exhibits can be compared with allegation duties.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await api.reviewEvidence(caseId)
      setHits(res.hits || [])
      setScanned(res.scanned_count || 0)
      setMessage(res.message || '')
      const prior = new Set(
        (report.evidence_review || [])
          .filter((h) => h.included_by_default)
          .map((h) => h.id),
      )
      const starters = new Set(
        (res.hits || []).filter((h) => h.included_by_default).map((h) => h.id),
      )
      setSelected(prior.size ? prior : starters)
      const first = res.hits?.[0]?.cite || ''
      setActiveCite(first)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evidence review failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReview()
    // Re-run when exhibit count changes (new upload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, evidenceCount])

  const grouped = useMemo(() => {
    const map = new Map<string, EvidenceReviewHit[]>()
    for (const hit of hits) {
      const list = map.get(hit.cite) || []
      list.push(hit)
      map.set(hit.cite, list)
    }
    return [...map.entries()]
  }, [hits])

  const activeHits = grouped.find(([cite]) => cite === activeCite)?.[1] || grouped[0]?.[1] || []

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const chosen = hits.filter((h) => selected.has(h.id))

  const continueWithSelection = () => {
    const selectedHits = chosen.map((h) => ({ ...h, included_by_default: true }))
    const process = [
      ...(report.investigative_process || []).filter((p) => !p.startsWith(EXHIBIT_PREFIX)),
      ...selectedHits.map(formatProcessLine),
    ]
    const next: InvestigationReport = {
      ...report,
      evidence_review: hits.map((h) => ({
        ...h,
        included_by_default: selected.has(h.id),
      })),
      investigative_process: process,
    }
    onReportChange(next)
    onContinue(next)
  }

  const upload = async (files: FileList | File[]) => {
    if (!caseId || !canEdit) return
    const list = Array.from(files)
    if (!list.length) return
    setLoading(true)
    setError('')
    try {
      for (const file of list) {
        await api.uploadEvidence(caseId, file, { title: file.name })
      }
      await onCaseRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="compare-meta">Step 4 · Evidence</p>
          <h2 className="font-display text-xl text-ink-900 dark:text-ink-50">
            Review exhibits against allegation duties
          </h2>
          <p className="mt-1 max-w-2xl font-sans text-sm text-ink-500">
            Optional. IR and SOD stay available if exhibits are missing or incomplete.
            Suggested excerpts come from attached files and overlap allegation or Regulatory
            Framework duties. Select what applies; this is assistive record review, not a
            finding and not statute authority.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Documents
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || loading}
            onClick={continueWithSelection}
          >
            Save to Documents <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="btn-ghost !px-2.5 !py-1 text-xs"
          disabled={!caseId || !canEdit || loading}
          onClick={() => fileRef.current?.click()}
        >
          <FileUp className="h-3.5 w-3.5" /> Attach exhibits
        </button>
        <span className="font-sans text-xs text-ink-400">
          {evidenceCount === 0
            ? 'No exhibits attached'
            : `${evidenceCount} exhibit${evidenceCount === 1 ? '' : 's'} · ${scanned} scanned`}
        </span>
      </div>

      {loading && (
        <p className="flex items-center gap-2 font-sans text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Comparing exhibits with allegation duties…
        </p>
      )}

      {message && !loading && (
        <p className="border-l-2 border-ink-300 px-3 py-2 font-sans text-sm text-ink-600 dark:border-ink-600 dark:text-ink-300">
          {message}
        </p>
      )}

      {grouped.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <nav className="space-y-1" aria-label="Allegation cites">
            {grouped.map(([cite, list]) => {
              const n = list.filter((h) => selected.has(h.id)).length
              return (
                <button
                  key={cite}
                  type="button"
                  className={clsx(
                    'w-full rounded-md px-2 py-2 text-left font-mono text-xs',
                    cite === (activeCite || grouped[0][0])
                      ? 'bg-ink-100 dark:bg-ink-800'
                      : 'hover:bg-ink-50 dark:hover:bg-ink-900',
                  )}
                  onClick={() => setActiveCite(cite)}
                >
                  <span className="font-semibold">{cite}</span>
                  <span className="mt-0.5 block font-sans text-[11px] text-ink-400">
                    {n} selected · {list.length} suggested
                  </span>
                </button>
              )
            })}
          </nav>
          <div className="space-y-3">
            {activeHits.map((hit) => {
              const checked = selected.has(hit.id)
              return (
                <label
                  key={hit.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md border border-ink-200 px-3 py-3 dark:border-ink-700"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => toggle(hit.id)}
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="compare-cite font-semibold">{hit.evidence_title}</span>
                      <ApplicationStrengthBadge
                        score={hit.score}
                        lowConfidence={hit.band === 'weak'}
                        source="ir_match"
                        tone="quiet"
                        short
                      />
                    </span>
                    <span className="mt-1 block font-sans text-[11px] uppercase tracking-wide text-ink-400">
                      Related duty · {hit.cite}
                    </span>
                    <span className="mt-1 block font-serif text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                      {hit.excerpt}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      <p className="font-sans text-xs text-ink-400">
        {chosen.length} excerpt{chosen.length === 1 ? '' : 's'} will be added to Investigative
        Process. You can skip with none selected.
      </p>
    </div>
  )
}
