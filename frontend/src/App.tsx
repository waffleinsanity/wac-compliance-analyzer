import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  BookMarked,
  Moon,
  Scale,
  Sun,
  Tags,
  UserRound,
} from 'lucide-react'
import { api, type AnalyzeResponse, type WACNode } from './api'
import { useAuth } from './auth'
import { useTheme } from './theme'
import { AuthModal } from './components/AuthModal'
import { FavoritesSidebar } from './components/FavoritesSidebar'
import { InputArea } from './components/InputArea'
import { ResultsDisplay } from './components/ResultsDisplay'
import { StatsDashboard } from './components/StatsDashboard'
import { TriggerPhraseManager } from './components/TriggerPhraseManager'
import { WACSelectionPanel } from './components/WACSelectionPanel'

type Tab = 'analyze' | 'triggers' | 'stats'

export default function App() {
  const { user, logout } = useAuth()
  const { theme, setTheme, resolved } = useTheme()
  const [tab, setTab] = useState<Tab>('analyze')
  const [authOpen, setAuthOpen] = useState(false)
  const [wacs, setWacs] = useState<WACNode[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [text, setText] = useState('')
  const [examples, setExamples] = useState<{ name: string }[]>([])
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [includeInformational, setIncludeInformational] = useState(true)
  const [health, setHealth] = useState('')

  const loadWacs = useCallback(async () => {
    const list = await api.listWacs({ level: 'code' })
    setWacs(list)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const h = await api.health()
        setHealth(`${h.wac_codes} codes · ${h.wac_nodes} nodes`)
        await loadWacs()
        setExamples(await api.examples())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to reach API')
      }
    })()
  }, [loadWacs])

  const favorites = useMemo(() => wacs.filter((w) => w.is_favorite), [wacs])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleFavorite = async (id: string) => {
    if (!user) {
      setAuthOpen(true)
      return
    }
    await api.toggleFavorite(id)
    await loadWacs()
  }

  const loadExample = async (name: string) => {
    const res = await api.exampleText(name)
    setText(res.text)
    // Auto-select mentioned WACs from example
    const mentioned = Array.from(res.text.matchAll(/246-(?:341|337)-\d{3,4}/g)).map((m) => m[0])
    const ids = wacs.filter((w) => mentioned.includes(w.code)).map((w) => w.id)
    if (ids.length) setSelected(new Set(ids))
  }

  const runAnalyze = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.analyze(text, Array.from(selected), includeInformational)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setBusy(false)
    }
  }

  const upload = async (files: FileList) => {
    setBusy(true)
    setError('')
    try {
      const list = Array.from(files)
      if (list.length === 1) {
        const res = await api.analyzeUpload(list[0], Array.from(selected), includeInformational)
        // Also put extracted preview into textarea via document_preview is short; re-read not available
        // For UX, if user only wanted text load without analyze when no selection — still analyze if selected
        setResult(res)
        if (!text.trim()) setText(res.document_preview)
      } else {
        const batch = await api.analyzeBatch(list, Array.from(selected), includeInformational)
        // Merge findings
        const merged: AnalyzeResponse = {
          findings: batch.results.flatMap((r) => r.findings),
          document_preview: batch.results.map((r) => r.document_preview).join('\n---\n'),
          selected_count: selected.size,
          duration_ms: batch.results.reduce((a, r) => a + r.duration_ms, 0),
        }
        setResult(merged)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const cycleTheme = () => {
    const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
    const idx = order.indexOf(theme)
    setTheme(order[(idx + 1) % order.length])
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-white/75 backdrop-blur-md dark:border-ink-800 dark:bg-ink-950/75">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-800 text-ink-50 dark:bg-cedar-500 dark:text-ink-950">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-lg leading-tight tracking-tight sm:text-xl">
                WAC Compliance Analyzer
              </div>
              <div className="text-xs text-ink-500">{health || 'Loading regulatory database…'}</div>
            </div>
          </div>
          <nav className="hidden items-center gap-1 rounded-2xl bg-ink-100 p-1 dark:bg-ink-900 md:flex">
            {(
              [
                ['analyze', 'Analyze', BookMarked],
                ['triggers', 'Triggers', Tags],
                ['stats', 'Stats', BarChart3],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  tab === id
                    ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50'
                    : 'text-ink-500 hover:text-ink-800 dark:text-ink-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary !px-3" onClick={cycleTheme} title={`Theme: ${theme}`}>
              {resolved === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              <span className="hidden sm:inline capitalize">{theme}</span>
            </button>
            {user ? (
              <button type="button" className="btn-secondary" onClick={logout}>
                <UserRound className="h-4 w-4" />
                {user.username}
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4 pb-3 md:hidden">
          {(
            [
              ['analyze', 'Analyze'],
              ['triggers', 'Triggers'],
              ['stats', 'Stats'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${
                tab === id ? 'bg-ink-800 text-white dark:bg-cedar-500 dark:text-ink-950' : 'bg-ink-100 dark:bg-ink-800'
              }`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6">
        {error && (
          <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-800 dark:text-rose-300">
            {error}
          </div>
        )}

        {tab === 'analyze' && (
          <div className="grid animate-rise gap-4 xl:grid-cols-[280px_1fr_1.1fr]">
            <div className="space-y-4">
              <FavoritesSidebar
                favorites={favorites}
                selected={selected}
                onSelect={(id) => {
                  if (!selected.has(id)) toggle(id)
                }}
              />
              <div className="hidden xl:block">
                <WACSelectionPanel
                  wacs={wacs}
                  selected={selected}
                  onToggle={toggle}
                  onToggleFavorite={toggleFavorite}
                />
              </div>
            </div>
            <div className="space-y-4">
              <div className="xl:hidden">
                <WACSelectionPanel
                  wacs={wacs}
                  selected={selected}
                  onToggle={toggle}
                  onToggleFavorite={toggleFavorite}
                />
              </div>
              <InputArea
                text={text}
                onTextChange={setText}
                examples={examples}
                onLoadExample={loadExample}
                onAnalyze={runAnalyze}
                onUpload={upload}
                busy={busy}
                selectedCount={selected.size}
                includeInformational={includeInformational}
                onIncludeInformational={setIncludeInformational}
              />
            </div>
            <ResultsDisplay result={result} />
          </div>
        )}

        {tab === 'triggers' && (
          <div className="animate-rise">
            <TriggerPhraseManager wacs={wacs} />
          </div>
        )}

        {tab === 'stats' && (
          <div className="animate-rise">
            <StatsDashboard />
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 pb-8 text-center text-xs text-ink-400">
        Self-contained local analysis for WAC 246-341 & 246-337 · No external LLM APIs · Optional official web validation
      </footer>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  )
}
