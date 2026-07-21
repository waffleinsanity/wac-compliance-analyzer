import { Loader2, Plus, Search } from 'lucide-react'
import type { StatuteHit } from '../api'

type Props = {
  hits: StatuteHit[]
  busy: boolean
  onSearch: () => void
  onAddCode: (codeId: string) => void
  selectedIds: string[]
}

export function StatuteSearchPanel({ hits, busy, onSearch, onAddCode, selectedIds }: Props) {
  return (
    <div className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-2 py-2">
        <p className="text-xs text-muted-foreground">Search local WAC/RCW text for research context.</p>
        <button type="button" className="btn-outline btn-sm shrink-0" disabled={busy} onClick={onSearch}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
          Search
        </button>
      </div>
      <div className="max-h-[28rem] space-y-2 overflow-y-auto p-3">
        {!hits.length && (
          <p className="px-1 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            Search local WAC/RCW language when you need research context. Add a hit only if it becomes an
            officially approved code for this case.
          </p>
        )}
        {hits.map((hit) => {
          const codeId = hit.level === 'code' ? hit.id : hit.id.split('(')[0]
          const selected = selectedIds.includes(codeId) || selectedIds.includes(hit.id)
          return (
            <div key={hit.id} className="rounded-xl border border-ink-200/70 bg-muted/20 p-3 dark:border-ink-700">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold">
                    {hit.instrument} {hit.code}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{hit.title}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost btn-sm !px-2"
                    disabled={selected}
                    title="Add only if this code is officially approved for the case"
                    onClick={() => onAddCode(codeId)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="prose-report mt-2 text-xs text-foreground/90">{hit.excerpt}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
