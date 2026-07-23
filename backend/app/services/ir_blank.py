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

# Content-control dropdown lists from blank DOCX (display values)
INVESTIGATION_TYPE_CHOICES = [
    "On-site State Investigation",
    "On-site Federal Investigation",
    "On-site State and Federal Investigation",
    "Off-site State Investigation",
]
STATE_LICENSING_PRIORITY_CHOICES = ["A", "B", "C", "N/A"]
FEDERAL_CERTIFICATION_PRIORITY_CHOICES = [
    "N/A",
    "Immediate Jeopardy (IJ)",
    "Non-IJ High",
    "Non-IJ Medium",
    "Non-IJ Low",
    "Adminstrative Review/Offsite Investigation",
    "Referral - Immediate",
    "Referral - Other",
    "No Action Necessary",
]

# Conclusion inline dropdown (blank SDT): only these two + empty "Choose an item."
CONCLUSION_FINDING_CHOICES = [
    "not in compliance",
    "in compliance",
]

ACTION_DETERMINATION_CHOICES = [
    "No Statement of Deficiency, No Further Action Required",
    "Letter of No Deficiency",
    "Statement of Deficiency with Directed Plan of Correction",
    "Referred Statement of Deficiency to Office of Investigative and Legal Services",
    "Memo to File",
    "Statement of Deficiency, Plan of Correction Reviewed",
    "Statement of Deficiency - No Plan of Correction Required",
    "Statement of Deficiency, Plan of Correction Reviewed, On-site Re-visit",
]

# Preserve blank spelling "Referrred" (three r's) for CARF line.
ACTION_REFERRAL_CHOICES = [
    "Referred to Medical Commission",
    "Referred to Nursing Commission",
    "Referred to Office of Investigative and Legal Services",
    "Referred to Health Care Authority",
    "Referred back to Case Management Team",
    "No Additional Referrals Needed",
    "Referrred to Commission on Accreditation of Rehabilitation Facilities",
    "Referred to Joint Commission",
    "Referred to Council on Accreditation",
]

CHOOSE_ITEM = "Choose an item."

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
    """Map editor result to blank-IR finding dropdown value (or empty = Choose an item.)."""
    r = (result or "").strip().lower()
    if r in {"substantiated", "out of compliance", "not in compliance"}:
        return "not in compliance"
    if r in {"unsubstantiated", "in compliance"}:
        return "in compliance"
    return ""


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
    finding = conclusion_finding_phrase(result) or CHOOSE_ITEM
    line = f"Allegation: The investigator found the facility {finding} with {prefix} {code}"
    if title:
        clean_title = title.replace("—", " - ").replace("–", " - ")
        if len(clean_title) > 90:
            clean_title = clean_title[:87].rstrip() + "…"
        line += f", {clean_title}"
    line += "."
    extra = (deficiency_details or "").strip()
    if extra and finding == "not in compliance":
        line += f" {extra}"
    return line


def compose_actions_text(determination: str = "", referral: str = "") -> str:
    """Two blank Actions content-control lines under Actions:."""
    d = (determination or "").strip() or CHOOSE_ITEM
    r = (referral or "").strip() or CHOOSE_ITEM
    return f"{d}\n{r}"


def parse_actions_fields(
    actions: str = "",
    *,
    determination: str = "",
    referral: str = "",
) -> tuple[str, str]:
    """Prefer structured fields; else split legacy actions text into the two dropdowns."""
    det = (determination or "").strip()
    ref = (referral or "").strip()
    if det or ref:
        return det, ref
    lines = [ln.strip() for ln in (actions or "").splitlines() if ln.strip()]
    # Drop legacy placeholder
    lines = [ln for ln in lines if ln.lower() not in {"[to be determined after investigation]"}]
    if not lines:
        return "", ""
    known_det = {c.lower() for c in ACTION_DETERMINATION_CHOICES} | {CHOOSE_ITEM.lower()}
    known_ref = {c.lower() for c in ACTION_REFERRAL_CHOICES} | {CHOOSE_ITEM.lower()}
    if len(lines) >= 2:
        a, b = lines[0], lines[1]
        if a.lower() in known_det or b.lower() in known_ref:
            return (
                "" if a.lower() == CHOOSE_ITEM.lower() else a,
                "" if b.lower() == CHOOSE_ITEM.lower() else b,
            )
        return a, b
    only = lines[0]
    if only.lower() in known_ref:
        return "", only
    if only.lower() == CHOOSE_ITEM.lower():
        return "", ""
    return only, ""
