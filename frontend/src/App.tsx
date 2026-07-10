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
import { api, type InvestigationReport, type WACNode } from './api'
import { useAuth } from './auth'
import { useTheme } from './theme'
import { AuthModal } from './components/AuthModal'
import { FavoritesSidebar } from './components/FavoritesSidebar'
import { ComplaintStep } from './components/ComplaintStep'
import { InvestigationReportEditor } from './components/InvestigationReportEditor'
import { ReviewStep } from './components/ReviewStep'
import { StatsDashboard } from './components/StatsDashboard'
import { TriggerPhraseManager } from './components/TriggerPhraseManager'
import { WACSelectionPanel } from './components/WACSelectionPanel'
import { WorkflowStepper, type WorkflowStep } from './components/WorkflowStepper'

type Tab = 'analyze' | 'triggers' | 'stats'

function todayMMDDYYYY() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

export default function App() {
  const { user, logout } = useAuth()
  const { theme, setTheme, resolved } = useTheme()
  const [tab, setTab] = useState<Tab>('analyze')
  const [authOpen, setAuthOpen] = useState(false)
  const [wacs, setWacs] = useState<WACNode[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [text, setText] = useState('')
  const [caseId, setCaseId] = useState('')
  const [investigationDate, setInvestigationDate] = useState(todayMMDDYYYY())
  const [facilityAddress, setFacilityAddress] = useState('')
  const [credentialNumber, setCredentialNumber] = useState('')
  const [examples, setExamples] = useState<{ name: string }[]>([])
  const [report, setReport] = useState<InvestigationReport | null>(null)
  const [step, setStep] = useState<WorkflowStep>('intake')
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
    const mentioned = Array.from(res.text.matchAll(/246-(?:341|337)-\d{3,4}/g)).map((m) => m[0])
    const ids = wacs.filter((w) => mentioned.includes(w.code)).map((w) => w.id)
    if (ids.length) setSelected(new Set(ids))
  }

  const extractFile = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const res = await api.extract(file)
      setText(res.text)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extract failed')
    } finally {
      setBusy(false)
    }
  }

  const runInvestigate = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.investigate({
        text,
        selected_wacs: Array.from(selected),
        include_informational: includeInformational,
        case_id: caseId || undefined,
        investigation_date: investigationDate || undefined,
        facility_address: facilityAddress || undefined,
        credential_number: credentialNumber || undefined,
      })
      setReport(res)
      setStep('compare')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Investigation failed')
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
                ['analyze', 'Investigate', BookMarked],
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
              ['analyze', 'Investigate'],
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
          <div className="animate-rise space-y-4">
            <WorkflowStepper
              step={step}
              onStepChange={setStep}
              canCompare={!!report}
              canReport={!!report}
            />
            <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
              <div className="space-y-4">
                <FavoritesSidebar
                  favorites={favorites}
                  selected={selected}
                  onSelect={(id) => {
                    if (!selected.has(id)) toggle(id)
                  }}
                />
                <WACSelectionPanel
                  wacs={wacs}
                  selected={selected}
                  onToggle={toggle}
                  onToggleFavorite={toggleFavorite}
                />
              </div>
              <div className="min-h-[70vh]">
                {step === 'intake' && (
                  <ComplaintStep
                    text={text}
                    onTextChange={setText}
                    caseId={caseId}
                    onCaseIdChange={setCaseId}
                    investigationDate={investigationDate}
                    onInvestigationDateChange={setInvestigationDate}
                    facilityAddress={facilityAddress}
                    onFacilityAddressChange={setFacilityAddress}
                    credentialNumber={credentialNumber}
                    onCredentialNumberChange={setCredentialNumber}
                    examples={examples}
                    onLoadExample={loadExample}
                    onExtractFile={extractFile}
                    onAnalyze={() => void runInvestigate()}
                    selectedCount={selected.size}
                    busy={busy}
                    includeInformational={includeInformational}
                    onIncludeInformational={setIncludeInformational}
                  />
                )}
                {step === 'compare' && report && (
                  <ReviewStep report={report} onContinue={() => setStep('report')} />
                )}
                {step === 'report' && report && (
                  <InvestigationReportEditor report={report} onChange={setReport} />
                )}
              </div>
            </div>
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
        Investigative Report drafting for WAC 246-341 & 246-337 · PDF-sourced subsection authority · Optional official web validation
      </footer>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  )
}
