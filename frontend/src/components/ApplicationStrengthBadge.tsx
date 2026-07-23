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
  /**
   * `badge` — bordered chip (research / dense lists).
   * `quiet` — sentence-case secondary text (Compare allegation chrome).
   */
  tone?: 'badge' | 'quiet'
}

const STYLES: Record<ApplicationStrength, string> = {
  strong: 'text-emerald-800 dark:text-emerald-300',
  moderate: 'text-sky-800 dark:text-sky-300',
  weak: 'text-amber-900 dark:text-amber-300',
  none: 'text-ink-500 dark:text-ink-400',
}

const QUIET: Record<ApplicationStrength, string> = {
  strong: 'text-emerald-800 dark:text-emerald-300',
  moderate: 'text-sky-800 dark:text-sky-300',
  weak: 'text-amber-800 dark:text-amber-300',
  none: 'text-ink-500 dark:text-ink-400',
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
  tone = 'badge',
}: Props) {
  const value =
    strength ||
    applicationStrengthFromMatch({ score, reason, lowConfidence, source })

  const label = applicationStrengthLabel(value, { short })
  const title =
    'How well this code appears to apply to the complaint (research signal — not authorization)'

  if (tone === 'quiet') {
    return (
      <span className={clsx('inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
        <span className={clsx('font-sans text-xs', QUIET[value])} title={title}>
          {label}
        </span>
        {betterFit && (
          <span className="font-sans text-xs text-tide-700 dark:text-tide-300">Stronger fit?</span>
        )}
      </span>
    )
  }

  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-1.5', className)}>
      <span
        className={clsx(
          'font-sans text-[11px] font-medium',
          STYLES[value],
        )}
        title={title}
      >
        {label}
      </span>
      {betterFit && (
        <span className="font-sans text-[11px] font-medium text-tide-700 dark:text-tide-300">
          Stronger fit?
        </span>
      )}
    </span>
  )
}
