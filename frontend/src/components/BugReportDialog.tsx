import { useRef, useState, type FormEvent } from 'react'
import { Bug, Camera, Stethoscope, Upload, X } from 'lucide-react'
import { api } from '../api'
import {
  captureAppScreenshot,
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
  const [screenshotSource, setScreenshotSource] = useState<'capture' | 'upload' | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [diagnostics, setDiagnostics] = useState<BugDiagnosticsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const reset = () => {
    setTitle('')
    setDescription('')
    setScreenshot(null)
    setScreenshotSource(null)
    setCapturing(false)
    setDiagnostics(null)
    setBusy(false)
    setError('')
    setInfo('')
    if (fileInputRef.current) fileInputRef.current.value = ''
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

  const takeScreenshot = async () => {
    setCapturing(true)
    setError('')
    setInfo('')
    try {
      const dataUrl = await captureAppScreenshot()
      setScreenshot(dataUrl)
      setScreenshotSource('capture')
      setInfo('Screenshot of the current screen attached')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture the current screen')
    } finally {
      setCapturing(false)
    }
  }

  const onFile = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Upload must be an image file')
      return
    }
    if (file.size > 6_000_000) {
      setError('Image must be under 6MB')
      return
    }
    setError('')
    setScreenshot(await fileToDataUrl(file))
    setScreenshotSource('upload')
    setInfo('Image attached')
  }

  const clearScreenshot = () => {
    setScreenshot(null)
    setScreenshotSource(null)
    setInfo('')
    if (fileInputRef.current) fileInputRef.current.value = ''
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
      const msg = err instanceof Error ? err.message : 'Failed to send bug report'
      if (/401|unauthoriz|sign in|session/i.test(msg)) {
        setError('Your session expired. Sign in again, then resubmit this report.')
        window.setTimeout(() => {
          window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`)
        }, 1200)
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm"
      data-bug-report-overlay="1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bug-report-title"
    >
      <div className="panel max-h-[90vh] w-full max-w-lg animate-rise overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="bug-report-title" className="flex items-center gap-2 font-display text-2xl">
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
            <p className="mb-2 text-xs text-ink-500">
              Capture the Investigation screen as it looks now, or upload an image.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-outline btn-sm"
                disabled={capturing || busy}
                onClick={() => void takeScreenshot()}
              >
                <Camera className="mr-1.5 h-4 w-4" />
                {capturing ? 'Capturing…' : 'Take screenshot'}
              </button>
              <button
                type="button"
                className="btn-outline btn-sm"
                disabled={capturing || busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-1.5 h-4 w-4" />
                Upload image
              </button>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept="image/*"
                onChange={(e) => void onFile(e.target.files?.[0] || null)}
              />
            </div>
            {screenshot && (
              <div className="mt-3 overflow-hidden rounded-md border border-ink-200 dark:border-ink-700">
                <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-2 py-1.5 dark:border-ink-700">
                  <p className="text-xs text-ink-500">
                    {screenshotSource === 'capture' ? 'Current screen attached' : 'Image attached'}
                  </p>
                  <button type="button" className="btn-ghost btn-sm !px-2" onClick={clearScreenshot}>
                    <X className="mr-1 h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
                <img
                  src={screenshot}
                  alt="Bug report screenshot preview"
                  className="max-h-48 w-full bg-ink-950/40 object-contain"
                />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={attachDiagnostics}>
              <Stethoscope className="mr-1.5 h-4 w-4" />
              {diagnostics ? 'Refresh diagnostics' : 'Attach diagnostics'}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
              {error}
            </p>
          )}
          {info && <p className="text-sm text-tide-700 dark:text-tide-300">{info}</p>}
          <button type="submit" className="btn-primary" disabled={busy || capturing || description.trim().length < 10}>
            {busy ? 'Submitting…' : 'Submit bug report'}
          </button>
        </form>
      </div>
    </div>
  )
}
