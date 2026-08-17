/**
 * Investigation workspace orchestration: Intake → Compare → Report state,
 * privacy gate, case save/rebuild, and local demos.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type CaseDetail,
  type InvestigationReport,
  type PrivacyHit,
  type PrivacyScanResult,
  type StatuteHit,
  type WACNode,
} from '../api'
import { normalizeReportAllegations } from '../allegationFormat'
import { getLocalDemoById, LOCAL_DEMO_SCENARIOS } from '../fixtures/localQuickDraft'
import type { WorkflowStep } from '../components/WorkflowStepper'
import { canAccessAdmin } from '../permissions'

function applyReport(report: InvestigationReport | null): InvestigationReport | null {
  return report ? normalizeReportAllegations(report) : null
}

function withLegacyCompareConfirmed(report: InvestigationReport): InvestigationReport {
  if (report.compare_cites_confirmed) return report
  // Saved cases opened mid-Report should not trap investigators behind a new gate.
  const codes =
    report.confirmed_allegation_codes?.length
      ? report.confirmed_allegation_codes
      : (report.comparisons || []).map((c) => c.wac_id || c.code)
  return {
    ...report,
    compare_cites_confirmed: true,
    confirmed_allegation_codes: codes,
  }
}

export type InvestigationWorkspace = {
  step: WorkflowStep
  setStep: (s: WorkflowStep) => void
  unlocked: Record<WorkflowStep, boolean>
  wacs: WACNode[]
  selectedCodes: string[]
  setSelectedCodes: (codes: string[]) => void
  text: string
  setText: (v: string) => void
  caseId: string
  setCaseId: (v: string) => void
  investigationDate: string
  setInvestigationDate: (v: string) => void
  facilityAddress: string
  setFacilityAddress: (v: string) => void
  credentialNumber: string
  setCredentialNumber: (v: string) => void
  report: InvestigationReport | null
  setReport: (r: InvestigationReport | null) => void
  activeCaseId: number | null
  caseDetail: CaseDetail | null
  casesRefreshKey: number
  busy: boolean
  searchBusy: boolean
  relatedBusy: boolean
  progress: string
  error: string
  setError: (v: string) => void
  health: string
  statuteHits: StatuteHit[]
  relatedHits: StatuteHit[]
  privacyHits: PrivacyHit[]
  privacyScan: PrivacyScanResult | null
  privacyModalOpen: boolean
  setPrivacyModalOpen: (v: boolean) => void
  privacyBusy: boolean
  privacyInfo: string
  localDemoId: string
  setLocalDemoId: (v: string) => void
  favorites: WACNode[]
  favoriteIds: Set<string>
  loadWacs: () => Promise<void>
  toggleFavorite: (wacId: string) => Promise<void>
  refreshCaseDetail: () => Promise<void>
  openCase: (id: number) => Promise<void>
  startNewCase: () => void
  ensureCaseSaved: (
    reportPayload: InvestigationReport,
    complaintText?: string,
    opts?: {
      approved_wac_ids?: string[]
      case_id_label?: string
      investigation_date?: string
      facility_address?: string
      credential_number?: string
    },
  ) => Promise<CaseDetail>
  addCodeToSelection: (codeId: string) => void
  continueAndRedact: () => Promise<void>
  extractFile: (file: File) => Promise<void>
  searchStatutes: () => Promise<void>
  refreshRelated: () => Promise<void>
  generateReport: () => Promise<void>
  applyLocalQuickDraft: (demoId?: string) => void
  loadLocalDemoAndDraft: (demoId?: string) => void
  rebuildCaseDraft: () => Promise<void>
  confirmCompareAndContinue: (confirmedCodes: string[]) => Promise<void>
  clearReportToWorkspace: () => void
  scanPrivacy: (value: string, opts?: { openModal?: boolean }) => Promise<PrivacyScanResult | null>
  clearPrivacyHints: () => void
}

export function useInvestigationWorkspace(opts: {
  userRole?: string | null
  isAdmin?: boolean
}): InvestigationWorkspace {
  const { userRole, isAdmin } = opts
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
  const [localDemoId, setLocalDemoId] = useState(LOCAL_DEMO_SCENARIOS[0]?.id || '')

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

  const favorites = useMemo(() => wacs.filter((w) => w.is_favorite), [wacs])
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites])

  const unlocked: Record<WorkflowStep, boolean> = {
    workspace: true,
    review: !!report,
    report: !!report && Boolean(report.compare_cites_confirmed),
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
        setReport(applyReport(withLegacyCompareConfirmed(detail.report)))
        setStep('report')
      } else {
        setReport(null)
        setStep('workspace')
      }
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
  }

  const ensureCaseSaved = async (
    reportPayload: InvestigationReport,
    complaintText = text,
    opts?: {
      approved_wac_ids?: string[]
      case_id_label?: string
      investigation_date?: string
      facility_address?: string
      credential_number?: string
    },
  ) => {
    const label = opts?.case_id_label ?? caseId
    const payload = {
      case_id_label: label,
      title: label || `Case ${new Date().toISOString().slice(0, 10)}`,
      complaint_text: complaintText,
      investigation_date: opts?.investigation_date ?? investigationDate,
      facility_address: opts?.facility_address ?? facilityAddress,
      credential_number: opts?.credential_number ?? credentialNumber,
      approved_wac_ids: opts?.approved_wac_ids ?? selectedCodes,
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

  const clearReportToWorkspace = () => {
    setReport(null)
    setStep('workspace')
  }

  const addCodeToSelection = (codeId: string) => {
    setSelectedCodes((prev) => (prev.includes(codeId) ? prev : [...prev, codeId]))
    clearReportToWorkspace()
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
      setError(e instanceof Error ? e.message : 'Privacy scan failed — check that the API is running')
      return null
    }
  }, [])

  const ensurePrivacyClear = async (): Promise<boolean> => {
    const scan = await scanPrivacy(text)
    if (!scan) return false
    if (scan.has_hits) {
      setPendingAfterRedact('draft')
      setPrivacyModalOpen(true)
      return false
    }
    return true
  }

  const generateReportWithText = async (
    complaintText: string,
    overrides?: {
      selected_wacs?: string[]
      case_id?: string
      investigation_date?: string
      facility_address?: string
      credential_number?: string
      subtitle?: string
      state_licensing_priority?: string
      federal_certification_priority?: string
    },
  ) => {
    const codes = overrides?.selected_wacs ?? selectedCodes
    if (!codes.length) {
      setError('Select the officially approved WACs for this case before drafting the report.')
      return
    }
    setBusy(true)
    setProgress('Drafting report from approved WACs (local PDF match)…')
    setError('')
    try {
      const res = await api.investigate({
        text: complaintText,
        selected_wacs: codes,
        include_informational: true,
        case_id: overrides?.case_id ?? (caseId || undefined),
        investigation_date: overrides?.investigation_date ?? (investigationDate || undefined),
        facility_address: overrides?.facility_address ?? (facilityAddress || undefined),
        credential_number: overrides?.credential_number ?? (credentialNumber || undefined),
      })
      // New drafts require Compare confirmation again. Demo shell fields seed the blank IR.
      const drafted = applyReport({
        ...res,
        subtitle: overrides?.subtitle ?? res.subtitle ?? '',
        facility_info: {
          ...res.facility_info,
          ...(overrides?.state_licensing_priority != null
            ? { state_licensing_priority: overrides.state_licensing_priority }
            : {}),
          ...(overrides?.federal_certification_priority != null
            ? { federal_certification_priority: overrides.federal_certification_priority }
            : {}),
        },
        compare_cites_confirmed: false,
        confirmed_allegation_codes: [],
      })
      setReport(drafted)
      setStep('review')
      setBusy(false)
      setProgress('Saving working draft to case…')
      try {
        await ensureCaseSaved(drafted!, complaintText, {
          approved_wac_ids: codes,
          case_id_label: overrides?.case_id ?? caseId,
          investigation_date: overrides?.investigation_date ?? investigationDate,
          facility_address: overrides?.facility_address ?? facilityAddress,
          credential_number: overrides?.credential_number ?? credentialNumber,
        })
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
      clearReportToWorkspace()
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
    if (!selectedCodes.length) setRelatedHits([])
  }, [selectedCodes.length])

  const applyLocalQuickDraft = (demoId = localDemoId) => {
    if (!canAccessAdmin(userRole, isAdmin)) {
      setError('Demo scenarios are limited to administrator accounts.')
      return
    }
    const d = getLocalDemoById(demoId)
    if (!d) {
      setError('Select a demo scenario first.')
      return
    }
    setLocalDemoId(d.id)
    setActiveCaseId(null)
    setCaseDetail(null)
    setReport(null)
    setText(d.complaint)
    setCaseId(d.case_id)
    setInvestigationDate(d.investigation_date)
    setFacilityAddress(d.facility_address)
    setCredentialNumber(d.credential_number)
    setSelectedCodes([...d.selected_wacs])
    setPrivacyHits([])
    setPrivacyScan(null)
    setPrivacyInfo('')
    setError('')
    setStep('workspace')
  }

  const loadLocalDemoAndDraft = (demoId = localDemoId) => {
    if (!canAccessAdmin(userRole, isAdmin)) {
      setError('Demo scenarios are limited to administrator accounts.')
      return
    }
    const d = getLocalDemoById(demoId)
    if (!d) {
      setError('Select a demo scenario first.')
      return
    }
    applyLocalQuickDraft(d.id)
    window.setTimeout(() => {
      void generateReportWithText(d.complaint, {
        selected_wacs: [...d.selected_wacs],
        case_id: d.case_id,
        investigation_date: d.investigation_date,
        facility_address: d.facility_address,
        credential_number: d.credential_number,
        subtitle: d.investigation_type,
        state_licensing_priority: d.state_licensing_priority,
        federal_certification_priority: d.federal_certification_priority,
      })
    }, 0)
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
      if (detail.report) {
        const rebuilt = applyReport({
          ...detail.report,
          compare_cites_confirmed: false,
          confirmed_allegation_codes: [],
        })
        setReport(rebuilt)
        setStep('review')
      }
      setCasesRefreshKey((k) => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rebuild failed')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const confirmCompareAndContinue = async (confirmedCodes: string[]) => {
    if (!report) return
    const next = applyReport({
      ...report,
      compare_cites_confirmed: true,
      confirmed_allegation_codes: confirmedCodes,
    })!
    setReport(next)
    setStep('report')
    if (activeCaseId) {
      try {
        const detail = await api.saveCaseDraft(activeCaseId, next, 'Compare cites confirmed')
        setCaseDetail(detail)
        setCasesRefreshKey((k) => k + 1)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save cite confirmation')
      }
    }
  }

  const clearPrivacyHints = () => {
    setPrivacyHits([])
    setPrivacyInfo('')
  }

  return {
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
    favorites,
    favoriteIds,
    loadWacs,
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
    clearReportToWorkspace,
    scanPrivacy,
    clearPrivacyHints,
  }
}
