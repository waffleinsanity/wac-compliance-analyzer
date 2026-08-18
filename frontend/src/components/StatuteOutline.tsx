import { parseStatuteOutline } from '../statuteOutline'

type Props = {
  text: string
  emptyLabel?: string
}

export function StatuteOutline({
  text,
  emptyLabel = 'Full approved code text is not available for this selection.',
}: Props) {
  const outline = parseStatuteOutline(text)
  if (!outline.lead && outline.items.length === 0) {
    return <p className="font-sans text-sm text-ink-400">{emptyLabel}</p>
  }

  return (
    <div className="statute-outline" role="region" aria-label="Full selected code text">
      {outline.lead ? <p className="statute-outline-lead">{outline.lead}</p> : null}
      {outline.items.map((item, i) => (
        <div
          key={`${item.label}-${i}`}
          className="statute-outline-row"
          style={{ paddingLeft: `${item.depth * 1.15}rem` }}
        >
          <span className="statute-outline-label text-tide-800 dark:text-tide-300">{item.label}</span>
          <span className="statute-outline-body">{item.body}</span>
        </div>
      ))}
    </div>
  )
}
