import { useEffect, useState, type FormEvent } from 'react'
import { api, type AuditLogEntry } from '../api'
import { useAuth } from '../auth'
import { roleLabel } from '../permissions'

type Props = {
  open: boolean
  onClose: () => void
  forcePasswordChange?: boolean
}

export function AccountSettings({ open, onClose, forcePasswordChange = false }: Props) {
  const { user, refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState<AuditLogEntry[]>([])

  useEffect(() => {
    if (open && user) {
      setEmail(user.email || '')
      setDisplayName(user.display_name || '')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setError('')
      setInfo('')
      if (!forcePasswordChange) {
        void api.myActivity(12).then(setActivity).catch(() => setActivity([]))
      }
    }
  }, [open, user, forcePasswordChange])

  if (!open || !user) return null

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await api.updateProfile({
        email: email.trim(),
        display_name: displayName.trim() || null,
      })
      await refresh()
      setInfo('Profile updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setBusy(false)
    }
  }

  const savePassword = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    try {
      if (newPassword !== confirmPassword) {
        throw new Error('New passwords do not match')
      }
      if (newPassword.length < 10) {
        throw new Error('Password must be at least 10 characters')
      }
      await api.changePassword(newPassword, user.has_password ? currentPassword : undefined)
      await refresh()
      setInfo('Password updated.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      if (forcePasswordChange) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm">
      <div className="panel max-h-[90vh] w-full max-w-lg animate-rise overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl">
              {forcePasswordChange ? 'Change temporary password' : 'Account settings'}
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              Signed in as <span className="font-mono font-semibold">{user.username}</span>
              {' · '}
              {roleLabel(user.role, user.is_admin)}
            </p>
          </div>
          {!forcePasswordChange && (
            <button type="button" className="btn-secondary !px-3 !py-1.5" onClick={onClose}>
              Close
            </button>
          )}
        </div>

        {forcePasswordChange && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            An administrator set a temporary password. Choose a new password before continuing.
          </p>
        )}

        {!forcePasswordChange && (
          <>
            <div className="mb-6 rounded-xl border border-ink-200/80 bg-ink-50/60 px-3 py-3 text-sm dark:border-ink-700 dark:bg-ink-900/40">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Sign-in methods</div>
              <ul className="mt-2 space-y-1 text-ink-600 dark:text-ink-300">
                <li>Password: {user.has_password ? 'Set' : 'Not set'}</li>
                <li>Google: {user.has_google ? 'Linked' : 'Not linked'}</li>
              </ul>
              {!user.has_google && (
                <button
                  type="button"
                  className="btn-secondary mt-3"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true)
                      setError('')
                      setInfo('')
                      try {
                        const { authorize_url } = await api.prepareGoogleLink()
                        window.location.assign(authorize_url)
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to start Google link')
                        setBusy(false)
                      }
                    })()
                  }}
                >
                  Link Google account
                </button>
              )}
              {!user.has_google && (
                <p className="mt-2 text-xs text-ink-400">
                  Sign in with your Google account to attach it to <span className="font-mono">{user.username}</span>.
                  After linking, Google sign-in opens this same account (including admin).
                </p>
              )}
            </div>

            <form className="mb-6 space-y-3 border-b border-ink-200/70 pb-6 dark:border-ink-700" onSubmit={saveProfile}>
              <h3 className="font-semibold">Profile</h3>
              <div>
                <label className="label">Display name</label>
                <input
                  className="input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={128}
                  placeholder="Shown in admin triage"
                />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn-secondary" disabled={busy}>
                Save profile
              </button>
            </form>
          </>
        )}

        <form className="space-y-3" onSubmit={savePassword}>
          <h3 className="font-semibold">{user.has_password ? 'Change password' : 'Set a password'}</h3>
          {user.has_password && !forcePasswordChange && (
            <div>
              <label className="label">Current password</label>
              <input
                className="input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          )}
          <div>
            <label className="label">New password</label>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={10}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={10}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {info && <p className="text-sm text-tide-700 dark:text-tide-300">{info}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>

        {!forcePasswordChange && activity.length > 0 && (
          <div className="mt-6 border-t border-ink-200/70 pt-4 dark:border-ink-700">
            <h3 className="font-semibold">Recent activity</h3>
            <ul className="mt-2 space-y-1.5 text-xs text-ink-500">
              {activity.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="shrink-0 font-mono">{a.created_at?.slice(0, 16).replace('T', ' ')}</span>
                  <span className="truncate">{a.action}{a.details ? ` — ${a.details}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
