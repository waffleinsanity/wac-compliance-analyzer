"""Canonical blank Investigation Report shell (DOH form, no letterhead).

Source of truth: data/templates/5. Investigation report.docx
All generated IRs follow this section order and labels. Letterhead/header
graphics are omitted; facility field lines from the blank are kept.
"""

from __future__ import annotations

from pathlib import Path

from app.config import settings

BLANK_FILENAME = "5. Investigation report.docx"

TITLE = "Investigative Report"

INTAKE_LABEL = "Intake Details: (List of concerns reported in the original complaint.)"
ALLEGATION_HEADER = (
    "Allegation(s): (The allegation(s) listed below is what the department has "
    "jurisdiction and authorization to investigate. An allegation is considered an "
    "assertion of improper practice or condition that could result in a violation "
    "of facility law or rule.)"
)
PROCESS_HEADER = (
    "Investigative Process Included: (This is what the investigator did in terms of "
    "methods employed to conduct inquiry.)"
)
SUMMARY_HEADER = "Summary of Findings (Narrative overview of the results of investigation.)"
CONCLUSION_HEADER = "Conclusion/ Results of Investigation"
ACTIONS_LABEL = "Actions:"

# Blank process skeleton (section labels + starter lines investigators fill in)
BLANK_PROCESS_SKELETON = [
    "Pre-investigation Activity:",
    "The Investigator reviewed relevant Washington Administrative Codes (WACs) and "
    "Revised Code of Washington (RCWs) statutes and regulations.",
    "The Investigator reviewed the complaint allegations.",
    "The Investigator developed an investigation plan.",
    "Investigation Activity:",
    "Observations",
    "[To be completed]",
    "Interviews",
    "[To be completed]",
    "Document Review",
    "The Investigator will review facility policies, procedures, and records relevant "
    "to the authorized allegations.",
]


def blank_docx_path() -> Path:
    return settings.templates_dir / BLANK_FILENAME


def conclusion_finding_phrase(result: str) -> str:
    """Map editor result to blank-IR 'found the facility … with WAC' phrasing."""
    r = (result or "").strip().lower()
    if r == "substantiated":
        return "out of compliance"
    if r == "unsubstantiated":
        return "in compliance"
    return "pending determination of compliance"


def format_conclusion_line(
    *,
    wac_code: str,
    wac_title: str = "",
    result: str = "Pending Investigation",
    deficiency_details: str = "",
    instrument: str = "WAC",
) -> str:
    code = (wac_code or "").replace("WAC ", "").replace("RCW ", "").strip()
    prefix = "RCW" if code.startswith("71.") else instrument
    title = (wac_title or "").strip()
    finding = conclusion_finding_phrase(result)
    line = f"Allegation: The investigator found the facility {finding} with {prefix} {code}"
    if title:
        clean_title = title.replace("—", " - ").replace("–", " - ")
        if len(clean_title) > 90:
            clean_title = clean_title[:87].rstrip() + "…"
        line += f", {clean_title}"
    line += "."
    extra = (deficiency_details or "").strip()
    if extra and finding == "out of compliance":
        line += f" {extra}"
    return line
