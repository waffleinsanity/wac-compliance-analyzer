import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Props = {
  edge: 'left' | 'right'
  panelLabel: string
  open: boolean
  onToggle: () => void
  /** Collapsed strip beside main content (panel hidden). */
  collapsedStrip?: boolean
  className?: string
}

/** Edge control to hide or restore a desktop sidebar rail. */
export function RailEdgeToggle({
  edge,
  panelLabel,
  open,
  onToggle,
  collapsedStrip = false,
  className,
}: Props) {
  const hideLabel = `Hide ${panelLabel}`
  const showLabel = `Show ${panelLabel}`
  const label = open ? hideLabel : showLabel
  const Icon = open
    ? edge === 'left'
      ? ChevronLeft
      : ChevronRight
    : edge === 'left'
      ? ChevronRight
      : ChevronLeft

  if (collapsedStrip) {
    return (
      <div
        className={clsx(
          'rail-edge-strip shrink-0 border-ink-200 bg-card dark:border-ink-700',
          edge === 'left' ? 'border-r' : 'border-l',
          className,
        )}
      >
        <button
          type="button"
          className="rail-edge-toggle rail-edge-toggle--strip"
          onClick={onToggle}
          aria-label={showLabel}
          title={showLabel}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={clsx(
        'rail-edge-toggle rail-edge-toggle--floating',
        edge === 'left' ? 'rail-edge-toggle--left' : 'rail-edge-toggle--right',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
}
