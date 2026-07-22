import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  FolderOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import { api, type CaseAnalytics, type CaseSummary } from '../api'
import { caseStatusLabel } from '../investigatorLabels'

type Props = {
  activeCaseId: number | null
  onOpenCase: (id: number) => void
  onNewCase: () => void
  refreshKey?: number
  canEdit?: boolean
  onCaseRemoved?: (id: number) => void
}

type CaseView = 'active' | 'archived' | 'trash'
type StatusFilter = 'all' | 'draft' | 'in_review' | 'final'

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'in_review', label: 'In review' },
  { id: 'final', label: 'Final' },
]

const TRASH_DAYS = 7

function statusChipClass(status: string) {
  if (status === 'final') return 'status-chip-ready'
  if (status === 'in_review') return 'status-chip-warn'
  if (status === 'archived') return 'opacity-70'
  if (status === 'trashed') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
  return ''
}

function relativeUpdated(iso?: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const sec = Math.round((Date.now() - t) / 1000)
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 48) return `${hr}h ago`
  const days = Math.round(hr / 24)
  if (days < 14) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function daysLeftInTrash(trashedAt?: string | null): number | null {
  if (!trashedAt) return null
  const start = new Date(trashedAt).getTime()
  if (Number.isNaN(start)) return null
  const expires = start + TRASH_DAYS * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000)))
}

