import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'
import type { AnalyzeResponse, ComplianceFinding } from '../api'

const STATUS_STYLES: Record<ComplianceFinding['status'], string> = {
  COMPLIES: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
  'NON-COMPLIANT': 'bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-500/30',
  PARTIAL: 'bg-amber-500/15 text-amber-900 dark:text-amber-300 border-amber-500/30',
  INFORMATIONAL: 'bg-tide-500/15 text-tide-600 dark:text-tide-400 border-tide-500/30',
  INSUFFICIENT: 'bg-ink-500/10 text-ink-700 dark:text-ink-200 border-ink-400/30',
}

function FindingCard({ finding }: { finding: ComplianceFinding }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(finding.formatted_output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <article className="animate-rise rounded-2xl border border-ink-200/80 bg-white/70 p-4 dark:border-ink-700 dark:bg-ink-900/50">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm font-semibold text-ink-900 dark:text-ink-50">
            {finding.wac_reference}
          </div>
          <div className="text-sm text-ink-600 dark:text-ink-300">{finding.title}</div>
          <div className="mt-1 text-xs text-ink-400">{finding.template}</div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'rounded-full border px-2.5 py-1 text-xs font-semibold',
              STATUS_STYLES[finding.status],
            )}
          >
            {finding.status}
          </span>
          <span className="rounded-full bg-ink-100 px-2.5 py-1 font-mono text-xs dark:bg-ink-800">
            {Math.round(finding.confidence * 100)}%
          </span>
          <button type="button" className="btn-secondary !px-2.5 !py-1.5" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="whitespace-pre-wrap rounded-xl bg-ink-50/80 p-3 font-mono text-sm leading-relaxed text-ink-800 dark:bg-ink-950/50 dark:text-ink-100">
        {finding.formatted_output}
      </p>
      {!!finding.matched_phrases.length && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {finding.matched_phrases.map((p) => (
            <span
              key={p}
              className="rounded-lg bg-cedar-500/10 px-2 py-1 text-xs text-cedar-600 dark:text-cedar-400"
            >
              {p}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

export function ResultsDisplay({ result }: { result: AnalyzeResponse | null }) {
  const [copiedAll, setCopiedAll] = useState(false)
  if (!result) {
    return (
      <div className="panel flex min-h-[280px] items-center justify-center p-8 text-center text-ink-500">
        Run an analysis to see compliance findings formatted to the five output templates.
      </div>
    )
  }

  const copyAll = async () => {
    const text = result.findings.map((f) => f.formatted_output).join('\n\n')
    await navigator.clipboard.writeText(text)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="font-display text-xl">Results</h2>
          <p className="text-sm text-ink-500">
            {result.findings.length} findings · {result.selected_count} WACs · {result.duration_ms} ms
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={copyAll}>
          {copiedAll ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          Copy all
        </button>
      </div>
      <div className="space-y-3">
        {result.findings.map((f) => (
          <FindingCard key={f.hierarchy_path + f.status} finding={f} />
        ))}
      </div>
    </div>
  )
}
