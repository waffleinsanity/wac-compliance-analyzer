import { useEffect } from 'react'
import { APP_ASSET_STALE_EVENT } from './AppUpdateBanner'

/**
 * When Vite chunks fail to load after a deploy, notify the update banner
 * instead of forcing a hard logout/reload loop.
 */
export function ChunkLoadErrorHandler() {
  useEffect(() => {
    const notify = () => {
      window.dispatchEvent(new Event(APP_ASSET_STALE_EVENT))
    }
    const onError = (event: ErrorEvent) => {
      const msg = String(event.message || '')
      const src = String((event.target as HTMLElement | null)?.getAttribute?.('src') || '')
      if (
        /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module/i.test(msg) ||
        (/\/assets\//.test(src) && event.target instanceof HTMLScriptElement)
      ) {
        notify()
      }
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = String(event.reason?.message || event.reason || '')
      if (/Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module/i.test(reason)) {
        notify()
      }
    }
    window.addEventListener('error', onError, true)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError, true)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
