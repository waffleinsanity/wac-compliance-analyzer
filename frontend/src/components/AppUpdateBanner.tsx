import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'

const VERSION_URL = '/api/version'
const POLL_MS = 45_000
const STORAGE_DISMISS = 'wacmakr.app.dismissedUpdateVersion'
export const APP_ASSET_STALE_EVENT = 'wacmakr:asset-stale'

type VersionPayload = { version?: string }

async function fetchServerVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(VERSION_URL, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as VersionPayload | null
    return data?.version?.trim() || null
  } catch {
    return null
  }
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(STORAGE_DISMISS) ?? sessionStorage.getItem(STORAGE_DISMISS)
  } catch {
    return null
  }
}

function writeDismissed(version: string) {
  try {
    localStorage.setItem(STORAGE_DISMISS, version)
  } catch {
    try {
      sessionStorage.setItem(STORAGE_DISMISS, version)
    } catch {
      /* ignore */
    }
  }
}

function clearDismissed() {
  try {
    localStorage.removeItem(STORAGE_DISMISS)
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(STORAGE_DISMISS)
  } catch {
    /* ignore */
  }
}

/** Polls deploy version and offers a non-forced refresh when a new build lands. */
export function AppUpdateBanner() {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const pageBaselineRef = useRef<string | null>(null)

  const showUpdate = useCallback((serverVersion: string) => {
    if (readDismissed() === serverVersion) {
      setUpdateVersion(null)
      return
    }
    setUpdateVersion(serverVersion)
  }, [])

  const applyUpdate = useCallback(() => {
    setUpdating(true)
    // Keep dismiss cleared for this version so a failed load can re-prompt,
    // but never touch auth tokens — session lives in localStorage across reload.
    clearDismissed()
    const url = new URL(window.location.href)
    url.searchParams.set('_v', String(Date.now()))
    // Full navigation so the browser fetches the new index/assets; auth JWT stays put.
    window.location.replace(url.toString())
  }, [])

  const dismiss = useCallback(() => {
    if (updateVersion) writeDismissed(updateVersion)
    setUpdateVersion(null)
  }, [updateVersion])

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    const controllers = new Set<AbortController>()

    const schedule = (delay: number) => {
      if (cancelled) return
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void check()
      }, delay)
    }

    const check = async () => {
      const controller = new AbortController()
      controllers.add(controller)
      const serverVersion = await fetchServerVersion(controller.signal)
      controllers.delete(controller)
      if (cancelled || !serverVersion) {
        schedule(POLL_MS)
        return
      }
      if (!pageBaselineRef.current) {
        pageBaselineRef.current = serverVersion
      } else if (serverVersion !== pageBaselineRef.current) {
        showUpdate(serverVersion)
      }
      schedule(POLL_MS)
    }

    const onFocus = () => {
      void check()
    }
    const onStale = () => {
      void (async () => {
        const v = await fetchServerVersion()
        if (v) showUpdate(v)
        else setUpdateVersion('new-assets')
      })()
    }

    void check()
    window.addEventListener('focus', onFocus)
    window.addEventListener(APP_ASSET_STALE_EVENT, onStale)
    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
      controllers.forEach((c) => c.abort())
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(APP_ASSET_STALE_EVENT, onStale)
    }
  }, [showUpdate])

  if (!updateVersion) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[60] border-b border-tide-700 bg-tide-700 px-4 py-2.5 text-white shadow-lg dark:border-tide-300 dark:bg-tide-300 dark:text-ink-950">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="font-semibold">A new WACMAKR build is available</p>
          <p className="text-xs text-white/90 dark:text-ink-900/85">
            Update now to load the latest UI. You stay signed in.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink-900 dark:bg-ink-950 dark:text-tide-200"
            disabled={updating}
            onClick={applyUpdate}
          >
            {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Update now
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-white/90 hover:bg-white/10 dark:text-ink-900 dark:hover:bg-ink-950/10"
            disabled={updating}
            onClick={dismiss}
            aria-label="Later"
          >
            <X className="h-3.5 w-3.5" />
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
