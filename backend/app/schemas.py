from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field, model_validator


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=10, max_length=128)
    email: EmailStr
    invite_code: str | None = Field(default=None, max_length=64)


class InviteCreate(BaseModel):
    role: str = "viewer"
    max_uses: int = Field(default=1, ge=1, le=100)
    note: str = Field(default="", max_length=255)
    expires_in_days: int | None = Field(default=14, ge=1, le=365)


class InviteOut(BaseModel):
    id: int
    code: str
    role: str
    max_uses: int
    used_count: int
    expires_at: datetime | None = None
    note: str = ""
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class AccessRequestCreate(BaseModel):
    requested_role: str = Field(default="editor")
    justification: str = Field(default="", max_length=2000)


class AccessRequestReview(BaseModel):
    status: str  # approved|denied
    admin_note: str = Field(default="", max_length=2000)


class AccessRequestOut(BaseModel):
    id: int
    user_id: int
    username: str = ""
    email: str | None = None
    current_role: str = ""
    requested_role: str
    justification: str = ""
    status: str
    admin_note: str = ""
    created_at: datetime | None = None
    reviewed_at: datetime | None = None

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None = None
    display_name: str | None = None
    role: str = "editor"  # admin | editor | viewer
    theme_preference: str = "system"
    is_admin: bool = False
    is_active: bool = True
    must_change_password: bool = False
    has_password: bool = False
    has_google: bool = False
    can_edit: bool = True
    can_export: bool = True
    can_review: bool = False
    can_access_admin: bool = False

    class Config:
        from_attributes = True


class ThemeUpdate(BaseModel):
    theme_preference: str


class GoogleAuthRequest(BaseModel):
    """Either a GIS ID token or an OAuth authorization code (redirect flow)."""

    id_token: str | None = Field(default=None, min_length=20)
    code: str | None = Field(default=None, min_length=10)
    redirect_uri: str | None = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def require_code_or_id_token(self) -> "GoogleAuthRequest":
        if not self.code and not self.id_token:
            raise ValueError("Provide a Google auth code or ID token")
        if self.code and not self.redirect_uri:
            raise ValueError("redirect_uri is required when exchanging a Google auth code")
        return self


