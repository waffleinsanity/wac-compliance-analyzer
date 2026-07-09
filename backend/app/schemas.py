from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    email: EmailStr | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None = None
    theme_preference: str = "system"

    class Config:
        from_attributes = True


class ThemeUpdate(BaseModel):
    theme_preference: str


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


class WACTreeNode(BaseModel):
    id: str
    code: str
    title: str
    chapter: str
    level: str
    children: list["WACTreeNode"] = []
    is_favorite: bool = False


class AnalyzeRequest(BaseModel):
    text: str = ""
    selected_wacs: list[str] = Field(default_factory=list)
    include_informational: bool = True
    batch_id: str | None = None


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


class TriggerPhraseCreate(BaseModel):
    wac_id: str
    phrase: str = Field(min_length=2, max_length=500)


class TriggerPhraseUpdate(BaseModel):
    phrase: str = Field(min_length=2, max_length=500)


class TriggerPhraseOut(BaseModel):
    id: int
    wac_id: str
    phrase: str

    class Config:
        from_attributes = True


class FavoriteToggle(BaseModel):
    wac_id: str


class StatsOut(BaseModel):
    total_analyses: int
    total_wac_codes: int
    total_nodes: int
    top_selected: list[dict[str, Any]]
    top_matched: list[dict[str, Any]]
    recent_runs: list[dict[str, Any]]
    chapter_breakdown: dict[str, int]


class ValidationResult(BaseModel):
    chapter: str
    official_url: str
    reachable: bool
    local_code_count: int
    notes: str
    sample_codes: list[str] = []


def phrases_from_json(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []
