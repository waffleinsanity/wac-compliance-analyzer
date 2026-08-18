import { useEffect, useState, type FormEvent } from 'react'
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
  const [publicRegister, setPublicRegister] = useState(true)
  const [inviteSignup, setInviteSignup] = useState(true)
  const [inviteCode, setInviteCode] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [googleOk, cfg] = await Promise.all([
        fetchGoogleSignInEnabled(),
        fetch('/api/auth/config')
          .then(async (r) =>
            r.ok
              ? ((await r.json()) as {
                  allow_public_registration?: boolean
                  allow_invite_signup?: boolean
                })
              : null,
          )
          .catch(() => null),
      ])
      if (cancelled) return
      setGoogleEnabled(googleOk)
      if (cfg && typeof cfg.allow_public_registration === 'boolean') {
        setPublicRegister(cfg.allow_public_registration)
      }
      if (cfg && typeof cfg.allow_invite_signup === 'boolean') {
        setInviteSignup(cfg.allow_invite_signup)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true })
  }, [loading, user, navigate])

  const canRegister = publicRegister || inviteSignup

  useEffect(() => {
    if (!canRegister && mode === 'register') setMode('login')
  }, [canRegister, mode])

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

    const linked = searchParams.get('google_linked') === '1'
    setCompletingGoogle(true)
    setToken(token)
    void (async () => {
      try {
        await refresh()
        if (linked) {
          setInfo('Google account linked. You can sign in with Google next time.')
        }
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
        await register(username, password, email, inviteCode.trim() || undefined)
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
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,_hsl(220_16%_96%)_0%,_hsl(220_14%_92%)_100%)] dark:bg-[linear-gradient(180deg,_hsl(220_16%_10%)_0%,_hsl(220_16%_8%)_100%)]"
        aria-hidden
      />

      <div className="relative w-full max-w-md animate-rise">
        <div className="mb-8 text-center">
          <h1 className="brand-mark mx-auto text-[2rem]">WACMAKR</h1>
          <div className="brand-rule mx-auto" aria-hidden />
          <p className="mt-3 text-sm text-ink-500">
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

          <form className="login-stack mt-6" onSubmit={submit}>
            {mode !== 'forgot' && googleEnabled && (
              <>
                <GoogleSignInButton
                  disabled={busy}
                  buttonText="signin_with"
                  onError={setError}
                />
                <div className="flex w-full items-center gap-3 text-xs text-ink-400">
                  <span className="h-px min-w-0 flex-1 bg-ink-200 dark:bg-ink-700" />
                  or with password
                  <span className="h-px min-w-0 flex-1 bg-ink-200 dark:bg-ink-700" />
                </div>
              </>
            )}
            {mode !== 'forgot' && (
              <div className="w-full">
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
              <div className="w-full">
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
              <div className="w-full">
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
            {mode === 'register' && (
              <div className="w-full">
                <label className="label" htmlFor="login-invite">
                  Invite code {publicRegister ? '(optional)' : '(required)'}
                </label>
                <input
                  id="login-invite"
                  className="input"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required={!publicRegister}
                  autoComplete="off"
                  placeholder="Provided by an administrator"
                />
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
                {canRegister && (
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
                )}
                {!canRegister && googleEnabled && (
                  <p className="text-xs text-ink-400">
                    New investigators: use Sign in with Google. Admins can also create accounts.
                  </p>
                )}
              </>
            )}
            {mode === 'register' && canRegister && (
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
