import { useEffect, useState } from 'react'
import {
  FileText,
  BookOpen,
  Menu,
  X,
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
import { api } from './api'
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
import { ResizeHandle } from './components/ResizeHandle'
import { SodEditor } from './components/SodEditor'
import { LOCAL_DEMO_SCENARIOS } from './fixtures/localQuickDraft'
import { ReviewStep } from './components/ReviewStep'
import { EvidenceStep } from './components/EvidenceStep'
import { StatuteSearchPanel } from './components/StatuteSearchPanel'
import { WACSelectionPanel } from './components/WACSelectionPanel'
import { WorkflowStepper } from './components/WorkflowStepper'
import { DraftRecallMenu } from './components/DraftRecallMenu'
import { formatSavedClock } from './draftBackup'
import { PrivacyScreenBanner } from './components/PrivacyScreenBanner'
import { useResizableWidth } from './hooks/useResizableWidth'
import { useInvestigationWorkspace } from './hooks/useInvestigationWorkspace'
import { canAccessAdmin, canEdit, canExport, roleLabel } from './permissions'

type MainTab = 'analysis' | 'directory' | 'admin'
type AdminSubTab = 'users' | 'inbox' | 'audit' | 'access' | 'changelog'

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
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showCasesDrawer, setShowCasesDrawer] = useState(false)
  const [tab, setTab] = useState<MainTab>('analysis')
  const [docSurface, setDocSurface] = useState<'ir' | 'sod'>('ir')

  const ws = useInvestigationWorkspace({
    userRole: user?.role,
    isAdmin: user?.is_admin,
    userId: user?.id,
  })
  const {
    step,
    setStep,
    unlocked,
    wacs,
    selectedCodes,
    setSelectedCodes,
    text,
    setText,
    caseId,
    setCaseId,
    investigationDate,
    setInvestigationDate,
    facilityAddress,
    setFacilityAddress,
    credentialNumber,
    setCredentialNumber,
    report,
    setReport,
    activeCaseId,
    caseDetail,
    casesRefreshKey,
    busy,
    searchBusy,
    relatedBusy,
    progress,
    error,
    setError,
    health,
    statuteHits,
    relatedHits,
    privacyHits,
    privacyScan,
    privacyModalOpen,
    setPrivacyModalOpen,
    privacyBusy,
    privacyInfo,
    localDemoId,
    setLocalDemoId,
    favoriteIds,
    toggleFavorite,
    refreshCaseDetail,
    openCase,
    startNewCase,
    ensureCaseSaved,
    addCodeToSelection,
    continueAndRedact,
    extractFile,
    searchStatutes,
    refreshRelated,
    generateReport,
    applyLocalQuickDraft,
    loadLocalDemoAndDraft,
    rebuildCaseDraft,
    confirmCompareAndContinue,
    confirmEvidenceAndContinue,
    clearReportToWorkspace,
    scanPrivacy,
    clearPrivacyHints,
    saveStatus,
    recoverOffer,
    applyRecoveredDraft,
    dismissRecoveredDraft,
    restoreSnapshot,
    restoreEpoch,
  } = ws

  const signOut = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const wacRail = useResizableWidth({
    storageKey: 'wacmakr.sidebar.wacWidth',
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 480,
  })
  const casesRail = useResizableWidth({
    storageKey: 'wacmakr.sidebar.casesWidth',
    defaultWidth: 280,
    minWidth: 220,
    maxWidth: 520,
  })

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
            const same =
              codes.length === selectedCodes.length && codes.every((c) => selectedCodes.includes(c))
            setSelectedCodes(codes)
            if (!same) clearReportToWorkspace()
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
  const saveLabel =
    saveStatus.state === 'saving'
      ? 'Saving…'
      : saveStatus.state === 'offline'
        ? 'Kept on this device'
        : saveStatus.state === 'saved' && saveStatus.at
          ? `Saved ${formatSavedClock(saveStatus.at)}`
          : saveStatus.state === 'error'
            ? 'Save failed'
            : ''
  const saveTone =
    saveStatus.state === 'offline' || saveStatus.state === 'error' ? 'warn' : saveStatus.state === 'saved' ? 'ready' : 'neutral'

  const casesPanel = (
    <CasesPanel
      activeCaseId={activeCaseId}
      onOpenCase={(id) => {
        void openCase(id).then((ok) => {
          if (!ok) return
          setTab('analysis')
          setShowCasesDrawer(false)
        })
      }}
      onNewCase={() => {
        startNewCase()
        setTab('analysis')
        setShowCasesDrawer(false)
      }}
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
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-card dark:border-ink-700">
        <div className="mx-auto flex h-14 max-w-none items-center justify-between gap-3 px-4 lg:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="btn-ghost btn-sm md:hidden"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              aria-label="Open approved WAC selection"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="brand-mark truncate">WACMAKR</h1>
              <div className="brand-rule" aria-hidden />
              <p className="mt-1 hidden truncate text-[11px] text-ink-500 sm:block">
                Investigation reports · approved WACs only
                {health ? ` · ${health}` : ''}
              </p>
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm hidden sm:inline-flex"
              onClick={() => setFeedbackOpen(true)}
              title="Send feedback"
              aria-label="Send feedback"
            >
              <MessageSquare className="h-4 w-4" />
              <span className="ml-1.5 hidden lg:inline">Feedback</span>
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm hidden sm:inline-flex"
              onClick={() => setBugOpen(true)}
              title="Report a bug"
              aria-label="Report a bug"
            >
              <Bug className="h-4 w-4" />
              <span className="ml-1.5 hidden lg:inline">Bug</span>
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={cycleTheme}
              title={`Theme: ${theme}`}
              aria-label={`Theme: ${theme}. Click to cycle.`}
            >
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
                  <span className="ml-1.5 rounded-sm bg-rose-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
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
                    <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border border-ink-200 bg-card p-1 dark:border-ink-700">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800/50 sm:hidden"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          setFeedbackOpen(true)
                        }}
                      >
                        <MessageSquare className="h-4 w-4" /> Feedback
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800/50 sm:hidden"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          setBugOpen(true)
                        }}
                      >
                        <Bug className="h-4 w-4" /> Report bug
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800/50"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          setAccountOpen(true)
                        }}
                      >
                        <Settings className="h-4 w-4" /> Account settings
                      </button>
                      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-ink-400">
                        {roleLabel(user.role, user.is_admin)}
                      </div>
                      {userCanAdmin && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800/50"
                          onClick={() => {
                            setAccountMenuOpen(false)
                            setAdminSubTab('users')
                            setTab('admin')
                          }}
                        >
                          <Shield className="h-4 w-4" /> Admin panel
                          {inboxTotal > 0 && (
                            <span className="ml-auto rounded-sm bg-rose-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                              {inboxTotal}
                            </span>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800/50"
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

      <div className="flex h-[calc(100vh-3.5rem)]">
        {showMobileMenu && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="fixed inset-0 bg-ink-950/40" onClick={() => setShowMobileMenu(false)} />
            <div className="fixed left-0 top-0 flex h-full w-[22rem] max-w-[90vw] flex-col border-r bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <h2 className="font-display text-base">Approved WACs</h2>
                  <p className="text-xs text-muted-foreground">Required for every case report</p>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setShowMobileMenu(false)}
                  aria-label="Close approved WAC panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">{wacPanel}</div>
            </div>
          </div>
        )}

        <aside
          className="sidebar-rail relative hidden h-full shrink-0 border-r border-ink-200 dark:border-ink-700 md:flex md:flex-col"
          style={{ width: wacRail.width }}
        >
          <div className="border-b border-ink-200 px-3 py-3 dark:border-ink-700">
            <h2 className="font-display text-[15px] tracking-tight text-ink-900 dark:text-ink-50">
              Approved WACs
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
              Required. Only selected codes enter the report.
            </p>
          </div>
          <div className="min-h-0 flex-1">{wacPanel}</div>
          <ResizeHandle
            edge="right"
            label="Resize Approved WACs panel"
            onPointerDown={wacRail.onResizePointerDown('right')}
            onNudge={wacRail.nudge}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-transparent">
          <div className="border-b border-ink-200 px-4 dark:border-ink-700">
            <div
              className={clsx(
                'grid w-full',
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
                    <span className="ml-1 rounded-sm bg-rose-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                      {inboxTotal}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {user && userCanEdit && !userCanExport && (
            <div className="mx-4 mt-3 border-l-2 border-ink-400 bg-ink-50/90 px-3 py-2 text-sm text-ink-600 dark:bg-ink-900/40 dark:text-ink-300">
              Viewer role — you can create and edit cases and investigation reports in-system. Export, download, and copy are disabled; drafts stay in the case record.
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="mx-4 mt-3 border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          {privacyInfo && (
            <div
              className="mx-4 mt-3 border-l-2 border-tide-600 bg-tide-500/10 px-3 py-2 text-sm text-tide-800 dark:text-tide-200"
              aria-live="polite"
            >
              {privacyInfo}
            </div>
          )}
          {recoverOffer && (
            <div
              className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 border-l-2 border-cedar-600 bg-cedar-50/80 px-3 py-2 text-sm text-ink-800 dark:bg-cedar-950/30 dark:text-ink-100"
              role="status"
            >
              <p>
                This device has a newer draft
                {recoverOffer.savedAt ? ` from ${formatSavedClock(recoverOffer.savedAt)}` : ''}.
                Restore it after an error or dropped connection?
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary !h-8 !px-3 text-xs" onClick={applyRecoveredDraft}>
                  Restore
                </button>
                <button type="button" className="btn-ghost !h-8 !px-3 text-xs" onClick={dismissRecoveredDraft}>
                  Discard
                </button>
              </div>
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
                <div className="border-b border-ink-200 bg-card/80 px-3 py-2 dark:border-ink-700 lg:px-4">
                  <WorkflowStepper
                    step={step}
                    onStepChange={setStep}
                    unlocked={unlocked}
                    context={{
                      approvedWacCount: selectedCodes.length,
                      quoteIssueCount: report?.quote_integrity?.failures?.length ?? 0,
                      caseStatus: caseDetail?.status ?? null,
                      saveLabel: saveLabel || undefined,
                      saveTone,
                    }}
                  />
                </div>
                <div
                  className={
                    step === 'report'
                      ? 'min-h-0 flex-1 overflow-y-auto'
                      : 'min-h-0 flex-1 overflow-y-auto p-3 pb-20 sm:p-4 lg:p-5 lg:pb-5'
                  }
                >
                  {step === 'workspace' && (
                    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-5">
                      <ComplaintStep
                        text={text}
                        onTextChange={(v) => {
                          setText(v)
                          clearReportToWorkspace()
                          clearPrivacyHints()
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
                        hasPreviousDraft={Boolean(report)}
                        selectedCount={selectedCodes.length}
                        busy={busy}
                        canEdit={userCanEdit}
                        privacyHits={privacyHits}
                        onBlurScan={() => {
                          void scanPrivacy(text)
                        }}
                        showLocalDemo={userCanAdmin}
                        localDemoOptions={LOCAL_DEMO_SCENARIOS.map((d) => ({
                          id: d.id,
                          label: d.label,
                          focus: d.focus,
                        }))}
                        localDemoId={localDemoId}
                        onLocalDemoIdChange={setLocalDemoId}
                        onLoadLocalDemo={() => applyLocalQuickDraft()}
                        onLoadLocalDemoAndDraft={() => loadLocalDemoAndDraft()}
                      />
                      <details className="group border-t border-ink-200 pt-3 dark:border-ink-700">
                        <summary className="cursor-pointer list-none font-sans text-sm font-medium text-ink-600 marker:content-none dark:text-ink-300 [&::-webkit-details-marker]:hidden">
                          <span className="flex items-center justify-between gap-2">
                            <span>
                              Optional research — find stronger WAC/RCW fits
                              <span className="mt-0.5 block text-xs font-normal text-ink-400">
                                Ranks codes by the same duty-overlap logic as Compare drafts (Strong /
                                Moderate / Weak / None). Research only — not authorization.
                              </span>
                            </span>
                            <span className="text-xs text-ink-400 group-open:hidden">Show</span>
                            <span className="hidden text-xs text-ink-400 group-open:inline">Hide</span>
                          </span>
                        </summary>
                        <div className="mt-3">
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
                      onReportChange={setReport}
                      onBack={() => setStep('workspace')}
                      onContinue={(codes) => void confirmCompareAndContinue(codes)}
                      busy={busy}
                      statuteHits={statuteHits}
                      searchBusy={searchBusy}
                      onSearchStatutes={() => void searchStatutes()}
                      onAddCode={addCodeToSelection}
                      selectedIds={selectedCodes}
                      caseId={activeCaseId}
                      caseDetail={caseDetail}
                      onCaseRefresh={refreshCaseDetail}
                    />
                  )}
                  {step === 'evidence' && report && (
                    <EvidenceStep
                      report={report}
                      caseDetail={caseDetail}
                      caseId={activeCaseId}
                      busy={busy}
                      canEdit={userCanEdit}
                      onReportChange={setReport}
                      onCaseRefresh={refreshCaseDetail}
                      onBack={() => setStep('report')}
                      onContinue={(next) => void confirmEvidenceAndContinue(next)}
                    />
                  )}
                  {step === 'report' && report && (
                    <div className="flex min-h-0 flex-col gap-3">
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-3 pt-2 dark:border-ink-700 sm:px-4 lg:px-5">
                        <div className="flex flex-wrap gap-0">
                          {(
                            [
                              ['ir', 'Investigation Report'],
                              ['sod', 'Statement of Deficiencies'],
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              className={clsx(
                                'nav-pill',
                                docSurface === id ? 'nav-pill-active' : 'nav-pill-idle',
                              )}
                              onClick={() => setDocSurface(id)}
                            >
                              {label}
                              {id === 'sod' && (report.sod?.deficiencies?.length ?? 0) > 0 && (
                                <span className="ml-1 font-mono text-[10px] text-ink-400">
                                  {report.sod!.deficiencies!.length}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          className="btn-ghost !h-8 !px-2.5 text-xs"
                          onClick={() => setStep('evidence')}
                          title="Review exhibits against allegation duties (optional)"
                        >
                          Evidence
                        </button>
                        {userCanEdit && (
                          <DraftRecallMenu
                            snapshots={caseDetail?.snapshots || []}
                            disabled={!userCanEdit || caseDetail?.status === 'final' || caseDetail?.status === 'in_review' || caseDetail?.status === 'archived' || caseDetail?.status === 'trashed'}
                            busy={busy}
                            onRestore={(id) => void restoreSnapshot(id)}
                          />
                        )}
                        </div>
                      </div>
                      {docSurface === 'ir' ? (
                        <InvestigationReportEditor
                          report={report}
                          selectedWacs={selectedCodes}
                          caseId={activeCaseId}
                          caseDetail={caseDetail}
                          onCaseRefresh={refreshCaseDetail}
                          onReportChange={setReport}
                          onRebuild={rebuildCaseDraft}
                          onEnsureCase={async (reportPayload) => {
                            const detail = await ensureCaseSaved(reportPayload)
                            return detail.id
                          }}
                          onBack={() => setStep('review')}
                          revision={restoreEpoch}
                          onRestoreSnapshot={(id) => void restoreSnapshot(id)}
                          canEdit={userCanEdit}
                          canExport={userCanExport}
                        />
                      ) : (
                        <SodEditor
                          report={report}
                          onReportChange={setReport}
                          canEdit={userCanEdit}
                          canExport={userCanExport}
                          busy={busy}
                          activeCaseId={activeCaseId}
                          evidence={caseDetail?.evidence || []}
                          onEnsureCase={async (reportPayload) => {
                            const detail = await ensureCaseSaved(reportPayload)
                            return detail.id
                          }}
                        />
                      )}
                    </div>
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
                    clearReportToWorkspace()
                  }}
                  onToggleFavorite={toggleFavorite}
                  canEdit={userCanEdit}
                />
              </div>
            )}

            {tab === 'admin' && user && userCanAdmin && (
              <div className="h-full overflow-y-auto p-4 lg:p-5">
                <div className="mb-4 flex flex-wrap gap-0 border-b border-ink-200 dark:border-ink-700">
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
                        <span className="ml-1 rounded-sm bg-rose-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
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

        <aside
          className="relative hidden h-full shrink-0 border-l border-ink-200 bg-card dark:border-ink-700 lg:flex lg:flex-col"
          style={{ width: casesRail.width }}
        >
          <ResizeHandle
            edge="left"
            label="Resize Cases panel"
            onPointerDown={casesRail.onResizePointerDown('left')}
            onNudge={casesRail.nudge}
            className="!hidden lg:!block"
          />
          {casesPanel}
        </aside>

        <div className="fixed bottom-4 right-4 lg:hidden">
          <button
            type="button"
            className="btn-default h-12 w-12 rounded-md"
            onClick={() => setShowCasesDrawer(!showCasesDrawer)}
            aria-label="Open cases"
          >
            <FileText className="h-4 w-4" />
          </button>
        </div>

        {showCasesDrawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="fixed inset-0 bg-ink-950/40" onClick={() => setShowCasesDrawer(false)} />
            <div className="fixed right-0 top-0 flex h-full w-80 flex-col border-l bg-card">
              <div className="flex items-center justify-between border-b p-3">
                <h2 className="font-display text-base">Cases</h2>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setShowCasesDrawer(false)} aria-label="Close cases panel">
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
