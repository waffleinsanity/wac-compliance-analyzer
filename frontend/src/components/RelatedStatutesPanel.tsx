import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Plus, Sparkles } from 'lucide-react'
import type { StatuteHit, WACComparison } from '../api'
import {
  applicationStrengthFromMatch,
  isStrongerThan,
} from '../applicationStrength'
import { ApplicationStrengthBadge } from './ApplicationStrengthBadge'

type Props = {
  suggestions: StatuteHit[]
  busy: boolean
  onRefresh: () => void
  onAddCode: (codeId: string) => void
  selectedIds: string[]
  hasSelection: boolean
  comparisons?: WACComparison[]
}

export function RelatedStatutesPanel({
  suggestions,
  busy,
  onRefresh,
  onAddCode,
  selectedIds,
  hasSelection,
  comparisons = [],
}: Props) {
  const [open, setOpen] = useState(false)

  const weakestApproved = comparisons.reduce<ReturnType<typeof applicationStrengthFromMatch> | null>(
    (worst, c) => {
      const s = applicationStrengthFromMatch({
        score: c.match_score,
        reason: c.match_reason,
        lowConfidence: c.low_confidence,
        source: 'ir_match',
      })
      if (!worst) return s
      const order = { none: 0, weak: 1, moderate: 2, strong: 3 }
      return order[s] < order[worst] ? s : worst
    },
    null,
  )

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
            Research — find stronger fits
          </div>
          <p className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
            Related WAC/RCW with application strength · not authorization
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
          <div className="max-h-56 min-h-0 space-y-2 overflow-y-auto p-2">
            {!hasSelection && (
              <p className="p-2 text-xs text-muted-foreground">
                Select approved WACs first. Then suggest related codes that may apply more strongly to
                the complaint.
              </p>
            )}
            {hasSelection && !suggestions.length && !busy && (
              <p className="p-2 text-xs text-muted-foreground">
                Suggest related WAC/RCW to compare application strength (Strong / Moderate / Weak /
                None) against your current approvals.
              </p>
            )}
            {suggestions.map((hit) => {
              const codeId = hit.level === 'code' ? hit.id : hit.id.split('(')[0]
              const selected = selectedIds.includes(codeId)
              const strength = applicationStrengthFromMatch({
                score: hit.score,
                reason: hit.reason,
                source: 'research',
              })
              const betterFit = Boolean(
                weakestApproved && isStrongerThan(strength, weakestApproved) && !selected,
              )
              return (
                <div key={hit.id} className="rounded-md border bg-background p-2">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <div className="font-mono text-[11px] font-semibold">
                          {hit.instrument} {hit.code}
                        </div>
                        <ApplicationStrengthBadge
                          strength={strength}
                          source="research"
                          short
                          betterFit={betterFit}
                        />
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
