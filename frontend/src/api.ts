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
}

export type WACTreeNode = {
  id: string
  code: string
  title: string
  chapter: string
  level: string
  children: WACTreeNode[]
  is_favorite: boolean
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

export type AnalyzeResponse = {
  findings: ComplianceFinding[]
  document_preview: string
  selected_count: number
  duration_ms: number
  analysis_id?: number | null
}

export type FacilityInfo = {
  facility_address: string
  credential_number: string
  medicare_number?: string
  shell_number?: string
  investigation_dates: string
  state_licensing_priority?: string
  federal_certification_priority?: string
}

export type RegulatorySubsection = {
  label: string
  cite: string
  snippet: string
  reason?: string
}

export type RegulatoryFrameworkEntry = {
  wac_code: string
  wac_title: string
  chapter: string
  matched_subsections: RegulatorySubsection[]
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
  matched_subsections?: string[]
  finding?: ComplianceFinding | null
}

export type InvestigationAllegation = {
  case_category: string
  wac_code: string
  wac_title: string
  allegation_text: string
  status?: string | null
  confidence?: number | null
  matched_subsections?: string[]
}

export type InvestigationConclusion = {
  wac_code: string
  allegation_text: string
  result: string
  deficiency_cited?: boolean
  deficiency_details?: string
}

export type InvestigationReport = {
  title: string
  subtitle: string
  investigation_date: string
  case_id?: string | null
  facility_info: FacilityInfo
  intake_details: string
  allegation_preamble: string
  authority_statement: string
  regulatory_framework: RegulatoryFrameworkEntry[]
  allegations: InvestigationAllegation[]
  investigative_process: string[]
  evidentiary_examples: string[]
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
  recommended_subsections?: string[]
}

export type InvestigationRequest = {
  text: string
  selected_wacs: string[]
  include_informational?: boolean
  investigation_date?: string
  case_id?: string
  facility_address?: string
  credential_number?: string
}

export type StatsOut = {
  total_analyses: number
  total_wac_codes: number
  total_nodes: number
  top_selected: { wac_id: string; count: number }[]
  top_matched: { wac_id: string; count: number }[]
  recent_runs: {
    id: number
    document_name?: string | null
    selected_count: number
    result_count: number
    duration_ms: number
    created_at?: string | null
  }[]
  chapter_breakdown: Record<string, number>
}

export type TriggerPhrase = {
  id: number
  wac_id: string
  phrase: string
}

export type User = {
  id: number
  username: string
  email?: string | null
  theme_preference: string
}

const TOKEN_KEY = 'wac_token'

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

  const res = await fetch(path, { ...options, headers })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data.detail || JSON.stringify(data)
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  health: () => request<{ status: string; wac_codes: number; wac_nodes: number; ready: boolean }>('/api/health'),
  register: (username: string, password: string, email?: string) =>
    request<{ access_token: string; username: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, email }),
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
  setTheme: (theme_preference: string) =>
    request<User>('/api/auth/theme', {
      method: 'PATCH',
      body: JSON.stringify({ theme_preference }),
    }),
  listWacs: (params?: { chapter?: string; q?: string; level?: string }) => {
    const qs = new URLSearchParams()
    if (params?.chapter) qs.set('chapter', params.chapter)
    if (params?.q) qs.set('q', params.q)
    if (params?.level) qs.set('level', params.level)
    const suffix = qs.toString() ? `?${qs}` : ''
    return request<WACNode[]>(`/api/wacs${suffix}`)
  },
  tree: () => request<WACTreeNode[]>('/api/wacs/tree'),
  getWac: (id: string) => request<WACNode>(`/api/wacs/${encodeURIComponent(id)}`),
  toggleFavorite: (wac_id: string) =>
    request<{ wac_id: string; favorited: boolean }>('/api/wacs/favorites/toggle', {
      method: 'POST',
      body: JSON.stringify({ wac_id }),
    }),
  favorites: () =>
    request<{ wac_id: string; title: string; code: string; chapter: string }[]>('/api/wacs/favorites/list'),
  analyze: (text: string, selected_wacs: string[], include_informational = true) =>
    request<AnalyzeResponse>('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ text, selected_wacs, include_informational }),
    }),
  investigate: (payload: InvestigationRequest) =>
    request<InvestigationReport>('/api/investigate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  extract: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ filename: string; text: string }>('/api/extract', { method: 'POST', body: form })
  },
  analyzeUpload: async (file: File, selected_wacs: string[], include_informational = true) => {
    const form = new FormData()
    form.append('file', file)
    form.append('selected_wacs', JSON.stringify(selected_wacs))
    form.append('include_informational', String(include_informational))
    return request<AnalyzeResponse>('/api/analyze/upload', { method: 'POST', body: form })
  },
  analyzeBatch: async (files: File[], selected_wacs: string[], include_informational = true) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    form.append('selected_wacs', JSON.stringify(selected_wacs))
    form.append('include_informational', String(include_informational))
    return request<{ results: AnalyzeResponse[]; count: number }>('/api/analyze/batch', {
      method: 'POST',
      body: form,
    })
  },
  examples: () => request<{ name: string; path: string }[]>('/api/examples'),
  exampleText: (name: string) => request<{ name: string; text: string }>(`/api/examples/${encodeURIComponent(name)}/text`),
  stats: () => request<StatsOut>('/api/stats'),
  validate: (chapter: string) =>
    request<{
      chapter: string
      official_url: string
      reachable: boolean
      local_code_count: number
      notes: string
      sample_codes: string[]
    }>(`/api/validate/${chapter}`),
  listTriggers: (wac_id?: string) =>
    request<TriggerPhrase[]>(`/api/triggers${wac_id ? `?wac_id=${encodeURIComponent(wac_id)}` : ''}`),
  createTrigger: (wac_id: string, phrase: string) =>
    request<TriggerPhrase>('/api/triggers', {
      method: 'POST',
      body: JSON.stringify({ wac_id, phrase }),
    }),
  updateTrigger: (id: number, phrase: string) =>
    request<TriggerPhrase>(`/api/triggers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ phrase }),
    }),
  deleteTrigger: (id: number) => request<{ deleted: boolean }>(`/api/triggers/${id}`, { method: 'DELETE' }),
}
