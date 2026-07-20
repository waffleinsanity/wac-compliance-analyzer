import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Plus, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { api, type CaseAnalytics, type CaseSummary } from '../api'

type Props = {
  activeCaseId: number | null
  onOpenCase: (id: number) => void
  onNewCase: () => void
  refreshKey?: number
  canEdit?: boolean
}

function statusClass(status: string) {
  if (status === 'final') return 'status-chip-ready'
  if (status === 'in_review') return 'status-chip-warn'
  if (status === 'archived') return 'opacity-70'
  return ''
}

export function CasesPanel({
  activeCaseId,
  onOpenCase,
  onNewCase,
  refreshKey = 0,
  canEdit = true,
}: Props) {
  const [cases, setCases] = useState<CaseSummary[]>([])
  const [analytics, setAnalytics] = useState<CaseAnalytics | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const [list, stats] = await Promise.all([api.listCases(false), api.caseAnalytics()])
      setCases(list)
      setAnalytics(stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cases')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

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
          {canEdit && (
            <button type="button" className="btn-secondary !h-8 !px-2 text-xs" onClick={onNewCase}>
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          )}
        </div>
      </div>

      {analytics && (
        <div className="border-b border-ink-200/60 px-3 py-2 text-[11px] text-ink-500 dark:border-ink-700">
          {analytics.total_cases} case{analytics.total_cases === 1 ? '' : 's'}
          {analytics.by_status.draft != null ? ` · ${analytics.by_status.draft} draft` : ''}
          {analytics.by_status.in_review != null ? ` · ${analytics.by_status.in_review} in review` : ''}
          {analytics.by_status.final != null ? ` · ${analytics.by_status.final} final` : ''}
        </div>
      )}

      {error && <p className="px-3 py-2 text-xs text-rose-600">{error}</p>}

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {cases.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onOpenCase(c.id)}
              className={clsx(
                'w-full rounded-xl px-3 py-2 text-left transition',
                activeCaseId === c.id
                  ? 'bg-tide-500/12 ring-1 ring-tide-500/30'
                  : 'hover:bg-ink-100/70 dark:hover:bg-ink-800/50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs font-semibold">
                  {c.case_id_label || `Case ${c.id}`}
                </span>
                <span className={clsx('status-chip !px-2 !py-0.5 text-[10px]', statusClass(c.status))}>
                  {c.status}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-ink-500">{c.title || 'Untitled'}</div>
              <div className="mt-0.5 text-[10px] text-ink-400">
                {c.approved_wac_count} approved WAC{c.approved_wac_count === 1 ? '' : 's'}
                {c.has_report ? ' · has draft' : ''}
              </div>
            </button>
          </li>
        ))}
        {!cases.length && !busy && (
          <li className="px-2 py-6 text-center text-xs text-ink-400">
            No saved cases yet. Draft a report, then save it as a case.
          </li>
        )}
      </ul>
    </div>
  )
}
