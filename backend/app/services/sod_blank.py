"""Canonical Statement of Deficiency pack shell.

Source of truth: data/templates/Investigation SOD Template.docx
Export and preview fill that file in place from the Investigation Report.
Peer SOD samples inform voice only; statute text stays PDF-backed from data/source/.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.config import settings
from app.services.sod_writing import FINDINGS_INCLUDED_LABEL

BLANK_FILENAME = "Investigation SOD Template.docx"

TITLE = "Statement of Deficiency Report"

TABLE_HEADERS = (
    "Deficiency Number and Rule Reference",
    "Findings",
    "Plan of Correction",
)

HEADER_LABELS = {
    "agency": "Agency Name and Address",
    "administrator": "Administrator",
    "inspection_type": "Inspection Type",
    "investigation_start": "Investigation Start Date",
    "investigator_number": "Investigator Number",
    "case_number": "Case Number",
    "license_number": "License Number",
    "services_type": "BHA/RTF Agency Services Type",
}

DOH_CONTACT_LINES = (
    "Department of Health",
    "P.O. Box 47874, Olympia, WA 98504-7874",
    "TEL: 360-236-4732",
)

LETTERHEAD_LINES = (
    "STATE OF WASHINGTON",
    "DEPARTMENT OF HEALTH",
    "PO Box 47874, Olympia, Washington 98504-7874",
)

DISCLAIMER = (
    "Please note that the deficiencies/violations/observations noted in this report "
    "are not all-inclusive, but rather were deficiencies/violations/observations that "
    "were observed or discovered during the investigation."
)

# Exact enforcement sentence from Investigation SOD Template.docx
ENFORCEMENT_RCW_HINT = (
    "You may receive notice of the Department's intent to take enforcement action "
    "against your license under RCW 71.24.037, 71.12, WAC 246-337-021 and "
    "WAC 246-341-0335 based on any deficiency listed on the enclosed report. "
    "Your submission of a Plan of Correction or any other action you take in "
    "response to this Statement of Deficiency Report may be taken into consideration "
    "in an enforcement action but does not prevent the Department from proceeding "
    "with enforcement action."
)

POC_ELEMENTS = (
    "The regulation number;",
    "How the deficiency will be corrected;",
    "Who is responsible for making the correction;",
    "When the correction will be completed",
    (
        "How you will assure that the deficiency has been successfully corrected. "
        "When monitoring activities are planned, objectives must be measurable and "
        "quantifiable. Please include information about the monitoring time frame and "
        "number of planned observations."
    ),
)

DOH_RETURN_LINES = (
    "Department of Health",
    "HSQA/Office of Health Systems Oversight",
    "PO Box 47874",
    "Olympia, Washington 98504-7874",
)


def blank_sod_docx_path() -> Path:
    """Path to the official Investigation SOD Template DOCX."""
    primary = settings.templates_dir / BLANK_FILENAME
    if primary.is_file():
        return primary
    fallback = settings.examples_dir / "policy_guidance" / BLANK_FILENAME
    return fallback


def agency_display_line(facility_name: str, facility_address: str) -> str:
    name = (facility_name or "").strip()
    addr = (facility_address or "").strip().replace("\n", ", ")
    if name and addr:
        if addr.lower().startswith(name.lower()):
            return addr
        return f"{name}, {addr}"
    return name or addr or "N/A"


def format_findings_column(deficiency: dict[str, Any] | Any) -> str:
    if hasattr(deficiency, "model_dump"):
        d = deficiency.model_dump()
    else:
        d = dict(deficiency or {})
    parts: list[str] = []
    based = (d.get("based_on") or "").strip()
    fail = (d.get("failure_to") or "").strip()
    if based:
        parts.append(based)
    if fail:
        parts.append(fail)
    ref = (d.get("reference") or "").strip()
    if ref:
        parts.append(f"Reference: {ref}")
    parts.append(FINDINGS_INCLUDED_LABEL)
    numbered: list[str] = []
    items = d.get("items") or []
    if items:
        for it in items:
            numbered.append(
                f"Item #{it.get('number', 1)} - {it.get('title') or ''}".strip().rstrip("-").strip()
            )
            fins = it.get("findings") or []
            for n, f in enumerate(fins, start=1):
                numbered.append(_finding_line(n, f, number=len(fins) > 1))
    else:
        fins = d.get("findings") or []
        for n, f in enumerate(fins, start=1):
            numbered.append(_finding_line(n, f, number=len(fins) > 1))
    if numbered:
        parts.extend(numbered)
    return "\n\n".join(p for p in parts if p)


def _finding_line(n: int, finding: dict[str, Any], *, number: bool) -> str:
    method = (finding.get("method") or "").strip()
    body = (finding.get("text") or "").strip()
    text = body
    if method and body and not body.lower().startswith(method.lower()):
        text = body
    elif method and not body:
        text = method
    prefix = f"{n}. " if number else ""
    return f"{prefix}{text}".strip()
