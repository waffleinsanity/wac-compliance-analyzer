"""DOH policy guidance corpus for IR / SOD structure and validation.

Sources (local, shipped with the app for all users):
  data/examples/policy_guidance/*

GUIDANCE vs STATUTE
-------------------
These manuals govern document structure, voice, and workflow gates.
They are NEVER authority for which WAC/RCW subsections apply or for
statute wording — that remains the ingested PDFs in data/source/.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from xml.etree import ElementTree as ET

from docx import Document

from app.config import settings

GUIDANCE_DIRNAME = "policy_guidance"

# IR Guidance conclusion options (normalize desk-manual typo "citied" → "cited")
IR_CONCLUSION_OPTIONS = [
    "Substantiated with deficient practice or condition cited",
    "Substantiated with no current deficient practice or condition cited",
    "Not Substantiated",
    "Pending Investigation",
]

IR_CONCLUSION_SUBSTANTIATED_DEFICIENT = IR_CONCLUSION_OPTIONS[0]
IR_CONCLUSION_SUBSTANTIATED_NO_DEFICIENT = IR_CONCLUSION_OPTIONS[1]
IR_CONCLUSION_NOT_SUBSTANTIATED = IR_CONCLUSION_OPTIONS[2]

# Actions may name SOD presence/absence — never specific citations (IR Guidance).
ACTIONS_NO_CITE_HINT = "Actions name SOD presence/absence only — citations belong in the SOD."

# SOD Based-on evidence vocabulary (Formatting Standards + SOD Writing PPTX)
SOD_EVIDENCE_TYPES = (
    "observation",
    "interview",
    "record review",
    "document review",
    "policy and procedure review",
    "policy review",
)

SOD_BANNED_VAGUE = frozenset(
    {
        "several",
        "seems",
        "appears",
        "sometimes",
        "timely",
        "inadequate",
        "unsatisfactory",
        "unnecessary",
    }
)

SOD_BANNED_FIRST_PERSON = re.compile(r"\b(I|we|our|my)\b", re.IGNORECASE)

# Scope × Severity (Enforcement Tool Desk Manual) — Phase 2 advisory
SCOPE_OPTIONS = ["isolated", "pattern", "widespread"]
SEVERITY_OPTIONS = [
    "no_actual_harm_minimal",
    "no_actual_harm_more_than_minimal_not_ij",
    "actual_harm_not_ij",
    "immediate_jeopardy",
]

ENFORCEMENT_OUTCOMES = [
    "no_citation",
    "sod_poc_no_revisit",
    "sod_poc_revisit",
    "sod_dpoc_rtf",
    "sod_cmt_referral",
    "ij_notice",
    "cmt_emergency_actions",
]

# DPOC directed-action checklist (DPOC Desk Manual) — Phase 2
DPOC_DIRECTED_ACTION_OPTIONS = [
    "Hire department-approved consultant",
    "Documented routine quality reviews",
    "Revise/develop individual service plans for all clients",
    "Change organizational structure / supervision of direct care staff",
]

DEFAULT_POC_DUE_DAYS = 14

# Category themes for categorical IR allegations (IR Guidance)
CATEGORY_BY_CODE_HINTS: dict[str, str] = {
    "246-337-045": "Governance and administration",
    "246-337-048": "Quality improvement",
    "246-337-050": "Personnel",
    "246-337-060": "Infection control",
    "246-337-065": "Safety and security",
    "246-337-075": "Resident rights",
    "246-337-080": "Care services",
    "246-337-105": "Medication management",
    "246-337-110": "Restraint and seclusion",
    "246-337-120": "Physical environment",
    "246-337-146": "Laundry and linen",
    "246-341-0410": "Agency administration",
    "246-341-0420": "Policies and procedures / staffing",
    "246-341-0425": "Individual service records",
    "246-341-0510": "Personnel",
    "246-341-0515": "Clinical supervision",
    "246-341-0600": "Individual participant rights",
    "246-341-0605": "Complaint and grievance process",
    "246-341-0640": "Clinical documentation",
    "246-341-0903": "Crisis mental health services",
    "246-341-1000": "Opioid treatment program",
    "246-341-1124": "Inpatient clinical record / consent",
}


@dataclass
class GuidanceFile:
    name: str
    kind: str  # ir_guidance | sod_standards | sod_sample | peer_review | enforcement | dpoc | training
    text_preview: str = ""
    char_count: int = 0


@dataclass
class GuidanceCorpus:
    files: list[GuidanceFile] = field(default_factory=list)
    loaded_from: str = ""
    ir_conclusion_options: list[str] = field(default_factory=lambda: list(IR_CONCLUSION_OPTIONS))
    sod_evidence_types: list[str] = field(default_factory=lambda: list(SOD_EVIDENCE_TYPES))
    banned_vague: list[str] = field(default_factory=lambda: sorted(SOD_BANNED_VAGUE))
    scope_options: list[str] = field(default_factory=lambda: list(SCOPE_OPTIONS))
    severity_options: list[str] = field(default_factory=lambda: list(SEVERITY_OPTIONS))
    enforcement_outcomes: list[str] = field(default_factory=lambda: list(ENFORCEMENT_OUTCOMES))
    dpoc_actions: list[str] = field(default_factory=lambda: list(DPOC_DIRECTED_ACTION_OPTIONS))
    poc_due_days: int = DEFAULT_POC_DUE_DAYS


def guidance_dir() -> Path:
    root = Path(settings.data_dir) / "examples" / GUIDANCE_DIRNAME
    if root.is_dir():
        return root
    # Fallback relative to repo when data_dir points elsewhere
    alt = Path(__file__).resolve().parents[3] / "data" / "examples" / GUIDANCE_DIRNAME
    return alt if alt.is_dir() else root


def _classify(name: str) -> str:
    low = name.lower()
    if "investigative report" in low and "guidance" in low:
        return "ir_guidance"
    if "formatting standards" in low or ("sod" in low and "standard" in low):
        return "sod_standards"
    if "sod writing" in low or low.endswith(".pptx"):
        return "training"
    if "sample" in low and "sod" in low:
        return "sod_sample"
    if "peer review" in low:
        return "peer_review"
    if "enforcement" in low:
        return "enforcement"
    if "directed plan" in low or "dpoc" in low:
        return "dpoc"
    return "other"


def _docx_text(path: Path, limit: int = 12000) -> str:
    try:
        doc = Document(str(path))
    except Exception:
        return ""
    parts: list[str] = []
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            parts.append(t)
        if sum(len(x) for x in parts) >= limit:
            break
    return "\n".join(parts)[:limit]


def _pptx_text(path: Path, limit: int = 12000) -> str:
    """Extract slide text from PPTX via zip/xml (no python-pptx dependency)."""
    ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    chunks: list[str] = []
    try:
        with zipfile.ZipFile(path) as zf:
            slides = sorted(
                n for n in zf.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")
            )
            for name in slides:
                root = ET.fromstring(zf.read(name))
                texts = [n.text for n in root.findall(".//a:t", ns) if n.text]
                if texts:
                    chunks.append(" ".join(texts))
                if sum(len(c) for c in chunks) >= limit:
                    break
    except Exception:
        return ""
    return "\n".join(chunks)[:limit]


def _load_corpus() -> GuidanceCorpus:
    root = guidance_dir()
    corpus = GuidanceCorpus(loaded_from=str(root))
    if not root.is_dir():
        return corpus
    for path in sorted(root.iterdir()):
        if path.suffix.lower() not in {".docx", ".pptx", ".txt", ".md"}:
            continue
        if path.name.startswith("~") or path.name.startswith("."):
            continue
        kind = _classify(path.name)
        if path.suffix.lower() == ".docx":
            preview = _docx_text(path)
        elif path.suffix.lower() == ".pptx":
            preview = _pptx_text(path)
        else:
            preview = path.read_text(encoding="utf-8", errors="replace")[:12000]
        corpus.files.append(
            GuidanceFile(
                name=path.name,
                kind=kind,
                text_preview=preview[:800],
                char_count=len(preview),
            )
        )
    return corpus


@lru_cache(maxsize=1)
def load_guidance_corpus() -> GuidanceCorpus:
    return _load_corpus()


def reload_guidance_corpus() -> GuidanceCorpus:
    load_guidance_corpus.cache_clear()
    return load_guidance_corpus()


def categorical_allegation_topic(code: str, title: str) -> str:
    """IR Guidance: categorical topic (not cite-first) for Allegation/s section."""
    bare = (code or "").replace("WAC ", "").replace("RCW ", "").strip()
    if bare in CATEGORY_BY_CODE_HINTS:
        return CATEGORY_BY_CODE_HINTS[bare]
    clean = re.sub(r"\s*[—–-]\s*", " — ", (title or "").strip())
    if clean:
        # First clause of title often is the category
        return clean.split("—")[0].strip() or clean
    return bare or "Authorized investigative concern"


def categorical_allegation_text(code: str, title: str) -> str:
    topic = categorical_allegation_topic(code, title)
    return (
        f"{topic} — systemic practices and conditions derived from the complaint intake "
        f"and authorized for investigation (jurisdiction under the selected provisions)."
    )


def failure_to_risk_stub(duty_phrase: str) -> str:
    """Investigator-editable Failure-to seed; echoes duty, generic risk placeholder."""
    duty = re.sub(r"\s+", " ", (duty_phrase or "").strip()).rstrip(" .;")
    if not duty:
        duty = "comply with the cited regulatory requirements"
    # Infinitive-ish echo for "Failure to …"
    low = duty[0].lower() + duty[1:] if duty else duty
    return (
        f"Failure to {low} can result in inconsistent or delayed care and place "
        f"patients at risk of harm if left uncorrected."
    )


def recommend_enforcement_outcomes(
    scope: str | None,
    severity: str | None,
    *,
    is_rtf: bool = False,
) -> list[str]:
    """Advisory Enforcement Tool cells (Phase 2) — never auto-issues letters."""
    s = (scope or "").strip().lower()
    v = (severity or "").strip().lower()
    if not s or not v:
        return []
    if v == "immediate_jeopardy":
        return ["ij_notice", "sod_cmt_referral", "cmt_emergency_actions"]
    if v == "actual_harm_not_ij":
        out = ["sod_poc_revisit", "sod_cmt_referral"]
        if is_rtf:
            out.insert(1, "sod_dpoc_rtf")
        return out
    if v == "no_actual_harm_more_than_minimal_not_ij":
        if s == "isolated":
            return ["sod_poc_revisit"]
        out = ["sod_poc_revisit"]
        if is_rtf:
            out.append("sod_dpoc_rtf")
        if s == "widespread":
            out.append("sod_cmt_referral")
        return out
    if v == "no_actual_harm_minimal":
        if s == "isolated":
            return ["no_citation"]
        if s == "pattern":
            return ["sod_poc_no_revisit"]
        return ["sod_poc_revisit"]
    return []


def guidance_stats() -> dict:
    c = load_guidance_corpus()
    return {
        "loaded_from": c.loaded_from,
        "file_count": len(c.files),
        "files": [{"name": f.name, "kind": f.kind, "chars": f.char_count} for f in c.files],
        "ir_conclusion_options": c.ir_conclusion_options,
        "poc_due_days": c.poc_due_days,
        "scope_options": c.scope_options,
        "severity_options": c.severity_options,
    }
