import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react'
import clsx from 'clsx'
import type {
  CaseDetail,
  InvestigationReport,
  QuoteFailure,
  StatuteHit,
  WACComparison,
} from '../api'
import { quoteFailureLabel } from '../investigatorLabels'
import { normalizeAllegationLine } from '../allegationFormat'
import { ApplicationStrengthBadge } from './ApplicationStrengthBadge'
import { IrTemplatePicker } from './IrTemplatePicker'
import { StatuteSearchPanel } from './StatuteSearchPanel'

type Props = {
  comparisons: WACComparison[]
  complaintText: string
  report?: InvestigationReport | null
  onBack: () => void
  onContinue: () => void
  busy: boolean
  /** Optional research — find additional WACs/RCWs that may apply more strongly. */
  statuteHits?: StatuteHit[]
  searchBusy?: boolean
  onSearchStatutes?: () => void
  onAddCode?: (codeId: string) => void
  selectedIds?: string[]
  caseId?: number | null
  caseDetail?: CaseDetail | null
  onCaseRefresh?: () => void | Promise<void>
}

function AccuracyBadge({ comparison }: { comparison: WACComparison }) {
  if (comparison.quote_ok === false) {
    return (
      <span className="rounded-md bg-rose-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
        Needs statute review
      </span>
    )
  }
  if (comparison.low_confidence) {
    return (
      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
        Confirm subsection
      </span>
    )
  }
  if (comparison.quote_ok) {
    return (
      <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
        Statute verified
      </span>
    )
  }
  return null
}

/** Map a quote-integrity failure to a comparison index when possible. */
function findComparisonIndex(comparisons: WACComparison[], failure: QuoteFailure): number {
  const cite = failure.cite?.trim()
  if (cite) {
    const byCite = comparisons.findIndex(
      (c) =>
        c.code === cite ||
        c.matched_subsections?.some((s) => s === cite || s.startsWith(cite) || cite.startsWith(s)),
    )
    if (byCite >= 0) return byCite
  }

  const field = failure.field || ''
  const fromAllegation = field.startsWith('allegation:')
    ? field.slice('allegation:'.length).trim()
    : ''
  const candidates = [fromAllegation, cite].filter(Boolean) as string[]

  for (const token of candidates) {
    const idx = comparisons.findIndex(
      (c) =>
        c.code === token ||
        c.wac_id === token ||
        c.code.endsWith(token) ||
        token.includes(c.code),
    )
    if (idx >= 0) return idx
  }
  return -1
}

