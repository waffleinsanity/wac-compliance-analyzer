import { useState } from 'react'
import clsx from 'clsx'
import { FileDown, Link2, Loader2, Plus } from 'lucide-react'
import {
  api,
  DPOC_ACTION_OPTIONS,
  recommendEnforcementOutcomes,
  SOD_SCOPE_OPTIONS,
  SOD_SEVERITY_OPTIONS,
  type CaseEvidence,
  type InvestigationReport,
  type SodDeficiency,
  type SodFinding,
  type StatementOfDeficiency,
} from '../api'

type Props = {
  report: InvestigationReport
  onReportChange?: (report: InvestigationReport) => void
  canEdit?: boolean
  canExport?: boolean
  busy?: boolean
  activeCaseId?: number | null
  evidence?: CaseEvidence[]
  onEnsureCase?: (report: InvestigationReport) => Promise<number>
}

function emptySod(report: InvestigationReport): StatementOfDeficiency {
  return {
    title: 'Statement of Deficiency Report',
    facility_address: report.facility_info?.facility_address || '',
    case_id: report.case_id || '',
    credential_number: report.facility_info?.credential_number || '',
    investigation_dates: report.facility_info?.investigation_dates || report.investigation_date,
    inspection_type: 'Investigation',
    deficiencies: [],
    identifier_key: [],
    poc_due_days: 14,
    is_rtf: false,
    notes: '',
    agency_services_type: '',
  }
}

