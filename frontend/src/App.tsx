import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search,
  FileText,
  BookOpen,
  Menu,
  X,
  FileCheck2,
  Moon,
  Sun,
  UserRound,
  Users,
  LogOut,
  Shield,
  Settings,
  Bug,
  MessageSquare,
  Inbox,
  ScrollText,
  KeyRound,
  NotebookPen,
} from 'lucide-react'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import {
  api,
  type CaseDetail,
  type InvestigationReport,
  type PrivacyHit,
  type PrivacyScanResult,
  type StatuteHit,
  type WACNode,
} from './api'
import { useAuth } from './auth'
import { useTheme } from './theme'
import { AccountSettings } from './components/AccountSettings'
import { AdminAccessPanel } from './components/AdminAccessPanel'
import { AdminAuditPanel } from './components/AdminAuditPanel'
import { AdminInboxPanel } from './components/AdminInboxPanel'
import { AdminUsersPanel } from './components/AdminUsersPanel'
import { BugReportDialog } from './components/BugReportDialog'
import { CasesPanel } from './components/CasesPanel'
import { ChangelogPanel } from './components/ChangelogPanel'
import { ComplaintStep } from './components/ComplaintStep'
import { DirectoryPanel } from './components/DirectoryPanel'
import { FeedbackDialog } from './components/FeedbackDialog'
import { InvestigationReportEditor } from './components/InvestigationReportEditor'
import { PrivacyGate } from './components/PrivacyGate'
import { RelatedStatutesPanel } from './components/RelatedStatutesPanel'
import { ReviewStep } from './components/ReviewStep'
import { StatuteSearchPanel } from './components/StatuteSearchPanel'
import { WACSelectionPanel } from './components/WACSelectionPanel'
import { WorkflowStepper, type WorkflowStep } from './components/WorkflowStepper'
import { PrivacyScreenBanner } from './components/PrivacyScreenBanner'
import { canAccessAdmin, canEdit, canExport, roleLabel } from './permissions'
import { normalizeReportAllegations } from './allegationFormat'

type MainTab = 'analysis' | 'directory' | 'admin'
type AdminSubTab = 'users' | 'inbox' | 'audit' | 'access' | 'changelog'

function applyReport(report: InvestigationReport | null): InvestigationReport | null {
  return report ? normalizeReportAllegations(report) : null
}