export function ReviewStep({
  comparisons,
  complaintText,
  report,
  onBack,
  onContinue,
  busy,
  statuteHits = [],
  searchBusy = false,
  onSearchStatutes,
  onAddCode,
  selectedIds = [],
  caseId = null,
  caseDetail = null,
  onCaseRefresh,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [showPdf, setShowPdf] = useState(false)
  const [showFullCode, setShowFullCode] = useState(false)
  const total = comparisons.length
  const active = comparisons[activeIdx] || null

  const goTo = (idx: number, opts?: { openPdf?: boolean }) => {
    if (!total) return
    const next = ((idx % total) + total) % total
    setActiveIdx(next)
    const target = comparisons[next]
    setShowPdf(opts?.openPdf === true || target?.quote_ok === false)
    setShowFullCode(false)
  }

  const goPrev = () => goTo(activeIdx - 1)
  const goNext = () => goTo(activeIdx + 1)

  useEffect(() => {
    if (!total) {
      setActiveIdx(0)
      return
    }
    if (activeIdx >= total) setActiveIdx(0)
  }, [total, activeIdx])

  // Default-open Exact PDF panel when the active allegation has a broken quote.
  useEffect(() => {
    if (active?.quote_ok === false) setShowPdf(true)
  }, [active?.wac_id, active?.quote_ok])

  useEffect(() => {
    if (total < 2) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) {
        return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      setActiveIdx((i) => {
        const next = e.key === 'ArrowLeft' ? i - 1 : i + 1
        const idx = ((next % total) + total) % total
        const target = comparisons[idx]
        setShowPdf(target?.quote_ok === false)
        setShowFullCode(false)
        return idx
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total, comparisons])

  const grouped = useMemo(() => {
    const map: Record<string, WACComparison[]> = { BHA: [], RTF: [], RCW: [], Other: [] }
    for (const c of comparisons) {
      const key =
        c.chapter === '246-341'
          ? 'BHA'
          : c.chapter === '246-337'
            ? 'RTF'
            : c.chapter.startsWith('71.')
              ? 'RCW'
              : 'Other'
      map[key].push(c)
    }
    return map
  }, [comparisons])

  const quoteFailures = report?.quote_integrity?.failures ?? []

  const excerpts = active?.complaint_excerpts?.length
    ? active.complaint_excerpts.slice(0, 2)
    : complaintText.trim()
      ? [complaintText.slice(0, 280)]
      : []

  const allegationLen = active?.allegation_draft?.length ?? 0

  if (!comparisons.length) {
    return (
      <div className="panel animate-rise p-8 text-center font-sans text-sm text-ink-500">
        Generate a draft report first to compare authorized WACs against the complaint.
      </div>
    )
  }

  return (
    <div className="animate-rise space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-tide-600 dark:text-tide-400">
            Step 2 · Compare
          </p>
          <h2 className="mt-1 font-display text-3xl tracking-tight">Working allegations</h2>
          <p className="mt-2 max-w-2xl font-sans text-sm text-ink-500">
            One allegation line per approved code ({total} total). Application strength shows how
            clearly each code fits the complaint. Use optional research below if another WAC/RCW may
            apply more strongly.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={onContinue}>
            Open report editor <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <IrTemplatePicker
        caseId={caseId}
        caseDetail={caseDetail}
        onCaseRefresh={onCaseRefresh}
        disabled={busy}
      />

      {quoteFailures.length > 0 && (
        <div className="rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">
            Statute wording issues ({quoteFailures.length}). Jump to the allegation and check it
            against the approved code text before exporting. If this draft was built before a recent
            update, go back to Intake and rebuild the report.
          </p>
          <ul className="mt-2 space-y-1.5">
            {quoteFailures.map((f, i) => {
              const idx = findComparisonIndex(comparisons, f)
              const label = f.cite || `Issue ${i + 1}`
              const preview = (f.quote_preview || '').trim()
              const canNav = idx >= 0
              return (
                <li key={`${f.field}-${f.cite ?? ''}-${i}`}>
                  <button
                    type="button"
                    disabled={!canNav}
                    onClick={() => canNav && goTo(idx, { openPdf: true })}
                    className={clsx(
                      'w-full rounded-lg border border-amber-300/60 bg-white/60 px-3 py-2 text-left transition dark:border-amber-700/60 dark:bg-amber-950/30',
                      canNav
                        ? 'hover:border-amber-500 hover:bg-amber-100/80 dark:hover:bg-amber-900/50'
                        : 'cursor-default opacity-70',
                    )}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-xs font-semibold">{label}</span>
                      <span className="font-sans text-xs text-amber-800 dark:text-amber-200">
                        {quoteFailureLabel(f.reason)}
                      </span>
                    </div>
                    {preview && (
                      <p className="mt-1 line-clamp-2 font-serif text-xs leading-snug text-ink-600 dark:text-ink-300">
                        {preview}
                      </p>
                    )}
                    {!canNav && (
                      <p className="mt-1 font-sans text-[11px] text-amber-700/80 dark:text-amber-300/80">
                        No matching allegation in this compare list.
                      </p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[188px_minmax(0,1fr)]">
        <aside className="panel max-h-[42vh] overflow-y-auto p-2 lg:sticky lg:top-3 lg:max-h-[78vh]">
          {Object.entries(grouped).map(([label, items]) => {
            if (!items.length) return null
            return (
              <div key={label} className="mb-2">
                <div className="px-2 py-0.5 font-sans text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  {label}
                </div>
                <ul className="space-y-0.5">
                  {items.map((c) => {
                    const idx = comparisons.findIndex((x) => x.wac_id === c.wac_id)
                    const activeItem = idx === activeIdx
                    return (
                      <li key={c.wac_id}>
                        <button
                          type="button"
                          onClick={() => goTo(idx)}
                          className={clsx(
                            'w-full rounded-xl px-2.5 py-1.5 text-left transition',
                            activeItem
                              ? 'bg-tide-500/12 ring-1 ring-tide-500/30'
                              : 'hover:bg-ink-100/70 dark:hover:bg-ink-800/50',
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="font-mono text-xs font-semibold">{c.code}</div>
                            <ApplicationStrengthBadge
                              score={c.match_score}
                              reason={c.match_reason}
                              lowConfidence={c.low_confidence}
                              source="ir_match"
                              short
                            />
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            <AccuracyBadge comparison={c} />
                          </div>
                          <div className="line-clamp-2 font-sans text-xs text-ink-500">{c.title}</div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </aside>

        {active && (
          <div className="space-y-4">
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                className="btn-secondary shrink-0 self-center !px-2.5"
                onClick={goPrev}
                disabled={total < 2}
                aria-label="Previous approved WAC"
                title="Previous approved WAC (←)"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <section className="doc-surface min-w-0 flex-1 overflow-hidden">
                <header className="border-b border-ink-200/70 px-5 py-4 dark:border-ink-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-tide-600 dark:text-tide-400">
                      Allegation line · {active.code}
                      <span className="ml-2 font-mono normal-case tracking-normal text-ink-400">
                        {activeIdx + 1} of {total}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ApplicationStrengthBadge
                        score={active.match_score}
                        reason={active.match_reason}
                        lowConfidence={active.low_confidence}
                        source="ir_match"
                      />
                      <AccuracyBadge comparison={active} />
                    </div>
                  </div>
                  <h3 className="mt-1 font-display text-lg leading-snug tracking-tight">{active.title}</h3>
                  {active.low_confidence && (
                    <p className="mt-1 font-sans text-xs text-amber-800 dark:text-amber-300">
                      Limited match to the complaint — confirm the selected subsection fits the intake
                      before relying on this allegation line. Optional research below can surface
                      codes with stronger application.
                    </p>
                  )}
                </header>

                <article className="bg-tide-500/[0.06] px-5 py-5 dark:bg-tide-500/[0.08]">
                  <p className="prose-report whitespace-pre-wrap text-[15px] leading-snug text-ink-900 dark:text-ink-50">
                    {normalizeAllegationLine(active.allegation_draft) ||
                      'No allegation draft generated for this code.'}
                  </p>
                  {allegationLen > 480 && (
                    <p className="mt-2 font-sans text-xs text-amber-800 dark:text-amber-300">
                      This allegation line is long — consider editing it down in the report editor.
                    </p>
                  )}
                </article>

                {!!active.matched_subsections?.length && (
                  <div className="flex flex-wrap gap-1.5 border-t border-ink-200/60 px-5 py-3 dark:border-ink-700">
                    {active.matched_subsections.map((cite) => (
                      <span
                        key={cite}
                        className="rounded-md border border-ink-200 bg-background px-2 py-0.5 font-mono text-[11px] dark:border-ink-600"
                      >
                        {cite}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <button
                type="button"
                className="btn-secondary shrink-0 self-center !px-2.5"
                onClick={goNext}
                disabled={total < 2}
                aria-label="Next approved WAC"
                title="Next approved WAC (→)"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <section className="panel space-y-3 p-4">
              <h4 className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Complaint excerpts tied to this code
              </h4>
              {excerpts.length ? (
                <ul className="space-y-2">
                  {excerpts.map((ex, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-ink-200/70 bg-muted/15 px-3 py-2 text-sm leading-relaxed text-ink-700 dark:border-ink-700 dark:text-ink-200"
                    >
                      {ex}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-400">No complaint excerpts linked to this code.</p>
              )}
            </section>

            <section className="panel overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left font-sans text-sm font-medium"
                onClick={() => setShowPdf((v) => !v)}
                aria-expanded={showPdf}
              >
                <span>
                  Exact PDF subsection text (verification)
                  {active.quote_ok === false && (
                    <span className="ml-2 font-sans text-[11px] font-normal text-rose-700 dark:text-rose-300">
                      — review against approved code text
                    </span>
                  )}
                </span>
                {showPdf ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {showPdf && (
                <div className="space-y-3 border-t border-ink-200/70 px-4 py-3 dark:border-ink-700">
                  {active.matched_subsections?.length ? (
                    active.matched_subsections.map((cite, i) => (
                      <div key={cite} className="rounded-lg border border-ink-200/70 px-3 py-2.5 dark:border-ink-700">
                        <div className="font-mono text-xs font-semibold text-tide-700 dark:text-tide-300">
                          {cite}
                        </div>
                        {active.matched_subsection_texts?.[i] && (
                          <p className="mt-1.5 max-h-80 overflow-y-auto whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                            {active.matched_subsection_texts[i]}
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-ink-400">No matched subsections for this code.</p>
                  )}
                  <button
                    type="button"
                    className="btn-ghost !px-2 !py-1 font-sans text-xs"
                    onClick={() => setShowFullCode((v) => !v)}
                  >
                    {showFullCode ? 'Hide full code text' : 'Show full selected code text'}
                  </button>
                  {showFullCode && (
                    <p className="max-h-64 overflow-y-auto whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                      {active.wac_text || active.wac_summary || 'Full approved code text is not available for this selection.'}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {onSearchStatutes && onAddCode && (
        <details className="panel group">
          <summary className="cursor-pointer list-none px-4 py-3 font-sans text-sm font-medium text-ink-600 marker:content-none dark:text-ink-300 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between gap-2">
              <span>
                Optional research — stronger WAC/RCW fits?
                <span className="mt-0.5 block text-xs font-normal text-ink-400">
                  Same Strong / Moderate / Weak / None scale as approved codes above. Not authorization.
                </span>
              </span>
              <span className="text-xs text-ink-400 group-open:hidden">Show</span>
              <span className="hidden text-xs text-ink-400 group-open:inline">Hide</span>
            </span>
          </summary>
          <div className="border-t border-ink-200/70 px-2 pb-3 dark:border-ink-700">
            <StatuteSearchPanel
              hits={statuteHits}
              busy={searchBusy}
              onSearch={onSearchStatutes}
              onAddCode={onAddCode}
              selectedIds={selectedIds}
              comparisons={comparisons}
              compact
            />
          </div>
        </details>
      )}
    </div>
  )
}