class ProfileUpdate(BaseModel):
    email: EmailStr | None = None
    display_name: str | None = Field(default=None, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str | None = None
    new_password: str = Field(min_length=10, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10)
    new_password: str = Field(min_length=10, max_length=128)


class AdminUserUpdate(BaseModel):
    email: EmailStr | None = None
    is_active: bool | None = None
    is_admin: bool | None = None  # legacy; prefer role
    role: str | None = None  # admin | editor | viewer


class AdminCreateUser(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    display_name: str | None = Field(default=None, max_length=128)
    is_admin: bool = False  # legacy; prefer role
    role: str = "editor"


class TempPasswordResponse(BaseModel):
    user_id: int
    username: str
    temporary_password: str
    must_change_password: bool = True


class MessageResponse(BaseModel):
    message: str


class SupportUserBrief(BaseModel):
    id: int
    username: str
    email: str | None = None
    display_name: str | None = None
    role: str | None = None
    is_admin: bool = False


class BugReportCreate(BaseModel):
    title: str = Field(default="", max_length=255)
    description: str = Field(min_length=10, max_length=20000)
    page_url: str = ""
    user_agent: str = ""
    viewport_json: str = "{}"
    diagnostics_json: str = "{}"
    screenshot_data_url: str | None = None


class BugReportUpdate(BaseModel):
    status: str | None = None
    admin_note: str | None = None


class BugReportOut(BaseModel):
    id: int
    title: str
    description: str
    page_url: str = ""
    user_agent: str = ""
    viewport_json: str = "{}"
    diagnostics_json: str = "{}"
    has_screenshot: bool = False
    status: str = "open"
    admin_note: str = ""
    resolved_by: int | None = None
    resolved_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    user: SupportUserBrief | None = None


class FeedbackCreate(BaseModel):
    category: str = "suggestion"
    subject: str = Field(min_length=3, max_length=255)
    message: str = Field(min_length=10, max_length=20000)
    page_url: str = ""


class FeedbackUpdate(BaseModel):
    status: str | None = None
    admin_note: str | None = None


class FeedbackOut(BaseModel):
    id: int
    category: str
    subject: str
    message: str
    page_url: str = ""
    status: str = "new"
    admin_note: str = ""
    read_by: int | None = None
    read_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    user: SupportUserBrief | None = None


class AdminInboxCounts(BaseModel):
    open_bugs: int = 0
    new_feedback: int = 0
    total: int = 0


class AuditLogOut(BaseModel):
    id: int
    user_id: int | None = None
    username: str | None = None
    action: str
    entity_type: str = ""
    entity_id: str = ""
    details: str = ""
    outcome: str = "ok"
    created_at: str | None = None


class WACNodeOut(BaseModel):
    id: str
    chapter: str
    code: str
    title: str
    text: str
    level: str
    parent_id: str | None = None
    hierarchy_path: str
    primary: str | None = None
    secondary: str | None = None
    tertiary: str | None = None
    version_date: str | None = None
    certified_date: str | None = None
    trigger_phrases: list[str] = []
    custom_trigger_phrases: list[str] = []
    is_favorite: bool = False
    usage_count: int = 0


class WACUsageStatOut(BaseModel):
    wac_id: str
    code: str = ""
    title: str = ""
    chapter: str = ""
    count: int = 0
    last_used: str | None = None
    stat_type: str = "selected"


class WACUsageStatsResponse(BaseModel):
    items: list[WACUsageStatOut] = Field(default_factory=list)
    total_tracked: int = 0


class ComplianceFinding(BaseModel):
    wac_reference: str
    title: str
    status: str  # COMPLIES | NON-COMPLIANT | PARTIAL | INFORMATIONAL | INSUFFICIENT
    template: str
    formatted_output: str
    confidence: float
    matched_phrases: list[str] = []
    compliant_subsections: list[str] = []
    non_compliant_subsections: list[str] = []
    corrective_action: str | None = None
    additional_info_needed: str | None = None
    recommendation: str | None = None
    hierarchy_path: str
    chapter: str


class AnalyzeResponse(BaseModel):
    findings: list[ComplianceFinding]
    document_preview: str
    selected_count: int
    duration_ms: float
    analysis_id: int | None = None


class InvestigationRequest(BaseModel):
    text: str = ""
    selected_wacs: list[str] = Field(default_factory=list)
    include_informational: bool = True
    # None = use settings.llm_for_investigate (default False for fast local drafts)
    use_llm: bool | None = None
    investigation_date: str | None = None
    case_id: str | None = None
    facility_address: str | None = None
    credential_number: str | None = None


class FacilityInfo(BaseModel):
    facility_address: str = "Washington State"
    laboratory_director: str = ""
    clia_number: str = ""
    credential_number: str = ""
    medicare_number: str = "N/A"
    shell_number: str = "N/A"
    investigation_dates: str = ""
    state_licensing_priority: str = ""
    federal_certification_priority: str = ""


class QuoteFailureOut(BaseModel):
    field: str
    cite: str | None = None
    quote_preview: str = ""
    reason: str


class QuoteIntegrityOut(BaseModel):
    ok: bool = True
    failures: list[QuoteFailureOut] = Field(default_factory=list)


class WACComparison(BaseModel):
    wac_id: str
    code: str
    title: str
    chapter: str
    hierarchy_path: str
    wac_text: str
    wac_summary: str
    complaint_excerpts: list[str] = []
    allegation_draft: str
    finding: ComplianceFinding | None = None
    matched_subsections: list[str] = Field(default_factory=list)
    matched_subsection_texts: list[str] = Field(default_factory=list)
    match_reason: str | None = None
    match_score: float | None = None
    quote_ok: bool | None = None
    low_confidence: bool = False


class InvestigationAllegation(BaseModel):
    case_category: str = "BHA"
    wac_code: str
    wac_title: str
    allegation_text: str
    status: str | None = None
    confidence: float | None = None
    matched_subsections: list[str] = Field(default_factory=list)
    match_reason: str | None = None
    match_score: float | None = None
    quote_ok: bool | None = None
    low_confidence: bool = False


class RegulatoryFrameworkEntry(BaseModel):
    instrument: str
    code: str
    title: str
    subsections: list[dict[str, Any]] = Field(default_factory=list)


class StatuteSearchRequest(BaseModel):
    text: str = ""
    top_k: int = 30
    exclude_codes: list[str] = Field(default_factory=list)


class StatuteHit(BaseModel):
    id: str
    instrument: str
    chapter: str
    code: str
    title: str
    level: str
    hierarchy_path: str
    score: float
    reason: str
    text: str
    excerpt: str


class StatuteSearchResponse(BaseModel):
    hits: list[StatuteHit]
    query_preview: str
    total: int


class SuggestRelatedRequest(BaseModel):
    selected_wacs: list[str] = Field(default_factory=list)
    text: str = ""
    top_k: int = 15


class SuggestRelatedResponse(BaseModel):
    suggestions: list[StatuteHit]
    selected_count: int


class InvestigationConclusion(BaseModel):
    wac_code: str
    allegation_text: str
    result: str = "Pending Investigation"
    deficiency_cited: bool = False
    deficiency_details: str = ""


class InvestigationReport(BaseModel):
    title: str = "Investigative Report"
    subtitle: str = "State Investigation"
    investigation_date: str
    case_id: str | None = None
    facility_info: FacilityInfo
    intake_details: str
    allegation_preamble: str
    allegations: list[InvestigationAllegation]
    investigative_process: list[str] = []
    summary_of_findings: str = ""
    conclusions: list[InvestigationConclusion] = []
    actions: str = "[To be determined after investigation]"
    comparisons: list[WACComparison]
    findings: list[ComplianceFinding]
    report_text: str
    selected_count: int
    duration_ms: float
    analysis_id: int | None = None
    document_preview: str
    regulatory_framework: list[RegulatoryFrameworkEntry] = Field(default_factory=list)
    evidentiary_examples: list[str] = Field(default_factory=list)
    authority_statement: str = (
        "The selected WAC and RCW provisions are the primary investigative standard "
        "for this matter unless concrete evidence developed during the investigation "
        "definitively contradicts or supersedes them."
    )
    # Investigator collaborator (LLM or scoped local fallback)
    investigator_notes: str = ""
    clarifying_questions: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    known_facts: list[str] = Field(default_factory=list)
    unclear_items: list[str] = Field(default_factory=list)
    inferences: list[str] = Field(default_factory=list)
    recommended_subsections: list[str] = Field(default_factory=list)
    llm_used: bool = False
    llm_model: str | None = None
    llm_error: str | None = None
    quote_integrity: QuoteIntegrityOut = Field(default_factory=QuoteIntegrityOut)


class ValidateReportRequest(BaseModel):
    """Validate allegation / RF / evidentiary quotes against the PDF store."""

    selected_wacs: list[str] = Field(default_factory=list)
    allegations: list[InvestigationAllegation] = Field(default_factory=list)
    regulatory_framework: list[RegulatoryFrameworkEntry] = Field(default_factory=list)
    evidentiary_examples: list[str] = Field(default_factory=list)


class ValidateReportResponse(BaseModel):
    quote_integrity: QuoteIntegrityOut
    can_export: bool


class CaseCreate(BaseModel):
    case_id_label: str = ""
    title: str = ""
    complaint_text: str = ""
    investigation_date: str = ""
    facility_address: str = ""
    credential_number: str = ""
    approved_wac_ids: list[str] = Field(default_factory=list)


class CaseUpdate(BaseModel):
    case_id_label: str | None = None
    title: str | None = None
    complaint_text: str | None = None
    investigation_date: str | None = None
    facility_address: str | None = None
    credential_number: str | None = None
    approved_wac_ids: list[str] | None = None


class CaseSaveDraft(BaseModel):
    report: InvestigationReport
    note: str = ""


class CaseStatusUpdate(BaseModel):
    status: str
    note: str = ""


class CaseCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


class ProcessEntryCreate(BaseModel):
    activity_date: str = ""
    activity_type: str = "record_review"
    who: str = ""
    summary: str = ""


class ProcessEntryOut(BaseModel):
    id: int
    activity_date: str = ""
    activity_type: str = "record_review"
    who: str = ""
    summary: str = ""
    sort_order: int = 0

    class Config:
        from_attributes = True


class EvidenceOut(BaseModel):
    id: int
    title: str
    original_filename: str = ""
    content_type: str = ""
    linked_wac_ids: list[str] = Field(default_factory=list)
    notes: str = ""
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class CaseCommentOut(BaseModel):
    id: int
    author_user_id: int
    author_username: str = ""
    body: str
    created_at: datetime | None = None


class CaseSnapshotOut(BaseModel):
    id: int
    version: int
    note: str = ""
    created_by: int | None = None
    created_at: datetime | None = None


class CaseSummaryOut(BaseModel):
    id: int
    case_id_label: str = ""
    title: str = ""
    status: str
    approved_wac_count: int = 0
    has_report: bool = False
    owner_user_id: int
    updated_at: datetime | None = None
    created_at: datetime | None = None
    archived_at: datetime | None = None
    trashed_at: datetime | None = None


class CaseDetailOut(BaseModel):
    id: int
    case_id_label: str = ""
    title: str = ""
    status: str
    complaint_text: str = ""
    investigation_date: str = ""
    facility_address: str = ""
    credential_number: str = ""
    approved_wac_ids: list[str] = Field(default_factory=list)
    report: InvestigationReport | None = None
    owner_user_id: int
    privacy_acknowledged_at: datetime | None = None
    privacy_redaction_note: str = ""
    status_changed_at: datetime | None = None
    status_changed_by: int | None = None
    archived_at: datetime | None = None
    trashed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    snapshots: list[CaseSnapshotOut] = Field(default_factory=list)
    evidence: list[EvidenceOut] = Field(default_factory=list)
    process_entries: list[ProcessEntryOut] = Field(default_factory=list)
    comments: list[CaseCommentOut] = Field(default_factory=list)


class DefensibilityCheckOut(BaseModel):
    code: str
    severity: str
    message: str


class DefensibilityOut(BaseModel):
    overall: str
    can_export: bool
    summary: str
    checks: list[DefensibilityCheckOut] = Field(default_factory=list)


class CaseAnalyticsOut(BaseModel):
    total_cases: int
    by_status: dict[str, int] = Field(default_factory=dict)
    top_approved_wacs: list[dict[str, Any]] = Field(default_factory=list)


class FavoriteToggle(BaseModel):
    wac_id: str


class PrivacyScanRequest(BaseModel):
    text: str = ""


class PrivacyHitOut(BaseModel):
    id: str
    start: int
    end: int
    kind: str
    category: str
    preview: str
    replacement: str
    confidence: float = 0.0


class PrivacyScanResponse(BaseModel):
    has_hits: bool = False
    hit_count: int = 0
    hits: list[PrivacyHitOut] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)


class PrivacyRedactRequest(BaseModel):
    text: str = ""
    hit_ids: list[str] | None = None


class PrivacyRedactResponse(BaseModel):
    redacted_text: str
    applied: list[dict[str, Any]] = Field(default_factory=list)
    applied_count: int = 0
    residual_hits: int = 0
    clean: bool = True


def phrases_from_json(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []
