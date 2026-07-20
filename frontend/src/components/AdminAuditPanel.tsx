import { useCallback, useEffect, useState } from 'react'
import { api, type AuditLogEntry } from '../api'

export function AdminAuditPanel() {
  const [rows, setRows] = useState<AuditLogEntry[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setRows(await api.listAuditLogs(100))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="animate-rise space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl tracking-tight">Audit log</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-500">
            Recent auth, admin, and support actions for accountability.
          </p>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-ink-200/80 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-700">
            <tr>
              <th className="px-4 py-3 font-semibold">When</th>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">Entity</th>
              <th className="px-4 py-3 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-ink-100 dark:border-ink-800">
                <td className="px-4 py-2.5 font-mono text-xs text-ink-500">
                  {r.created_at?.replace('T', ' ').slice(0, 19) || '—'}
                </td>
                <td className="px-4 py-2.5">{r.username || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2.5 text-xs text-ink-500">
                  {r.entity_type}
                  {r.entity_id ? ` #${r.entity_id}` : ''}
                </td>
                <td className="max-w-xs truncate px-4 py-2.5 text-ink-600 dark:text-ink-300">{r.details}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-400">
                  No audit events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
