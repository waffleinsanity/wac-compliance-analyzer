import { useState, type FormEvent } from 'react'
import { MessageSquare } from 'lucide-react'
import { api } from '../api'

type Props = {
  open: boolean
  onClose: () => void
}

const CATEGORIES = [
  { id: 'suggestion', label: 'Suggestion' },
  { id: 'usability', label: 'Usability' },
  { id: 'content', label: 'Report content / WAC wording' },
  { id: 'other', label: 'Other' },
] as const

export function FeedbackDialog({ open, onClose }: Props) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['id']>('suggestion')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const reset = () => {
    setCategory('suggestion')
    setSubject('')
    setMessage('')
    setBusy(false)
    setError('')
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.createFeedback({
        category,
        subject: subject.trim(),
        message: message.trim(),
        page_url: window.location.href,
      })
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send feedback')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm">
      <div className="panel max-h-[90vh] w-full max-w-lg animate-rise overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl">
              <MessageSquare className="h-5 w-5 text-tide-600" />
              Send feedback
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              Ideas and friction reports help shape WACMAKR. This is not for case content review.
            </p>
          </div>
          <button type="button" className="btn-secondary !px-3 !py-1.5" onClick={close}>
            Close
          </button>
        </div>

        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          <div>
            <label className="label">Category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Subject</label>
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              minLength={3}
              maxLength={255}
            />
          </div>
          <div>
            <label className="label">Message</label>
            <textarea
              className="input min-h-[120px]"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              minLength={10}
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send feedback'}
          </button>
        </form>
      </div>
    </div>
  )
}
