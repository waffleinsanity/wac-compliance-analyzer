import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatSavedClock } from '../draftBackup'
import type { CaseSnapshot } from '../api'

type Props = {
  snapshots: CaseSnapshot[]
  disabled?: boolean
  busy?: boolean
  onRestore: (snapshotId: number) => void
}

/**
 * Server draft recall. Menu is portaled + fixed so Documents overflow parents
 * cannot clip it (that looked like "cannot pull up saved drafts").
 */
export function DraftRecallMenu({ snapshots, disabled = false, busy = false, onRestore }: Props) {
  const items = snapshots.slice(0, 16)
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const menuId = useId()

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPos(null)
      return
    }
    const rect = buttonRef.current.getBoundingClientRect()
    const width = 288
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
    setPos({ top: rect.bottom + 4, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onReposition = () => setOpen(false)
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  if (!items.length) return null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn-ghost !h-8 !px-2.5 text-xs"
        title="Restore a prior draft"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled || busy}
        onClick={() => setOpen((v) => !v)}
      >
        Recall
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            className="fixed z-[45] max-h-72 w-72 overflow-y-auto rounded-md border border-ink-200 bg-card p-1 shadow-lg dark:border-ink-700"
            style={{ top: pos.top, left: pos.left }}
          >
            <p className="px-2 py-1 font-sans text-[11px] text-ink-500">
              Server recall points. Restoring saves the current draft first.
            </p>
            {items.map((s) => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                className="btn-ghost w-full !justify-start !px-2.5 !py-1.5 text-left text-xs"
                disabled={disabled || busy}
                onClick={() => {
                  const when = formatSavedClock(s.created_at)
                  const label = s.note ? `${s.note}` : 'Draft'
                  if (
                    window.confirm(
                      `Restore version ${s.version}${when ? ` (${when})` : ''} (${label})? Current work is saved first.`,
                    )
                  ) {
                    setOpen(false)
                    onRestore(s.id)
                  }
                }}
              >
                <span className="font-mono">v{s.version}</span>
                <span className="ml-1.5 text-ink-500">
                  {formatSavedClock(s.created_at) || 'undated'}
                </span>
                {s.note ? (
                  <span className="mt-0.5 block truncate text-[11px] text-ink-400">{s.note}</span>
                ) : null}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
