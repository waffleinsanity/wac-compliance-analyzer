import { useEffect, useState } from 'react'

type Props = {
  disabled?: boolean
  buttonText?: 'signin_with' | 'continue_with' | 'signup_with'
  width?: number | string
  onError?: (message: string) => void
}

const LABEL: Record<NonNullable<Props['buttonText']>, string> = {
  signin_with: 'Sign in with Google',
  continue_with: 'Continue with Google',
  signup_with: 'Sign up with Google',
}

type GoogleStatus = {
  enabled: boolean
  redirect_uri?: string | null
}

/** Relative start path — works for Vite proxy (local) and same-origin Railway. */
export const GOOGLE_START_PATH = '/api/auth/google/start'

/**
 * Always same-origin relative. Do not rewrite localhost → 127.0.0.1: Vite may only
 * be bound to ::1/localhost, and Cursor's Simple Browser then gets ERR_CONNECTION_REFUSED.
 */
export function googleStartHref(): string {
  return GOOGLE_START_PATH
}

export async function fetchGoogleSignInEnabled(): Promise<boolean> {
  // Build-time override (local Vite) still works, but live builds rely on API status.
  if (import.meta.env.VITE_GOOGLE_SIGNIN === 'true') return true
  if (import.meta.env.VITE_GOOGLE_SIGNIN === 'false') return false
  try {
    const res = await fetch('/api/auth/google/status')
    if (!res.ok) return false
    const data = (await res.json()) as GoogleStatus
    return Boolean(data.enabled)
  } catch {
    return false
  }
}

/** @deprecated use fetchGoogleSignInEnabled — kept for LoginPage first paint */
export const isGoogleSignInEnabled = import.meta.env.VITE_GOOGLE_SIGNIN !== 'false'

export function GoogleSignInButton({
  disabled,
  buttonText = 'continue_with',
  width = '100%',
  onError,
}: Props) {
  const [ready, setReady] = useState(import.meta.env.VITE_GOOGLE_SIGNIN === 'true')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = await fetchGoogleSignInEnabled()
      if (!cancelled) setReady(ok)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) {
    return null
  }

  return (
    <a
      href={googleStartHref()}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault()
          return
        }
        e.preventDefault()
        try {
          window.location.assign(googleStartHref())
        } catch (err) {
          onError?.(err instanceof Error ? err.message : 'Google sign-in failed')
        }
      }}
      className="inline-flex h-10 w-full items-center justify-center gap-3 rounded-md border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 shadow-sm transition hover:bg-ink-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-50 dark:hover:bg-ink-800"
      style={{ width, maxWidth: '100%' }}
    >
      <GoogleGlyph />
      {LABEL[buttonText]}
    </a>
  )
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}
