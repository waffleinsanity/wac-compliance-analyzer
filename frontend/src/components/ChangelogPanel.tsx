import { useEffect, useState } from 'react'
import { CalendarDays, GitBranch, NotebookPen, Sparkles } from 'lucide-react'
import { api } from '../api'
import {
  CHANGELOG_AREA_LABELS,
  getLatestChangelogEntry,
  listChangelogEntries,
  type ChangelogEntry,
} from '../changelog'

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function ChangelogPanel() {
  const entries = listChangelogEntries()
  const latest = getLatestChangelogEntry()
  const [runningVersion, setRunningVersion] = useState('…')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const h = await api.health()
        if (cancelled) return
        const started = h.started_at ? `started ${h.started_at}` : 'started_at unknown'
        setRunningVersion(
          `ready=${h.ready} · nodes=${h.wac_nodes} · codes=${h.wac_codes} · ${started}`,
        )
      } catch {
        if (!cancelled) setRunningVersion('Could not read /api/health')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="animate-rise space-y-4">
      <div>
        <h2 className="font-display text-3xl tracking-tight">Changelog</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-500">
          Operator-facing build notes for intentional production ships. Members never see this tab.
        </p>
      </div>

      <div className="panel overflow-hidden border-tide-500/25 bg-tide-500/5 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-tide-500/15 text-tide-800 dark:text-tide-200">
            <GitBranch className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-tide-800 dark:text-tide-200/90">
              Running build
            </p>
            <p className="mt-1 break-all font-mono text-sm text-ink-800 dark:text-ink-100">{runningVersion}</p>
            <p className="mt-2 text-xs text-ink-500">
              Live health fingerprint from this deploy. Refresh the browser after a release if the UI
              looks stale.
            </p>
            {latest ? (
              <p className="mt-2 text-xs text-ink-500">
                Latest build notes:{' '}
                <span className="font-medium text-ink-800 dark:text-ink-100">{latest.buildTag}</span>
                {' · '}
                {latest.title}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="panel p-8 text-center text-sm text-ink-500">
          No changelog entries yet. Add notes in{' '}
          <code className="text-xs">frontend/src/changelog.ts</code>.
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry, index) => (
            <ChangelogCard key={entry.id} entry={entry} isLatest={index === 0} />
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-500">
        Maintainers: append a new entry at the top of{' '}
        <code className="rounded bg-ink-100 px-1 py-0.5 text-[11px] dark:bg-ink-800">
          frontend/src/changelog.ts
        </code>{' '}
        for each intentional production ship.
      </p>
    </div>
  )
}

function ChangelogCard({ entry, isLatest }: { entry: ChangelogEntry; isLatest: boolean }) {
  return (
    <li>
      <div className="panel overflow-hidden">
        <div className="border-b border-ink-200/60 bg-ink-50/60 px-5 py-4 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-tide-500/30 bg-tide-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-tide-900 dark:text-tide-100">
                  <NotebookPen className="h-3 w-3" />
                  {entry.buildTag}
                </span>
                {isLatest ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                    <Sparkles className="h-3 w-3" />
                    Latest notes
                  </span>
                ) : null}
              </div>
              <h3 className="mt-2 font-display text-base font-semibold">{entry.title}</h3>
              <p className="mt-1 text-sm text-ink-500">{entry.summary}</p>
            </div>
            <p className="inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-500">
              <CalendarDays className="h-3.5 w-3.5" />
              {formatDate(entry.date)}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {entry.areas.map((area) => (
              <span
                key={area}
                className="rounded-sm border border-ink-200/70 bg-ink-100/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500 dark:border-ink-700 dark:bg-ink-800/60"
              >
                {CHANGELOG_AREA_LABELS[area]}
              </span>
            ))}
          </div>
        </div>
        <ul className="space-y-2 px-5 py-4">
          {entry.highlights.map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-snug text-ink-800 dark:text-ink-100">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-tide-500/80" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  )
}
