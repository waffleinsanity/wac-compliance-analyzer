import clsx from 'clsx'
import { Check } from 'lucide-react'
import { Fragment } from 'react'
import { caseStatusLabel } from '../investigatorLabels'

export type WorkflowStep = 'workspace' | 'review' | 'report'

const STEPS: { id: WorkflowStep; label: string; hint: string }[] = [
  { id: 'workspace', label: 'Intake', hint: 'Complaint + approved WACs' },
  { id: 'review', label: 'Compare', hint: 'Allegation lines per code' },
  { id: 'report', label: 'Documents', hint: 'IR + SOD sister drafts, save, export' },
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
  const meta: { key: string; label: string; tone: 'neutral' | 'ready' | 'warn' }[] = []

  if (context?.approvedWacCount != null) {
    meta.push({
      key: 'wacs',
      label: context.approvedWacCount === 1 ? '1 WAC' : `${context.approvedWacCount} WACs`,
      tone: context.approvedWacCount > 0 ? 'ready' : 'warn',
    })
  }
  if (context?.quoteIssueCount != null && context.quoteIssueCount > 0) {
    meta.push({
      key: 'quotes',
      label:
        context.quoteIssueCount === 1
          ? '1 wording issue'
          : `${context.quoteIssueCount} wording issues`,
      tone: 'warn',
    })
  }
  if (context?.caseStatus) {
    meta.push({
      key: 'status',
      label: caseStatusLabel(context.caseStatus),
      tone: context.caseStatus === 'final' ? 'ready' : 'neutral',
    })
  }

  return (
    <nav
      aria-label="Investigation workflow"
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5"
    >
      <ol className="flex min-w-0 flex-1 items-baseline gap-0">
        {STEPS.map((s, idx) => {
          const active = s.id === step
          const done = idx < currentIdx
          const canGo = unlocked[s.id] || done || active
          return (
            <Fragment key={s.id}>
              <li className="min-w-0">
                <button
                  type="button"
                  disabled={!canGo}
                  onClick={() => canGo && onStepChange(s.id)}
                  title={s.hint}
                  className={clsx(
                    'group flex items-baseline gap-1.5 px-0.5 py-1 text-left transition',
                    canGo ? 'hover:opacity-90' : 'cursor-not-allowed opacity-40',
                  )}
                >
                  <span
                    className={clsx(
                      'font-mono text-[10px] tabular-nums',
                      active ? 'text-tide-700 dark:text-tide-300' : 'text-ink-400',
                    )}
                  >
                    {done && !active ? (
                      <Check className="inline h-3 w-3" strokeWidth={2.5} aria-hidden />
                    ) : (
                      String(idx + 1).padStart(2, '0')
                    )}
                  </span>
                  <span
                    className={clsx(
                      'font-display text-sm tracking-tight lg:text-[15px]',
                      active
                        ? 'border-b-2 border-tide-600 text-ink-900 dark:border-tide-400 dark:text-ink-50'
                        : done
                          ? 'text-ink-600 dark:text-ink-300'
                          : 'text-ink-500 dark:text-ink-400',
                    )}
                  >
                    {s.label}
                  </span>
                </button>
              </li>
              {idx < STEPS.length - 1 && (
                <li aria-hidden className="mx-2 flex items-center text-ink-300 dark:text-ink-600 lg:mx-3">
                  <span className="text-[10px]">/</span>
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>

      {meta.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Case context">
          {meta.map((item) => (
            <span
              key={item.key}
              className={clsx(
                'font-sans text-[11px]',
                item.tone === 'ready' && 'text-tide-800 dark:text-tide-300',
                item.tone === 'warn' && 'text-cedar-600 dark:text-[#d4a574]',
                item.tone === 'neutral' && 'text-ink-500 dark:text-ink-400',
              )}
            >
              {item.label}
            </span>
          ))}
        </div>
      )}
    </nav>
  )
}
