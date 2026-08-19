import type { InvestigationReport } from './api'
import type { WorkflowStep } from './components/WorkflowStepper'

const PREFIX = 'wacmakr.draft.v1'

export type DraftBackup = {
  savedAt: string
  caseId: number | null
  step: WorkflowStep
  text: string
  caseIdLabel: string
  investigationDate: string
  facilityAddress: string
  credentialNumber: string
  selectedCodes: string[]
  report: InvestigationReport | null
}

export type SaveStatus = {
  state: 'idle' | 'saving' | 'saved' | 'offline' | 'error'
  at?: string
  message?: string
}

export const PERIODIC_SAVE_NOTE = 'Periodic save'
export const PERIODIC_SAVE_MS = 45_000
export const LOCAL_BACKUP_MS = 2_500

export function backupStorageKey(userId: number | string | null | undefined, caseId: number | null) {
  const user = userId == null || userId === '' ? 'anon' : String(userId)
  const caseKey = caseId == null ? 'new' : String(caseId)
  return `${PREFIX}.${user}.${caseKey}`
}

export function workspaceFingerprint(input: {
  step: WorkflowStep
  text: string
  caseIdLabel: string
  investigationDate: string
  facilityAddress: string
  credentialNumber: string
  selectedCodes: string[]
  report: InvestigationReport | null
}) {
  return JSON.stringify({
    step: input.step,
    text: input.text,
    caseIdLabel: input.caseIdLabel,
    investigationDate: input.investigationDate,
    facilityAddress: input.facilityAddress,
    credentialNumber: input.credentialNumber,
    selectedCodes: input.selectedCodes,
    report: input.report,
  })
}

export function hasSaveableDraft(input: {
  text: string
  selectedCodes: string[]
  report: InvestigationReport | null
  caseIdLabel: string
}) {
  return Boolean(
    input.report ||
      input.text.trim() ||
      input.selectedCodes.length ||
      input.caseIdLabel.trim(),
  )
}

export function writeDraftBackup(key: string, backup: DraftBackup) {
  try {
    const raw = JSON.stringify(backup)
    if (raw.length > 4_000_000) return
    localStorage.setItem(key, raw)
  } catch {
    /* quota / private mode */
  }
}

export function readDraftBackup(key: string): DraftBackup | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw) as DraftBackup
    if (!data || typeof data !== 'object' || !data.savedAt) return null
    return data
  } catch {
    return null
  }
}

export function clearDraftBackup(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function backupIsNewer(backup: DraftBackup, serverUpdatedAt?: string | null) {
  const localMs = Date.parse(backup.savedAt)
  if (Number.isNaN(localMs)) return false
  if (!serverUpdatedAt) return true
  const serverMs = Date.parse(serverUpdatedAt)
  if (Number.isNaN(serverMs)) return true
  return localMs > serverMs + 1500
}

export function formatSavedClock(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
