import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import type { FacilityInfo, InvestigationReport } from '../api'

type Props = {
  report: InvestigationReport
  onChange: (next: InvestigationReport) => void
}

function rebuildReportText(report: InvestigationReport): string {
  // Prefer server-built text when structure unchanged; otherwise rebuild a readable export.
  const fi = report.facility_info
  const lines: string[] = [
    report.title || 'Investigative Report',
    report.subtitle || 'State Investigation',
    `Date(s) of Investigation: ${fi.investigation_dates || report.investigation_date || 'XX/XX/XX'}`,
  ]
  if (report.case_id) lines.push(`Case Number: ${report.case_id}`)
  if (fi.facility_address) lines.push(`Subject / Facility: ${fi.facility_address}`)
  if (fi.credential_number) lines.push(`Credential Number: ${fi.credential_number}`)
  lines.push('', `Intake Details:`, report.intake_details, '')
  lines.push('Regulatory Framework:', report.authority_statement, '')
  for (const entry of report.regulatory_framework || []) {
    lines.push(`WAC ${entry.wac_code} — ${entry.wac_title}`)
    for (const sub of entry.matched_subsections || []) {
      lines.push(`  ${sub.label || '(section)'}: ${sub.snippet}`)
    }
    lines.push('')
  }
  lines.push(`Allegation/s: (${report.allegation_preamble})`)
  for (const a of report.allegations) {
    lines.push(`Allegation: ${a.allegation_text}`)
    if (a.matched_subsections?.length) {
      lines.push(`  Matched subsections: ${a.matched_subsections.join(', ')}`)
    }
    lines.push('')
  }
  lines.push('Investigative Process Included:')
  for (const step of report.investigative_process) lines.push(`- ${step}`)
  lines.push('', 'Evidentiary Framework (5 Examples):')
  ;(report.evidentiary_examples || []).forEach((ex, i) => lines.push(`${i + 1}. ${ex}`))
  lines.push('', 'Summary of Findings', report.summary_of_findings, '')
  lines.push('Conclusion / Results of Investigation:')
  for (const c of report.conclusions) {
    lines.push(`Allegation: ${c.allegation_text} ${c.result}.`)
  }
  lines.push('', 'Actions:', report.actions || '[To be determined after investigation]')
  return lines.join('\n').trim() + '\n'
}

