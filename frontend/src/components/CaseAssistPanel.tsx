import { useEffect, useState, type FormEvent } from 'react'
import { Download, FileUp, MessageSquare, Trash2 } from 'lucide-react'
import {
  api,
  type CaseComment,
  type CaseDetail,
  type CaseEvidence,
  type CaseProcessEntry,
  type DefensibilityResult,
  type InvestigationReport,
} from '../api'
import { useAuth } from '../auth'
import { canEdit, canExport, canReview } from '../permissions'
import { caseStatusLabel } from '../investigatorLabels'
import { PrivacyScreenBanner } from './PrivacyScreenBanner'
import { DraftRecallMenu } from './DraftRecallMenu'

type Props = {
  caseDetail: CaseDetail
  report?: InvestigationReport | null
  onRefresh: () => Promise<void>
  onReportApplied?: (detail: CaseDetail) => void
  onRestoreSnapshot?: (snapshotId: number) => void
}

export function CaseAssistPanel({
  caseDetail,
  report = null,
  onRefresh,
  onReportApplied,
  onRestoreSnapshot,
}: Props) {
  const { user } = useAuth()
  const [defensibility, setDefensibility] = useState<DefensibilityResult | null>(null)
  const [comment, setComment] = useState('')
  const [proc, setProc] = useState({
    activity_date: '',
    activity_type: 'record_review',
    who: '',
    summary: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const editable = canEdit(user?.role, user?.is_admin)
  const exporter = canExport(user?.role, user?.is_admin)
  const reviewer = canReview(user?.role, user?.is_admin)
  const locked =
    !editable ||
    caseDetail.status === 'final' ||
    caseDetail.status === 'in_review' ||
    caseDetail.status === 'archived' ||
    caseDetail.status === 'trashed'

  useEffect(() => {
    void api
      .caseDefensibility(caseDetail.id)
      .then(setDefensibility)
      .catch(() => setDefensibility(null))
  }, [caseDetail.id, caseDetail.updated_at, caseDetail.report])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await fn()
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    await run(async () => {
      for (const file of list) {
        await api.uploadEvidence(caseDetail.id, file, {
          title: file.name,
          linked_wac_ids: caseDetail.approved_wac_ids.slice(0, 3),
        })
      }
      setInfo(
        list.length === 1
          ? 'Evidence attached. Open the Evidence step to compare exhibits with allegation duties.'
          : `${list.length} evidence files attached. Open the Evidence step to compare exhibits with allegation duties.`,
      )
    })
  }

  const addProcess = async (e: FormEvent) => {
    e.preventDefault()
    await run(async () => {
      await api.addProcessEntry(caseDetail.id, proc)
      setProc({ activity_date: '', activity_type: 'record_review', who: '', summary: '' })
      setInfo('Process entry added.')
    })
  }

  const applyAssists = async () => {
    await run(async () => {
      const detail = await api.applyProcessToReport(caseDetail.id)
      onReportApplied?.(detail)
      setInfo('Inserted process/exhibit assists into the draft. Edit freely.')
    })
  }

  const downloadEvidenceLog = async () => {
    await run(async () => {
      // Persist in-memory Evidence Log edits before export (parity with EvidenceLogEditor).
      if (report && !locked) {
        await api.saveCaseDraft(caseDetail.id, report, 'Evidence Log before download')
      }
      const blob = await api.exportEvidenceLog(caseDetail.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Evidence_Log_${caseDetail.case_id_label || caseDetail.id}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      setInfo('Evidence Log downloaded. Superscripts in Document Review match log #1, #2, …')
      await onRefresh()
    })
  }

  const setStatus = async (status: string) => {
    await run(async () => {
      await api.setCaseStatus(caseDetail.id, status)
      setInfo(`Status set to ${caseStatusLabel(status)}.`)
    })
  }

  const submitComment = async (e: FormEvent) => {
    e.preventDefault()
    if (!comment.trim()) return
    await run(async () => {
      await api.addCaseComment(caseDetail.id, comment.trim())
      setComment('')
    })
  }

  return (
    <details className="rounded-md border border-ink-200/80 bg-card/60 open:pb-2 dark:border-ink-700">
      <summary className="cursor-pointer list-none px-2.5 py-2 marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-sm text-ink-900 dark:text-ink-50">Case tools</h3>
          <span className="font-sans text-[10px] text-ink-500">
            {caseStatusLabel(caseDetail.status)}
            {locked ? ' · locked' : ''}
            <span className="ml-1 text-ink-400">· expand</span>
          </span>
        </div>
      </summary>
      <div className="space-y-3 border-t border-ink-200/70 px-2.5 pt-2 dark:border-ink-700">
        <p className="text-[11px] leading-snug text-ink-500">
          Attach exhibits and process notes. Use Evidence to review materials against selected
          regulations.
        </p>
        {onRestoreSnapshot && (caseDetail.snapshots?.length || 0) > 0 && (
          <DraftRecallMenu
            snapshots={caseDetail.snapshots}
            disabled={locked}
            busy={busy}
            onRestore={onRestoreSnapshot}
          />
        )}

      {defensibility && (
        <details
          className={
            defensibility.overall === 'pass'
              ? 'rounded border border-emerald-300/60 bg-emerald-50/80 px-2 py-1.5 text-xs dark:border-emerald-800 dark:bg-emerald-950/30'
              : defensibility.overall === 'block'
                ? 'rounded border border-rose-300/60 bg-rose-50 px-2 py-1.5 text-xs dark:border-rose-800 dark:bg-rose-950/30'
                : 'rounded border border-amber-300/60 bg-amber-50 px-2 py-1.5 text-xs dark:border-amber-800 dark:bg-amber-950/30'
          }
        >
          <summary className="cursor-pointer font-semibold">Ready to circulate?</summary>
          <p className="mt-1 text-[11px]">{defensibility.summary}</p>
          {!!defensibility.checks.length && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px]">
              {defensibility.checks.slice(0, 8).map((c) => (
                <li key={c.code}>
                  <span className="uppercase tracking-wide">{c.severity}</span>: {c.message}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}

      <div className="flex flex-wrap gap-1.5">
        {!locked && caseDetail.status !== 'in_review' && (
          <button type="button" className="btn-secondary !h-7 text-[11px]" disabled={busy} onClick={() => void setStatus('in_review')}>
            Submit for review
          </button>
        )}
        {caseDetail.status === 'in_review' && reviewer && (
          <button
            type="button"
            className="btn-primary !h-7 text-[11px]"
            disabled={busy || defensibility?.can_finalize === false}
            title={
              defensibility?.can_finalize === false
                ? 'Fix quote integrity issues before finalize'
                : undefined
            }
            onClick={() => void setStatus('final')}
          >
            Mark final
          </button>
        )}
        {editable && (caseDetail.status === 'final' || caseDetail.status === 'in_review') && (
          <button type="button" className="btn-secondary !h-7 text-[11px]" disabled={busy} onClick={() => void setStatus('reopened')}>
            Reopen
          </button>
        )}
        {editable && caseDetail.status === 'reopened' && (
          <button type="button" className="btn-ghost !h-7 text-[11px]" disabled={busy} onClick={() => void setStatus('draft')}>
            Return to draft
          </button>
        )}
        {!editable && (
          <p className="text-[11px] text-ink-500">Your account cannot edit this case.</p>
        )}
      </div>

      {!locked && (
        <>
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Evidence</div>
            <PrivacyScreenBanner variant="evidence" compact className="mb-2" />
            <label className="btn-secondary inline-flex !h-7 cursor-pointer text-[11px]">
              <FileUp className="h-3.5 w-3.5" /> Attach files
              <input
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
                onChange={(e) => {
                  const files = e.target.files
                  if (files?.length) void upload(files)
                  e.target.value = ''
                }}
              />
            </label>
            {exporter && caseDetail.evidence.length > 0 && (
              <button
                type="button"
                className="btn-ghost ml-1.5 inline-flex !h-7 text-[11px]"
                disabled={busy}
                title="Download Evidence Log.xlsx"
                onClick={() => void downloadEvidenceLog()}
              >
                <Download className="h-3.5 w-3.5" /> Evidence Log
              </button>
            )}
            <ul className="mt-1.5 space-y-1">
              {caseDetail.evidence.map((ev: CaseEvidence) => (
                <li key={ev.id} className="flex items-start justify-between gap-2 border border-ink-200/80 px-2 py-1 text-[11px] dark:border-ink-700">
                  <div>
                    <div className="font-medium">
                      {ev.exhibit_number != null ? (
                        <span className="mr-1.5 text-ink-400">#{ev.exhibit_number}</span>
                      ) : null}
                      {ev.title}
                    </div>
                    <div className="text-ink-400">{ev.original_filename}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost !h-6 !w-6 !px-0"
                    onClick={() => void run(async () => { await api.deleteEvidence(caseDetail.id, ev.id) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <form className="space-y-1.5" onSubmit={addProcess}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Process builder</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              <input
                className="input !h-7 text-[11px]"
                placeholder="Date"
                value={proc.activity_date}
                onChange={(e) => setProc((p) => ({ ...p, activity_date: e.target.value }))}
              />
              <select
                className="input !h-7 text-[11px]"
                value={proc.activity_type}
                onChange={(e) => setProc((p) => ({ ...p, activity_type: e.target.value }))}
              >
                <option value="interview">Interview</option>
                <option value="record_review">Record review</option>
                <option value="site_visit">Site visit</option>
                <option value="other">Other</option>
              </select>
              <input
                className="input !h-7 text-[11px] sm:col-span-2"
                placeholder="Who"
                value={proc.who}
                onChange={(e) => setProc((p) => ({ ...p, who: e.target.value }))}
              />
              <textarea
                className="input min-h-[52px] text-[11px] sm:col-span-2"
                placeholder="Summary"
                value={proc.summary}
                onChange={(e) => setProc((p) => ({ ...p, summary: e.target.value }))}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="submit" className="btn-secondary !h-7 text-[11px]" disabled={busy}>
                Add entry
              </button>
              <button type="button" className="btn-ghost !h-7 text-[11px]" disabled={busy} onClick={() => void applyAssists()}>
                Insert into draft
              </button>
            </div>
            <ul className="space-y-1">
              {caseDetail.process_entries.map((pe: CaseProcessEntry) => (
                <li key={pe.id} className="flex justify-between gap-2 border border-ink-200/80 px-2 py-1 text-[11px] dark:border-ink-700">
                  <span>
                    {pe.activity_date || '—'} · {pe.activity_type} · {pe.who || 'Investigator'}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost !h-6 !w-6 !px-0"
                    onClick={() => void run(async () => { await api.deleteProcessEntry(caseDetail.id, pe.id) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </form>
        </>
      )}

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
          <MessageSquare className="h-3 w-3" /> Review comments
        </div>
        <ul className="mb-1.5 max-h-32 space-y-1 overflow-y-auto">
          {caseDetail.comments.map((c: CaseComment) => (
            <li key={c.id} className="border border-ink-200/80 px-2 py-1 text-[11px] dark:border-ink-700">
              <span className="font-semibold">{c.author_username}</span>
              <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
          {!caseDetail.comments.length && <li className="text-[11px] text-ink-400">No comments yet.</li>}
        </ul>
        <form className="flex gap-1.5" onSubmit={submitComment}>
          <input
            className="input !h-7 flex-1 text-[11px]"
            placeholder={
              caseDetail.status === 'trashed' ? 'Restore case before adding comments…' : 'Add a review note…'
            }
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={caseDetail.status === 'trashed'}
          />
          <button
            type="submit"
            className="btn-secondary !h-7 text-[11px]"
            disabled={busy || caseDetail.status === 'trashed'}
          >
            Post
          </button>
        </form>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {info && <p className="text-xs text-tide-700 dark:text-tide-300">{info}</p>}
      </div>
    </details>
  )
}
