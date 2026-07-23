"""Single emitter for DOH Investigation Report plain text and DOCX body order.

Labels and process skeleton come from ir_blank (blank DOCX). Regulatory Framework /
Authority / Evidentiary Framework stay out of the facility IR body.
"""

from __future__ import annotations

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
    format_conclusion_line,
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


def allegation_export_line(allegation: InvestigationAllegation | dict[str, Any]) -> str:
    if isinstance(allegation, InvestigationAllegation):
        text = allegation.allegation_text or ""
    else:
        text = str(allegation.get("allegation_text") or "")
    text = normalize_allegation_line(text)
    if text.lower().startswith("allegation:"):
        return text
    return f"Allegation: {text}"


def conclusion_export_lines(report: InvestigationReport) -> list[str]:
    conclusions_by_code = {c.wac_code: c for c in report.conclusions}
    lines: list[str] = []
    for a in report.allegations:
        c = conclusions_by_code.get(a.wac_code)
        lines.append(
            format_conclusion_line(
                wac_code=a.wac_code,
                wac_title=a.wac_title or "",
                result=c.result if c else "Pending Investigation",
                deficiency_details=(c.deficiency_details if c and c.deficiency_cited else "") or "",
            )
        )
    return lines


def build_report_plain_text(report: InvestigationReport) -> str:
    """Plain-text IR matching blank DOCX section order (no letterhead, no RF appendix)."""
    lines: list[str] = [TITLE]
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
    for a in report.allegations:
        lines.append(allegation_export_line(a))
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

    lines.extend(
        [
            ACTIONS_LABEL,
            (report.actions or "[To be determined after investigation]").strip(),
        ]
    )
    return "\n".join(lines).strip() + "\n"


def sync_report_text(report: InvestigationReport) -> InvestigationReport:
    """Regenerate report_text from structured fields (keeps Copy/DOCX/save aligned)."""
    report.report_text = build_report_plain_text(report)
    return report