export function InvestigationReportEditor({ report, onChange }: Props) {
  const [copied, setCopied] = useState(false)
  const [local, setLocal] = useState(report)

  useEffect(() => {
    setLocal(report)
  }, [report])

  const exportText = useMemo(() => rebuildReportText(local), [local])

  const patch = (partial: Partial<InvestigationReport>) => {
    const next = { ...local, ...partial }
    setLocal(next)
    onChange(next)
  }

  const patchFacility = (partial: Partial<FacilityInfo>) => {
    patch({ facility_info: { ...local.facility_info, ...partial } })
  }

  const updateAllegation = (idx: number, allegation_text: string) => {
    const allegations = local.allegations.map((a, i) =>
      i === idx ? { ...a, allegation_text } : a,
    )
    const conclusions = local.conclusions.map((c) => {
      const match = allegations.find((a) => a.wac_code === c.wac_code)
      return match ? { ...c, allegation_text: match.allegation_text } : c
    })
    patch({ allegations, conclusions })
  }

  const updateConclusion = (idx: number, result: string) => {
    const conclusions = local.conclusions.map((c, i) => (i === idx ? { ...c, result } : c))
    patch({ conclusions })
  }

  const updateEvidence = (idx: number, value: string) => {
    const evidentiary_examples = [...(local.evidentiary_examples || [])]
    evidentiary_examples[idx] = value
    patch({ evidentiary_examples })
  }

  const copy = async () => {
    await navigator.clipboard.writeText(exportText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const download = () => {
    const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${local.case_id || 'investigation'}-report.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200/80 p-4 dark:border-ink-700/80">
        <div>
          <h2 className="font-display text-xl">Investigation Report</h2>
          <p className="text-sm text-ink-500">
            Edit placeholders, allegations, and evidentiary examples · export as text
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => void copy()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy
          </button>
          <button type="button" className="btn-primary" onClick={download}>
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section className="grid gap-3 sm:grid-cols-2">
          <h3 className="font-display text-lg sm:col-span-2">Header / facility</h3>
          <label className="block">
            <span className="label">Case number</span>
            <input
              className="input"
              value={local.case_id || ''}
              onChange={(e) => patch({ case_id: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">Investigation date(s)</span>
            <input
              className="input"
              value={local.facility_info.investigation_dates}
              onChange={(e) => patchFacility({ investigation_dates: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">Subject / facility</span>
            <input
              className="input"
              value={local.facility_info.facility_address}
              onChange={(e) => patchFacility({ facility_address: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">Credential number</span>
            <input
              className="input"
              value={local.facility_info.credential_number}
              onChange={(e) => patchFacility({ credential_number: e.target.value })}
            />
          </label>
        </section>

        <section>
          <h3 className="mb-2 font-display text-lg">Intake details</h3>
          <textarea
            className="input min-h-[100px] font-mono text-sm"
            value={local.intake_details}
            onChange={(e) => patch({ intake_details: e.target.value })}
          />
        </section>

        <section>
          <h3 className="mb-2 font-display text-lg">Regulatory framework</h3>
          <p className="mb-3 rounded-xl border border-ink-200/80 bg-ink-50/70 p-3 text-sm leading-relaxed dark:border-ink-700 dark:bg-ink-950/40">
            {local.authority_statement}
          </p>
          <div className="space-y-3">
            {(local.regulatory_framework || []).map((entry) => (
              <div
                key={entry.wac_code}
                className="rounded-xl border border-ink-200/80 p-3 dark:border-ink-700"
              >
                <div className="font-mono text-sm font-semibold">
                  WAC {entry.wac_code} — {entry.wac_title}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-ink-700 dark:text-ink-200">
                  {(entry.matched_subsections || []).length ? (
                    entry.matched_subsections.map((s) => (
                      <li key={s.cite}>
                        <span className="font-mono text-xs">{s.label || s.cite}</span>: {s.snippet}
                      </li>
                    ))
                  ) : (
                    <li className="text-ink-500">No specific subsection isolated.</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-display text-lg">Allegations</h3>
          <p className="mb-3 text-xs text-ink-500">{local.allegation_preamble}</p>
          <div className="space-y-3">
            {local.allegations.map((a, idx) => (
              <div key={a.wac_code} className="rounded-xl border border-ink-200/80 p-3 dark:border-ink-700">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <span className="rounded bg-ink-100 px-2 py-0.5 font-semibold dark:bg-ink-800">
                    {a.case_category}
                  </span>
                  <span className="font-mono">WAC {a.wac_code}</span>
                  {!!a.matched_subsections?.length && (
                    <span>{a.matched_subsections.join(', ')}</span>
                  )}
                </div>
                <textarea
                  className="input min-h-[90px] font-mono text-sm"
                  value={a.allegation_text}
                  onChange={(e) => updateAllegation(idx, e.target.value)}
                />
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-display text-lg">Investigative process</h3>
          <textarea
            className="input min-h-[120px] font-mono text-sm"
            value={local.investigative_process.join('\n')}
            onChange={(e) =>
              patch({
                investigative_process: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </section>

        <section>
          <h3 className="mb-2 font-display text-lg">Evidentiary framework (5 examples)</h3>
          <div className="space-y-2">
            {(local.evidentiary_examples || []).map((ex, idx) => (
              <label key={idx} className="block">
                <span className="label">Example {idx + 1}</span>
                <textarea
                  className="input min-h-[70px] text-sm"
                  value={ex}
                  onChange={(e) => updateEvidence(idx, e.target.value)}
                />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-display text-lg">Summary of findings</h3>
          <textarea
            className="input min-h-[120px] text-sm"
            value={local.summary_of_findings}
            onChange={(e) => patch({ summary_of_findings: e.target.value })}
          />
        </section>

        <section>
          <h3 className="mb-2 font-display text-lg">Conclusions</h3>
          <div className="space-y-3">
            {local.conclusions.map((c, idx) => (
              <div key={c.wac_code} className="rounded-xl border border-ink-200/80 p-3 dark:border-ink-700">
                <div className="mb-2 font-mono text-xs text-ink-500">WAC {c.wac_code}</div>
                <p className="mb-2 text-sm text-ink-700 dark:text-ink-200">{c.allegation_text}</p>
                <select
                  className="input"
                  value={c.result}
                  onChange={(e) => updateConclusion(idx, e.target.value)}
                >
                  <option>Pending Investigation</option>
                  <option>Substantiated</option>
                  <option>Unsubstantiated</option>
                </select>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-display text-lg">Actions</h3>
          <textarea
            className="input min-h-[80px] text-sm"
            value={local.actions}
            onChange={(e) => patch({ actions: e.target.value })}
          />
        </section>
      </div>
    </div>
  )
}