export function CasesPanel({
  activeCaseId,
  onOpenCase,
  onNewCase,
  refreshKey = 0,
  canEdit = true,
  onCaseRemoved,
}: Props) {
  const [view, setView] = useState<CaseView>('active')
  const [cases, setCases] = useState<CaseSummary[]>([])
  const [archiveCount, setArchiveCount] = useState(0)
  const [trashCount, setTrashCount] = useState(0)
  const [analytics, setAnalytics] = useState<CaseAnalytics | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionId, setActionId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const [list, archived, trash, stats] = await Promise.all([
        api.listCases(view),
        view === 'archived' ? Promise.resolve(null) : api.listCases('archived'),
        view === 'trash' ? Promise.resolve(null) : api.listCases('trash'),
        api.caseAnalytics(),
      ])
      setCases(list)
      if (view === 'archived') setArchiveCount(list.length)
      else if (archived) setArchiveCount(archived.length)
      if (view === 'trash') setTrashCount(list.length)
      else if (trash) setTrashCount(trash.length)
      setAnalytics(stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cases')
    } finally {
      setBusy(false)
    }
  }, [view])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const filtered = useMemo(() => {
    let list = cases
    if (view === 'active' && statusFilter !== 'all') {
      list = list.filter((c) => c.status === statusFilter)
    }
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((c) => {
      const title = (c.title || '').toLowerCase()
      const label = (c.case_id_label || '').toLowerCase()
      return title.includes(q) || label.includes(q) || String(c.id).includes(q)
    })
  }, [cases, statusFilter, view, query])

  const filterCount = (id: StatusFilter) => {
    if (id === 'all') return analytics?.total_cases ?? cases.length
    return analytics?.by_status?.[id] ?? cases.filter((c) => c.status === id).length
  }

  const runAction = async (id: number, fn: () => Promise<unknown>): Promise<boolean> => {
    setActionId(id)
    setError('')
    try {
      await fn()
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Case action failed')
      return false
    } finally {
      setActionId(null)
    }
  }

  const archiveCase = (c: CaseSummary) => {
    if (!window.confirm(`Archive ${c.title || c.case_id_label || `Case ${c.id}`}?`)) return
    void runAction(c.id, async () => {
      await api.setCaseStatus(c.id, 'archived')
      if (activeCaseId === c.id) onCaseRemoved?.(c.id)
    })
  }

  const trashCase = (c: CaseSummary) => {
    if (
      !window.confirm(
        `Move ${c.title || c.case_id_label || `Case ${c.id}`} to trash? It will be permanently deleted after ${TRASH_DAYS} days.`,
      )
    ) {
      return
    }
    void runAction(c.id, async () => {
      await api.trashCase(c.id)
      if (activeCaseId === c.id) onCaseRemoved?.(c.id)
    })
  }

  const restoreCase = (c: CaseSummary) => {
    void runAction(c.id, async () => {
      await api.restoreCase(c.id)
    }).then((ok) => {
      if (ok) setView('active')
    })
  }

  const purgeCase = (c: CaseSummary) => {
    if (
      !window.confirm(
        `Permanently delete ${c.title || c.case_id_label || `Case ${c.id}`}? This cannot be undone.`,
      )
    ) {
      return
    }
    void runAction(c.id, async () => {
      await api.deleteCase(c.id)
      if (activeCaseId === c.id) onCaseRemoved?.(c.id)
    })
  }

  const emptyTrash = () => {
    const n = cases.length
    if (!n) return
    if (
      !window.confirm(
        `Permanently delete all ${n} case${n === 1 ? '' : 's'} in Trash? This cannot be undone.`,
      )
    ) {
      return
    }
    void (async () => {
      setBusy(true)
      setError('')
      try {
        const ids = cases.map((c) => c.id)
        for (const id of ids) {
          await api.deleteCase(id)
          if (activeCaseId === id) onCaseRemoved?.(id)
        }
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to empty trash')
        await load()
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink-200/70 px-3 py-3 dark:border-ink-700">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FolderOpen className="h-4 w-4 shrink-0 text-tide-600" /> Cases
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Save and resume IR drafts</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" className="btn-ghost !h-8 !w-8 !px-0" onClick={() => void load()} title="Refresh">
            <RefreshCw className={clsx('h-3.5 w-3.5', busy && 'animate-spin')} />
          </button>
          {canEdit && view === 'active' && (
            <button type="button" className="btn-secondary !h-8 !px-2 text-xs" onClick={onNewCase}>
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 border-b border-ink-200/60 px-3 py-2.5 dark:border-ink-700">
        <div className="flex gap-1">
          {(
            [
              { id: 'active' as const, label: 'Active', count: analytics?.total_cases },
              { id: 'archived' as const, label: 'Archive', count: archiveCount, icon: Archive },
              { id: 'trash' as const, label: 'Trash', count: trashCount, icon: Trash2 },
            ] as const
          ).map((tab) => {
            const Icon = 'icon' in tab ? tab.icon : null
            const active = view === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setView(tab.id)
                  setStatusFilter('all')
                }}
                className={clsx(
                  'inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition',
                  active
                    ? 'bg-tide-500/12 text-tide-800 ring-1 ring-tide-500/30 dark:text-tide-200'
                    : 'text-ink-500 hover:bg-ink-100/70 dark:hover:bg-ink-800/50',
                )}
                title={tab.label}
              >
                {Icon ? <Icon className="h-3 w-3 shrink-0" /> : null}
                <span className="truncate">{tab.label}</span>
                <span className="font-mono tabular-nums opacity-70">{tab.count ?? '—'}</span>
              </button>
            )
          })}
        </div>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or case ID…"
            className="input !h-8 pl-8 !text-xs"
            aria-label="Search cases"
          />
        </label>

        {view === 'active' && (
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => {
              const count = filterCount(f.id)
              const active = statusFilter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={clsx(
                    'status-chip !px-2 !py-0.5 text-[10px] transition',
                    active
                      ? f.id === 'final'
                        ? 'status-chip-ready ring-1 ring-tide-500/30'
                        : f.id === 'in_review'
                          ? 'status-chip-warn ring-1 ring-amber-500/30'
                          : 'bg-tide-500/12 ring-1 ring-tide-500/30'
                      : 'opacity-70 hover:opacity-100',
                  )}
                >
                  {f.label}
                  <span className="font-mono tabular-nums opacity-80">{count}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {view === 'trash' && (
        <div className="flex items-center justify-between gap-2 border-b border-ink-200/60 px-3 py-2 dark:border-ink-700">
          <p className="min-w-0 text-[10px] leading-snug text-ink-400">
            Permanently deleted after {TRASH_DAYS} days.
          </p>
          {canEdit && cases.length > 0 && (
            <button
              type="button"
              className="btn-ghost shrink-0 !h-7 !px-2 text-[11px] text-rose-600 hover:text-rose-700"
              disabled={busy}
              title="Permanently delete everything in Trash"
              onClick={emptyTrash}
            >
              <Trash2 className="h-3 w-3" /> Delete all
            </button>
          )}
        </div>
      )}

      {error && <p className="px-3 py-2 text-xs text-rose-600">{error}</p>}

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {filtered.map((c) => {
          const left = view === 'trash' ? daysLeftInTrash(c.trashed_at) : null
          const acting = actionId === c.id
          const displayTitle = c.title?.trim() || 'Untitled'
          const when = relativeUpdated(c.updated_at)
          const selected = activeCaseId === c.id && view === 'active'
          const meta =
            view === 'trash' && left != null
              ? `Deletes in ${left} day${left === 1 ? '' : 's'}`
              : [
                  c.case_id_label || `Case ${c.id}`,
                  `${c.approved_wac_count} WAC${c.approved_wac_count === 1 ? '' : 's'}`,
                  c.has_report ? 'has draft' : null,
                  when,
                ]
                  .filter(Boolean)
                  .join(' · ')

          return (
            <li key={c.id} className="group">
              <div
                className={clsx(
                  'rounded-xl border px-3 py-2.5 transition',
                  selected
                    ? 'border-tide-500/40 bg-tide-500/10 shadow-soft'
                    : 'border-ink-200/70 bg-card/60 hover:border-ink-300 hover:bg-ink-50/80 dark:border-ink-700 dark:hover:border-ink-600 dark:hover:bg-ink-800/40',
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (view === 'trash') return
                      onOpenCase(c.id)
                    }}
                    disabled={view === 'trash'}
                    className={clsx(
                      'min-w-0 flex-1 text-left',
                      view === 'trash' && 'cursor-default',
                    )}
                  >
                    <span
                      className="block truncate text-[13px] font-semibold leading-snug text-ink-900 dark:text-ink-50"
                      title={displayTitle}
                    >
                      {displayTitle}
                    </span>
                    <span className="mt-1 block truncate text-[11px] leading-snug text-ink-400" title={meta}>
                      {meta}
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                    {canEdit && view === 'active' && (
                      <>
                        <button
                          type="button"
                          className="btn-ghost !h-7 !w-7 !px-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                          title="Archive"
                          disabled={acting}
                          onClick={() => archiveCase(c)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !h-7 !w-7 !px-0 text-rose-600 hover:text-rose-700 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                          title="Move to trash"
                          disabled={acting}
                          onClick={() => trashCase(c)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    {canEdit && view === 'archived' && (
                      <>
                        <button
                          type="button"
                          className="btn-ghost !h-7 !w-7 !px-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                          title="Restore"
                          disabled={acting}
                          onClick={() => restoreCase(c)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !h-7 !w-7 !px-0 text-rose-600 hover:text-rose-700 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                          title="Move to trash"
                          disabled={acting}
                          onClick={() => trashCase(c)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    {canEdit && view === 'trash' && (
                      <>
                        <button
                          type="button"
                          className="btn-ghost !h-7 !w-7 !px-0"
                          title="Restore"
                          disabled={acting}
                          onClick={() => restoreCase(c)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !h-7 !w-7 !px-0 text-rose-600 hover:text-rose-700"
                          title="Delete forever"
                          disabled={acting}
                          onClick={() => purgeCase(c)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    <span
                      className={clsx(
                        'status-chip !px-1.5 !py-0 text-[10px] capitalize',
                        statusChipClass(c.status),
                      )}
                    >
                      {caseStatusLabel(c.status)}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
        {!filtered.length && !busy && (
          <li className="px-2 py-8 text-center text-xs text-ink-400">
            {query.trim()
              ? 'No cases match that search.'
              : view === 'archived'
                ? 'No archived cases.'
                : view === 'trash'
                  ? 'Trash is empty.'
                  : cases.length
                    ? `No ${statusFilter === 'all' ? '' : caseStatusLabel(statusFilter) + ' '}cases.`
                    : 'No saved cases yet. Draft a report, then save it as a case.'}
          </li>
        )}
      </ul>
    </div>
  )
}
