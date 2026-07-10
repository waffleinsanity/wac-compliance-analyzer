import { useState } from 'react'
import clsx from 'clsx'
import type { InvestigationReport } from '../api'

type Props = {
  report: InvestigationReport
  onContinue: () => void
}

export function ReviewStep({ report, onContinue }: Props) {
  const [expanded, setExpanded] = useState<string | null>(
    report.comparisons[0]?.wac_id ?? null,
  )

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200/80 p-4 dark:border-ink-700/80">
        <div>
          <h2 className="font-display text-xl">WAC comparison</h2>
          <p className="text-sm text-ink-500">
            Matched subsections from the authorized WAC PDFs · complaint excerpts · allegation drafts
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={onContinue}>
          Continue to report
        </button>
      </div>

      {!!report.recommended_subsections?.length && (
        <div className="border-b border-ink-200/70 px-4 py-3 dark:border-ink-700">
          <div className="label mb-2">Recommended subsections</div>
          <div className="flex flex-wrap gap-1.5">
            {report.recommended_subsections.map((s) => (
              <span
                key={s}
                className="rounded-lg bg-cedar-500/10 px-2 py-1 font-mono text-xs text-cedar-600 dark:text-cedar-400"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {report.comparisons.map((c) => {
          const open = expanded === c.wac_id
          return (
            <article
              key={c.wac_id}
              className="rounded-2xl border border-ink-200/80 bg-white/70 dark:border-ink-700 dark:bg-ink-900/50"
            >
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
                onClick={() => setExpanded(open ? null : c.wac_id)}
              >
                <div>
                  <div className="font-mono text-sm font-semibold">WAC {c.code}</div>
                  <div className="text-sm text-ink-600 dark:text-ink-300">{c.title}</div>
                  {!!c.matched_subsections?.length && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.matched_subsections.map((s) => (
                        <span
                          key={s}
                          className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-ink-800"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span
                  className={clsx(
                    'rounded-full border px-2.5 py-1 text-xs font-semibold',
                    c.finding?.status === 'NON-COMPLIANT'
                      ? 'border-rose-500/30 bg-rose-500/15 text-rose-800 dark:text-rose-300'
                      : 'border-ink-300 bg-ink-50 text-ink-600 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200',
                  )}
                >
                  {c.finding?.status || 'REVIEW'}
                </span>
              </button>

              {open && (
                <div className="grid gap-3 border-t border-ink-200/70 p-4 lg:grid-cols-2 dark:border-ink-700">
                  <div>
                    <div className="label">WAC text (summary)</div>
                    <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-ink-50/80 p-3 font-mono text-xs leading-relaxed dark:bg-ink-950/50">
                      {c.wac_summary || c.wac_text.slice(0, 800)}
                    </p>
                  </div>
                  <div>
                    <div className="label">Complaint excerpts</div>
                    {c.complaint_excerpts.length ? (
                      <ul className="space-y-2">
                        {c.complaint_excerpts.map((ex, i) => (
                          <li
                            key={i}
                            className="rounded-xl bg-tide-500/10 p-3 text-sm leading-relaxed text-ink-800 dark:text-ink-100"
                          >
                            {ex}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-ink-500">
                        No direct excerpts isolated; ranking used lexical overlap against PDF subsections.
                      </p>
                    )}
                  </div>
                  <div className="lg:col-span-2">
                    <div className="label">Allegation draft</div>
                    <p className="whitespace-pre-wrap rounded-xl border border-ink-200/80 bg-white/80 p-3 text-sm leading-relaxed dark:border-ink-700 dark:bg-ink-950/40">
                      {c.allegation_draft}
                    </p>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