export function SodEditor({
  report,
  onReportChange,
  canEdit = true,
  canExport = true,
  busy = false,
  activeCaseId = null,
  evidence = [],
  onEnsureCase,
}: Props) {
  const sod = report.sod || emptySod(report)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [linkTarget, setLinkTarget] = useState<string>('')

  const patchSod = (partial: Partial<StatementOfDeficiency>) => {
    if (!onReportChange) return
    onReportChange({ ...report, sod: { ...sod, ...partial } })
  }

  const patchDeficiency = (id: string, partial: Partial<SodDeficiency>) => {
    const deficiencies = (sod.deficiencies || []).map((d) =>
      d.id === id ? { ...d, ...partial } : d,
    )
    patchSod({ deficiencies })
  }

  const addFinding = (defId: string, finding?: SodFinding) => {
    const deficiencies = (sod.deficiencies || []).map((d) => {
      if (d.id !== defId) return d
      return {
        ...d,
        findings: [
          ...(d.findings || []),
          finding || { method: 'record review', text: '', evidence_ids: [] },
        ],
      }
    })
    patchSod({ deficiencies })
  }

  const patchFinding = (defId: string, idx: number, partial: Partial<SodFinding>) => {
    const deficiencies = (sod.deficiencies || []).map((d) => {
      if (d.id !== defId) return d
      const findings = [...(d.findings || [])]
      findings[idx] = { ...findings[idx], ...partial }
      return { ...d, findings }
    })
    patchSod({ deficiencies })
  }

  const linkEvidence = (defId: string) => {
    if (!linkTarget) return
    const ev = evidence.find((e) => String(e.id) === linkTarget)
    addFinding(defId, {
      method: 'document review',
      text: `Review of case evidence “${ev?.title || linkTarget}” showed [describe the failed practice].`,
      evidence_ids: [linkTarget],
    })
    setLinkTarget('')
  }

  const exportSod = async () => {
    setError('')
    setExporting(true)
    try {
      let id = activeCaseId
      if (!id && onEnsureCase) id = await onEnsureCase(report)
      if (!id) throw new Error('Save the case before exporting the SOD.')
      if (onReportChange) {
        // Persist latest SOD edits via parent save path when available
        onReportChange({ ...report, sod })
      }
      const blob = await api.exportCaseSod(id, true)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `SOD_${report.case_id || id}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SOD export failed')
    } finally {
      setExporting(false)
    }
  }

  const defs = sod.deficiencies || []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="compare-meta">Sister document · facility-facing</p>
          <h2 className="font-display mt-1 text-2xl text-ink-900 dark:text-ink-50">
            Statement of Deficiencies
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Facility-facing pack: cover letter, Plan of Correction instructions, then Cite / Based on /
            Failure to / Findings included. Regulation text comes from the local PDF store. Findings stay
            investigator-owned. The identifier key is internal only and is never exported.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!canExport || busy || exporting}
          onClick={() => void exportSod()}
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Export SOD
        </button>
      </div>

      {error && (
        <p className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="text-ink-500">Facility name</span>
          <input
            className="input mt-1"
            disabled={!canEdit || busy}
            value={sod.facility_name || ''}
            onChange={(e) => patchSod({ facility_name: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-ink-500">Administrator</span>
          <input
            className="input mt-1"
            disabled={!canEdit || busy}
            value={sod.administrator || ''}
            onChange={(e) => patchSod({ administrator: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-ink-500">Investigator #</span>
          <input
            className="input mt-1"
            disabled={!canEdit || busy}
            value={sod.investigator_number || ''}
            onChange={(e) => patchSod({ investigator_number: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-ink-500">POC due (days)</span>
          <input
            type="number"
            className="input mt-1"
            disabled={!canEdit || busy}
            value={sod.poc_due_days ?? 14}
            onChange={(e) => patchSod({ poc_due_days: Number(e.target.value) || 14 })}
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-ink-500">BHA/RTF agency services type</span>
          <input
            className="input mt-1"
            disabled={!canEdit || busy}
            value={sod.agency_services_type || ''}
            onChange={(e) => patchSod({ agency_services_type: e.target.value })}
          />
        </label>
      </div>

      <p className="rounded border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-700 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-200">
        SOD Writing standards (core instruction): Based on names two or more of observation,
        interview, and document review, and must echo the cited WAC duty. Every evidence type named
        there needs a matching Findings included row. Failure to states the risk if the practice is
        left uncorrected. Findings use showed for records, stated / stated that for interviews,
        Patient #n and Staff A/B, past tense, and dates/times on observations and interviews only.
        Plan of Correction stays blank for the facility.
      </p>

      {!defs.length && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          No SOD deficiency blocks yet. Draft from Intake with approved WACs so Compare duties seed
          the sister SOD.
        </p>
      )}

      <ul className="space-y-4">
        {defs.map((d, i) => (
          <li
            key={d.id || i}
            className="rounded-lg border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/40"
          >
            <p className="compare-meta">Deficiency {i + 1}</p>
            <p className="mt-1 font-semibold text-ink-900 dark:text-ink-50">
              {d.regulation_cite || 'Cite pending'}
            </p>
            {d.regulation_text && (
              <p className="mt-2 font-serif text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                {d.regulation_text}
              </p>
            )}

            <label className="mt-3 block text-sm">
              <span className="text-ink-500">Based on…</span>
              <textarea
                className="input mt-1 min-h-[72px]"
                disabled={!canEdit || busy}
                value={d.based_on || ''}
                onChange={(e) => patchDeficiency(d.id || '', { based_on: e.target.value })}
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className="text-ink-500">Failure to…</span>
              <textarea
                className="input mt-1 min-h-[72px]"
                disabled={!canEdit || busy}
                value={d.failure_to || ''}
                onChange={(e) => patchDeficiency(d.id || '', { failure_to: e.target.value })}
              />
            </label>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-ink-500">Scope (advisory)</span>
                <select
                  className="input mt-1"
                  disabled={!canEdit || busy}
                  value={d.scope || ''}
                  onChange={(e) => {
                    const scope = e.target.value
                    patchDeficiency(d.id || '', {
                      scope,
                      recommended_outcomes: recommendEnforcementOutcomes(
                        scope,
                        d.severity,
                        !!sod.is_rtf,
                      ),
                    })
                  }}
                >
                  <option value="">—</option>
                  {SOD_SCOPE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-ink-500">Severity (advisory)</span>
                <select
                  className="input mt-1"
                  disabled={!canEdit || busy}
                  value={d.severity || ''}
                  onChange={(e) => {
                    const severity = e.target.value
                    patchDeficiency(d.id || '', {
                      severity,
                      recommended_outcomes: recommendEnforcementOutcomes(
                        d.scope,
                        severity,
                        !!sod.is_rtf,
                      ),
                    })
                  }}
                >
                  <option value="">—</option>
                  {SOD_SEVERITY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(d.recommended_outcomes || []).length > 0 && (
              <p className="mt-2 text-xs text-ink-500">
                Enforcement tool (advisory): {(d.recommended_outcomes || []).join(', ')}
              </p>
            )}

            <fieldset className="mt-3">
              <legend className="text-xs uppercase tracking-wide text-ink-400">
                DPOC checklist (RTF advisory)
              </legend>
              <ul className="mt-1 space-y-1">
                {DPOC_ACTION_OPTIONS.map((action) => {
                  const checked = (d.dpoc_actions || []).includes(action)
                  return (
                    <li key={action}>
                      <label className="flex items-start gap-2 text-sm text-ink-700 dark:text-ink-200">
                        <input
                          type="checkbox"
                          className="mt-1"
                          disabled={!canEdit || busy}
                          checked={checked}
                          onChange={() => {
                            const cur = new Set(d.dpoc_actions || [])
                            if (checked) cur.delete(action)
                            else cur.add(action)
                            patchDeficiency(d.id || '', { dpoc_actions: [...cur] })
                          }}
                        />
                        {action}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>

            <div className="mt-4 border-t border-ink-100 pt-3 dark:border-ink-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-700 dark:text-ink-200">
                  Findings included:
                </p>
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 text-xs"
                  disabled={!canEdit || busy}
                  onClick={() => addFinding(d.id || '')}
                >
                  <Plus className="h-3.5 w-3.5" /> Add finding
                </button>
              </div>
              <p className="mt-1 text-xs text-ink-500">
                Do not auto-fill this from the complaint. Use showed for records, stated or stated that
                for interviews, and Patient # / Staff A from the internal key.
              </p>
              <ul className="mt-2 space-y-2">
                {(d.findings || []).map((f, fi) => (
                  <li key={fi} className="grid gap-2 sm:grid-cols-[140px_1fr]">
                    <select
                      className="input"
                      disabled={!canEdit || busy}
                      value={f.method || 'record review'}
                      onChange={(e) =>
                        patchFinding(d.id || '', fi, { method: e.target.value })
                      }
                    >
                      {[
                        'observation',
                        'interview',
                        'record review',
                        'document review',
                        'policy and procedure review',
                      ].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className="input min-h-[56px]"
                      disabled={!canEdit || busy}
                      value={f.text || ''}
                      onChange={(e) => patchFinding(d.id || '', fi, { text: e.target.value })}
                    />
                  </li>
                ))}
              </ul>

              {evidence.length > 0 && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="block min-w-[200px] flex-1 text-sm">
                    <span className="text-ink-500">Link case evidence into a finding</span>
                    <select
                      className="input mt-1"
                      disabled={!canEdit || busy}
                      value={linkTarget}
                      onChange={(e) => setLinkTarget(e.target.value)}
                    >
                      <option value="">Choose evidence…</option>
                      {evidence.map((ev) => (
                        <option key={ev.id} value={String(ev.id)}>
                          {ev.title || `Evidence ${ev.id}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={clsx('btn-ghost !px-2.5 !py-1.5 text-xs')}
                    disabled={!canEdit || busy || !linkTarget}
                    onClick={() => linkEvidence(d.id || '')}
                  >
                    <Link2 className="h-3.5 w-3.5" /> Link
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <label className="block text-sm">
        <span className="text-ink-500">Internal notes (not exported to facility)</span>
        <textarea
          className="input mt-1 min-h-[64px]"
          disabled={!canEdit || busy}
          value={sod.notes || ''}
          onChange={(e) => patchSod({ notes: e.target.value })}
        />
      </label>
    </div>
  )
}
