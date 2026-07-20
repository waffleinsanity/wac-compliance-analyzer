import { useEffect, useState, type FormEvent } from 'react'
import { FileUp, MessageSquare, Trash2 } from 'lucide-react'
import {
  api,
  type CaseComment,
  type CaseDetail,
  type CaseEvidence,
  type CaseProcessEntry,
  type DefensibilityResult,
} from '../api'
import { useAuth } from '../auth'
import { canEdit, canReview } from '../permissions'

type Props = {
  caseDetail: CaseDetail
  onRefresh: () => Promise<void>
  onReportApplied?: (detail: CaseDetail) => void
}

export function CaseAssistPanel({ caseDetail, onRefresh, onReportApplied }: Props) {
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
  const reviewer = canReview(user?.role, user?.is_admin)
  const locked =
    !editable ||
    caseDetail.status === 'final' ||
    caseDetail.status === 'in_review' ||
    caseDetail.status === 'archived'

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

  const upload = async (file: File) => {
    await run(async () => {
      await api.uploadEvidence(caseDetail.id, file, {
        title: file.name,
        linked_wac_ids: caseDetail.approved_wac_ids.slice(0, 3),
      })
      setInfo('Evidence attached (assist only — not auto-analyzed).')
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
      setInfo('Inserted process/exhibit assists into the draft — edit freely.')
    })
  }

  const setStatus = async (status: string) => {
    await run(async () => {
      await api.setCaseStatus(caseDetail.id, status)
      setInfo(`Status set to ${status}.`)
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
    <div className="space-y-4 rounded-xl border border-ink-200/80 bg-card/60 p-4 dark:border-ink-700">
      <div>
        <h3 className="font-display text-lg">Case assists</h3>
        <p className="mt-1 text-xs text-ink-500">
          Organize evidence and process notes. Nothing here auto-finalizes findings — you stay in control.
        </p>
        <div className="mt-2 font-mono text-xs">
          Status: <span className="font-semibold">{caseDetail.status}</span>
          {locked ? ' · locked for edit' : ''}
        </div>
      </div>

      {defensibility && (
        <div
          className={
            defensibility.overall === 'pass'
              ? 'rounded-lg border border-emerald-300/60 bg-emerald-50/80 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/30'
              : defensibility.overall === 'block'
                ? 'rounded-lg border border-rose-300/60 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950/30'
                : 'rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30'
          }
        >
          <div className="font-semibold">Ready to circulate?</div>
          <p className="mt-1 text-xs">{defensibility.summary}</p>
          {!!defensibility.checks.length && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              {defensibility.checks.slice(0, 8).map((c) => (
                <li key={c.code}>
                  <span className="uppercase tracking-wide">{c.severity}</span>: {c.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!locked && caseDetail.status !== 'in_review' && (
          <button type="button" className="btn-secondary !h-8 text-xs" disabled={busy} onClick={() => void setStatus('in_review')}>
            Submit for review
          </button>
        )}
        {caseDetail.status === 'in_review' && reviewer && (
          <button type="button" className="btn-primary !h-8 text-xs" disabled={busy} onClick={() => void setStatus('final')}>
            Mark final
          </button>
        )}
        {editable && (caseDetail.status === 'final' || caseDetail.status === 'in_review') && (
          <button type="button" className="btn-secondary !h-8 text-xs" disabled={busy} onClick={() => void setStatus('reopened')}>
            Reopen
          </button>
        )}
        {editable && caseDetail.status === 'reopened' && (
          <button type="button" className="btn-ghost !h-8 text-xs" disabled={busy} onClick={() => void setStatus('draft')}>
            Return to draft
          </button>
        )}
        {!editable && (
          <p className="text-xs text-ink-500">Viewer role — case is read-only.</p>
        )}
      </div>

      {!locked && (
        <>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Evidence</div>
            <p className="mb-2 text-[11px] leading-relaxed text-ink-500">
              Do not upload files containing Category 3/4 PII/PHI. File scanning is not applied in v1 —
              prefer de-identified exhibits.
            </p>
            <label className="btn-secondary inline-flex !h-8 cursor-pointer text-xs">
              <FileUp className="h-3.5 w-3.5" /> Attach file
              <input
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload(f)
                  e.target.value = ''
                }}
              />
            </label>
            <ul className="mt-2 space-y-1">
              {caseDetail.evidence.map((ev: CaseEvidence) => (
                <li key={ev.id} className="flex items-start justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs">
                  <div>
                    <div className="font-medium">{ev.title}</div>
                    <div className="text-ink-400">{ev.original_filename}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost !h-7 !w-7 !px-0"
                    onClick={() => void run(async () => { await api.deleteEvidence(caseDetail.id, ev.id) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <form className="space-y-2" onSubmit={addProcess}>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Process builder</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="input !h-8 text-xs"
                placeholder="Date"
                value={proc.activity_date}
                onChange={(e) => setProc((p) => ({ ...p, activity_date: e.target.value }))}
              />
              <select
                className="input !h-8 text-xs"
                value={proc.activity_type}
                onChange={(e) => setProc((p) => ({ ...p, activity_type: e.target.value }))}
              >
                <option value="interview">Interview</option>
                <option value="record_review">Record review</option>
                <option value="site_visit">Site visit</option>
                <option value="other">Other</option>
              </select>
              <input
                className="input !h-8 text-xs sm:col-span-2"
                placeholder="Who"
                value={proc.who}
                onChange={(e) => setProc((p) => ({ ...p, who: e.target.value }))}
              />
              <textarea
                className="input min-h-[64px] text-xs sm:col-span-2"
                placeholder="Summary"
                value={proc.summary}
                onChange={(e) => setProc((p) => ({ ...p, summary: e.target.value }))}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-secondary !h-8 text-xs" disabled={busy}>
                Add entry
              </button>
              <button type="button" className="btn-ghost !h-8 text-xs" disabled={busy} onClick={() => void applyAssists()}>
                Insert into draft
              </button>
            </div>
            <ul className="space-y-1">
              {caseDetail.process_entries.map((pe: CaseProcessEntry) => (
                <li key={pe.id} className="flex justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs">
                  <span>
                    {pe.activity_date || '—'} · {pe.activity_type} · {pe.who || 'Investigator'}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost !h-7 !w-7 !px-0"
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
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
          <MessageSquare className="h-3.5 w-3.5" /> Review comments
        </div>
        <ul className="mb-2 max-h-40 space-y-1 overflow-y-auto">
          {caseDetail.comments.map((c: CaseComment) => (
            <li key={c.id} className="rounded-lg border px-2 py-1.5 text-xs">
              <span className="font-semibold">{c.author_username}</span>
              <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
          {!caseDetail.comments.length && <li className="text-xs text-ink-400">No comments yet.</li>}
        </ul>
        <form className="flex gap-2" onSubmit={submitComment}>
          <input
            className="input !h-8 flex-1 text-xs"
            placeholder="Add a review note…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="submit" className="btn-secondary !h-8 text-xs" disabled={busy}>
            Post
          </button>
        </form>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {info && <p className="text-xs text-tide-700 dark:text-tide-300">{info}</p>}
    </div>
  )
}
