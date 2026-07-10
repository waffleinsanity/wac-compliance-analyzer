import clsx from 'clsx'
import { FileText, GitCompare, ScrollText } from 'lucide-react'

export type WorkflowStep = 'intake' | 'compare' | 'report'

const STEPS: { id: WorkflowStep; label: string; Icon: typeof FileText }[] = [
  { id: 'intake', label: 'Intake', Icon: FileText },
  { id: 'compare', label: 'Compare', Icon: GitCompare },
  { id: 'report', label: 'Report', Icon: ScrollText },
]

type Props = {
  step: WorkflowStep
  onStepChange: (s: WorkflowStep) => void
  canCompare: boolean
  canReport: boolean
}

export function WorkflowStepper({ step, onStepChange, canCompare, canReport }: Props) {
  return (
    <ol className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink-200/80 bg-white/70 p-2 dark:border-ink-700 dark:bg-ink-900/50">
      {STEPS.map(({ id, label, Icon }, idx) => {
        const enabled =
          id === 'intake' || (id === 'compare' && canCompare) || (id === 'report' && canReport)
        const active = step === id
        return (
          <li key={id} className="flex items-center gap-2">
            {idx > 0 && <span className="hidden h-px w-6 bg-ink-300 sm:block dark:bg-ink-600" />}
            <button
              type="button"
              disabled={!enabled}
              onClick={() => enabled && onStepChange(id)}
              className={clsx(
                'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition',
                active
                  ? 'bg-ink-800 text-ink-50 dark:bg-cedar-500 dark:text-ink-950'
                  : enabled
                    ? 'text-ink-600 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'
                    : 'cursor-not-allowed text-ink-300 dark:text-ink-600',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>
                {idx + 1}. {label}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
