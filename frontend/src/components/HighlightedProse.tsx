import clsx from 'clsx'
import { buildHighlightSegments, findRemovalSpans, type RemovalSpan } from '../contentReview'

type Props = {
  text: string
  spans?: RemovalSpan[]
  className?: string
  /** Render as inline span (facility lines, conclusion phrases). */
  inline?: boolean
}

export function HighlightedProse({ text, spans, className, inline = false }: Props) {
  const resolved = spans ?? findRemovalSpans(text)
  const segments = buildHighlightSegments(text, resolved)
  const Tag = inline ? 'span' : 'p'
  return (
    <Tag
      className={clsx(
        inline
          ? 'break-words font-serif'
          : 'whitespace-pre-wrap break-words font-serif text-sm leading-relaxed text-ink-800 dark:text-ink-100',
        className,
      )}
    >
      {segments.map((seg) =>
        seg.hit ? (
          <mark
            key={seg.key}
            className="rounded-sm bg-amber-300/80 px-0.5 text-ink-950 ring-1 ring-amber-500/40 dark:bg-amber-500/45 dark:text-ink-50"
            title="Remove or replace before submission"
            aria-label="Assistive placeholder: remove or replace before submission"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={seg.key}>{seg.text}</span>
        ),
      )}
    </Tag>
  )
}

type HintProps = {
  text: string
  label?: string
}

/** Preview below an editor field when assistive text remains. */
export function RemovalReviewHint({ text, label }: HintProps) {
  const spans = findRemovalSpans(text)
  if (!spans.length) return null
  return (
    <div
      className="mt-2 rounded-lg border border-amber-400/70 bg-amber-50/90 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/25"
      role="status"
    >
      <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
        {label || 'Remove or replace before submission'}
      </p>
      <HighlightedProse text={text} spans={spans} />
    </div>
  )
}
