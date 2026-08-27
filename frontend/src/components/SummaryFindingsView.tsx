import { useState } from 'react'
import clsx from 'clsx'
import type { CaseEvidence, InvestigationReport } from '../api'
import { api } from '../api'
import {
  resolveSummaryEvidenceCite,
  splitSummaryParagraphs,
  stripTrailingSuperscripts,
  summaryParagraphIsEvidenceLinked,
  type SummaryEvidenceCite,
} from '../summaryFindingsFormat'
import { HighlightedProse } from './HighlightedProse'

type Props = {
  text: string
  report: InvestigationReport
  /** Case exhibits for superscript → file links. */
  evidence?: CaseEvidence[]
  caseId?: number | null
  /** Print/paper surface (Form preview). */
  paper?: boolean
  /** Edit mode: one textarea per paragraph. */
  editable?: boolean
  onChange?: (next: string) => void
  className?: string
}

const LINKED_TITLE = 'Evidence linked to an authorized allegation duty'

function ExhibitSuperscriptLink({
  cite,
  caseId,
  paper,
}: {
  cite: SummaryEvidenceCite
  caseId?: number | null
  paper?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    if (!caseId || busy) return
    setBusy(true)
    try {
      const blob = await api.downloadEvidenceFile(caseId, cite.evidenceId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      // Tooltip still conveys the excerpt when open fails.
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      className={clsx(
        'ml-0.5 inline align-super text-[0.72em] font-semibold underline decoration-1 underline-offset-2',
        paper
          ? 'text-[#0563C1] hover:text-[#034078]'
          : 'text-tide-700 hover:text-tide-900 dark:text-tide-300 dark:hover:text-tide-100',
        busy && 'opacity-60',
      )}
      title={cite.tooltip || LINKED_TITLE}
      aria-label={`Open exhibit ${cite.exhibitNo}: ${cite.title}`}
      onClick={() => void open()}
    >
      {cite.exhibitNo}
    </button>
  )
}

/**
 * Summary of Findings paragraphs.
 * Green highlight = Evidence ↔ allegation duty link.
 * Superscript = open exhibit (tooltip shows duty-matched excerpt).
 */
export function SummaryFindingsView({
  text,
  report,
  evidence = [],
  caseId = null,
  paper = false,
  editable = false,
  onChange,
  className,
}: Props) {
  const paragraphs = splitSummaryParagraphs(text)

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
      {paragraphs.map((para, i) => {
        const linked = summaryParagraphIsEvidenceLinked(para, report)
        const cite = resolveSummaryEvidenceCite(para, report, evidence)
        const { body } = stripTrailingSuperscripts(para)
        if (editable && onChange) {
          return (
            <div key={`sum-edit-${i}`} className="relative">
              <textarea
                className={clsx(
                  'input min-h-[4.5rem] w-full font-serif text-sm leading-relaxed',
                  linked &&
                    'border-emerald-400/70 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-500/30 dark:border-emerald-600 dark:bg-emerald-950/35 dark:text-emerald-50 dark:ring-emerald-500/25',
                )}
                value={para}
                title={cite?.tooltip || (linked ? LINKED_TITLE : undefined)}
                aria-label={
                  linked
                    ? `Summary finding ${i + 1} (evidence linked to allegation)`
                    : `Summary finding ${i + 1}`
                }
                onChange={(e) => updateParagraph(i, e.target.value)}
              />
              {cite && caseId ? (
                <div className="mt-1">
                  <ExhibitSuperscriptLink cite={cite} caseId={caseId} />
                  <span className="ml-1 font-sans text-[11px] text-ink-400">
                    Exhibit #{cite.exhibitNo}
                  </span>
                </div>
              ) : null}
            </div>
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
            <span className="font-serif">
              <HighlightedProse
                text={body}
                paper={paper}
                inline
                className={
                  paper
                    ? 'text-[12pt] leading-[1.45] text-black'
                    : 'text-sm leading-relaxed text-ink-800 dark:text-ink-100'
                }
              />
              {cite ? <ExhibitSuperscriptLink cite={cite} caseId={caseId} paper={paper} /> : null}
            </span>
          </div>
        )
      })}
      {editable && onChange ? (
        <button
          type="button"
          className="btn-ghost !h-8 !px-2.5 text-xs"
          onClick={() =>
            onChange(
              `${text.trim()}\n\nReview of a document titled "[title]", dated [document date], showed [excerpt from the record].`,
            )
          }
        >
          Add paragraph
        </button>
      ) : null}
    </div>
  )
}
