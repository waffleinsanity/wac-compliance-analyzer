import { formatSavedClock } from '../draftBackup'
import type { CaseSnapshot } from '../api'

type Props = {
  snapshots: CaseSnapshot[]
  disabled?: boolean
  busy?: boolean
  onRestore: (snapshotId: number) => void
}

export function DraftRecallMenu({ snapshots, disabled = false, busy = false, onRestore }: Props) {
  const items = snapshots.slice(0, 16)
  if (!items.length) return null
  return (
    <details className="relative">
      <summary
        className="btn-ghost !h-8 !px-2.5 text-xs marker:content-none [&::-webkit-details-marker]:hidden"
        title="Restore a prior draft"
      >
        Recall
      </summary>
      <div className="absolute right-0 z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-ink-200 bg-card p-1 dark:border-ink-700">
        <p className="px-2 py-1 font-sans text-[11px] text-ink-500">
          Server recall points. Restoring saves the current draft first.
        </p>
        {items.map((s) => (
          <button
            key={s.id}
            type="button"
            className="btn-ghost w-full !justify-start !px-2.5 !py-1.5 text-left text-xs"
            disabled={disabled || busy}
            onClick={() => {
              const when = formatSavedClock(s.created_at)
              const label = s.note ? `${s.note}` : 'Draft'
              if (
                window.confirm(
                  `Restore version ${s.version}${when ? ` (${when})` : ''} (${label})? Current work is saved first.`,
                )
              ) {
                onRestore(s.id)
              }
            }}
          >
            <span className="font-mono">v{s.version}</span>
            <span className="ml-1.5 text-ink-500">
              {formatSavedClock(s.created_at) || 'undated'}
            </span>
            {s.note ? <span className="mt-0.5 block truncate text-[11px] text-ink-400">{s.note}</span> : null}
          </button>
        ))}
      </div>
    </details>
  )
}
