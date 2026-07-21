import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, FolderOpen, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
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

function statusClass(status: string) {
  if (status === 'final') return 'status-chip-ready'
  if (status === 'in_review') return 'status-chip-warn'
  if (status === 'archived') return 'opacity-70'
  if (status === 'trashed') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
  return ''
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
    if (view !== 'active' || statusFilter === 'all') return cases
    return cases.filter((c) => c.status === statusFilter)
  }, [cases, statusFilter, view])

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
    if (!window.confirm(`Archive ${c.case_id_label || c.title || `Case ${c.id}`}?`)) return
    void runAction(c.id, async () => {
      await api.setCaseStatus(c.id, 'archived')
      if (activeCaseId === c.id) onCaseRemoved?.(c.id)
    })
  }

  const trashCase = (c: CaseSummary) => {
    if (
      !window.confirm(
        `Move ${c.case_id_label || c.title || `Case ${c.id}`} to trash? It will be permanently deleted after ${TRASH_DAYS} days.`,
      )
    ) {
      return
    }
    void runAction(c.id, async () => {
      await api.trashCase(c.id)
      if (activeCaseId === c.id) onCaseRemoved?.(c.id)
    }).then((ok) => {
      if (ok) setView('trash')
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
        `Permanently delete ${c.case_id_label || c.title || `Case ${c.id}`}? This cannot be undone.`,
      )
    ) {
      return
    }
    void runAction(c.id, async () => {
      await api.deleteCase(c.id)
      if (activeCaseId === c.id) onCaseRemoved?.(c.id)
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink-200/70 px-3 py-3 dark:border-ink-700">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FolderOpen className="h-4 w-4 text-tide-600" /> Cases
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Save and resume IR drafts</p>
        </div>
        <div className="flex gap-1">
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

      <div className="flex gap-1 border-b border-ink-200/60 px-3 py-2 dark:border-ink-700">
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
                'inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition',
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

      {view === 'active' && (
        <div className="border-b border-ink-200/60 px-3 py-2 dark:border-ink-700">
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
        </div>
      )}

      {view === 'trash' && (
        <p className="border-b border-ink-200/60 px-3 py-2 text-[10px] leading-snug text-ink-400 dark:border-ink-700">
          Items in Trash are permanently deleted after {TRASH_DAYS} days.
        </p>
      )}

      {error && <p className="px-3 py-2 text-xs text-rose-600">{error}</p>}

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {filtered.map((c) => {
          const left = view === 'trash' ? daysLeftInTrash(c.trashed_at) : null
          const acting = actionId === c.id
          return (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => {
                  if (view === 'trash') return
                  onOpenCase(c.id)
                }}
                disabled={view === 'trash'}
                className={clsx(
                  'w-full rounded-xl px-3 py-2 pr-16 text-left transition',
                  view === 'trash' && 'cursor-default',
                  activeCaseId === c.id && view === 'active'
                    ? 'bg-tide-500/12 ring-1 ring-tide-500/30'
                    : 'hover:bg-ink-100/70 dark:hover:bg-ink-800/50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs font-semibold">
                    {c.case_id_label || `Case ${c.id}`}
                  </span>
                  <span className={clsx('status-chip !px-2 !py-0.5 text-[10px]', statusClass(c.status))}>
                    {caseStatusLabel(c.status)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-ink-500">{c.title || 'Untitled'}</div>
                <div className="mt-0.5 text-[10px] text-ink-400">
                  {view === 'trash' && left != null
                    ? `Deletes in ${left} day${left === 1 ? '' : 's'}`
                    : `${c.approved_wac_count} approved WAC${c.approved_wac_count === 1 ? '' : 's'}${
                        c.has_report ? ' · has draft' : ''
                      }`}
                </div>
              </button>

              {canEdit && (
                <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  {view === 'active' && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost !h-7 !w-7 !px-0"
                        title="Archive"
                        disabled={acting}
                        onClick={(e) => {
                          e.stopPropagation()
                          archiveCase(c)
                        }}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !h-7 !w-7 !px-0 text-rose-600 hover:text-rose-700"
                        title="Move to trash"
                        disabled={acting}
                        onClick={(e) => {
                          e.stopPropagation()
                          trashCase(c)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  {view === 'archived' && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost !h-7 !w-7 !px-0"
                        title="Restore"
                        disabled={acting}
                        onClick={(e) => {
                          e.stopPropagation()
                          restoreCase(c)
                        }}
                      >
                        <ArchiveRestore className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !h-7 !w-7 !px-0 text-rose-600"
                        title="Move to trash"
                        disabled={acting}
                        onClick={(e) => {
                          e.stopPropagation()
                          trashCase(c)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  {view === 'trash' && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost !h-7 !w-7 !px-0"
                        title="Restore"
                        disabled={acting}
                        onClick={(e) => {
                          e.stopPropagation()
                          restoreCase(c)
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !h-7 !w-7 !px-0 text-rose-600"
                        title="Delete forever"
                        disabled={acting}
                        onClick={(e) => {
                          e.stopPropagation()
                          purgeCase(c)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
        {!filtered.length && !busy && (
          <li className="px-2 py-6 text-center text-xs text-ink-400">
            {view === 'archived'
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
