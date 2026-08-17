"""Single emitter for DOH Investigation Report plain text and DOCX body order.

Labels and process skeleton come from ir_blank (blank DOCX). Regulatory Framework /
Authority / Evidentiary Framework stay out of the facility IR body.
"""

from __future__ import annotations

import re
from typing import Any

from app.schemas import FacilityInfo, InvestigationAllegation, InvestigationReport
from app.services.ir_blank import (
    ACTIONS_LABEL,
    ALLEGATION_HEADER,
    CONCLUSION_HEADER,
    INTAKE_LABEL,
    PROCESS_HEADER,
    SUMMARY_HEADER,
    TITLE,
    compose_actions_text,
    format_conclusion_line,
    parse_actions_fields,
)
from app.services.wac_scope import normalize_allegation_line


def _fi(report: InvestigationReport) -> FacilityInfo:
    return report.facility_info or FacilityInfo()


def facility_header_lines(report: InvestigationReport) -> list[tuple[str, str]]:
    """Return (label_with_colon, value) pairs matching the blank Header lines."""
    fi = _fi(report)
    dates = fi.investigation_dates or report.investigation_date or ""
    return [
        ("Facility Address:", fi.facility_address or ""),
        ("Laboratory Director:", fi.laboratory_director or "N/A"),
        ("CLIA Number:", fi.clia_number or "N/A"),
        ("Credential Number:", fi.credential_number or ""),
        ("Medicare Number:", fi.medicare_number or "N/A"),
        ("Shell Number:", fi.shell_number or "N/A"),
        ("Date(s) of Investigation:", dates),
        ("State Licensing Priority:", fi.state_licensing_priority or ""),
        ("Federal Certification Priority:", fi.federal_certification_priority or ""),
    ]


def investigation_type_line(report: InvestigationReport) -> str:
    """Blank IR investigation-type dropdown value (subtitle)."""
    return (getattr(report, "subtitle", None) or "").strip()


def allegation_body_text(allegation: InvestigationAllegation | dict[str, Any]) -> str:
    """Normalized allegation sentence without leading 'Allegation:' prefix."""
    if isinstance(allegation, InvestigationAllegation):
        text = allegation.allegation_text or ""
    else:
        text = str(allegation.get("allegation_text") or "")
    text = normalize_allegation_line(text)
    text = re.sub(r"^\s*\d+\.\s*", "", text)
    if text.lower().startswith("allegation:"):
        text = text.split(":", 1)[1].strip()
    return text


def allegation_export_line(
    allegation: InvestigationAllegation | dict[str, Any],
    *,
    index: int | None = None,
) -> str:
    """DOH allegation line; optional 1-based index for numbered list display."""
    body = allegation_body_text(allegation)
    line = f"Allegation: {body}" if body else "Allegation:"
    if index is not None and index >= 1:
        return f"{index}. {line}"
    return line


def conclusion_export_lines(report: InvestigationReport) -> list[str]:
    conclusions_by_code = {c.wac_code: c for c in report.conclusions}
    lines: list[str] = []
    for i, a in enumerate(report.allegations, start=1):
        c = conclusions_by_code.get(a.wac_code)
        line = format_conclusion_line(
            wac_code=a.wac_code,
            wac_title=a.wac_title or "",
            result=c.result if c else "Pending Investigation",
            deficiency_details=(c.deficiency_details if c and c.deficiency_cited else "") or "",
        )
        # Number conclusions to match allegation list in peer IRs / template UI
        if line.lower().startswith("allegation:"):
            lines.append(f"{i}. {line}")
        else:
            lines.append(f"{i}. Allegation: {line}")
    return lines


def build_report_plain_text(report: InvestigationReport) -> str:
    """Plain-text IR matching blank DOCX section order (no letterhead, no RF appendix)."""
    lines: list[str] = [TITLE]
    inv_type = investigation_type_line(report)
    if inv_type:
        lines.append(inv_type)
    for label, value in facility_header_lines(report):
        lines.append(f"{label} {value}".rstrip())
    lines.extend(
        [
            "",
            INTAKE_LABEL,
            "",
            (report.intake_details or "").strip(),
            "",
            ALLEGATION_HEADER,
            "",
        ]
    )
    for i, a in enumerate(report.allegations, start=1):
        lines.append(allegation_export_line(a, index=i))
        lines.append("")

    lines.extend(["", PROCESS_HEADER, ""])
    for step in report.investigative_process or []:
        lines.append(str(step))

    lines.extend(
        [
            "",
            SUMMARY_HEADER,
            "",
            (report.summary_of_findings or "").strip(),
            "",
            CONCLUSION_HEADER,
            "",
        ]
    )
    for line in conclusion_export_lines(report):
        lines.append(line)
        lines.append("")

    det, ref = parse_actions_fields(
        report.actions or "",
        determination=getattr(report, "action_determination", "") or "",
        referral=getattr(report, "action_referral", "") or "",
    )
    actions_body = compose_actions_text(det, ref)

    lines.extend([ACTIONS_LABEL, actions_body])
    return "\n".join(lines).strip() + "\n"


def sync_report_text(report: InvestigationReport) -> InvestigationReport:
    """Regenerate report_text from structured fields (keeps Copy/DOCX/save aligned)."""
    det, ref = parse_actions_fields(
        report.actions or "",
        determination=getattr(report, "action_determination", "") or "",
        referral=getattr(report, "action_referral", "") or "",
    )
    report.action_determination = det
    report.action_referral = ref
    report.actions = compose_actions_text(det, ref)
    report.report_text = build_report_plain_text(report)
    return report
