import clsx from 'clsx'
import { Plus, Check } from 'lucide-react'
import { sanitizeSubsectionLabel } from '../allegationFormat'
import { outlineItemFullLabel, parseStatuteOutline } from '../statuteOutline'

type Props = {
  text: string
  emptyLabel?: string
  /** Full subsection labels currently in the allegation, e.g. "(2)", "(4)(a)". */
  selectedLabels?: Set<string>
  onToggleDuty?: (fullLabel: string) => void
  busy?: boolean
  pendingLabel?: string | null
}

function labelIsSelected(selectedLabels: Set<string> | undefined, fullLabel: string): boolean {
  if (!selectedLabels?.size) return false
  const want = sanitizeSubsectionLabel(fullLabel)
  if (!want) return false
  if (selectedLabels.has(fullLabel) || selectedLabels.has(want)) return true
  for (const label of selectedLabels) {
    if (sanitizeSubsectionLabel(label) === want) return true
  }
  return false
}

export function StatuteOutline({
  text,
  emptyLabel = 'Full approved code text is not available for this selection.',
  selectedLabels,
  onToggleDuty,
  busy = false,
  pendingLabel = null,
}: Props) {
  const outline = parseStatuteOutline(text)
  const interactive = Boolean(onToggleDuty)

  if (!outline.lead && outline.items.length === 0) {
    return <p className="font-sans text-sm text-ink-400">{emptyLabel}</p>
  }

  return (
    <div className="statute-outline" role="region" aria-label="Full selected code text">
      {interactive && outline.items.length > 0 ? (
        <p className="statute-outline-hint">
          Add any subsection below to the allegation duties above.
        </p>
      ) : null}
      {outline.lead ? <p className="statute-outline-lead">{outline.lead}</p> : null}
      {outline.items.map((item, i) => {
        const fullLabel = outlineItemFullLabel(outline.items, i)
        const selected = labelIsSelected(selectedLabels, fullLabel)
        const pending =
          pendingLabel != null &&
          sanitizeSubsectionLabel(pendingLabel) === sanitizeSubsectionLabel(fullLabel)
        return (
          <div
            key={`${fullLabel}-${i}`}
            className={clsx(
              'statute-outline-row',
              selected && 'statute-outline-row-selected',
            )}
            style={{ paddingLeft: `${item.depth * 1.15}rem` }}
          >
            <span className="statute-outline-label text-tide-800 dark:text-tide-300">
              {item.label}
            </span>
            <span className="statute-outline-body">{item.body}</span>
            {interactive ? (
              <button
                type="button"
                className={clsx(
                  'statute-outline-action',
                  selected && 'statute-outline-action-selected',
                )}
                disabled={busy || pending}
                onClick={() => onToggleDuty?.(fullLabel)}
                aria-pressed={selected}
                title={
                  selected
                    ? 'Remove from allegation duties'
                    : 'Add to allegation duties'
                }
              >
                {pending ? (
                  '…'
                ) : selected ? (
                  <>
                    <Check className="h-3 w-3 text-tide-800 dark:text-tide-300" aria-hidden />
                    <span className="text-tide-800 dark:text-tide-300">In allegation</span>
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3" aria-hidden />
                    <span>Add</span>
                  </>
                )}
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
