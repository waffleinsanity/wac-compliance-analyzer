import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search, Star } from 'lucide-react'
import clsx from 'clsx'
import type { WACNode } from '../api'

type Props = {
  wacs: WACNode[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleFavorite?: (id: string) => void
  favoritesOnly?: boolean
}

export function WACSelectionPanel({
  wacs,
  selected,
  onToggle,
  onToggleFavorite,
  favoritesOnly = false,
}: Props) {
  const [query, setQuery] = useState('')
  const [chapter, setChapter] = useState<'all' | '246-341' | '246-337'>('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '246-341': true, '246-337': true })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return wacs.filter((w) => {
      if (favoritesOnly && !w.is_favorite) return false
      if (chapter !== 'all' && w.chapter !== chapter) return false
      if (!q) return true
      return (
        w.code.toLowerCase().includes(q) ||
        w.title.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q)
      )
    })
  }, [wacs, query, chapter, favoritesOnly])

  const grouped = useMemo(() => {
    const map: Record<string, WACNode[]> = { '246-341': [], '246-337': [] }
    for (const w of filtered) {
      if (!map[w.chapter]) map[w.chapter] = []
      map[w.chapter].push(w)
    }
    return map
  }, [filtered])

  const selectedCount = selected.size

  useEffect(() => {
    // keep chapters expanded when searching
    if (query) setExpanded({ '246-341': true, '246-337': true })
  }, [query])

  return (
    <div className="panel flex h-full min-h-[420px] flex-col overflow-hidden">
      <div className="border-b border-ink-200/80 p-4 dark:border-ink-700/80">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-ink-900 dark:text-ink-50">WAC Directory</h2>
            <p className="text-sm text-ink-500 dark:text-ink-300">
              Pre-select authorized codes · {selectedCount} selected
            </p>
          </div>
          <div className="flex gap-1 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
            {(['all', '246-341', '246-337'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChapter(c)}
                className={clsx(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold',
                  chapter === c
                    ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50'
                    : 'text-ink-500 hover:text-ink-800 dark:text-ink-300',
                )}
              >
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
          <input
            className="input pl-9"
            placeholder="Search code or title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs"
            onClick={() => filtered.forEach((w) => !selected.has(w.id) && onToggle(w.id))}
          >
            Select filtered
          </button>
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs"
            onClick={() => Array.from(selected).forEach((id) => onToggle(id))}
          >
            Clear selection
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {Object.entries(grouped).map(([ch, items]) => {
          if (!items.length && chapter !== 'all' && chapter !== ch) return null
          const open = expanded[ch]
          return (
            <div key={ch} className="mb-2">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-ink-100/70 dark:hover:bg-ink-800/70"
                onClick={() => setExpanded((e) => ({ ...e, [ch]: !open }))}
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-mono text-sm font-semibold text-tide-600 dark:text-tide-400">
                  Chapter {ch}
                </span>
                <span className="ml-auto text-xs text-ink-400">{items.length}</span>
              </button>
              {open && (
                <ul className="space-y-1 px-1 pb-2">
                  {items.map((w) => {
                    const checked = selected.has(w.id)
                    return (
                      <li
                        key={w.id}
                        className={clsx(
                          'group flex items-start gap-2 rounded-xl border px-3 py-2 transition',
                          checked
                            ? 'border-cedar-500/50 bg-cedar-500/10'
                            : 'border-transparent hover:border-ink-200 hover:bg-ink-50 dark:hover:border-ink-700 dark:hover:bg-ink-800/40',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-ink-700"
                          checked={checked}
                          onChange={() => onToggle(w.id)}
                          aria-label={`Select ${w.code}`}
                        />
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => onToggle(w.id)}
                        >
                          <div className="font-mono text-xs font-semibold text-ink-800 dark:text-ink-100">
                            {w.code}
                          </div>
                          <div className="line-clamp-2 text-sm text-ink-600 dark:text-ink-300">
                            {w.title}
                          </div>
                        </button>
                        {onToggleFavorite && (
                          <button
                            type="button"
                            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-cedar-500 dark:hover:bg-ink-700"
                            onClick={() => onToggleFavorite(w.id)}
                            title="Favorite"
                          >
                            <Star
                              className={clsx('h-4 w-4', w.is_favorite && 'fill-cedar-500 text-cedar-500')}
                            />
                          </button>
                        )}
                      </li>
                    )
                  })}
                  {!items.length && (
                    <li className="px-3 py-4 text-sm text-ink-400">No matching codes.</li>
                  )}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
