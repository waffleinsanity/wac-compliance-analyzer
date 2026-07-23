import { Navigate, useLocation } from 'react-router-dom'
import { getToken } from '../api'
import { useAuth } from '../auth'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, sessionPending, refresh } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-ink-500">
        Checking session…
      </div>
    )
  }

  if (!user && (sessionPending || getToken())) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Reconnecting to WACMAKR…</p>
        <p className="max-w-sm text-xs text-ink-500">
          Your session is still saved. The API was briefly unreachable (common right after a deploy).
        </p>
        <button type="button" className="btn-secondary !h-8 !px-3 text-xs" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
