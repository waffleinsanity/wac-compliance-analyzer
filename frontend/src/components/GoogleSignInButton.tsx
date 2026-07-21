type Props = {
  disabled?: boolean
  buttonText?: 'signin_with' | 'continue_with' | 'signup_with'
  width?: number
  onError?: (message: string) => void
}

const LABEL: Record<NonNullable<Props['buttonText']>, string> = {
  signin_with: 'Sign in with Google',
  continue_with: 'Continue with Google',
  signup_with: 'Sign up with Google',
}

/** Show Google OAuth only when VITE_GOOGLE_SIGNIN=true and backend OAuth is configured. */
export const isGoogleSignInEnabled = import.meta.env.VITE_GOOGLE_SIGNIN === 'true'

/**
 * Always start OAuth on 127.0.0.1 — Google treats localhost as a different redirect URI.
 * Port follows the current UI port (default 5173).
 */
export function googleStartHref(): string {
  if (typeof window === 'undefined') return '/api/auth/google/start'
  const port = window.location.port || '5173'
  return `http://127.0.0.1:${port}/api/auth/google/start`
}

export function GoogleSignInButton({
  disabled,
  buttonText = 'continue_with',
  width = 320,
}: Props) {
  if (!isGoogleSignInEnabled) {
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
        // Force 127.0.0.1 even if the user opened the app via localhost.
        e.preventDefault()
        window.location.assign(googleStartHref())
      }}
      className="inline-flex items-center justify-center gap-3 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-800 shadow-sm transition hover:bg-ink-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-50 dark:hover:bg-ink-800"
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
