import { useEffect, useState, type FormEvent } from 'react'
import { FileCheck2 } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, setToken } from '../api'
import { useAuth } from '../auth'
import { GoogleSignInButton, fetchGoogleSignInEnabled } from './GoogleSignInButton'

type Mode = 'login' | 'register' | 'forgot'

/** Survive Strict Mode so the Google token is only consumed once. */
let googleReturnHandled = false

export function LoginPage() {
  const { user, loading, login, register, refresh } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [completingGoogle, setCompletingGoogle] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchGoogleSignInEnabled().then((ok) => {
      if (!cancelled) setGoogleEnabled(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true })
  }, [loading, user, navigate])

  // Complete server-side Google OAuth return: /login?google_token=... or google_error=...
  useEffect(() => {
    if (googleReturnHandled || loading) return
    const token = searchParams.get('google_token')
    const googleError = searchParams.get('google_error')
    if (!token && !googleError) return
    googleReturnHandled = true
    navigate('/login', { replace: true })

    if (googleError) {
      setError(
        googleError === 'access_denied' ? 'Google sign-in was cancelled.' : googleError,
      )
      return
    }

    setCompletingGoogle(true)
    setToken(token)
    void (async () => {
      try {
        await refresh()
        navigate('/', { replace: true })
      } catch (err) {
        setToken(null)
        setError(err instanceof Error ? err.message : 'Google sign-in failed')
      } finally {
        setCompletingGoogle(false)
      }
    })()
  }, [loading, navigate, refresh, searchParams])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    try {
      if (mode === 'login') {
        await login(username, password)
        navigate('/', { replace: true })
      } else if (mode === 'register') {
        await register(username, password, email)
        navigate('/', { replace: true })
      } else {
        const res = await api.forgotPassword(email)
        setInfo(res.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading || completingGoogle) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-ink-500">
        {completingGoogle ? 'Completing Google sign-in…' : 'Checking session…'}
      </div>
    )
  }

  const title =
    mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Reset password'

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(31,127,120,0.14),_transparent_55%),linear-gradient(180deg,_#f3f6f8_0%,_#e8eef2_100%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(31,127,120,0.18),_transparent_50%),linear-gradient(180deg,_#12171e_0%,_#1a222c_100%)]"
        aria-hidden
      />

      <div className="relative w-full max-w-md animate-rise">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-tide-600 text-white shadow-soft">
            <FileCheck2 className="h-7 w-7" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink-900 dark:text-ink-50">
            WACMAKR
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Sign in to access investigation workflows and case tools.
          </p>
        </div>

        <div className="panel p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-ink-500">
            {mode === 'forgot'
              ? 'We will email a reset link if that address is registered.'
              : googleEnabled
                ? 'Sign in with Google, or use your username and password.'
                : 'Sign in with your username and password.'}
          </p>

          {mode !== 'forgot' && googleEnabled && (
            <div className="mt-6 space-y-4">
              <GoogleSignInButton
                disabled={busy}
                buttonText="signin_with"
                width={352}
                onError={setError}
              />
              <div className="flex items-center gap-3 text-xs text-ink-400">
                <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
                or with password
                <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
              </div>
            </div>
          )}

          <form className="mt-4 space-y-3" onSubmit={submit}>
            {mode !== 'forgot' && (
              <div>
                <label className="label" htmlFor="login-username">
                  Username
                </label>
                <input
                  id="login-username"
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
            )}
            {(mode === 'register' || mode === 'forgot') && (
              <div>
                <label className="label" htmlFor="login-email">
                  Email
                </label>
                <input
                  id="login-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            )}
            {mode !== 'forgot' && (
              <div>
                <label className="label" htmlFor="login-password">
                  Password
                </label>
                <input
                  id="login-password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === 'register' ? 10 : 1}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
                {mode === 'register' && (
                  <p className="mt-1 text-xs text-ink-400">At least 10 characters.</p>
                )}
              </div>
            )}
            {error && <p className="text-sm text-rose-600 whitespace-pre-wrap">{error}</p>}
            {info && <p className="text-sm text-tide-700 dark:text-tide-300">{info}</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'register'
                    ? 'Create account'
                    : 'Send reset link'}
            </button>
          </form>

          <div className="mt-5 flex flex-col gap-2 text-sm">
            {mode === 'login' && (
              <>
                <button
                  type="button"
                  className="text-left text-tide-600 hover:underline"
                  onClick={() => {
                    setMode('forgot')
                    setError('')
                    setInfo('')
                  }}
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  className="text-left text-tide-600 hover:underline"
                  onClick={() => {
                    setMode('register')
                    setError('')
                    setInfo('')
                  }}
                >
                  Need an account? Register
                </button>
              </>
            )}
            {mode === 'register' && (
              <button
                type="button"
                className="text-left text-tide-600 hover:underline"
                onClick={() => {
                  setMode('login')
                  setError('')
                  setInfo('')
                }}
              >
                Already registered? Sign in
              </button>
            )}
            {mode === 'forgot' && (
              <button
                type="button"
                className="text-left text-tide-600 hover:underline"
                onClick={() => {
                  setMode('login')
                  setError('')
                  setInfo('')
                }}
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-ink-400">
          Authorized use only.{' '}
          <Link to="/reset-password" className="text-tide-600 hover:underline">
            Have a reset token?
          </Link>
        </p>
      </div>
    </div>
  )
}