export default function App() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { theme, setTheme, resolved } = useTheme()
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [bugOpen, setBugOpen] = useState(false)
  const [adminSubTab, setAdminSubTab] = useState<AdminSubTab>('users')
  const [inboxTotal, setInboxTotal] = useState(0)

  const signOut = () => {
    logout()
    navigate('/login', { replace: true })
  }
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showCasesDrawer, setShowCasesDrawer] = useState(false)
  const [tab, setTab] = useState<MainTab>('analysis')
  const [step, setStep] = useState<WorkflowStep>('workspace')

  const [wacs, setWacs] = useState<WACNode[]>([])
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [text, setText] = useState('')
  const [caseId, setCaseId] = useState('')
  const [investigationDate, setInvestigationDate] = useState('')
  const [facilityAddress, setFacilityAddress] = useState('')
  const [credentialNumber, setCredentialNumber] = useState('')
  const [report, setReport] = useState<InvestigationReport | null>(null)
  const [activeCaseId, setActiveCaseId] = useState<number | null>(null)
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null)
  const [casesRefreshKey, setCasesRefreshKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [searchBusy, setSearchBusy] = useState(false)
  const [relatedBusy, setRelatedBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [health, setHealth] = useState('')
  const [statuteHits, setStatuteHits] = useState<StatuteHit[]>([])
  const [relatedHits, setRelatedHits] = useState<StatuteHit[]>([])
  const [privacyHits, setPrivacyHits] = useState<PrivacyHit[]>([])
  const [privacyScan, setPrivacyScan] = useState<PrivacyScanResult | null>(null)
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false)
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [pendingAfterRedact, setPendingAfterRedact] = useState<'draft' | null>(null)
  const [privacyInfo, setPrivacyInfo] = useState('')

  const loadWacs = useCallback(async () => {
    setWacs(await api.listWacs({ level: 'code' }))
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const h = await api.health()
        setHealth(`${h.wac_codes} codes`)
        await loadWacs()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to reach API')
      }
    })()
  }, [loadWacs])

  useEffect(() => {
    if (!user || !canAccessAdmin(user.role, user.is_admin)) {
      setInboxTotal(0)
      return
    }
    const refreshCounts = () => {
      void api
        .inboxCounts()
        .then((c) => setInboxTotal(c.total))
        .catch(() => setInboxTotal(0))
    }
    refreshCounts()
    const id = window.setInterval(refreshCounts, 60_000)
    return () => window.clearInterval(id)
  }, [user, tab, adminSubTab])

  const favorites = useMemo(() => wacs.filter((w) => w.is_favorite), [wacs])
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites])

  const unlocked: Record<WorkflowStep, boolean> = {
    workspace: true,
    review: !!report,
    report: !!report,
  }

  const toggleFavorite = async (wacId: string) => {
    await api.toggleFavorite(wacId)
    await loadWacs()
  }

  const refreshCaseDetail = useCallback(async () => {
    if (!activeCaseId) {
      setCaseDetail(null)
      return
    }
    const detail = await api.getCase(activeCaseId)
    setCaseDetail(detail)
    setCasesRefreshKey((k) => k + 1)
  }, [activeCaseId])

  const openCase = async (id: number) => {
    setBusy(true)
    setError('')
    try {
      const detail = await api.getCase(id)
      setActiveCaseId(detail.id)
      setCaseDetail(detail)
      setCaseId(detail.case_id_label || '')
      setText(detail.complaint_text || '')
      setInvestigationDate(detail.investigation_date || '')
      setFacilityAddress(detail.facility_address || '')
      setCredentialNumber(detail.credential_number || '')
      setSelectedCodes(detail.approved_wac_ids || [])
      if (detail.report) {
        setReport(applyReport(detail.report))
        setStep('report')
      } else {
        setReport(null)
        setStep('workspace')
      }
      setTab('analysis')
      setShowCasesDrawer(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open case')
    } finally {
      setBusy(false)
    }
  }

  const startNewCase = () => {
    setActiveCaseId(null)
    setCaseDetail(null)
    setReport(null)
    setText('')
    setCaseId('')
    setInvestigationDate('')
    setFacilityAddress('')
    setCredentialNumber('')
    setSelectedCodes([])
    setPrivacyHits([])
    setPrivacyScan(null)
    setPrivacyInfo('')
    setStep('workspace')
    setTab('analysis')
    setShowCasesDrawer(false)
  }

  const ensureCaseSaved = async (reportPayload: InvestigationReport, complaintText = text) => {
    const payload = {
      case_id_label: caseId,
      title: caseId || `Case ${new Date().toISOString().slice(0, 10)}`,
      complaint_text: complaintText,
      investigation_date: investigationDate,
      facility_address: facilityAddress,
      credential_number: credentialNumber,
      approved_wac_ids: selectedCodes,
    }
    if (activeCaseId) {
      await api.updateCase(activeCaseId, payload)
      const detail = await api.saveCaseDraft(activeCaseId, reportPayload, 'Auto-save after draft build')
      setCaseDetail(detail)
      setCasesRefreshKey((k) => k + 1)
      return detail
    }
    const created = await api.createCase(payload)
    setActiveCaseId(created.id)
    const detail = await api.saveCaseDraft(created.id, reportPayload, 'Initial draft save')
    setCaseDetail(detail)
    setCasesRefreshKey((k) => k + 1)
    return detail
  }

  const addCodeToSelection = (codeId: string) => {
    setSelectedCodes((prev) => (prev.includes(codeId) ? prev : [...prev, codeId]))
    setReport(null)
    setStep('workspace')
  }

  const scanPrivacy = useCallback(async (value: string, opts?: { openModal?: boolean }) => {
    if (!value.trim()) {
      setPrivacyHits([])
      setPrivacyScan(null)
      return null
    }
    try {
      const scan = await api.privacyScan(value)
      setPrivacyHits(scan.hits)
      setPrivacyScan(scan)
      if (opts?.openModal && scan.has_hits) {
        setPrivacyModalOpen(true)
      }
      return scan
    } catch (e) {
      // Fail closed: keep prior hits and surface the error — never pretend "no PII".
      setError(e instanceof Error ? e.message : 'Privacy scan failed — check that the API is running')
      return null
    }
  }, [])

  const ensurePrivacyClear = async (): Promise<boolean> => {
    const scan = await scanPrivacy(text)
    if (!scan) {
      return false
    }
    if (scan.has_hits) {
      setPendingAfterRedact('draft')
      setPrivacyModalOpen(true)
      return false
    }
    return true
  }

  const continueAndRedact = async () => {
    setPrivacyBusy(true)
    setError('')
    try {
      const result = await api.privacyRedact(text)
      setText(result.redacted_text)
      setPrivacyHits([])
      setPrivacyScan(null)
      setPrivacyModalOpen(false)
      setPrivacyInfo(
        result.applied_count
          ? `${result.applied_count} Category 3/4 item${result.applied_count === 1 ? '' : 's'} redacted.`
          : 'Text cleared of Category 3/4 patterns.',
      )
      const action = pendingAfterRedact
      setPendingAfterRedact(null)
      if (action === 'draft') {
        // Continue draft with redacted text on next tick so state is applied.
        window.setTimeout(() => {
          void generateReportWithText(result.redacted_text)
        }, 0)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Redaction failed')
    } finally {
      setPrivacyBusy(false)
    }
  }

  const extractFile = async (file: File) => {
    setBusy(true)
    setProgress('Extracting document text...')
    setError('')
    try {
      const res = await api.extract(file)
      setText(res.text)
      setReport(null)
      setStep('workspace')
      await scanPrivacy(res.text, { openModal: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const searchStatutes = async () => {
    if (!text.trim()) {
      setError('Enter complaint text before searching statutes')
      return
    }
    setSearchBusy(true)
    setError('')
    try {
      // Exclude already-approved codes; use expanded local RAG (TF-IDF + Chroma blend)
      const res = await api.searchStatutes(text, 30, selectedCodes)
      setStatuteHits(res.hits)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Statute search failed')
    } finally {
      setSearchBusy(false)
    }
  }

  const refreshRelated = useCallback(async () => {
    if (!selectedCodes.length) {
      setRelatedHits([])
      return
    }
    setRelatedBusy(true)
    try {
      const res = await api.suggestRelated(selectedCodes, text, 15)
      setRelatedHits(res.suggestions)
    } catch {
      setRelatedHits([])
    } finally {
      setRelatedBusy(false)
    }
  }, [selectedCodes, text])

  useEffect(() => {
    // Related suggestions are optional research only — clear when selection empties;
    // do not auto-fetch (user must request them).
    if (!selectedCodes.length) setRelatedHits([])
  }, [selectedCodes.length])

  const generateReportWithText = async (complaintText: string) => {
    if (!selectedCodes.length) {
      setError('Select the officially approved WACs for this case before drafting the report.')
      return
    }
    setBusy(true)
      setProgress('Drafting report from approved WACs (local PDF match)…')
    setError('')
    try {
      const res = await api.investigate({
        text: complaintText,
        selected_wacs: selectedCodes,
        include_informational: true,
        case_id: caseId || undefined,
        investigation_date: investigationDate || undefined,
        facility_address: facilityAddress || undefined,
        credential_number: credentialNumber || undefined,
      })
      setReport(applyReport(res))
      setStep('review')
      setBusy(false)
      setProgress('Saving working draft to case…')
      // Case persistence is secondary — do not block Compare on create/save round-trips
      try {
        await ensureCaseSaved(res, complaintText)
      } catch (saveErr) {
        setError(saveErr instanceof Error ? saveErr.message : 'Draft built, but case save failed')
      }
      setProgress('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
      setBusy(false)
      setProgress('')
    }
  }

  const generateReport = async () => {
    if (!selectedCodes.length) {
      setError('Select the officially approved WACs for this case before drafting the report.')
      return
    }
    const ok = await ensurePrivacyClear()
    if (!ok) return
    await generateReportWithText(text)
  }

  const rebuildCaseDraft = async () => {
    if (!activeCaseId) return
    setBusy(true)
    setProgress('Rebuilding draft from approved WACs…')
    setError('')
    try {
      await api.updateCase(activeCaseId, {
        complaint_text: text,
        approved_wac_ids: selectedCodes,
        case_id_label: caseId,
        investigation_date: investigationDate,
        facility_address: facilityAddress,
        credential_number: credentialNumber,
      })
      const detail = await api.rebuildCaseDraft(activeCaseId)
      setCaseDetail(detail)
      if (detail.report) setReport(applyReport(detail.report))
      setCasesRefreshKey((k) => k + 1)
      setStep('report')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rebuild failed')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const cycleTheme = () => {
    const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
    setTheme(order[(order.indexOf(theme) + 1) % order.length])
  }

  const wacPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <WACSelectionPanel
          wacs={wacs}
          selectedCodes={selectedCodes}
          onSelectionChange={(codes) => {
            setSelectedCodes(codes)
            setReport(null)
            setStep('workspace')
          }}
          onToggleFavorite={toggleFavorite}
          favoriteIds={favoriteIds}
        />
      </div>
      <RelatedStatutesPanel
        suggestions={relatedHits}
        busy={relatedBusy}
        onRefresh={() => void refreshRelated()}
        onAddCode={addCodeToSelection}
        selectedIds={selectedCodes}
        hasSelection={selectedCodes.length > 0}
        comparisons={report?.comparisons}
      />
    </div>
  )

  const userCanEdit = canEdit(user?.role, user?.is_admin)
  const userCanExport = canExport(user?.role, user?.is_admin)
  const userCanAdmin = canAccessAdmin(user?.role, user?.is_admin)

  const casesPanel = (
    <CasesPanel
      activeCaseId={activeCaseId}
      onOpenCase={(id) => void openCase(id)}
      onNewCase={startNewCase}
      refreshKey={casesRefreshKey}
      canEdit={userCanEdit}
      onCaseRemoved={(id) => {
        if (activeCaseId === id) {
          startNewCase()
        }
      }}
    />
  )

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-card/90 backdrop-blur-md dark:border-ink-700">
        <div className="mx-auto flex h-[4.25rem] max-w-none items-center justify-between gap-3 px-4 lg:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="btn-ghost btn-sm md:hidden"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              aria-label="Open approved WAC selection"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tide-600 text-white shadow-soft">
                <FileCheck2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">
                  WACMAKR
                </h1>
                <p className="hidden truncate text-xs text-ink-500 sm:block">
                  Case reports from approved WACs {health ? `· ${health}` : ''}
                </p>
              </div>
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm hidden sm:inline-flex"
              onClick={() => setFeedbackOpen(true)}
              title="Send feedback"
            >
              <MessageSquare className="h-4 w-4" />
              <span className="ml-1.5 hidden lg:inline">Feedback</span>
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm hidden sm:inline-flex"
              onClick={() => setBugOpen(true)}
              title="Report a bug"
            >
              <Bug className="h-4 w-4" />
              <span className="ml-1.5 hidden lg:inline">Bug</span>
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={cycleTheme} title={`Theme: ${theme}`}>
              {resolved === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            {user && userCanAdmin && (
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => {
                  setAdminSubTab('users')
                  setTab('admin')
                }}
                title="Admin panel"
              >
                <Shield className="h-4 w-4" />
                <span className="ml-1.5 hidden md:inline">Admin</span>
                {inboxTotal > 0 && (
                  <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                    {inboxTotal}
                  </span>
                )}
              </button>
            )}
            {user && (
              <div className="relative">
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => setAccountMenuOpen((v) => !v)}
                  aria-expanded={accountMenuOpen}
                >
                  <UserRound className="mr-2 h-4 w-4" />
                  {user.display_name || user.username}
                </button>
                {accountMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setAccountMenuOpen(false)} />
                    <div className="absolute right-0 z-50 mt-1 w-56 rounded-xl border border-ink-200/80 bg-card p-1 shadow-panel dark:border-ink-700">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-100/80 dark:hover:bg-ink-800/50 sm:hidden"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          setFeedbackOpen(true)
                        }}
                      >
                        <MessageSquare className="h-4 w-4" /> Feedback
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-100/80 dark:hover:bg-ink-800/50 sm:hidden"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          setBugOpen(true)
                        }}
                      >
                        <Bug className="h-4 w-4" /> Report bug
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-100/80 dark:hover:bg-ink-800/50"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          setAccountOpen(true)
                        }}
                      >
                        <Settings className="h-4 w-4" /> Account settings
                      </button>
                      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-ink-400">
                        {roleLabel(user.role, user.is_admin)}
                      </div>
                      {userCanAdmin && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-100/80 dark:hover:bg-ink-800/50"
                          onClick={() => {
                            setAccountMenuOpen(false)
                            setAdminSubTab('users')
                            setTab('admin')
                          }}
                        >
                          <Shield className="h-4 w-4" /> Admin panel
                          {inboxTotal > 0 && (
                            <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                              {inboxTotal}
                            </span>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-100/80 dark:hover:bg-ink-800/50"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          signOut()
                        }}
                      >
                        <LogOut className="h-4 w-4" /> Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-4.25rem)]">
        {showMobileMenu && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="fixed inset-0 bg-ink-950/35 backdrop-blur-[2px]" onClick={() => setShowMobileMenu(false)} />
            <div className="fixed left-0 top-0 flex h-full w-[22rem] max-w-[90vw] flex-col border-r bg-card shadow-panel">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <h2 className="font-semibold">Approved WACs</h2>
                  <p className="text-xs text-muted-foreground">Required for every case report</p>
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setShowMobileMenu(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">{wacPanel}</div>
            </div>
          </div>
        )}

        <aside className="sidebar-rail hidden h-full w-[240px] min-w-[220px] max-w-[260px] shrink-0 border-r border-ink-200/80 dark:border-ink-700 md:flex md:flex-col">
          <div className="border-b border-ink-200/80 px-3 py-3 dark:border-ink-700">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Search className="h-4 w-4 text-tide-600" />
              Approved WACs
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Required. Only selected codes enter the report.
            </p>
          </div>
          <div className="min-h-0 flex-1">{wacPanel}</div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-ink-200/80 px-4 py-2.5 dark:border-ink-700">
            <div
              className={clsx(
                'grid w-full gap-1 rounded-xl bg-ink-100/80 p-1 dark:bg-ink-800/60',
                userCanAdmin ? 'grid-cols-3' : 'grid-cols-2',
              )}
            >
              {(
                [
                  ['analysis', 'Investigation', FileText],
                  ['directory', 'Directory', BookOpen],
                  ...(userCanAdmin ? ([['admin', 'Admin', Users]] as const) : []),
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={clsx('nav-pill', tab === id ? 'nav-pill-active' : 'nav-pill-idle')}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                  {id === 'admin' && inboxTotal > 0 && (
                    <span className="ml-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                      {inboxTotal}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {user && userCanEdit && !userCanExport && (
            <div className="mx-4 mt-3 rounded-xl border border-ink-200/80 bg-ink-50/80 px-3 py-2 text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-300">
              Viewer role — you can create and edit cases and investigation reports in-system. Export, download, and copy are disabled; drafts stay in the case record.
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="mx-4 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          {privacyInfo && (
            <div
              className="mx-4 mt-3 rounded-xl border border-tide-500/30 bg-tide-500/10 px-3 py-2 text-sm text-tide-800 dark:text-tide-200"
              aria-live="polite"
            >
              {privacyInfo}
            </div>
          )}
          {progress && (
            <div className="mx-4 mt-2 text-xs text-muted-foreground" aria-live="polite">
              {progress}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === 'analysis' && (
              <div className="flex h-full flex-col overflow-hidden">
                <div className="border-b border-ink-200/70 bg-card/50 px-3 py-1.5 dark:border-ink-700 lg:px-4 lg:py-2">
                  <WorkflowStepper
                    step={step}
                    onStepChange={setStep}
                    unlocked={unlocked}
                    context={{
                      approvedWacCount: selectedCodes.length,
                      quoteIssueCount: report?.quote_integrity?.failures?.length ?? 0,
                      caseStatus: caseDetail?.status ?? null,
                    }}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5">
                  {step === 'workspace' && (
                    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-4">
                      <ComplaintStep
                        text={text}
                        onTextChange={(v) => {
                          setText(v)
                          setReport(null)
                          setPrivacyHits([])
                          setPrivacyInfo('')
                        }}
                        caseId={caseId}
                        onCaseIdChange={setCaseId}
                        investigationDate={investigationDate}
                        onInvestigationDateChange={setInvestigationDate}
                        facilityAddress={facilityAddress}
                        onFacilityAddressChange={setFacilityAddress}
                        credentialNumber={credentialNumber}
                        onCredentialNumberChange={setCredentialNumber}
                        onExtractFile={extractFile}
                        onAnalyze={() => void generateReport()}
                        selectedCount={selectedCodes.length}
                        busy={busy}
                        canEdit={userCanEdit}
                        privacyHits={privacyHits}
                        onBlurScan={() => {
                          void scanPrivacy(text)
                        }}
                      />
                      <details className="panel group">
                        <summary className="cursor-pointer list-none px-4 py-3 font-sans text-sm font-medium text-ink-600 marker:content-none dark:text-ink-300 [&::-webkit-details-marker]:hidden">
                          <span className="flex items-center justify-between gap-2">
                            <span>
                              Optional research — find stronger WAC/RCW fits
                              <span className="mt-0.5 block text-xs font-normal text-ink-400">
                                Shows Strong / Moderate / Weak / None application — same scale as Compare.
                                Not authorization; does not replace left-rail approvals.
                              </span>
                            </span>
                            <span className="text-xs text-ink-400 group-open:hidden">Show</span>
                            <span className="hidden text-xs text-ink-400 group-open:inline">Hide</span>
                          </span>
                        </summary>
                        <div className="border-t border-ink-200/70 px-2 pb-3 dark:border-ink-700">
                          <StatuteSearchPanel
                            hits={statuteHits}
                            busy={searchBusy}
                            onSearch={() => void searchStatutes()}
                            onAddCode={addCodeToSelection}
                            selectedIds={selectedCodes}
                            comparisons={report?.comparisons}
                          />
                        </div>
                      </details>
                      <div className="mt-auto pt-2">
                        <PrivacyScreenBanner />
                      </div>
                    </div>
                  )}
                  {step === 'review' && report && (
                    <ReviewStep
                      comparisons={report.comparisons}
                      complaintText={text}
                      report={report}
                      onBack={() => setStep('workspace')}
                      onContinue={() => setStep('report')}
                      busy={busy}
                      statuteHits={statuteHits}
                      searchBusy={searchBusy}
                      onSearchStatutes={() => void searchStatutes()}
                      onAddCode={addCodeToSelection}
                      selectedIds={selectedCodes}
                    />
                  )}
                  {step === 'report' && report && (
                    <InvestigationReportEditor
                      report={report}
                      selectedWacs={selectedCodes}
                      caseId={activeCaseId}
                      caseDetail={caseDetail}
                      onCaseRefresh={refreshCaseDetail}
                      onReportChange={setReport}
                      onRebuild={rebuildCaseDraft}
                      onBack={() => setStep('review')}
                      canEdit={userCanEdit}
                      canExport={userCanExport}
                    />
                  )}
                </div>
              </div>
            )}

            {tab === 'directory' && (
              <div className="h-full overflow-y-auto p-4 lg:p-5">
                <DirectoryPanel
                  wacs={wacs}
                  selectedCodes={selectedCodes}
                  onSelectionChange={(codes) => {
                    setSelectedCodes(codes)
                    setReport(null)
                  }}
                  onToggleFavorite={toggleFavorite}
                  canEdit={userCanEdit}
                />
              </div>
            )}

            {tab === 'admin' && user && userCanAdmin && (
              <div className="h-full overflow-y-auto p-4 lg:p-5">
                <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-ink-100/80 p-1 dark:bg-ink-800/60">
                  {(
                    [
                      ['users', 'Users', Users],
                      ['inbox', 'Inbox', Inbox],
                      ['access', 'Access', KeyRound],
                      ['audit', 'Audit', ScrollText],
                      ['changelog', 'Changelog', NotebookPen],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      className={clsx('nav-pill', adminSubTab === id ? 'nav-pill-active' : 'nav-pill-idle')}
                      onClick={() => setAdminSubTab(id)}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      {id === 'inbox' && inboxTotal > 0 && (
                        <span className="ml-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                          {inboxTotal}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {adminSubTab === 'users' && <AdminUsersPanel />}
                {adminSubTab === 'inbox' && <AdminInboxPanel />}
                {adminSubTab === 'access' && <AdminAccessPanel />}
                {adminSubTab === 'audit' && <AdminAuditPanel />}
                {adminSubTab === 'changelog' && <ChangelogPanel />}
              </div>
            )}
          </div>
        </main>

        <aside className="hidden h-full w-[200px] min-w-[180px] max-w-[220px] shrink-0 border-l border-ink-200/80 bg-card/40 dark:border-ink-700 lg:flex lg:flex-col">
          {casesPanel}
        </aside>

        <div className="fixed bottom-4 right-4 lg:hidden">
          <button
            type="button"
            className="btn-default h-12 w-12 rounded-full shadow-lg"
            onClick={() => setShowCasesDrawer(!showCasesDrawer)}
            aria-label="Open cases"
          >
            <FileText className="h-4 w-4" />
          </button>
        </div>

        {showCasesDrawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="fixed inset-0 bg-black/20" onClick={() => setShowCasesDrawer(false)} />
            <div className="fixed right-0 top-0 flex h-full w-80 flex-col border-l bg-background shadow-lg">
              <div className="flex items-center justify-between border-b p-3">
                <h2 className="font-semibold">Cases</h2>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setShowCasesDrawer(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">{casesPanel}</div>
            </div>
          </div>
        )}
      </div>

      <PrivacyGate
        open={privacyModalOpen}
        scan={privacyScan}
        busy={privacyBusy}
        onCancel={() => {
          setPrivacyModalOpen(false)
          setPendingAfterRedact(null)
        }}
        onContinueRedact={() => void continueAndRedact()}
      />
      <AccountSettings
        open={accountOpen || Boolean(user?.must_change_password)}
        onClose={() => {
          if (user?.must_change_password) return
          setAccountOpen(false)
        }}
        forcePasswordChange={Boolean(user?.must_change_password)}
      />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <BugReportDialog
        open={bugOpen}
        onClose={() => setBugOpen(false)}
        appContext={{
          workflowStep: step,
          mainTab: tab,
          caseDbId: activeCaseId,
          caseIdLabel: caseId,
          approvedWacCount: selectedCodes.length,
          approvedWacIds: selectedCodes.slice(0, 40),
        }}
      />
    </div>
  )
}
