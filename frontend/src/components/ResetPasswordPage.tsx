import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = useMemo(() => params.get('token') || '', [params])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (!token) throw new Error('Missing reset token')
      if (password !== confirm) throw new Error('Passwords do not match')
      if (password.length < 10) throw new Error('Password must be at least 10 characters')
      await api.resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="panel w-full max-w-md p-6">
        <h1 className="font-display text-2xl">Reset password</h1>
        <p className="mt-1 text-sm text-ink-500">Choose a new password for your account.</p>

        {done ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-tide-700 dark:text-tide-300">
              Password updated. You can sign in with your new password.
            </p>
            <Link to="/login" className="btn-primary inline-flex">
              Sign in
            </Link>
          </div>
        ) : (
          <form className="mt-6 space-y-3" onSubmit={submit}>
            <div>
              <label className="label">New password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">Confirm password</label>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={10}
                autoComplete="new-password"
              />
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy || !token}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
            <Link to="/login" className="block text-center text-sm text-tide-600 hover:underline">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
