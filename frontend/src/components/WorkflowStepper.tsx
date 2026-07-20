import clsx from 'clsx'
import { Check } from 'lucide-react'
import { Fragment } from 'react'

export type WorkflowStep = 'workspace' | 'review' | 'report'

const STEPS: { id: WorkflowStep; label: string; hint: string }[] = [
  { id: 'workspace', label: 'Intake', hint: 'Complaint + approved WACs' },
  { id: 'review', label: 'Compare', hint: 'Allegation lines per code' },
  { id: 'report', label: 'Report', hint: 'Edit, save, export DOCX' },
]

type Props = {
  step: WorkflowStep
  onStepChange: (step: WorkflowStep) => void
  unlocked: Record<WorkflowStep, boolean>
}

export function WorkflowStepper({ step, onStepChange, unlocked }: Props) {
  const currentIdx = STEPS.findIndex((s) => s.id === step)

  return (
    <nav aria-label="Investigation workflow" className="w-full">
      <ol className="flex items-start">
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
                    'group flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition',
                    canGo ? 'hover:bg-ink-100/80 dark:hover:bg-ink-800/50' : 'cursor-not-allowed opacity-40',
                    active && 'bg-tide-500/8',
                  )}
                >
                  <span
                    className={clsx(
                      'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition',
                      active && 'border-tide-600 bg-tide-600 text-white shadow-soft',
                      done && !active && 'border-cedar-500/40 bg-cedar-500/12 text-cedar-600',
                      !active &&
                        !done &&
                        'border-ink-300 bg-card text-ink-500 dark:border-ink-600 dark:bg-ink-900',
                    )}
                  >
                    {done && !active ? <Check className="h-4 w-4" strokeWidth={2.5} /> : idx + 1}
                  </span>
                  <span className="min-w-0 pt-0.5">
                    <span
                      className={clsx(
                        'block text-sm font-semibold tracking-tight',
                        active ? 'text-ink-900 dark:text-ink-50' : 'text-ink-600 dark:text-ink-300',
                      )}
                    >
                      {s.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-400">{s.hint}</span>
                  </span>
                </button>
              </li>
              {idx < STEPS.length - 1 && (
                <li
                  aria-hidden
                  className="flex w-6 shrink-0 items-start justify-center pt-[1.35rem] sm:w-10"
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
    </nav>
  )
}
