import clsx from 'clsx'
import { Check } from 'lucide-react'
import { Fragment } from 'react'
import { caseStatusLabel } from '../investigatorLabels'

export type WorkflowStep = 'workspace' | 'review' | 'report'

const STEPS: { id: WorkflowStep; label: string; hint: string }[] = [
  { id: 'workspace', label: 'Intake', hint: 'Complaint + approved WACs' },
  { id: 'review', label: 'Compare', hint: 'Allegation lines per code' },
  { id: 'report', label: 'Report', hint: 'Edit, save, export DOCX' },
]

export type StepperContext = {
  approvedWacCount?: number
  quoteIssueCount?: number
  caseStatus?: string | null
}

type Props = {
  step: WorkflowStep
  onStepChange: (step: WorkflowStep) => void
  unlocked: Record<WorkflowStep, boolean>
  context?: StepperContext
}

export function WorkflowStepper({ step, onStepChange, unlocked, context }: Props) {
  const currentIdx = STEPS.findIndex((s) => s.id === step)
  const chips: { key: string; label: string; tone: 'neutral' | 'ready' | 'warn' }[] = []

  if (context?.approvedWacCount != null) {
    chips.push({
      key: 'wacs',
      label: context.approvedWacCount === 1 ? '1 WAC' : `${context.approvedWacCount} WACs`,
      tone: context.approvedWacCount > 0 ? 'ready' : 'warn',
    })
  }
  if (context?.quoteIssueCount != null && context.quoteIssueCount > 0) {
    chips.push({
      key: 'quotes',
      label:
        context.quoteIssueCount === 1
          ? '1 wording issue'
          : `${context.quoteIssueCount} wording issues`,
      tone: 'warn',
    })
  }
  if (context?.caseStatus) {
    chips.push({
      key: 'status',
      label: caseStatusLabel(context.caseStatus),
      tone: context.caseStatus === 'final' ? 'ready' : 'neutral',
    })
  }

  return (
    <nav
      aria-label="Investigation workflow"
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5"
    >
      <ol className="flex min-w-0 flex-1 items-center">
        {STEPS.map((s, idx) => {
          const active = s.id === step
          const done = idx < currentIdx
          const canGo = unlocked[s.id] || done || active
          const connectorFilled = idx < currentIdx
          return (
            <Fragment key={s.id}>
              <li className="min-w-0">
                <button
                  type="button"
                  disabled={!canGo}
                  onClick={() => canGo && onStepChange(s.id)}
                  title={s.hint}
                  className={clsx(
                    'group flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition lg:gap-2 lg:px-2 lg:py-1.5',
                    canGo ? 'hover:bg-ink-100/80 dark:hover:bg-ink-800/50' : 'cursor-not-allowed opacity-40',
                    active && 'bg-tide-500/8',
                  )}
                >
                  <span
                    className={clsx(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition lg:h-7 lg:w-7 lg:text-xs',
                      active && 'border-tide-600 bg-tide-600 text-white shadow-soft',
                      done && !active && 'border-cedar-500/40 bg-cedar-500/12 text-cedar-600',
                      !active &&
                        !done &&
                        'border-ink-300 bg-card text-ink-500 dark:border-ink-600 dark:bg-ink-900',
                    )}
                  >
                    {done && !active ? <Check className="h-3 w-3 lg:h-3.5 lg:w-3.5" strokeWidth={2.5} /> : idx + 1}
                  </span>
                  <span
                    className={clsx(
                      'text-xs font-semibold tracking-tight lg:text-sm',
                      active ? 'text-ink-900 dark:text-ink-50' : 'text-ink-600 dark:text-ink-300',
                    )}
                  >
                    {s.label}
                  </span>
                </button>
              </li>
              {idx < STEPS.length - 1 && (
                <li aria-hidden className="flex w-3 shrink-0 items-center justify-center lg:w-6">
                  <span
                    className={clsx(
                      'h-px w-full rounded-full',
                      connectorFilled ? 'bg-tide-500/60' : 'bg-ink-200 dark:bg-ink-700',
                    )}
                  />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Case context">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={clsx(
                'status-chip !px-1.5 !py-0 text-[10px] capitalize',
                chip.tone === 'ready' && 'status-chip-ready',
                chip.tone === 'warn' && 'status-chip-warn',
                chip.tone === 'neutral' &&
                  'border-ink-200 bg-ink-50 text-ink-600 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-300',
              )}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}
    </nav>
  )
}
