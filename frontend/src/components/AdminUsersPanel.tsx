import { useCallback, useEffect, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { api, type User, type UserRole } from '../api'
import { ROLES, normalizeRole, roleLabel } from '../permissions'

export function AdminUsersPanel() {
  const [users, setUsers] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [tempPassword, setTempPassword] = useState<{ username: string; password: string } | null>(null)
  const [newUsername, setNewUsername] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('editor')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async (q?: string) => {
    setError('')
    try {
      setUsers(await api.listUsers(q))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load(search)
    }, 250)
    return () => window.clearTimeout(t)
  }, [search, load])

  const patch = async (
    userId: number,
    body: { is_active?: boolean; role?: UserRole | string },
  ) => {
    setBusyId(userId)
    setError('')
    setInfo('')
    try {
      await api.updateUser(userId, body)
      await load(search)
      setInfo('User updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const issueTemp = async (userId: number) => {
    setBusyId(userId)
    setError('')
    setInfo('')
    setTempPassword(null)
    try {
      const res = await api.setTempPassword(userId)
      setTempPassword({ username: res.username, password: res.temporary_password })
      await load(search)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set temporary password')
    } finally {
      setBusyId(null)
    }
  }

  const createUser = async (e: FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError('')
    setInfo('')
    setTempPassword(null)
    try {
      const res = await api.createUser({
        username: newUsername.trim(),
        email: newEmail.trim(),
        display_name: newDisplayName.trim() || undefined,
        role: newRole,
      })
      setTempPassword({ username: res.username, password: res.temporary_password })
      setNewUsername('')
      setNewEmail('')
      setNewDisplayName('')
      setNewRole('editor')
      await load(search)
      setInfo('User created. Share the temporary password securely.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="animate-rise space-y-4">
      <div>
        <h2 className="font-display text-3xl tracking-tight">User accounts</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-500">
          Assign Admin, Editor, or Viewer. Temporary passwords are shown once — share them securely.
        </p>
        <ul className="mt-3 grid gap-2 text-xs text-ink-500 sm:grid-cols-3">
          {ROLES.map((r) => (
            <li key={r.value} className="rounded-lg border border-ink-200/70 px-3 py-2 dark:border-ink-700">
              <div className="font-semibold text-ink-700 dark:text-ink-200">{r.label}</div>
              <div className="mt-0.5">{r.description}</div>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {info && <p className="text-sm text-tide-700 dark:text-tide-300">{info}</p>}

      {tempPassword && (
        <div className="rounded-xl border border-tide-500/30 bg-tide-500/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-tide-700 dark:text-tide-300">
            Temporary password (copy now)
          </div>
          <p className="mt-1 text-sm">
            User <span className="font-mono font-semibold">{tempPassword.username}</span>
          </p>
          <p className="mt-2 select-all rounded-lg bg-card px-3 py-2 font-mono text-sm">
            {tempPassword.password}
          </p>
          <button type="button" className="btn-ghost mt-2 !px-2 text-xs" onClick={() => setTempPassword(null)}>
            Dismiss
          </button>
        </div>
      )}

      <form className="panel grid gap-3 p-4 md:grid-cols-2" onSubmit={(e) => void createUser(e)}>
        <div className="md:col-span-2">
          <h3 className="font-semibold">Create user</h3>
        </div>
        <div>
          <label className="label">Username</label>
          <input
            className="input"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            required
            minLength={3}
            pattern="[a-zA-Z0-9._-]{3,64}"
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Display name</label>
          <input className="input" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>

      <div className="flex items-center gap-2">
        <input
          className="input max-w-md"
          placeholder="Search username, email, role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-ink-200/80 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-700">
            <tr>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const role = normalizeRole(u.role, u.is_admin)
              return (
                <tr key={u.id} className="border-b border-ink-100 dark:border-ink-800">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold">{u.username}</div>
                    {u.display_name && <div className="text-xs text-ink-500">{u.display_name}</div>}
                    <div className="text-xs text-ink-400">
                      {u.has_google ? 'Google' : ''}
                      {u.has_google && u.has_password ? ' · ' : ''}
                      {u.has_password ? 'Password' : u.has_google ? '' : 'No login method'}
                      {u.must_change_password ? ' · must change password' : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{u.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        'status-chip',
                        u.is_active ? 'status-chip-ready' : 'status-chip-warn',
                      )}
                    >
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="input !h-8 !w-auto !py-0 text-xs"
                      value={role}
                      disabled={busyId === u.id}
                      onChange={(e) => void patch(u.id, { role: e.target.value })}
                      title={roleLabel(role)}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="btn-ghost !h-8 !px-2 text-xs"
                        disabled={busyId === u.id}
                        onClick={() => patch(u.id, { is_active: !u.is_active })}
                      >
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !h-8 !px-2 text-xs"
                        disabled={busyId === u.id || !u.is_active}
                        onClick={() => issueTemp(u.id)}
                      >
                        Temp password
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!users.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-400">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
