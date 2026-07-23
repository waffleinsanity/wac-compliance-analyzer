export type WACNode = {
  id: string
  chapter: string
  code: string
  title: string
  text: string
  level: string
  parent_id?: string | null
  hierarchy_path: string
  primary?: string | null
  secondary?: string | null
  tertiary?: string | null
  version_date?: string | null
  certified_date?: string | null
  trigger_phrases: string[]
  custom_trigger_phrases: string[]
  is_favorite: boolean
  usage_count?: number
}

export type WACUsageStat = {
  wac_id: string
  code: string
  title: string
  chapter: string
  count: number
  last_used?: string | null
  stat_type: string
}

export type WACUsageStatsResponse = {
  items: WACUsageStat[]
  total_tracked: number
}

export type PrivacyHit = {
  id: string
  start: number
  end: number
  kind: string
  category: string
  preview: string
  replacement: string
  confidence: number
}

export type PrivacyScanResult = {
  has_hits: boolean
  hit_count: number
  hits: PrivacyHit[]
  summary: {
    by_kind?: Record<string, number>
    by_category?: Record<string, number>
    message?: string
  }
}

export type PrivacyRedactResult = {
  redacted_text: string
  applied: { id: string; kind: string; category: string; replacement: string }[]
  applied_count: number
  residual_hits: number
  clean: boolean
}

export type ComplianceFinding = {
  wac_reference: string
  title: string
  status: 'COMPLIES' | 'NON-COMPLIANT' | 'PARTIAL' | 'INFORMATIONAL' | 'INSUFFICIENT'
  template: string
  formatted_output: string
  confidence: number
  matched_phrases: string[]
  compliant_subsections: string[]
  non_compliant_subsections: string[]
  corrective_action?: string | null
  additional_info_needed?: string | null
  recommendation?: string | null
  hierarchy_path: string
  chapter: string
}

export type FacilityInfo = {
  laboratory_director?: string
  clia_number?: string
  facility_address: string
  credential_number: string
  medicare_number: string
  shell_number: string
  investigation_dates: string
  state_licensing_priority: string
  federal_certification_priority: string
}

export type QuoteFailure = {
  field: string
  cite?: string | null
  quote_preview: string
  reason: string
}

export type QuoteIntegrity = {
  ok: boolean
  failures: QuoteFailure[]
}

export type WACComparison = {
  wac_id: string
  code: string
  title: string
  chapter: string
  hierarchy_path: string
  wac_text: string
  wac_summary: string
  complaint_excerpts: string[]
  allegation_draft: string
  finding: ComplianceFinding | null
  matched_subsections?: string[]
  matched_subsection_texts?: string[]
  match_reason?: string | null
  match_score?: number | null
  quote_ok?: boolean | null
  low_confidence?: boolean
}

export type InvestigationAllegation = {
  case_category: string
  wac_code: string
  wac_title: string
  allegation_text: string
  status?: string | null
  confidence?: number | null
  matched_subsections?: string[]
  match_reason?: string | null
  match_score?: number | null
  quote_ok?: boolean | null
  low_confidence?: boolean
}

export type RegulatoryFrameworkEntry = {
  instrument: string
  code: string
  title: string
  subsections: {
    cite?: string
    label?: string
    text?: string
    level?: string
    score?: number
  }[]
}

export type StatuteHit = {
  id: string
  instrument: string
  chapter: string
  code: string
  title: string
  level: string
  hierarchy_path: string
  score: number
  reason: string
  text: string
  excerpt: string
}

export type InvestigationConclusion = {
  wac_code: string
  allegation_text: string
  result: string
  deficiency_cited: boolean
  deficiency_details: string
}

export type InvestigationReport = {
  title: string
  subtitle: string
  investigation_date: string
  case_id?: string | null
  facility_info: FacilityInfo
  intake_details: string
  allegation_preamble: string
  allegations: InvestigationAllegation[]
  investigative_process: string[]
  summary_of_findings: string
  conclusions: InvestigationConclusion[]
  actions: string
  comparisons: WACComparison[]
  findings: ComplianceFinding[]
  report_text: string
  selected_count: number
  duration_ms: number
  analysis_id?: number | null
  document_preview: string
  regulatory_framework?: RegulatoryFrameworkEntry[]
  evidentiary_examples?: string[]
  authority_statement?: string
  investigator_notes?: string
  clarifying_questions?: string[]
  next_steps?: string[]
  areas_of_concern?: string[]
  investigation_methods?: string[]
  known_facts?: string[]
  unclear_items?: string[]
  inferences?: string[]
  recommended_subsections?: string[]
  llm_used?: boolean
  llm_assist_used?: boolean
  llm_model?: string | null
  llm_error?: string | null
  quote_integrity?: QuoteIntegrity
}

