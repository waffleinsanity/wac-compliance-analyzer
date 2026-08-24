import clsx from 'clsx'
import type { InvestigationReport } from '../api'
import {
  splitSummaryParagraphs,
  summaryParagraphIsEvidenceLinked,
} from '../summaryFindingsFormat'
import { HighlightedProse } from './HighlightedProse'

type Props = {
  text: string
  report: InvestigationReport
  /** Print/paper surface (Form preview). */
  paper?: boolean
  /** Edit mode: one textarea per paragraph. */
  editable?: boolean
  onChange?: (next: string) => void
  className?: string
}

const LINKED_TITLE = 'Evidence linked to an authorized allegation duty'

/**
 * Summary of Findings paragraphs. Green highlight marks findings with a direct
 * Evidence ↔ allegation (WAC/RCW duty) link from evidence review.
 */
export function SummaryFindingsView({
  text,
  report,
  paper = false,
  editable = false,
  onChange,
  className,
}: Props) {
  const paragraphs = splitSummaryParagraphs(text)
  const linkedCount = paragraphs.filter((p) => summaryParagraphIsEvidenceLinked(p, report)).length

  const updateParagraph = (index: number, value: string) => {
    if (!onChange) return
    const next = [...paragraphs]
    next[index] = value
    onChange(next.map((p) => p.trim()).filter(Boolean).join('\n\n'))
  }

  if (!paragraphs.length) {
    if (editable && onChange) {
      return (
        <textarea
          className={clsx('input min-h-[200px] font-serif leading-relaxed', className)}
          value=""
          onChange={(e) => onChange(e.target.value)}
          aria-label="Summary of Findings"
        />
      )
    }
    return <p className={clsx(paper ? 'ir-body ir-indent' : 'font-serif text-sm', className)}>—</p>
  }

  return (
    <div className={clsx('space-y-2', className)}>
      {linkedCount > 0 ? (
        <p
          className={clsx(
            'font-sans text-[11px]',
            paper ? 'text-ink-600' : 'text-ink-500 dark:text-ink-400',
          )}
        >
          <span
            className={clsx(
              'mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle',
              paper
                ? 'bg-emerald-300 ring-1 ring-emerald-600/40'
                : 'bg-emerald-400/80 ring-1 ring-emerald-600/30 dark:bg-emerald-500/50',
            )}
            aria-hidden
          />
          Green highlight: exhibit finding linked to an authorized allegation duty ({linkedCount})
        </p>
      ) : null}
      {paragraphs.map((para, i) => {
        const linked = summaryParagraphIsEvidenceLinked(para, report)
        if (editable && onChange) {
          return (
            <textarea
              key={`sum-edit-${i}`}
              className={clsx(
                'input min-h-[4.5rem] w-full font-serif text-sm leading-relaxed',
                linked &&
                  'border-emerald-400/70 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-500/30 dark:border-emerald-600 dark:bg-emerald-950/35 dark:text-emerald-50 dark:ring-emerald-500/25',
              )}
              value={para}
              title={linked ? LINKED_TITLE : undefined}
              aria-label={
                linked
                  ? `Summary finding ${i + 1} (evidence linked to allegation)`
                  : `Summary finding ${i + 1}`
              }
              onChange={(e) => updateParagraph(i, e.target.value)}
            />
          )
        }
        return (
          <div
            key={`sum-view-${i}`}
            className={clsx(
              linked &&
                (paper
                  ? 'rounded-sm bg-emerald-200/70 px-1.5 py-1 ring-1 ring-emerald-600/35'
                  : 'rounded-md bg-emerald-50 px-2 py-1.5 ring-1 ring-emerald-400/40 dark:bg-emerald-950/40 dark:ring-emerald-600/40'),
            )}
            title={linked ? LINKED_TITLE : undefined}
          >
            <HighlightedProse
              text={para}
              paper={paper}
              className={
                paper
                  ? 'text-[12pt] leading-[1.45] text-black'
                  : 'text-sm leading-relaxed text-ink-800 dark:text-ink-100'
              }
            />
          </div>
        )
      })}
      {editable && onChange ? (
        <button
          type="button"
          className="btn-ghost !h-8 !px-2.5 text-xs"
          onClick={() =>
            onChange(
              `${text.trim()}\n\nA review of the document titled "[title]", dated [document date], showed [pending: how this record supports or does not support the authorized WAC duties].`,
            )
          }
        >
          Add paragraph
        </button>
      ) : null}
    </div>
  )
}
