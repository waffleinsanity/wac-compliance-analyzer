/**
 * Investigation workspace orchestration: Intake → Compare → Documents → Evidence state,
 * privacy gate, case save/rebuild, and local demos.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { canAccessAdmin, canEdit } from '../permissions'
import {
  backupIsNewer,
  backupStorageKey,
  clearDraftBackup,
  hasSaveableDraft,
  LOCAL_BACKUP_MS,
  PERIODIC_SAVE_MS,
  PERIODIC_SAVE_NOTE,
  readDraftBackup,
  type DraftBackup,
  type SaveStatus,
  workspaceFingerprint,
  writeDraftBackup,
} from '../draftBackup'

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
  openCase: (id: number) => Promise<boolean>
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
  confirmEvidenceAndContinue: (nextReport?: InvestigationReport | null) => Promise<void>
  clearReportToWorkspace: () => void
  scanPrivacy: (value: string, opts?: { openModal?: boolean }) => Promise<PrivacyScanResult | null>
  clearPrivacyHints: () => void
  saveStatus: SaveStatus
  recoverOffer: DraftBackup | null
  applyRecoveredDraft: () => void
  dismissRecoveredDraft: () => void
  restoreSnapshot: (snapshotId: number) => Promise<void>
  restoreEpoch: number
}

export function useInvestigationWorkspace(opts: {
  userRole?: string | null
  isAdmin?: boolean
  userId?: number | null
}): InvestigationWorkspace {
  const { userRole, isAdmin, userId = null } = opts
  const userCanEdit = canEdit(userRole, isAdmin)
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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle' })
  const [recoverOffer, setRecoverOffer] = useState<DraftBackup | null>(null)
  const [restoreEpoch, setRestoreEpoch] = useState(0)

  const lastSavedFp = useRef('')
  const saveInFlight = useRef(false)
  const stepRef = useRef(step)
  const textRef = useRef(text)
  const caseIdLabelRef = useRef(caseId)
  const investigationDateRef = useRef(investigationDate)
  const facilityAddressRef = useRef(facilityAddress)
  const credentialNumberRef = useRef(credentialNumber)
  const selectedCodesRef = useRef(selectedCodes)
  const reportRef = useRef(report)
  const activeCaseIdRef = useRef(activeCaseId)
  const caseDetailRef = useRef(caseDetail)
  const busyRef = useRef(busy)

  stepRef.current = step
  textRef.current = text
  caseIdLabelRef.current = caseId
  investigationDateRef.current = investigationDate
  facilityAddressRef.current = facilityAddress
  credentialNumberRef.current = credentialNumber
  selectedCodesRef.current = selectedCodes
  reportRef.current = report
  activeCaseIdRef.current = activeCaseId
  caseDetailRef.current = caseDetail
  busyRef.current = busy

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
    evidence: !!report && Boolean(report.compare_cites_confirmed),
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

  const openCase = async (id: number): Promise<boolean> => {
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
        const nextReport = applyReport(withLegacyCompareConfirmed(detail.report))
        setReport(nextReport)
        setStep('report')
        lastSavedFp.current = workspaceFingerprint({
          step: 'report',
          text: detail.complaint_text || '',
          caseIdLabel: detail.case_id_label || '',
          investigationDate: detail.investigation_date || '',
          facilityAddress: detail.facility_address || '',
          credentialNumber: detail.credential_number || '',
          selectedCodes: detail.approved_wac_ids || [],
          report: nextReport,
        })
      } else {
        setReport(null)
        setStep('workspace')
        lastSavedFp.current = workspaceFingerprint({
          step: 'workspace',
          text: detail.complaint_text || '',
          caseIdLabel: detail.case_id_label || '',
          investigationDate: detail.investigation_date || '',
          facilityAddress: detail.facility_address || '',
          credentialNumber: detail.credential_number || '',
          selectedCodes: detail.approved_wac_ids || [],
          report: null,
        })
      }
      const local = readDraftBackup(backupStorageKey(userId, detail.id))
      if (
        local &&
        backupIsNewer(local, detail.updated_at) &&
        workspaceFingerprint(local) !== lastSavedFp.current
      ) {
        setRecoverOffer(local)
      } else {
        setRecoverOffer(null)
      }
      setSaveStatus({ state: 'saved', at: detail.updated_at || new Date().toISOString() })
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open case')
      return false
    } finally {
      setBusy(false)
    }
  }

  const startNewCase = () => {
    clearDraftBackup(backupStorageKey(userId, null))
    setRecoverOffer(null)
    setSaveStatus({ state: 'idle' })
    lastSavedFp.current = ''
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

  const captureWorkspace = (): DraftBackup => ({
    savedAt: new Date().toISOString(),
    caseId: activeCaseIdRef.current,
    step: stepRef.current,
    text: textRef.current,
    caseIdLabel: caseIdLabelRef.current,
    investigationDate: investigationDateRef.current,
    facilityAddress: facilityAddressRef.current,
    credentialNumber: credentialNumberRef.current,
    selectedCodes: selectedCodesRef.current,
    report: reportRef.current,
  })

  const currentFingerprint = () =>
    workspaceFingerprint({
      step: stepRef.current,
      text: textRef.current,
      caseIdLabel: caseIdLabelRef.current,
      investigationDate: investigationDateRef.current,
      facilityAddress: facilityAddressRef.current,
      credentialNumber: credentialNumberRef.current,
      selectedCodes: selectedCodesRef.current,
      report: reportRef.current,
    })

  const writeLocalBackup = () => {
    const snap = captureWorkspace()
    if (
      !hasSaveableDraft({
        text: snap.text,
        selectedCodes: snap.selectedCodes,
        report: snap.report,
        caseIdLabel: snap.caseIdLabel,
      })
    ) {
      return
    }
    writeDraftBackup(backupStorageKey(userId, snap.caseId), snap)
  }

  const caseIsEditable = () => {
    const status = caseDetailRef.current?.status
    if (!userCanEdit) return false
    if (!status) return true
    return status === 'draft' || status === 'reopened'
  }

  const persistToServer = async (note = PERIODIC_SAVE_NOTE): Promise<boolean> => {
    const caseNum = activeCaseIdRef.current
    const currentReport = reportRef.current
    if (!caseNum || !caseIsEditable() || busyRef.current) return false
    if (
      !hasSaveableDraft({
        text: textRef.current,
        selectedCodes: selectedCodesRef.current,
        report: currentReport,
        caseIdLabel: caseIdLabelRef.current,
      })
    ) {
      return false
    }
    if (saveInFlight.current) return false
    saveInFlight.current = true
    setSaveStatus((prev) => ({ state: 'saving', at: prev.at }))
    try {
      await api.updateCase(caseNum, {
        case_id_label: caseIdLabelRef.current,
        title: caseIdLabelRef.current || `Case ${new Date().toISOString().slice(0, 10)}`,
        complaint_text: textRef.current,
        investigation_date: investigationDateRef.current,
        facility_address: facilityAddressRef.current,
        credential_number: credentialNumberRef.current,
        approved_wac_ids: selectedCodesRef.current,
      })
      let detail: CaseDetail | null = null
      if (currentReport) {
        detail = await api.saveCaseDraft(caseNum, currentReport, note)
      } else {
        detail = await api.getCase(caseNum)
      }
      setCaseDetail(detail)
      setCasesRefreshKey((k) => k + 1)
      lastSavedFp.current = currentFingerprint()
      writeDraftBackup(backupStorageKey(userId, caseNum), {
        ...captureWorkspace(),
        savedAt: detail.updated_at || new Date().toISOString(),
      })
      setSaveStatus({
        state: 'saved',
        at: detail.updated_at || new Date().toISOString(),
      })
      return true
    } catch (e) {
      writeLocalBackup()
      const message =
        e instanceof Error ? e.message : 'Could not reach the server. Draft kept on this device.'
      setSaveStatus({
        state: 'offline',
        at: new Date().toISOString(),
        message,
      })
      return false
    } finally {
      saveInFlight.current = false
    }
  }

  const applyRecoveredDraft = () => {
    const local = recoverOffer
    if (!local) return
    setText(local.text || '')
    setCaseId(local.caseIdLabel || '')
    setInvestigationDate(local.investigationDate || '')
    setFacilityAddress(local.facilityAddress || '')
    setCredentialNumber(local.credentialNumber || '')
    setSelectedCodes(local.selectedCodes || [])
    setReport(local.report ? applyReport(withLegacyCompareConfirmed(local.report)) : null)
    if (local.step) setStep(local.step)
    setRecoverOffer(null)
    lastSavedFp.current = ''
    setRestoreEpoch((n) => n + 1)
    setSaveStatus({ state: 'idle', message: 'Restored from this device. Saving to server…' })
    window.setTimeout(() => {
      void persistToServer('Recovered device draft')
    }, 0)
  }

  const dismissRecoveredDraft = () => {
    if (recoverOffer) {
      clearDraftBackup(backupStorageKey(userId, recoverOffer.caseId))
    }
    setRecoverOffer(null)
  }

  const restoreSnapshot = async (snapshotId: number) => {
    const caseNum = activeCaseIdRef.current
    if (!caseNum) return
    setBusy(true)
    setError('')
    try {
      const detail = await api.restoreCaseSnapshot(caseNum, snapshotId)
      setCaseDetail(detail)
      setCasesRefreshKey((k) => k + 1)
      if (detail.report) {
        const nextReport = applyReport(withLegacyCompareConfirmed(detail.report))
        setReport(nextReport)
        lastSavedFp.current = workspaceFingerprint({
          step: stepRef.current,
          text: textRef.current,
          caseIdLabel: caseIdLabelRef.current,
          investigationDate: investigationDateRef.current,
          facilityAddress: facilityAddressRef.current,
          credentialNumber: credentialNumberRef.current,
          selectedCodes: selectedCodesRef.current,
          report: nextReport,
        })
      }
      setSaveStatus({
        state: 'saved',
        at: detail.updated_at || new Date().toISOString(),
        message: 'Restored a server recall point',
      })
      setRestoreEpoch((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore recall point')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const local = readDraftBackup(backupStorageKey(userId, null))
    if (
      local &&
      hasSaveableDraft(local) &&
      !activeCaseIdRef.current &&
      !textRef.current.trim() &&
      !reportRef.current
    ) {
      setRecoverOffer(local)
    }
    // One-shot after login identity is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const fp = currentFingerprint()
      if (fp === lastSavedFp.current) return
      writeLocalBackup()
    }, LOCAL_BACKUP_MS)
    return () => window.clearTimeout(timer)
  }, [
    step,
    text,
    caseId,
    investigationDate,
    facilityAddress,
    credentialNumber,
    selectedCodes,
    report,
    activeCaseId,
    userId,
  ])

  useEffect(() => {
    const tick = () => {
      if (busyRef.current || !caseIsEditable()) return
      if (currentFingerprint() === lastSavedFp.current) return
      if (!activeCaseIdRef.current) {
        writeLocalBackup()
        setSaveStatus({
          state: 'offline',
          at: new Date().toISOString(),
          message: 'Draft kept on this device until the case is saved',
        })
        return
      }
      void persistToServer(PERIODIC_SAVE_NOTE)
    }
    const timer = window.setInterval(tick, PERIODIC_SAVE_MS)
    return () => window.clearInterval(timer)
  }, [userId, userCanEdit])

  useEffect(() => {
    const onHide = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') return
      if (currentFingerprint() === lastSavedFp.current) return
      writeLocalBackup()
      if (activeCaseIdRef.current && caseIsEditable() && !busyRef.current) {
        void persistToServer(PERIODIC_SAVE_NOTE)
      }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [userId, userCanEdit])

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
      lastSavedFp.current = workspaceFingerprint({
        step: stepRef.current,
        text: complaintText,
        caseIdLabel: label,
        investigationDate: payload.investigation_date,
        facilityAddress: payload.facility_address,
        credentialNumber: payload.credential_number,
        selectedCodes: payload.approved_wac_ids,
        report: applyReport(reportPayload),
      })
      setSaveStatus({ state: 'saved', at: detail.updated_at || new Date().toISOString() })
      return detail
    }
    const created = await api.createCase(payload)
    setActiveCaseId(created.id)
    const detail = await api.saveCaseDraft(created.id, reportPayload, 'Initial draft save')
    setCaseDetail(detail)
    setCasesRefreshKey((k) => k + 1)
    clearDraftBackup(backupStorageKey(userId, null))
    lastSavedFp.current = workspaceFingerprint({
      step: stepRef.current,
      text: complaintText,
      caseIdLabel: label,
      investigationDate: payload.investigation_date,
      facilityAddress: payload.facility_address,
      credentialNumber: payload.credential_number,
      selectedCodes: payload.approved_wac_ids,
      report: applyReport(reportPayload),
    })
    setSaveStatus({ state: 'saved', at: detail.updated_at || new Date().toISOString() })
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
        setStep('review')
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
    if (activeCaseId) {
      try {
        const detail = await api.saveCaseDraft(activeCaseId, next, 'Compare cites confirmed')
        setReport(next)
        setCaseDetail(detail)
        setStep('report')
        setCasesRefreshKey((k) => k + 1)
        lastSavedFp.current = workspaceFingerprint({
          step: 'report',
          text: textRef.current,
          caseIdLabel: caseIdLabelRef.current,
          investigationDate: investigationDateRef.current,
          facilityAddress: facilityAddressRef.current,
          credentialNumber: credentialNumberRef.current,
          selectedCodes: selectedCodesRef.current,
          report: next,
        })
        setSaveStatus({ state: 'saved', at: detail.updated_at || new Date().toISOString() })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save cite confirmation')
      }
      return
    }
    setReport(next)
    setStep('report')
  }

  const confirmEvidenceAndContinue = async (nextReport?: InvestigationReport | null) => {
    const payload = nextReport || report
    if (!payload) return
    if (activeCaseId) {
      try {
        const detail = await api.saveCaseDraft(activeCaseId, payload, 'Evidence excerpts selected')
        setReport(payload)
        setCaseDetail(detail)
        setStep('report')
        setCasesRefreshKey((k) => k + 1)
        lastSavedFp.current = workspaceFingerprint({
          step: 'report',
          text: textRef.current,
          caseIdLabel: caseIdLabelRef.current,
          investigationDate: investigationDateRef.current,
          facilityAddress: facilityAddressRef.current,
          credentialNumber: credentialNumberRef.current,
          selectedCodes: selectedCodesRef.current,
          report: payload,
        })
        setSaveStatus({ state: 'saved', at: detail.updated_at || new Date().toISOString() })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save evidence selections')
      }
      return
    }
    setReport(payload)
    setStep('report')
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
  }
}
