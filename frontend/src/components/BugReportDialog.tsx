import { useState, type FormEvent } from 'react'
import { Bug, Stethoscope } from 'lucide-react'
import { api } from '../api'
import {
  captureBugDiagnostics,
  diagnosticsToJson,
  fileToDataUrl,
  summarizeDiagnostics,
  type AppContextSnapshot,
  type BugDiagnosticsSnapshot,
} from '../clientDiagnostics'

type Props = {
  open: boolean
  onClose: () => void
  appContext?: AppContextSnapshot
}

export function BugReportDialog({ open, onClose, appContext }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<BugDiagnosticsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  if (!open) return null

  const reset = () => {
    setTitle('')
    setDescription('')
    setScreenshot(null)
    setDiagnostics(null)
    setBusy(false)
    setError('')
    setInfo('')
  }

  const close = () => {
    reset()
    onClose()
  }

  const attachDiagnostics = () => {
    const snap = captureBugDiagnostics(appContext)
    setDiagnostics(snap)
    setInfo(`Diagnostics attached — ${summarizeDiagnostics(snap)}`)
  }

  const onFile = async (file: File | null) => {
    if (!file) {
      setScreenshot(null)
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Screenshot must be an image file')
      return
    }
    if (file.size > 6_000_000) {
      setError('Screenshot must be under 6MB')
      return
    }
    setError('')
    setScreenshot(await fileToDataUrl(file))
    setInfo('Screenshot attached')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const snap = diagnostics ?? captureBugDiagnostics(appContext)
      await api.createBugReport({
        title: title.trim() || 'Bug report',
        description: description.trim(),
        page_url: snap.page.href || window.location.href,
        user_agent: snap.environment.userAgent,
        viewport_json: JSON.stringify(snap.viewport),
        diagnostics_json: diagnosticsToJson(snap),
        screenshot_data_url: screenshot || undefined,
      })
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit bug report')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm">
      <div className="panel max-h-[90vh] w-full max-w-lg animate-rise overflow-y-auto p-6" data-bug-report-overlay="1">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl">
              <Bug className="h-5 w-5 text-tide-600" />
              Report a bug
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              Describe what went wrong. Diagnostics help us reproduce the issue without your case text.
            </p>
          </div>
          <button type="button" className="btn-secondary !px-3 !py-1.5" onClick={close}>
            Close
          </button>
        </div>

        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          <div>
            <label className="label">Title (optional)</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
          </div>
          <div>
            <label className="label">What happened?</label>
            <textarea
              className="input min-h-[120px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={10}
              placeholder="Steps to reproduce, expected vs actual…"
            />
          </div>
          <div>
            <label className="label">Screenshot (optional)</label>
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
            />
            {screenshot && <p className="mt-1 text-xs text-ink-500">Image attached.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={attachDiagnostics}>
              <Stethoscope className="mr-1.5 h-4 w-4" />
              {diagnostics ? 'Refresh diagnostics' : 'Attach diagnostics'}
            </button>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {info && <p className="text-sm text-tide-700 dark:text-tide-300">{info}</p>}
          <button type="submit" className="btn-primary" disabled={busy || description.trim().length < 10}>
            {busy ? 'Submitting…' : 'Submit bug report'}
          </button>
        </form>
      </div>
    </div>
  )
}
