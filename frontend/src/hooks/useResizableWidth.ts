import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'

type Options = {
  storageKey: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function readStored(key: string, fallback: number, min: number, max: number) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return clamp(n, min, max)
  } catch {
    return fallback
  }
}

/**
 * Persistable sidebar width with a drag handle.
 * `growEdge`: which side of the panel the handle sits on — dragging away from the
 * panel center increases width.
 */
export function useResizableWidth({ storageKey, defaultWidth, minWidth, maxWidth }: Options) {
  const [width, setWidth] = useState(() => readStored(storageKey, defaultWidth, minWidth, maxWidth))

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(Math.round(width)))
    } catch {
      /* ignore quota / private mode */
    }
  }, [storageKey, width])

  const onResizePointerDown = useCallback(
    (growEdge: 'left' | 'right') => (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startW = width
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const next = growEdge === 'right' ? startW + dx : startW - dx
        setWidth(clamp(next, minWidth, maxWidth))
      }
      const onUp = () => {
        target.releasePointerCapture(e.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [width, minWidth, maxWidth],
  )

  const nudge = useCallback(
    (delta: number) => {
      setWidth((w) => clamp(w + delta, minWidth, maxWidth))
    },
    [minWidth, maxWidth],
  )

  return { width, setWidth, onResizePointerDown, nudge, minWidth, maxWidth }
}
