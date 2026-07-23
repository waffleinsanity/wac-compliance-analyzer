import { useEffect, useMemo, useState } from 'react'
import {
  Search,
  ChevronDown,
  ChevronRight,
  Star,
  StarOff,
  CheckSquare,
  Square,
} from 'lucide-react'
import clsx from 'clsx'
import type { WACNode } from '../api'

type Props = {
  wacs: WACNode[]
  selectedCodes: string[]
  onSelectionChange: (codes: string[]) => void
  onToggleFavorite: (wacId: string) => void
  favoriteIds: Set<string>
}

export function WACSelectionPanel({
  wacs,
  selectedCodes,
  onSelectionChange,
  onToggleFavorite,
  favoriteIds,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['BHA', 'RTF', 'RCW71.05']))
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false)

  const groupedCodes = useMemo(() => {
    let filtered = wacs
    if (showOnlyFavorites) {
      filtered = filtered.filter((c) => favoriteIds.has(c.id) || favoriteIds.has(c.code))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.chapter.toLowerCase().includes(q),
      )
    }
    const bha = filtered.filter((c) => c.code.startsWith('246-341')).sort((a, b) => a.code.localeCompare(b.code))
    const rtf = filtered.filter((c) => c.code.startsWith('246-337')).sort((a, b) => a.code.localeCompare(b.code))
    const rcwGroups = ['71.05', '71.24', '71.34'].map((ch) => ({
      key: `RCW${ch}`,
      label: `RCW ${ch}`,
      codes: filtered.filter((c) => c.chapter === ch).sort((a, b) => a.code.localeCompare(b.code)),
    }))
    const groups: { key: string; label: string; codes: WACNode[] }[] = []
    if (bha.length) groups.push({ key: 'BHA', label: 'BHA (WAC 246-341)', codes: bha })
    if (rtf.length) groups.push({ key: 'RTF', label: 'RTF (WAC 246-337)', codes: rtf })
    for (const g of rcwGroups) {
      if (g.codes.length) groups.push(g)
    }
    return groups
  }, [wacs, searchQuery, showOnlyFavorites, favoriteIds])

  const allFiltered = useMemo(() => groupedCodes.flatMap((g) => g.codes), [groupedCodes])

  const toggleCode = (id: string) => {
    onSelectionChange(
      selectedCodes.includes(id) ? selectedCodes.filter((c) => c !== id) : [...selectedCodes, id],
    )
  }

  const toggleSection = (codes: WACNode[]) => {
    const ids = codes.map((c) => c.id)
    const allSelected = ids.every((id) => selectedCodes.includes(id))
    if (allSelected) onSelectionChange(selectedCodes.filter((c) => !ids.includes(c)))
    else onSelectionChange([...new Set([...selectedCodes, ...ids])])
  }

  const toggleExpansion = (key: string) => {
    const next = new Set(expandedSections)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedSections(next)
  }

  useEffect(() => {
    if (searchQuery) setExpandedSections(new Set(['BHA', 'RTF', 'RCW71.05', 'RCW71.24', 'RCW71.34']))
  }, [searchQuery])

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-ink-200 p-3 dark:border-ink-700">
        <p className="font-sans text-[11px] leading-snug text-ink-500 dark:text-ink-400">
          Only codes you approve here enter the Investigation Report. Research and related hits are
          not authorization.
        </p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input pl-8 !h-9 text-sm"
            placeholder="Search codes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className="btn-ghost btn-sm !h-7 !px-2"
              onClick={() =>
                onSelectionChange([...new Set([...selectedCodes, ...allFiltered.map((c) => c.id)])])
              }
            >
              <CheckSquare className="mr-1 h-3.5 w-3.5" />
              All
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm !h-7 !px-2"
              onClick={() => onSelectionChange([])}
            >
              <Square className="mr-1 h-3.5 w-3.5" />
              None
            </button>
            <button
              type="button"
              className={clsx(
                'btn-sm !h-7 !px-2',
                showOnlyFavorites ? 'btn-default' : 'btn-ghost',
              )}
              onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
              title="Show only favorites"
            >
              <Star className={clsx('h-3.5 w-3.5', showOnlyFavorites && 'fill-current')} />
            </button>
          </div>
          {selectedCodes.length > 0 && (
            <p className="font-mono text-[11px] tabular-nums text-ink-500">
              {selectedCodes.length} selected
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1 p-2">
          {groupedCodes.map(({ key, label, codes }) => {
            const ids = codes.map((c) => c.id)
            const selectedInSection = ids.filter((id) => selectedCodes.includes(id)).length
            const allSelected = selectedInSection === ids.length && ids.length > 0
            const open = expandedSections.has(key)
            return (
              <div key={key}>
                <div className="flex cursor-pointer items-center gap-2 border-b border-ink-100 px-2 py-2.5 hover:bg-ink-50/80 dark:border-ink-800 dark:hover:bg-ink-800/40">
                  <button type="button" className="flex flex-1 items-center gap-2 text-left" onClick={() => toggleExpansion(key)}>
                    {open ? <ChevronDown className="h-3.5 w-3.5 text-tide-600" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-400" />}
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-tide-600"
                      checked={allSelected}
                      onChange={() => toggleSection(codes)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold tracking-tight">{label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {selectedInSection}/{ids.length} approved
                      </div>
                    </div>
                    <span className="badge-secondary ml-auto">{ids.length}</span>
                  </button>
                </div>
                {open && (
                  <div className="mt-1 space-y-1 pl-4">
                    {codes.map((code) => {
                      const fullLabel = `WAC ${code.code} — ${code.title}`
                      return (
                        <div
                          key={code.id}
                          title={fullLabel}
                          className={clsx(
                            'group flex items-start gap-2 rounded-lg px-2 py-1.5 transition hover:bg-muted/60',
                            selectedCodes.includes(code.id) && 'wac-row-selected',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 accent-tide-600"
                            checked={selectedCodes.includes(code.id)}
                            onChange={() => toggleCode(code.id)}
                            title={fullLabel}
                            aria-label={fullLabel}
                          />
                          <div className="min-w-0 flex-1" title={fullLabel}>
                            <div className="font-mono text-[13px] font-semibold leading-tight">
                              {code.code}
                            </div>
                            <div className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted-foreground">
                              {code.title}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn-ghost mt-0.5 h-6 w-6 shrink-0 p-0"
                            onClick={() => onToggleFavorite(code.id)}
                            title={
                              favoriteIds.has(code.id) || favoriteIds.has(code.code)
                                ? `Remove ${code.code} from favorites`
                                : `Add ${code.code} to favorites`
                            }
                          >
                            {favoriteIds.has(code.id) || favoriteIds.has(code.code) ? (
                              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                            ) : (
                              <StarOff className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {!groupedCodes.length && (
            <div className="py-8 text-center text-muted-foreground">
              <Search className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <div className="text-sm">No WAC codes found</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
