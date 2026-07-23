import { useMemo, useState } from 'react'
import { Star, Trash2, Search } from 'lucide-react'
import type { WACNode } from '../api'

type Props = {
  favorites: WACNode[]
  onRemoveFromFavorites: (wacId: string) => void
  onSelectWacCode: (wacId: string) => void
}

export function FavoritesSidebar({ favorites, onRemoveFromFavorites, onSelectWacCode }: Props) {
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return favorites
    const q = searchQuery.toLowerCase()
    return favorites.filter(
      (f) => f.code.toLowerCase().includes(q) || f.title.toLowerCase().includes(q),
    )
  }, [favorites, searchQuery])

  const grouped = useMemo(() => {
    return filtered.reduce(
      (acc, fav) => {
        const category = fav.chapter === '246-341' ? 'BHA' : fav.chapter === '246-337' ? 'RTF' : 'Other'
        if (!acc[category]) acc[category] = []
        acc[category].push(fav)
        return acc
      },
      {} as Record<string, WACNode[]>,
    )
  }, [filtered])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input pl-9"
            placeholder="Search favorites..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {favorites.length} favorite{favorites.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {Object.keys(grouped).length === 0 ? (
            <div className="py-8 text-center">
              <Star className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <div className="mt-3 text-sm text-muted-foreground">No favorite WAC codes</div>
              <div className="text-xs text-muted-foreground">Star codes in the left panel</div>
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </div>
                {items.map((fav) => (
                  <div
                    key={fav.id}
                    className="group flex items-start gap-2 border-b border-ink-100 py-2 last:border-0 dark:border-ink-800"
                  >
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectWacCode(fav.id)}>
                      <div className="truncate text-sm font-medium">{fav.code}</div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">{fav.title}</div>
                    </button>
                    <button
                      type="button"
                      className="btn-ghost h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                      onClick={() => onRemoveFromFavorites(fav.id)}
                      title="Remove favorite"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
