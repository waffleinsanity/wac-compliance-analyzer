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

function reasonLabel(reason: string): string {
  const r = (reason || '').toLowerCase()
  if (r === 'explicit_cite') return 'Cited in complaint'
  if (r === 'structural_anchor') return 'Structural duty'
  if (r === 'lexical_overlap') return 'Duty overlap with complaint'
  if (r === 'code_fallback') return 'Weak code-level match'
  return reason || 'Matched'
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
          Same ranking as Compare drafts: find codes whose duties overlap this complaint, then
          preview application strength. Research only — never authorization.
        </p>
        <button type="button" className="btn-outline btn-sm shrink-0" disabled={busy} onClick={onSearch}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
          Search
        </button>
      </div>
      <div className={compact ? 'max-h-64 space-y-2 overflow-y-auto p-3' : 'max-h-[28rem] space-y-2 overflow-y-auto p-3'}>
        {!hits.length && (
          <p className="px-1 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            Search ranks WAC/RCW by the duties that would surface if you approved the code — not
            random corpus neighbors. Each hit shows Strong / Moderate / Weak / None on the Compare
            scale, plus the best overlapping duty. Add only if it becomes an officially approved
            code for this case.
          </p>
        )}
        {hits.map((hit) => {
          const codeId = hit.level === 'code' ? hit.id : hit.id.split('(')[0]
          const selected = selectedIds.includes(codeId) || selectedIds.includes(hit.id)
          const strength = applicationStrengthFromMatch({
            score: hit.score,
            reason: hit.reason,
            source: 'research',
            scoreBasis: hit.score_basis || 'ir_leaf',
          })
          const betterFit = Boolean(
            weakestApproved && isStrongerThan(strength, weakestApproved) && !selected,
          )
          return (
            <div key={hit.id} className="border-b border-ink-200/80 py-3 last:border-0 dark:border-ink-700">
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
                      tone="quiet"
                    />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{hit.title}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {reasonLabel(hit.reason)}
                    {hit.duty_label ? ` · ${hit.duty_label}` : ''}
                  </div>
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
