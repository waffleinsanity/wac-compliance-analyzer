import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Search, Star, StarOff } from 'lucide-react'
import clsx from 'clsx'
import { api, type WACNode, type WACUsageStat } from '../api'

type Props = {
  wacs: WACNode[]
  selectedCodes: string[]
  onSelectionChange: (codes: string[]) => void
  onToggleFavorite: (wacId: string) => void
  canEdit?: boolean
}

export function DirectoryPanel({
  wacs,
  selectedCodes,
  onSelectionChange,
  onToggleFavorite,
  canEdit = true,
}: Props) {
  const [query, setQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'code' | 'usage'>('code')
  const [popular, setPopular] = useState<WACUsageStat[]>([])
  const [tracked, setTracked] = useState(0)

  useEffect(() => {
    void api
      .popularWacs(20)
      .then((res) => {
        setPopular(res.items)
        setTracked(res.total_tracked)
      })
      .catch(() => {
        setPopular([])
        setTracked(0)
      })
  }, [wacs])

  const filtered = useMemo(() => {
    let list = wacs
    if (favoritesOnly) list = list.filter((w) => w.is_favorite)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (w) =>
          w.code.toLowerCase().includes(q) ||
          w.title.toLowerCase().includes(q) ||
          w.id.toLowerCase().includes(q) ||
          w.chapter.toLowerCase().includes(q) ||
          (w.chapter.startsWith('71.') ? 'rcw' : 'wac').includes(q),
      )
    }
    const sorted = [...list]
    if (sortBy === 'usage') {
      sorted.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0) || a.code.localeCompare(b.code))
    } else {
      sorted.sort((a, b) => a.chapter.localeCompare(b.chapter) || a.code.localeCompare(b.code))
    }
    return sorted
  }, [wacs, query, favoritesOnly, sortBy])

  const toggle = (id: string) => {
    if (!canEdit) return
    onSelectionChange(
      selectedCodes.includes(id) ? selectedCodes.filter((x) => x !== id) : [...selectedCodes, id],
    )
  }

  const selectPopular = (wacId: string) => {
    if (!canEdit) return
    if (!selectedCodes.includes(wacId)) onSelectionChange([...selectedCodes, wacId])
  }

  return (
    <div className="mx-auto grid h-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.85fr)]">
      <div className="flex min-h-0 flex-col">
        <div className="mb-4">
          <h2 className="font-display text-3xl tracking-tight">Statute directory</h2>
          <p className="mt-2 text-sm text-ink-500">
            Search WACs, star favorites, and approve codes for the current case report.
          </p>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-9"
              placeholder="Search by code, title, chapter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search statutes"
            />
          </div>
          <button
            type="button"
            className={clsx('btn-sm', favoritesOnly ? 'btn-default' : 'btn-outline')}
            onClick={() => setFavoritesOnly((v) => !v)}
            title="Show favorites only"
          >
            <Star className={clsx('h-4 w-4', favoritesOnly && 'fill-current')} />
            Favorites
          </button>
          <select
            className="input !h-9 !w-auto text-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'code' | 'usage')}
            aria-label="Sort directory"
          >
            <option value="code">Sort by code</option>
            <option value="usage">Sort by usage</option>
          </select>
        </div>

        <div className="mb-2 flex items-center justify-between text-xs text-ink-500">
          <span>
            {filtered.length} shown
            {selectedCodes.length > 0 ? ` · ${selectedCodes.length} approved for case` : ''}
          </span>
          {canEdit && selectedCodes.length > 0 && (
            <button type="button" className="btn-ghost !h-7 !px-2 text-xs" onClick={() => onSelectionChange([])}>
              Clear selection
            </button>
          )}
        </div>

        <div className="panel min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {filtered.map((w) => {
              const instrument = w.chapter.startsWith('71.') ? 'RCW' : 'WAC'
              const selected = selectedCodes.includes(w.id)
              return (
                <li
                  key={w.id}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 transition hover:bg-ink-50/80 dark:hover:bg-ink-800/40',
                    selected && 'bg-tide-500/5',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-tide-600"
                    checked={selected}
                    disabled={!canEdit}
                    onChange={() => toggle(w.id)}
                    aria-label={`Approve ${w.code} for case`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {instrument} {w.code}
                      </span>
                      {(w.usage_count || 0) > 0 && (
                        <span className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 dark:bg-ink-800">
                          used {w.usage_count}×
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-ink-500">{w.title}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost h-8 w-8 shrink-0 p-0"
                    onClick={() => void onToggleFavorite(w.id)}
                    title={w.is_favorite ? 'Remove favorite' : 'Add favorite'}
                  >
                    {w.is_favorite ? (
                      <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    ) : (
                      <StarOff className="h-4 w-4" />
                    )}
                  </button>
                </li>
              )
            })}
            {!filtered.length && (
              <li className="px-4 py-12 text-center text-sm text-ink-400">
                <Search className="mx-auto mb-2 h-8 w-8 opacity-40" />
                No statutes match this search.
              </li>
            )}
          </ul>
        </div>
      </div>

      <aside className="panel flex h-fit flex-col p-4 lg:sticky lg:top-4">
        <div className="mb-3 flex items-start gap-2">
          <BarChart3 className="mt-0.5 h-4 w-4 text-tide-600" />
          <div>
            <h3 className="font-semibold tracking-tight">Most used WACs</h3>
            <p className="mt-1 text-xs text-ink-500">
              Platform-wide counts of codes approved when users generate investigation drafts.
              {tracked > 0 ? ` ${tracked} codes tracked.` : ''}
            </p>
          </div>
        </div>
        <ol className="space-y-1.5">
          {popular.map((item, idx) => (
            <li key={item.wac_id}>
              <button
                type="button"
                className={clsx(
                  'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-ink-100/70 dark:hover:bg-ink-800/50',
                  selectedCodes.includes(item.wac_id) && 'bg-tide-500/10',
                )}
                onClick={() => selectPopular(item.wac_id)}
                title={canEdit ? 'Add to approved WACs for this case' : item.title}
              >
                <span className="w-5 shrink-0 font-mono text-xs text-ink-400">{idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs font-semibold">{item.code || item.wac_id}</div>
                  <div className="truncate text-[11px] text-ink-500">{item.title || '—'}</div>
                </div>
                <span className="shrink-0 font-mono text-xs font-semibold text-tide-700 dark:text-tide-300">
                  {item.count}
                </span>
              </button>
            </li>
          ))}
          {!popular.length && (
            <li className="py-6 text-center text-xs text-ink-400">
              No usage yet. Counts appear after teams generate drafts from approved WACs.
            </li>
          )}
        </ol>
      </aside>
    </div>
  )
}
