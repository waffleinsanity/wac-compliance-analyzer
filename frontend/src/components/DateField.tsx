import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatDisplay(d: Date) {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`
}

function parseLooseDate(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const m = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2000
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return d
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

type Props = {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function DateField({
  id,
  value,
  onChange,
  placeholder = 'MM/DD/YYYY',
  className,
  disabled = false,
}: Props) {
  const autoId = useId()
  const inputId = id ?? autoId
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const parsed = useMemo(() => parseLooseDate(value), [value])
  const [view, setView] = useState(() => startOfMonth(parsed ?? new Date()))

  useEffect(() => {
    if (open) setView(startOfMonth(parsed ?? new Date()))
  }, [open, parsed])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = () => {
      const el = rootRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const width = 280
      const gap = 6
      let left = r.left
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
      if (left < 8) left = 8
      let top = r.bottom + gap
      const popH = popoverRef.current?.offsetHeight ?? 320
      if (top + popH > window.innerHeight - 8 && r.top > popH + gap) {
        top = r.top - popH - gap
      }
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const days = useMemo(() => {
    const first = startOfMonth(view)
    const startPad = first.getDay()
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - startPad)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      return d
    })
  }, [view])

  const monthLabel = view.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const today = new Date()

  const popover =
    open && pos
      ? createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Choose date"
            className="fixed z-[200] w-[17.5rem] rounded-xl border border-ink-200/80 bg-card p-3 shadow-panel dark:border-ink-700"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-ghost !h-8 !w-8 !px-0"
                aria-label="Previous month"
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-sm font-semibold text-ink-800 dark:text-ink-100">{monthLabel}</div>
              <button
                type="button"
                className="btn-ghost !h-8 !w-8 !px-0"
                aria-label="Next month"
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-400"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {days.map((d) => {
                const inMonth = d.getMonth() === view.getMonth()
                const selected = parsed ? sameDay(d, parsed) : false
                const isToday = sameDay(d, today)
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    className={clsx(
                      'flex h-8 items-center justify-center rounded-lg text-sm transition',
                      !inMonth && 'text-ink-300 dark:text-ink-600',
                      inMonth &&
                        !selected &&
                        'text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800',
                      selected && 'bg-tide-600 font-semibold text-white hover:bg-tide-600',
                      !selected && isToday && 'ring-1 ring-tide-500/50',
                    )}
                    onClick={() => {
                      onChange(formatDisplay(d))
                      setOpen(false)
                    }}
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-ink-200/70 pt-2 dark:border-ink-700">
              <button
                type="button"
                className="btn-ghost !h-8 !px-2 text-xs"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn-ghost !h-8 !px-2 text-xs text-tide-700 dark:text-tide-300"
                onClick={() => {
                  onChange(formatDisplay(today))
                  setOpen(false)
                }}
              >
                Today
              </button>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <div className="relative">
        <input
          id={inputId}
          className="input pr-10"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (!disabled) setOpen(true)
          }}
          autoComplete="off"
          inputMode="numeric"
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
          readOnly={disabled}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 transition hover:text-tide-600"
          aria-label={open ? 'Close calendar' : 'Open calendar'}
          onClick={() => {
            if (!disabled) setOpen((v) => !v)
          }}
          tabIndex={-1}
          disabled={disabled}
        >
          <Calendar className="h-4 w-4" />
        </button>
      </div>
      {popover}
    </div>
  )
}
