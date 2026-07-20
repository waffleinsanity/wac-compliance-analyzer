import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { api, type BugReport, type UserFeedback } from '../api'
import { getToken } from '../api'

type InboxTab = 'bugs' | 'feedback'

export function AdminInboxPanel() {
  const [tab, setTab] = useState<InboxTab>('bugs')
  const [bugs, setBugs] = useState<BugReport[]>([])
  const [feedback, setFeedback] = useState<UserFeedback[]>([])
  const [statusFilter, setStatusFilter] = useState('open')
  const [feedbackFilter, setFeedbackFilter] = useState('new')
  const [selectedBug, setSelectedBug] = useState<BugReport | null>(null)
  const [selectedFeedback, setSelectedFeedback] = useState<UserFeedback | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      if (tab === 'bugs') {
        setBugs(await api.listBugReports(statusFilter === 'all' ? undefined : statusFilter))
      } else {
        setFeedback(await api.listFeedback(feedbackFilter === 'all' ? undefined : feedbackFilter))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox')
    }
  }, [tab, statusFilter, feedbackFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setNote(selectedBug?.admin_note || selectedFeedback?.admin_note || '')
  }, [selectedBug, selectedFeedback])

  const updateBug = async (status: string) => {
    if (!selectedBug) return
    setBusy(true)
    setError('')
    try {
      const updated = await api.updateBugReport(selectedBug.id, { status, admin_note: note })
      setSelectedBug(updated)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const updateFeedback = async (status: string) => {
    if (!selectedFeedback) return
    setBusy(true)
    setError('')
    try {
      const updated = await api.updateFeedback(selectedFeedback.id, { status, admin_note: note })
      setSelectedFeedback(updated)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="animate-rise space-y-4">
      <div>
        <h2 className="font-display text-3xl tracking-tight">Support inbox</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-500">
          Triage bug reports and product feedback. Diagnostics never include complaint text by default.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['bugs', 'Bugs'],
            ['feedback', 'Feedback'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={clsx('nav-pill', tab === id ? 'nav-pill-active' : 'nav-pill-idle')}
            onClick={() => {
              setTab(id)
              setSelectedBug(null)
              setSelectedFeedback(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-ink-200/80 px-3 py-2 dark:border-ink-700">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              {tab === 'bugs' ? 'Bug reports' : 'Feedback'}
            </span>
            <select
              className="input !h-8 !w-auto !py-0 text-xs"
              value={tab === 'bugs' ? statusFilter : feedbackFilter}
              onChange={(e) =>
                tab === 'bugs' ? setStatusFilter(e.target.value) : setFeedbackFilter(e.target.value)
              }
            >
              {tab === 'bugs' ? (
                <>
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                  <option value="all">All</option>
                </>
              ) : (
                <>
                  <option value="new">New</option>
                  <option value="read">Read</option>
                  <option value="archived">Archived</option>
                  <option value="all">All</option>
                </>
              )}
            </select>
          </div>
          <ul className="max-h-[28rem] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
            {tab === 'bugs' &&
              bugs.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={clsx(
                      'w-full px-3 py-3 text-left text-sm hover:bg-ink-100/70 dark:hover:bg-ink-800/40',
                      selectedBug?.id === b.id && 'bg-tide-500/10',
                    )}
                    onClick={() => {
                      setSelectedBug(b)
                      setSelectedFeedback(null)
                    }}
                  >
                    <div className="font-semibold">{b.title}</div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      {b.user?.username || 'user'} · {b.status} · {b.created_at?.slice(0, 16) || ''}
                    </div>
                  </button>
                </li>
              ))}
            {tab === 'feedback' &&
              feedback.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className={clsx(
                      'w-full px-3 py-3 text-left text-sm hover:bg-ink-100/70 dark:hover:bg-ink-800/40',
                      selectedFeedback?.id === f.id && 'bg-tide-500/10',
                    )}
                    onClick={() => {
                      setSelectedFeedback(f)
                      setSelectedBug(null)
                    }}
                  >
                    <div className="font-semibold">{f.subject}</div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      {f.category} · {f.user?.username || 'user'} · {f.status}
                    </div>
                  </button>
                </li>
              ))}
            {tab === 'bugs' && !bugs.length && (
              <li className="px-3 py-8 text-center text-sm text-ink-400">No bug reports</li>
            )}
            {tab === 'feedback' && !feedback.length && (
              <li className="px-3 py-8 text-center text-sm text-ink-400">No feedback</li>
            )}
          </ul>
        </div>

        <div className="panel space-y-3 p-4">
          {!selectedBug && !selectedFeedback && (
            <p className="text-sm text-ink-500">Select an item to triage.</p>
          )}

          {selectedBug && (
            <>
              <div>
                <h3 className="font-semibold">{selectedBug.title}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{selectedBug.description}</p>
                <p className="mt-2 text-xs text-ink-500">
                  {selectedBug.page_url} · {selectedBug.user?.email || selectedBug.user?.username}
                </p>
              </div>
              {selectedBug.has_screenshot && (
                <button
                  type="button"
                  className="text-sm text-tide-700 underline dark:text-tide-300"
                  onClick={() => {
                    void (async () => {
                      const token = getToken()
                      const res = await fetch(`/api/support/bugs/${selectedBug.id}/screenshot`, {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      })
                      if (!res.ok) return
                      const blob = await res.blob()
                      window.open(URL.createObjectURL(blob), '_blank')
                    })()
                  }}
                >
                  View screenshot
                </button>
              )}
              {selectedBug.diagnostics_json && selectedBug.diagnostics_json !== '{}' && (
                <details className="rounded-lg border border-ink-200/80 p-2 text-xs dark:border-ink-700">
                  <summary className="cursor-pointer font-semibold">Diagnostics JSON</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
                    {selectedBug.diagnostics_json}
                  </pre>
                </details>
              )}
              <div>
                <label className="label">Admin note</label>
                <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void updateBug('in_progress')}>
                  In progress
                </button>
                <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void updateBug('resolved')}>
                  Resolve
                </button>
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void updateBug('closed')}>
                  Close
                </button>
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void updateBug('open')}>
                  Reopen
                </button>
              </div>
            </>
          )}

          {selectedFeedback && (
            <>
              <div>
                <h3 className="font-semibold">{selectedFeedback.subject}</h3>
                <p className="mt-1 text-xs uppercase tracking-wide text-ink-400">{selectedFeedback.category}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{selectedFeedback.message}</p>
                <p className="mt-2 text-xs text-ink-500">
                  {selectedFeedback.user?.username} · {selectedFeedback.created_at?.slice(0, 16)}
                </p>
              </div>
              <div>
                <label className="label">Admin note</label>
                <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => void updateFeedback('read')}
                >
                  Mark read
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void updateFeedback('archived')}
                >
                  Archive
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void updateFeedback('new')}
                >
                  Mark new
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
