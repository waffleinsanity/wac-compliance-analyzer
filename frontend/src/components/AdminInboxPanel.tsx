import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { api, type BugReport, type UserFeedback } from '../api'
import { getToken } from '../api'

type InboxTab = 'bugs' | 'feedback'

const BUG_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

function bugStatusClass(status: string) {
  switch (status) {
    case 'resolved':
      return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'
    case 'in_progress':
      return 'bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100'
    case 'closed':
      return 'bg-ink-200/80 text-ink-700 dark:bg-ink-800 dark:text-ink-200'
    default:
      return 'bg-tide-500/15 text-tide-900 dark:text-tide-200'
  }
}

function buildAgentBrief(bug: BugReport): string {
  return [
    'Support bug report — investigate and fix in this repo, then mark resolved in Admin → Inbox.',
    '',
    `Bug #${bug.id}: ${bug.title}`,
    `Status: ${bug.status}`,
    `Page: ${bug.page_url || '(none)'}`,
    `Reporter: ${bug.user?.email || bug.user?.username || 'unknown'}`,
    '',
    '## Description',
    bug.description,
    '',
    bug.has_screenshot ? '## Screenshot\nAvailable via GET /api/support/bugs/' + bug.id + '/screenshot (admin auth).' : '',
    bug.diagnostics_json && bug.diagnostics_json !== '{}'
      ? `## Diagnostics\n\`\`\`json\n${bug.diagnostics_json.slice(0, 4000)}\n\`\`\``
      : '',
    '',
    '## Done when',
    '- Root cause fixed in code',
    '- Brief admin note of what changed',
    `- PATCH /api/support/bugs/${bug.id} with status "resolved"`,
  ]
    .filter(Boolean)
    .join('\n')
}

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
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedBrief, setCopiedBrief] = useState(false)

  const loadBugs = useCallback(async (filter: string) => {
    setBugs(await api.listBugReports(filter === 'all' ? undefined : filter))
  }, [])

  const loadFeedback = useCallback(async (filter: string) => {
    setFeedback(await api.listFeedback(filter === 'all' ? undefined : filter))
  }, [])

  const load = useCallback(async () => {
    setError('')
    try {
      if (tab === 'bugs') {
        await loadBugs(statusFilter)
      } else {
        await loadFeedback(feedbackFilter)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox')
    }
  }, [tab, statusFilter, feedbackFilter, loadBugs, loadFeedback])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setNote(selectedBug?.admin_note || selectedFeedback?.admin_note || '')
    setInfo('')
    setCopiedBrief(false)
  }, [selectedBug?.id, selectedFeedback?.id])

  const updateBug = async (status: string) => {
    if (!selectedBug) return
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const updated = await api.updateBugReport(selectedBug.id, { status, admin_note: note })
      setSelectedBug(updated)
      // Keep the item visible: switch filter to the new status (unless browsing All)
      if (statusFilter !== 'all' && statusFilter !== status) {
        setStatusFilter(status)
        await loadBugs(status)
      } else {
        await loadBugs(statusFilter)
      }
      setInfo(`Saved — status is now ${BUG_STATUS_LABEL[status] || status}.`)
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
    setInfo('')
    try {
      const updated = await api.updateFeedback(selectedFeedback.id, { status, admin_note: note })
      setSelectedFeedback(updated)
      if (feedbackFilter !== 'all' && feedbackFilter !== status) {
        setFeedbackFilter(status)
        await loadFeedback(status)
      } else {
        await loadFeedback(feedbackFilter)
      }
      setInfo(`Saved — feedback marked ${status}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const copyAgentBrief = async () => {
    if (!selectedBug) return
    try {
      await navigator.clipboard.writeText(buildAgentBrief(selectedBug))
      setCopiedBrief(true)
      setInfo('Agent brief copied — paste into Cursor with the support-bug-report skill.')
      window.setTimeout(() => setCopiedBrief(false), 2500)
    } catch {
      setError('Could not copy agent brief to clipboard')
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
              setInfo('')
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
          {error}
        </p>
      )}
      {info && !error && (
        <p className="rounded-lg border border-emerald-300/70 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          {info}
        </p>
      )}

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
                      {b.user?.username || 'user'} · {BUG_STATUS_LABEL[b.status] || b.status} ·{' '}
                      {b.created_at?.slice(0, 16) || ''}
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
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">{selectedBug.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{selectedBug.description}</p>
                  <p className="mt-2 text-xs text-ink-500">
                    {selectedBug.page_url} · {selectedBug.user?.email || selectedBug.user?.username}
                  </p>
                </div>
                <span
                  className={clsx(
                    'shrink-0 rounded-md px-2 py-1 font-sans text-[11px] font-semibold uppercase tracking-wide',
                    bugStatusClass(selectedBug.status),
                  )}
                >
                  {BUG_STATUS_LABEL[selectedBug.status] || selectedBug.status}
                </span>
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
                      if (!res.ok) {
                        setError('Could not load screenshot')
                        return
                      }
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
                <textarea
                  className="input min-h-[80px]"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What we found / shipped"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={clsx(
                    'btn-sm',
                    selectedBug.status === 'in_progress' ? 'btn-primary' : 'btn-secondary',
                  )}
                  disabled={busy || selectedBug.status === 'in_progress'}
                  onClick={() => void updateBug('in_progress')}
                >
                  In progress
                </button>
                <button
                  type="button"
                  className={clsx(
                    'btn-sm',
                    selectedBug.status === 'resolved' ? 'btn-primary' : 'btn-secondary',
                  )}
                  disabled={busy || selectedBug.status === 'resolved'}
                  onClick={() => void updateBug('resolved')}
                >
                  {busy ? 'Saving…' : selectedBug.status === 'resolved' ? 'Resolved' : 'Resolve'}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy || selectedBug.status === 'closed'}
                  onClick={() => void updateBug('closed')}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy || selectedBug.status === 'open'}
                  onClick={() => void updateBug('open')}
                >
                  Reopen
                </button>
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => void copyAgentBrief()}
                  title="Copy a brief for the Cursor support-bug-report skill"
                >
                  {copiedBrief ? 'Copied' : 'Copy agent brief'}
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
