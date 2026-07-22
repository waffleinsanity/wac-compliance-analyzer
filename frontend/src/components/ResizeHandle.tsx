import clsx from 'clsx'
import type { KeyboardEvent, PointerEventHandler } from 'react'

type Props = {
  /** Side of the panel the handle is attached to. */
  edge: 'left' | 'right'
  label: string
  onPointerDown: PointerEventHandler<HTMLDivElement>
  onNudge: (delta: number) => void
  className?: string
}

/** Vertical drag handle for resizable side panels. */
export function ResizeHandle({ edge, label, onPointerDown, onNudge, className }: Props) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 24 : 12
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onNudge(edge === 'right' ? -step : step)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onNudge(edge === 'right' ? step : -step)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      title={`${label} — drag to resize`}
      className={clsx(
        'group absolute top-0 z-30 hidden h-full w-3 cursor-col-resize touch-none md:block',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tide-500/50',
        edge === 'right' ? '-right-1.5' : '-left-1.5',
        className,
      )}
    >
      <span
        className={clsx(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition',
          'group-hover:bg-tide-500/50 group-active:bg-tide-500/70 group-focus-visible:bg-tide-500/60',
        )}
      />
    </div>
  )
}
