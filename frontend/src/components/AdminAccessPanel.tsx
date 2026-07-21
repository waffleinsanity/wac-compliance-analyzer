import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type AccessRequest, type InviteCode, type UserRole } from '../api'
import { ROLES } from '../permissions'

/** Admin invites, access-request triage, and case retention (Navy EHIP ports). */
export function AdminAccessPanel() {
  const [invites, setInvites] = useState<InviteCode[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [role, setRole] = useState<UserRole>('viewer')
  const [maxUses, setMaxUses] = useState(1)
  const [note, setNote] = useState('')
  const [minted, setMinted] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [retentionInfo, setRetentionInfo] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [inv, req] = await Promise.all([api.listInvites(), api.listAccessRequests('pending')])
      setInvites(inv)
      setRequests(req)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load access tools')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const mint = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    setMinted('')
    try {
      const row = await api.createInvite({
        role,
        max_uses: maxUses,
        note,
        expires_in_days: 14,
      })
      setMinted(row.code)
      setInfo(`Invite created for ${row.role}. Copy the code now.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite')
    } finally {
      setBusy(false)
    }
  }

  const review = async (id: number, status: 'approved' | 'denied') => {
    setBusy(true)
    setError('')
    try {
      await api.reviewAccessRequest(id, { status })
      await load()
      setInfo(`Request ${status}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed')
    } finally {
      setBusy(false)
    }
  }

  const runRetention = async () => {
    setBusy(true)
    setRetentionInfo('')
    setError('')
    try {
      const res = await api.runRetention()
      setRetentionInfo(
        `Retention run: archived ${res.archived}, purged trash ${res.trash_purged} (final>${res.retention_days}d, trash>${res.trash_retention_days}d).`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retention run failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h2 className="font-display text-3xl tracking-tight">Access & ops</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-500">
          Invite codes, role elevation requests, and case retention — adapted from Navy EHIP admin tools.
        </p>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {info && <p className="text-sm text-tide-800 dark:text-tide-200">{info}</p>}
      {minted && (
        <div className="panel border-tide-500/30 bg-tide-500/10 px-4 py-3 font-mono text-lg tracking-widest">
          {minted}
        </div>
      )}

      <form className="panel space-y-3 p-4" onSubmit={(e) => void mint(e)}>
        <h3 className="font-semibold">Mint invite code</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Role</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Max uses</label>
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value) || 1)}
              disabled={role === 'admin'}
            />
          </div>
          <div>
            <label className="label">Note</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />
          </div>
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          Create invite
        </button>
      </form>

      <div className="panel overflow-x-auto">
        <h3 className="border-b border-ink-200/70 px-4 py-3 font-semibold dark:border-ink-700">Recent invites</h3>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Uses</th>
              <th className="px-4 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id} className="border-t border-ink-100 dark:border-ink-800">
                <td className="px-4 py-2 font-mono text-xs">{inv.code}</td>
                <td className="px-4 py-2">{inv.role}</td>
                <td className="px-4 py-2">
                  {inv.used_count}/{inv.max_uses}
                </td>
                <td className="px-4 py-2 text-ink-500">{inv.note || '—'}</td>
              </tr>
            ))}
            {invites.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-ink-500">
                  No invites yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel overflow-x-auto">
        <h3 className="border-b border-ink-200/70 px-4 py-3 font-semibold dark:border-ink-700">
          Pending access requests
        </h3>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-2">User</th>
              <th className="px-4 py-2">From → To</th>
              <th className="px-4 py-2">Justification</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-t border-ink-100 dark:border-ink-800">
                <td className="px-4 py-2">
                  {r.username}
                  <div className="text-xs text-ink-400">{r.email}</div>
                </td>
                <td className="px-4 py-2">
                  {r.current_role} → {r.requested_role}
                </td>
                <td className="px-4 py-2 text-ink-600 dark:text-ink-300">{r.justification || '—'}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary !h-8 text-xs"
                      disabled={busy}
                      onClick={() => void review(r.id, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn-secondary !h-8 text-xs"
                      disabled={busy}
                      onClick={() => void review(r.id, 'denied')}
                    >
                      Deny
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-ink-500">
                  No pending requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-semibold">Case retention</h3>
        <p className="text-sm text-ink-500">
          Archive stale final cases and permanently purge trash past the retention windows.
        </p>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void runRetention()}>
          Run retention now
        </button>
        {retentionInfo && <p className="text-sm text-ink-600 dark:text-ink-300">{retentionInfo}</p>}
      </div>
    </div>
  )
}
