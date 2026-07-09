import { Star } from 'lucide-react'
import type { WACNode } from '../api'

type Props = {
  favorites: WACNode[]
  selected: Set<string>
  onSelect: (id: string) => void
}

export function FavoritesSidebar({ favorites, selected, onSelect }: Props) {
  return (
    <aside className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Star className="h-4 w-4 fill-cedar-500 text-cedar-500" />
        <h2 className="font-display text-lg">Favorites</h2>
      </div>
      <ul className="space-y-1">
        {favorites.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onSelect(f.id)}
              className={`w-full rounded-xl px-3 py-2 text-left transition hover:bg-ink-100 dark:hover:bg-ink-800 ${
                selected.has(f.id) ? 'bg-cedar-500/15' : ''
              }`}
            >
              <div className="font-mono text-xs font-semibold">{f.code}</div>
              <div className="line-clamp-2 text-xs text-ink-500">{f.title}</div>
            </button>
          </li>
        ))}
        {!favorites.length && (
          <li className="text-sm text-ink-400">Star WACs in the directory for quick access.</li>
        )}
      </ul>
    </aside>
  )
}
