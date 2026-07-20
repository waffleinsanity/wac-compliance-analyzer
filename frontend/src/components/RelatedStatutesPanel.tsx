import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Plus, Sparkles } from 'lucide-react'
import type { StatuteHit } from '../api'

type Props = {
  suggestions: StatuteHit[]
  busy: boolean
  onRefresh: () => void
  onAddCode: (codeId: string) => void
  selectedIds: string[]
  hasSelection: boolean
}

export function RelatedStatutesPanel({
  suggestions,
  busy,
  onRefresh,
  onAddCode,
  selectedIds,
  hasSelection,
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-col border-t bg-muted/5">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Sparkles className="h-3.5 w-3.5" />
            Research — not authorization
          </div>
          <p className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
            Related WAC/RCW suggestions · optional only
          </p>
        </div>
      </button>

      {open && (
        <>
          <div className="flex items-center justify-end border-b px-3 pb-2">
            <button
              type="button"
              className="btn-ghost btn-sm !px-2 text-xs"
              disabled={!hasSelection || busy}
              onClick={onRefresh}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Suggest related'}
            </button>
          </div>
          <div className="max-h-48 min-h-0 space-y-2 overflow-y-auto p-2">
            {!hasSelection && (
              <p className="p-2 text-xs text-muted-foreground">
                First select the officially approved WACs for this case. Related suggestions are optional
                research afterward.
              </p>
            )}
            {hasSelection && !suggestions.length && !busy && (
              <p className="p-2 text-xs text-muted-foreground">
                Click “Suggest related” if you want optional secondary WAC/RCW language to research. Nothing
                here is required for the Investigative Report.
              </p>
            )}
            {suggestions.map((hit) => {
              const codeId = hit.level === 'code' ? hit.id : hit.id.split('(')[0]
              const selected = selectedIds.includes(codeId)
              return (
                <div key={hit.id} className="rounded-md border bg-background p-2">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-semibold">
                        {hit.instrument} {hit.code}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{hit.title}</div>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost h-7 w-7 p-0"
                      disabled={selected}
                      onClick={() => onAddCode(codeId)}
                      title="Add only if officially approved for this case"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-foreground/80">{hit.excerpt}</p>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
