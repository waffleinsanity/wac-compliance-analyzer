import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Save, X } from 'lucide-react'
import { api, type TriggerPhrase, type WACNode } from '../api'
import { useAuth } from '../auth'

export function TriggerPhraseManager({ wacs }: { wacs: WACNode[] }) {
  const { user } = useAuth()
  const [phrases, setPhrases] = useState<TriggerPhrase[]>([])
  const [wacId, setWacId] = useState('')
  const [phrase, setPhrase] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [error, setError] = useState('')
  const [autoPreview, setAutoPreview] = useState<string[]>([])

  const load = async () => {
    if (!user) return
    try {
      setPhrases(await api.listTriggers())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load phrases')
    }
  }

  useEffect(() => {
    void load()
  }, [user])

  useEffect(() => {
    const node = wacs.find((w) => w.id === wacId)
    setAutoPreview(node?.trigger_phrases?.slice(0, 8) || [])
  }, [wacId, wacs])

  if (!user) {
    return (
      <div className="panel p-6 text-sm text-ink-500">
        Sign in to save custom trigger phrases with your account.
      </div>
    )
  }

  const add = async () => {
    setError('')
    if (!wacId || !phrase.trim()) {
      setError('Select a WAC and enter a phrase')
      return
    }
    try {
      await api.createTrigger(wacId, phrase.trim())
      setPhrase('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add')
    }
  }

  const saveEdit = async (id: number) => {
    await api.updateTrigger(id, editText.trim())
    setEditingId(null)
    await load()
  }

  const remove = async (id: number) => {
    await api.deleteTrigger(id)
    await load()
  }

  return (
    <div className="panel space-y-4 p-4">
      <div>
        <h2 className="font-display text-xl">Trigger Phrase Manager</h2>
        <p className="text-sm text-ink-500">
          Auto-generated phrases come from WAC content. Add custom phrases to improve matching.
        </p>
      </div>
      {error && <div className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
        <select className="input" value={wacId} onChange={(e) => setWacId(e.target.value)}>
          <option value="">Select WAC…</option>
          {wacs.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.title}
            </option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Custom trigger phrase"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={add}>
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {!!autoPreview.length && (
        <div>
          <div className="label">Auto-generated for selected WAC</div>
          <div className="flex flex-wrap gap-1.5">
            {autoPreview.map((p) => (
              <span key={p} className="rounded-lg bg-ink-100 px-2 py-1 text-xs dark:bg-ink-800">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}
      <ul className="divide-y divide-ink-200 dark:divide-ink-700">
        {phrases.map((p) => (
          <li key={p.id} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs text-tide-600">{p.wac_id}</div>
              {editingId === p.id ? (
                <input className="input mt-1" value={editText} onChange={(e) => setEditText(e.target.value)} />
              ) : (
                <div className="text-sm">{p.phrase}</div>
              )}
            </div>
            {editingId === p.id ? (
              <>
                <button type="button" className="btn-primary !px-2.5 !py-1.5" onClick={() => saveEdit(p.id)}>
                  <Save className="h-4 w-4" />
                </button>
                <button type="button" className="btn-secondary !px-2.5 !py-1.5" onClick={() => setEditingId(null)}>
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-secondary !px-2.5 !py-1.5"
                  onClick={() => {
                    setEditingId(p.id)
                    setEditText(p.phrase)
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" className="btn-secondary !px-2.5 !py-1.5" onClick={() => remove(p.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </li>
        ))}
        {!phrases.length && <li className="py-6 text-sm text-ink-400">No custom phrases yet.</li>}
      </ul>
    </div>
  )
}
