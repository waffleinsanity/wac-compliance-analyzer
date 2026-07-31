import { Shield } from 'lucide-react'
import clsx from 'clsx'

type Variant = 'workspace' | 'evidence'

type Props = {
  variant?: Variant
  className?: string
  compact?: boolean
}

const COPY: Record<Variant, { title: string; body: string }> = {
  workspace: {
    title: 'Privacy screen — Category 3/4 PII & PHI',
    body:
      'Complaint text is scanned for information beyond public Category 1 (including confidential and HIPAA-related identifiers). Flagged spans are audited in this workspace and can be redacted or censored before drafting, saving, or sending text to investigation tools. Public Category 1 content may remain. This is an assistive check, not a legal determination — investigators remain responsible for final sensitivity judgment.',
  },
  evidence: {
    title: 'Privacy screen — Category 3/4 PII & PHI',
    body:
      'Evidence text (.txt/.md/.pdf/.docx) is scanned for Category 3/4 PII/PHI. Text uploads are auto-redacted; PDF/DOCX with hits are blocked until de-identified. Images are not text-scanned — prefer de-identified exhibits. This is an assistive check, not a legal determination.',
  },
}

export function PrivacyScreenBanner({ variant = 'workspace', className, compact = false }: Props) {
  const { title, body } = COPY[variant]
  return (
    <div
      role="status"
      className={clsx(
        'flex gap-3 border-l-2 border-tide-600 bg-tide-500/[0.06] text-sm text-ink-700 dark:border-tide-400 dark:bg-tide-500/10 dark:text-ink-200',
        compact ? 'px-3 py-2' : 'px-3.5 py-3',
        className,
      )}
    >
      <Shield
        className={clsx(
          'shrink-0 text-tide-700 dark:text-tide-300',
          compact ? 'mt-0.5 h-3.5 w-3.5' : 'mt-0.5 h-4 w-4',
        )}
        aria-hidden
      />
      <div className="min-w-0 space-y-1">
        <p
          className={clsx(
            'font-sans font-semibold text-ink-900 dark:text-ink-50',
            compact ? 'text-xs' : 'text-[13px]',
          )}
        >
          {title}
        </p>
        <p
          className={clsx(
            'leading-relaxed text-ink-600 dark:text-ink-300',
            compact ? 'hidden text-[11px] sm:block' : 'text-[13px]',
          )}
        >
          {body}
        </p>
      </div>
    </div>
  )
}
