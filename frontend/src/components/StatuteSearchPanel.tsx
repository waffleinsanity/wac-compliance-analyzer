import { Loader2, Plus, Search } from 'lucide-react'
import type { StatuteHit, WACComparison } from '../api'
import {
  applicationStrengthFromMatch,
  isStrongerThan,
} from '../applicationStrength'
import { ApplicationStrengthBadge } from './ApplicationStrengthBadge'

type Props = {
  hits: StatuteHit[]
  busy: boolean
  onSearch: () => void
  onAddCode: (codeId: string) => void
  selectedIds: string[]
  /** Approved-code comparisons — used to flag research hits that look stronger. */
  comparisons?: WACComparison[]
  compact?: boolean
}

export function StatuteSearchPanel({
  hits,
  busy,
  onSearch,
  onAddCode,
  selectedIds,
  comparisons = [],
  compact = false,
}: Props) {
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
    <div className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-2">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Rank local WAC/RCW language against this complaint to spot codes that may apply more
          strongly than your current approvals. Research only — not authorization.
        </p>
        <button type="button" className="btn-outline btn-sm shrink-0" disabled={busy} onClick={onSearch}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
          Search
        </button>
      </div>
      <div className={compact ? 'max-h-64 space-y-2 overflow-y-auto p-3' : 'max-h-[28rem] space-y-2 overflow-y-auto p-3'}>
        {!hits.length && (
          <p className="px-1 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            Search the local PDF corpus for additional WAC/RCW that may better fit the allegation.
            Each hit shows Strong / Moderate / Weak / No clear application — the same scale used on
            Compare. Add a hit only if it becomes an officially approved code for this case.
          </p>
        )}
        {hits.map((hit) => {
          const codeId = hit.level === 'code' ? hit.id : hit.id.split('(')[0]
          const selected = selectedIds.includes(codeId) || selectedIds.includes(hit.id)
          const strength = applicationStrengthFromMatch({
            score: hit.score,
            reason: hit.reason,
            source: 'research',
          })
          const betterFit = Boolean(
            weakestApproved && isStrongerThan(strength, weakestApproved) && !selected,
          )
          return (
            <div key={hit.id} className="rounded-xl border border-ink-200/70 bg-muted/20 p-3 dark:border-ink-700">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-mono text-xs font-semibold">
                      {hit.instrument} {hit.code}
                    </div>
                    <ApplicationStrengthBadge
                      strength={strength}
                      source="research"
                      short
                      betterFit={betterFit}
                    />
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
