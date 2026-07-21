import clsx from 'clsx'
import {
  applicationStrengthFromMatch,
  applicationStrengthLabel,
  type ApplicationStrength,
  type ApplicationStrengthSource,
} from '../applicationStrength'

type Props = {
  strength?: ApplicationStrength
  score?: number | null
  reason?: string | null
  lowConfidence?: boolean | null
  source?: ApplicationStrengthSource
  short?: boolean
  className?: string
  /** Optional callout when this hit looks stronger than current approvals. */
  betterFit?: boolean
}

const STYLES: Record<ApplicationStrength, string> = {
  strong:
    'border-emerald-500/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
  moderate: 'border-sky-500/35 bg-sky-500/10 text-sky-900 dark:text-sky-100',
  weak: 'border-amber-500/35 bg-amber-500/10 text-amber-950 dark:text-amber-100',
  none: 'border-ink-300/60 bg-ink-100/70 text-ink-600 dark:border-ink-600 dark:bg-ink-800/50 dark:text-ink-300',
}

export function ApplicationStrengthBadge({
  strength,
  score,
  reason,
  lowConfidence,
  source = 'ir_match',
  short = false,
  className,
  betterFit = false,
}: Props) {
  const value =
    strength ||
    applicationStrengthFromMatch({ score, reason, lowConfidence, source })

  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-1', className)}>
      <span
        className={clsx(
          'rounded-md border px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide',
          STYLES[value],
        )}
        title="How well this code appears to apply to the complaint (research signal — not authorization)"
      >
        {applicationStrengthLabel(value, { short })}
      </span>
      {betterFit && (
        <span className="rounded-md border border-tide-500/40 bg-tide-500/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-tide-900 dark:text-tide-100">
          Stronger fit?
        </span>
      )}
    </span>
  )
}
