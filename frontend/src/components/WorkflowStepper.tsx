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

function formatStatus(status: string): string {
  return caseStatusLabel(status)
}

export function WorkflowStepper({ step, onStepChange, unlocked, context }: Props) {
  const currentIdx = STEPS.findIndex((s) => s.id === step)
  const chips: { key: string; label: string; tone: 'neutral' | 'ready' | 'warn' }[] = []

  if (context?.approvedWacCount != null) {
    chips.push({
      key: 'wacs',
      label:
        context.approvedWacCount === 1
          ? '1 WAC'
          : `${context.approvedWacCount} WACs`,
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
      label: formatStatus(context.caseStatus),
      tone: context.caseStatus === 'final' ? 'ready' : 'neutral',
    })
  }

  return (
    <nav aria-label="Investigation workflow" className="w-full space-y-1.5 sm:space-y-2">
      <ol className="flex items-center sm:items-start">
        {STEPS.map((s, idx) => {
          const active = s.id === step
          const done = idx < currentIdx
          const canGo = unlocked[s.id] || done || active
          const connectorFilled = idx < currentIdx
          return (
            <Fragment key={s.id}>
              <li className="min-w-0 flex-1">
                <button
                  type="button"
                  disabled={!canGo}
                  onClick={() => canGo && onStepChange(s.id)}
                  className={clsx(
                    'group flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition sm:items-start sm:gap-3 sm:rounded-xl sm:px-2 sm:py-2',
                    canGo ? 'hover:bg-ink-100/80 dark:hover:bg-ink-800/50' : 'cursor-not-allowed opacity-40',
                    active && 'bg-tide-500/8',
                  )}
                >
                  <span
                    className={clsx(
                      'flex shrink-0 items-center justify-center rounded-full border font-semibold transition',
                      'h-7 w-7 text-xs sm:mt-0.5 sm:h-9 sm:w-9 sm:text-sm',
                      active && 'border-tide-600 bg-tide-600 text-white shadow-soft',
                      done && !active && 'border-cedar-500/40 bg-cedar-500/12 text-cedar-600',
                      !active &&
                        !done &&
                        'border-ink-300 bg-card text-ink-500 dark:border-ink-600 dark:bg-ink-900',
                    )}
                  >
                    {done && !active ? <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={2.5} /> : idx + 1}
                  </span>
                  <span className="min-w-0 sm:pt-0.5">
                    <span
                      className={clsx(
                        'block text-xs font-semibold tracking-tight sm:text-sm',
                        active ? 'text-ink-900 dark:text-ink-50' : 'text-ink-600 dark:text-ink-300',
                      )}
                    >
                      {s.label}
                    </span>
                    <span className="mt-0.5 hidden text-xs text-ink-400 sm:block">{s.hint}</span>
                  </span>
                </button>
              </li>
              {idx < STEPS.length - 1 && (
                <li
                  aria-hidden
                  className="flex w-4 shrink-0 items-center justify-center sm:w-10 sm:items-start sm:pt-[1.35rem]"
                >
                  <span
                    className={clsx(
                      'h-0.5 w-full rounded-full',
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
        <div className="flex flex-wrap items-center gap-1 px-1 sm:gap-1.5 sm:px-2" aria-label="Case context">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={clsx(
                'status-chip !px-1.5 !py-0 text-[10px] capitalize sm:!px-2 sm:!py-0.5',
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
