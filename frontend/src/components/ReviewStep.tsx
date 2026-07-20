import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react'
import clsx from 'clsx'
import type { InvestigationReport, WACComparison } from '../api'

type Props = {
  comparisons: WACComparison[]
  complaintText: string
  report?: InvestigationReport | null
  onBack: () => void
  onContinue: () => void
  busy: boolean
}

function AccuracyBadge({ comparison }: { comparison: WACComparison }) {
  if (comparison.quote_ok === false) {
    return (
      <span className="rounded-md bg-rose-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
        Quote broken
      </span>
    )
  }
  if (comparison.low_confidence) {
    return (
      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
        Low confidence
      </span>
    )
  }
  if (comparison.quote_ok) {
    return (
      <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
        Verified
      </span>
    )
  }
  return null
}

export function ReviewStep({ comparisons, complaintText, report, onBack, onContinue, busy }: Props) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [showPdf, setShowPdf] = useState(false)
  const [showFullCode, setShowFullCode] = useState(false)
  const total = comparisons.length
  const active = comparisons[activeIdx] || null

  const goTo = (idx: number) => {
    if (!total) return
    const next = ((idx % total) + total) % total
    setActiveIdx(next)
    setShowPdf(false)
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
        return ((next % total) + total) % total
      })
      setShowPdf(false)
      setShowFullCode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total])

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
            One allegation line per approved code ({total} total). Use the arrows or code list to move
            between codes.
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

      {report?.quote_integrity && !report.quote_integrity.ok && (
        <div className="rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          Quote integrity issues ({report.quote_integrity.failures.length}). Check matched PDF text
          before exporting.
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
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono text-xs font-semibold">{c.code}</div>
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
                    <div className="flex items-center gap-2">
                      <AccuracyBadge comparison={active} />
                      <span
                        className={clsx(
                          'font-mono text-[10px]',
                          allegationLen > 550 ? 'text-amber-700 dark:text-amber-300' : 'text-ink-400',
                        )}
                      >
                        {allegationLen} chars
                      </span>
                    </div>
                  </div>
                  <h3 className="mt-1 font-display text-lg leading-snug tracking-tight">{active.title}</h3>
                  {active.low_confidence && (
                    <p className="mt-1 font-sans text-xs text-amber-800 dark:text-amber-300">
                      Weak overlap — closest subsection(s) under this code were selected; confirm the
                      duty fits the complaint before relying on it.
                    </p>
                  )}
                </header>

                <article className="bg-tide-500/[0.06] px-5 py-5 dark:bg-tide-500/[0.08]">
                  <p className="prose-report whitespace-pre-wrap text-[15px] leading-snug text-ink-900 dark:text-ink-50">
                    {active.allegation_draft || 'No allegation draft generated for this code.'}
                  </p>
                  {allegationLen > 480 && (
                    <p className="mt-2 font-sans text-xs text-amber-800 dark:text-amber-300">
                      Allegation is longer than the target DOH line length — regenerate the draft or
                      edit it down in the report editor.
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
              >
                <span>Exact PDF subsection text (verification)</span>
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
                          <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink-700 dark:text-ink-200">
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
                      {active.wac_text || active.wac_summary || 'Full code text not loaded in this draft payload.'}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