export type UserRole = 'admin' | 'editor' | 'viewer'

export type User = {
  id: number
  username: string
  email?: string | null
  display_name?: string | null
  role: UserRole | string
  theme_preference: string
  is_admin: boolean
  is_active: boolean
  must_change_password: boolean
  has_password: boolean
  has_google: boolean
  can_edit?: boolean
  can_export?: boolean
  can_review?: boolean
  can_access_admin?: boolean
}

export type SupportUserBrief = {
  id: number
  username: string
  email?: string | null
  display_name?: string | null
  is_admin?: boolean
}

export type BugReport = {
  id: number
  title: string
  description: string
  page_url: string
  user_agent: string
  viewport_json: string
  diagnostics_json: string
  has_screenshot: boolean
  status: string
  admin_note: string
  resolved_by?: number | null
  resolved_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  user?: SupportUserBrief | null
}

export type UserFeedback = {
  id: number
  category: string
  subject: string
  message: string
  page_url: string
  status: string
  admin_note: string
  read_by?: number | null
  read_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  user?: SupportUserBrief | null
}

export type InviteCode = {
  id: number
  code: string
  role: string
  max_uses: number
  used_count: number
  expires_at?: string | null
  note?: string
  created_at?: string | null
}

export type AccessRequest = {
  id: number
  user_id: number
  username: string
  email?: string | null
  current_role: string
  requested_role: string
  justification: string
  status: string
  admin_note: string
  created_at?: string | null
  reviewed_at?: string | null
}

export type AdminInboxCounts = {
  open_bugs: number
  new_feedback: number
  total: number
}

export type AuditLogEntry = {
  id: number
  user_id?: number | null
  username?: string | null
  action: string
  entity_type: string
  entity_id: string
  details: string
  outcome: string
  created_at?: string | null
}

export type CaseStatus = 'draft' | 'in_review' | 'final' | 'reopened' | 'archived' | 'trashed'

export type CaseSummary = {
  id: number
  case_id_label: string
  title: string
  status: CaseStatus | string
  approved_wac_count: number
  has_report: boolean
  owner_user_id: number
  updated_at?: string | null
  created_at?: string | null
  archived_at?: string | null
  trashed_at?: string | null
}

export type CaseEvidence = {
  id: number
  title: string
  original_filename: string
  content_type: string
  linked_wac_ids: string[]
  notes: string
  created_at?: string | null
}

export type CaseProcessEntry = {
  id: number
  activity_date: string
  activity_type: string
  who: string
  summary: string
  sort_order: number
}

export type CaseComment = {
  id: number
  author_user_id: number
  author_username: string
  body: string
  created_at?: string | null
}

export type CaseSnapshot = {
  id: number
  version: number
  note: string
  created_by?: number | null
  created_at?: string | null
}

export type IrTemplate = {
  id: number
  name: string
  original_filename: string
  content_type?: string
  source: 'library' | 'case' | string
  case_id?: number | null
  is_default: boolean
  section_keys: string[]
  core_count: number
  warnings: string[]
  created_at?: string | null
  updated_at?: string | null
}

export type CaseDetail = {
  id: number
  case_id_label: string
  title: string
  status: CaseStatus | string
  complaint_text: string
  investigation_date: string
  facility_address: string
  credential_number: string
  approved_wac_ids: string[]
  report?: InvestigationReport | null
  owner_user_id: number
  ir_template_id?: number | null
  ir_template?: IrTemplate | null
  privacy_acknowledged_at?: string | null
  privacy_redaction_note?: string
  status_changed_at?: string | null
  status_changed_by?: number | null
  archived_at?: string | null
  trashed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  snapshots: CaseSnapshot[]
  evidence: CaseEvidence[]
  process_entries: CaseProcessEntry[]
  comments: CaseComment[]
}

export type DefensibilityResult = {
  overall: 'pass' | 'warn' | 'block' | string
  can_export: boolean
  summary: string
  checks: { code: string; severity: string; message: string }[]
}

export type CaseAnalytics = {
  total_cases: number
  by_status: Record<string, number>
  top_approved_wacs: { wac_id: string; count: number }[]
}

const TOKEN_KEY = 'wac_token'

/** Thrown for non-2xx API responses so callers can branch on HTTP status. */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403)
}

function formatApiErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg: unknown }).msg)
        }
        return typeof item === 'string' ? item : ''
      })
      .filter(Boolean)
    if (msgs.length) return msgs.join('; ')
  }
  if (detail && typeof detail === 'object' && 'msg' in detail) {
    return String((detail as { msg: unknown }).msg)
  }
  if (detail !== undefined && detail !== null) {
    return typeof detail === 'object' ? fallback : String(detail)
  }
  return fallback
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(path, { ...options, headers })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      throw new Error(
        'Cannot reach the API (http://127.0.0.1:8000). Start the stack with Launch.bat, then refresh.',
      )
    }
    throw err instanceof Error ? err : new Error(msg)
  }
  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      const data = await res.json()
      detail = data.detail ?? data
    } catch {
      /* ignore */
    }
    throw new ApiError(formatApiErrorDetail(detail, res.statusText), res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  health: () =>
    request<{
      status: string
      wac_codes: number
      wac_nodes: number
      ready: boolean
      started_at?: string
      pid?: number
    }>('/api/health'),
  register: (username: string, password: string, email: string, invite_code?: string) =>
    request<{ access_token: string; username: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, email, invite_code: invite_code || null }),
    }),
  login: async (username: string, password: string) => {
    const body = new URLSearchParams({ username, password })
    return request<{ access_token: string; username: string }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  },
  me: () => request<User>('/api/auth/me'),
  prepareGoogleLink: () =>
    request<{ authorize_url: string; username: string }>('/api/auth/google/link/prepare', {
      method: 'POST',
    }),
  setTheme: (theme_preference: string) =>
    request<User>('/api/auth/theme', {
      method: 'PATCH',
      body: JSON.stringify({ theme_preference }),
    }),
  updateProfile: (payload: { email?: string; display_name?: string | null }) =>
    request<User>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  changePassword: (new_password: string, current_password?: string) =>
    request<User>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ new_password, current_password: current_password || null }),
    }),
  forgotPassword: (email: string) =>
    request<{ message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, new_password: string) =>
    request<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, new_password }),
    }),
  listUsers: (q?: string) => {
    const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
    return request<User[]>(`/api/admin/users${qs}`)
  },
  createUser: (payload: {
    username: string
    email: string
    display_name?: string
    role?: UserRole | string
    is_admin?: boolean
  }) =>
    request<{ user_id: number; username: string; temporary_password: string; must_change_password: boolean }>(
      '/api/admin/users',
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  updateUser: (userId: number, patch: { email?: string; is_active?: boolean; is_admin?: boolean; role?: UserRole | string }) =>
    request<User>(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  setTempPassword: (userId: number) =>
    request<{ user_id: number; username: string; temporary_password: string; must_change_password: boolean }>(
      `/api/admin/users/${userId}/temp-password`,
      { method: 'POST' },
    ),
  unlockUser: (userId: number) =>
    request<User>(`/api/admin/users/${userId}/unlock`, { method: 'POST' }),
  listInvites: () => request<InviteCode[]>('/api/admin/invites'),
  createInvite: (payload: { role?: string; max_uses?: number; note?: string; expires_in_days?: number | null }) =>
    request<InviteCode>('/api/admin/invites', { method: 'POST', body: JSON.stringify(payload) }),
  listAccessRequests: (status = 'pending') =>
    request<AccessRequest[]>(`/api/admin/access-requests?status=${encodeURIComponent(status)}`),
  reviewAccessRequest: (id: number, patch: { status: string; admin_note?: string }) =>
    request<AccessRequest>(`/api/admin/access-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  createAccessRequest: (payload: { requested_role: string; justification?: string }) =>
    request<AccessRequest>('/api/auth/access-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  myAccessRequests: () => request<AccessRequest[]>('/api/auth/access-requests/mine'),
  unlinkGoogle: () => request<User>('/api/auth/google/link', { method: 'DELETE' }),
  runRetention: () =>
    request<{ archived: number; trash_purged: number; retention_days: number; trash_retention_days: number }>(
      '/api/cases/retention/run',
      { method: 'POST' },
    ),
  version: () => request<{ version: string; started_at?: string }>('/api/version'),
  createBugReport: (payload: {
    title: string
    description: string
    page_url?: string
    user_agent?: string
    viewport_json?: string
    diagnostics_json?: string
    screenshot_data_url?: string
  }) =>
    request<BugReport>('/api/support/bugs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listBugReports: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    return request<BugReport[]>(`/api/support/bugs${qs}`)
  },
  updateBugReport: (id: number, patch: { status?: string; admin_note?: string }) =>
    request<BugReport>(`/api/support/bugs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  createFeedback: (payload: { category: string; subject: string; message: string; page_url?: string }) =>
    request<UserFeedback>('/api/support/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listFeedback: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    return request<UserFeedback[]>(`/api/support/feedback${qs}`)
  },
  updateFeedback: (id: number, patch: { status?: string; admin_note?: string }) =>
    request<UserFeedback>(`/api/support/feedback/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  inboxCounts: () => request<AdminInboxCounts>('/api/support/inbox-counts'),
  listAuditLogs: (limit = 50) => request<AuditLogEntry[]>(`/api/support/audit?limit=${limit}`),
  myActivity: (limit = 20) => request<AuditLogEntry[]>(`/api/support/my-activity?limit=${limit}`),
  listWacs: (params?: { chapter?: string; q?: string; level?: string }) => {
    const qs = new URLSearchParams()
    if (params?.chapter) qs.set('chapter', params.chapter)
    if (params?.q) qs.set('q', params.q)
    if (params?.level) qs.set('level', params.level)
    const suffix = qs.toString() ? `?${qs}` : ''
    return request<WACNode[]>(`/api/wacs${suffix}`)
  },
  toggleFavorite: (wac_id: string) =>
    request<{ wac_id: string; favorited: boolean }>('/api/wacs/favorites/toggle', {
      method: 'POST',
      body: JSON.stringify({ wac_id }),
    }),
  popularWacs: (limit = 25) =>
    request<WACUsageStatsResponse>(`/api/wacs/stats/popular?limit=${limit}`),
  privacyScan: (text: string) =>
    request<PrivacyScanResult>('/api/privacy/scan', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  privacyRedact: (text: string, hit_ids?: string[]) =>
    request<PrivacyRedactResult>('/api/privacy/redact', {
      method: 'POST',
      body: JSON.stringify({ text, hit_ids: hit_ids || null }),
    }),
  investigate: (payload: {
    text: string
    selected_wacs: string[]
    include_informational?: boolean
    investigation_date?: string
    case_id?: string
    facility_address?: string
    credential_number?: string
  }) =>
    request<InvestigationReport>('/api/investigate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  validateReport: (payload: {
    selected_wacs: string[]
    allegations: InvestigationAllegation[]
    regulatory_framework?: RegulatoryFrameworkEntry[]
    evidentiary_examples?: string[]
  }) =>
    request<{ quote_integrity: QuoteIntegrity; can_export: boolean }>('/api/investigate/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  searchStatutes: (text: string, top_k = 30, exclude_codes: string[] = []) =>
    request<{ hits: StatuteHit[]; query_preview: string; total: number }>('/api/search-statutes', {
      method: 'POST',
      body: JSON.stringify({ text, top_k, exclude_codes }),
    }),
  suggestRelated: (selected_wacs: string[], text = '', top_k = 15) =>
    request<{ suggestions: StatuteHit[]; selected_count: number }>('/api/suggest-related', {
      method: 'POST',
      body: JSON.stringify({ selected_wacs, text, top_k }),
    }),
  extract: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ filename: string; text: string; characters: number }>('/api/extract', {
      method: 'POST',
      body: form,
    })
  },

  listCases: (view: 'active' | 'archived' | 'trash' | boolean = 'active') => {
    // boolean kept for older callers: true => archived
    const mode = typeof view === 'boolean' ? (view ? 'archived' : 'active') : view
    return request<CaseSummary[]>(`/api/cases?view=${encodeURIComponent(mode)}`)
  },
  createCase: (payload: {
    case_id_label?: string
    title?: string
    complaint_text?: string
    investigation_date?: string
    facility_address?: string
    credential_number?: string
    approved_wac_ids?: string[]
  }) =>
    request<CaseDetail>('/api/cases', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getCase: (id: number) => request<CaseDetail>(`/api/cases/${id}`),
  updateCase: (
    id: number,
    payload: Partial<{
      case_id_label: string
      title: string
      complaint_text: string
      investigation_date: string
      facility_address: string
      credential_number: string
      approved_wac_ids: string[]
    }>,
  ) =>
    request<CaseDetail>(`/api/cases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  saveCaseDraft: (id: number, report: InvestigationReport, note = '') =>
    request<CaseDetail>(`/api/cases/${id}/save-draft`, {
      method: 'POST',
      body: JSON.stringify({ report, note }),
    }),
  rebuildCaseDraft: (id: number) =>
    request<CaseDetail>(`/api/cases/${id}/rebuild`, { method: 'POST' }),
  setCaseStatus: (id: number, status: string, note = '') =>
    request<CaseDetail>(`/api/cases/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, note }),
    }),
  /** Soft-delete — dedicated endpoint (more reliable than /status). */
  trashCase: (id: number) =>
    request<CaseDetail>(`/api/cases/${id}/trash`, { method: 'POST' }),
  /** Restore from archive or trash. */
  restoreCase: (id: number) =>
    request<CaseDetail>(`/api/cases/${id}/restore`, { method: 'POST' }),
  deleteCase: (id: number) =>
    request<{ ok: boolean; deleted_id: number }>(`/api/cases/${id}`, { method: 'DELETE' }),
  addCaseComment: (id: number, body: string) =>
    request<CaseComment>(`/api/cases/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  caseDefensibility: (id: number) => request<DefensibilityResult>(`/api/cases/${id}/defensibility`),
  caseAnalytics: () => request<CaseAnalytics>('/api/cases/analytics'),
  exportCaseDocx: async (id: number, acknowledge_gaps = false) => {
    const token = getToken()
    const res = await fetch(`/api/cases/${id}/export/docx?acknowledge_gaps=${acknowledge_gaps}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      let detail: unknown = res.statusText
      try {
        const data = await res.json()
        detail = data.detail ?? data
      } catch {
        /* ignore */
      }
      throw new Error(formatApiErrorDetail(detail, res.statusText))
    }
    return res.blob()
  },
  exportCasePack: async (id: number, acknowledge_gaps = false) => {
    const token = getToken()
    const res = await fetch(`/api/cases/${id}/export/pack?acknowledge_gaps=${acknowledge_gaps}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      let detail: unknown = res.statusText
      try {
        const data = await res.json()
        detail = data.detail ?? data
      } catch {
        /* ignore */
      }
      throw new Error(formatApiErrorDetail(detail, res.statusText))
    }
    return res.blob()
  },
  uploadEvidence: async (
    id: number,
    file: File,
    opts?: { title?: string; notes?: string; linked_wac_ids?: string[] },
  ) => {
    const form = new FormData()
    form.append('file', file)
    form.append('title', opts?.title || file.name)
    form.append('notes', opts?.notes || '')
    form.append('linked_wac_ids', JSON.stringify(opts?.linked_wac_ids || []))
    return request<CaseEvidence>(`/api/cases/${id}/evidence`, { method: 'POST', body: form })
  },
  deleteEvidence: (caseId: number, evidenceId: number) =>
    request<{ ok: boolean }>(`/api/cases/${caseId}/evidence/${evidenceId}`, { method: 'DELETE' }),
  addProcessEntry: (
    id: number,
    payload: { activity_date?: string; activity_type?: string; who?: string; summary?: string },
  ) =>
    request<CaseProcessEntry>(`/api/cases/${id}/process-entries`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteProcessEntry: (caseId: number, entryId: number) =>
    request<{ ok: boolean }>(`/api/cases/${caseId}/process-entries/${entryId}`, { method: 'DELETE' }),
  applyProcessToReport: (id: number) =>
    request<CaseDetail>(`/api/cases/${id}/process-entries/apply`, { method: 'POST' }),

  listIrTemplates: () => request<IrTemplate[]>('/api/ir-templates'),
  uploadIrTemplate: async (file: File, name = '') => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    return request<IrTemplate>('/api/ir-templates', { method: 'POST', body: form })
  },
  patchIrTemplate: (id: number, payload: { name?: string; is_default?: boolean }) =>
    request<IrTemplate>(`/api/ir-templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteIrTemplate: (id: number) =>
    request<{ ok: boolean }>(`/api/ir-templates/${id}`, { method: 'DELETE' }),
  promoteIrTemplate: (id: number) =>
    request<IrTemplate>(`/api/ir-templates/${id}/promote`, { method: 'POST' }),
  bindCaseIrTemplate: (caseId: number, ir_template_id: number | null) =>
    request<CaseDetail>(`/api/cases/${caseId}/ir-template`, {
      method: 'PUT',
      body: JSON.stringify({ ir_template_id }),
    }),
  uploadCaseIrTemplate: async (caseId: number, file: File, name = '') => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    return request<CaseDetail>(`/api/cases/${caseId}/ir-template`, { method: 'POST', body: form })
  },
}
