"""Canonical Statement of Deficiency Report pack (DOH form, no letterhead graphics).

Layout source: official SOD PDFs (header table and column labels) plus peer DOCX
packs (cover letter and Plan of Correction instructions).

Writing source: Behavioral Health SOD Writing.pptx (theory and design). See
sod_writing.py. Peer SODs never choose WAC/RCW or statute wording; local
data/source/ PDFs remain sole source for regulation language.
"""

from __future__ import annotations

from typing import Any

from app.services.sod_writing import FINDINGS_INCLUDED_LABEL

TITLE = "Statement of Deficiency Report"

TABLE_HEADERS = (
    "Deficiency Number and Rule Reference",
    "Observation Findings",
    "Plan of Correction",
)

HEADER_LABELS = {
    "agency": "Facility Name and Address",
    "administrator": "Administrator",
    "inspection_type": "Inspection Type",
    "investigation_start": "Investigation Start Date",
    "investigator_number": "Investigator Number",
    "case_number": "Case Number(s)",
    "license_number": "License Number",
    "services_type": "BHA/RTF Facility Services Type",
}

DISCLAIMER = (
    "Please note that the deficiencies/violations/observations noted in this report "
    "are not all-inclusive, but rather were deficiencies/violations/observations that "
    "were observed or discovered during the investigation."
)

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
    "The regulation number",
    "How the deficiency will be corrected",
    "Who is responsible for making the correction",
    "When the correction will be completed",
    "How you will ensure that the deficiency has been successfully corrected. "
    "When monitoring activities are planned, objectives must be measurable and "
    "quantifiable. Please include information about the monitoring time frame and "
    "number of planned observations.",
)

DOH_RETURN_BLOCK = (
    "Department of Health\n"
    "HSQA/Office of Health Systems Oversight\n"
    "PO Box 47874\n"
    "Olympia, Washington 98504-7874"
)


def cover_letter_paragraphs(
    *,
    facility_name: str,
    facility_address: str,
    administrator: str,
    completed_on: str,
    investigator_number: str,
    poc_due_days: int = 14,
    letter_date: str = "",
) -> list[str]:
    """DOH SOD cover letter shell. Fill case fields; do not invent facts."""
    name = (facility_name or "").strip() or "N/A"
    addr = (facility_address or "").strip() or "N/A"
    admin = (administrator or "").strip() or "N/A"
    done = (completed_on or "").strip() or "N/A"
    inv = (investigator_number or "").strip() or "N/A"
    dear = admin if admin != "N/A" else "Administrator"
    dated = (letter_date or "").strip()
    lines = [
        "STATE OF WASHINGTON",
        "DEPARTMENT OF HEALTH",
        "PO Box 47874, Olympia, Washington 98504-7874",
    ]
    if dated:
        lines.append(dated)
    lines.extend(
        [
            name,
            addr,
            f"Dear: {dear}:",
            (
                f"This letter contains information regarding the investigation at {name} "
                f"by the Washington State Department of Health. Your state licensing investigation "
                f"was completed on {done}."
            ),
            (
                "During the investigation, deficient practice was found in the areas listed on the "
                "attached Statement of Deficiency Report. A written Plan of Correction is required "
                "for each deficiency listed on the Statement of Deficiency Report and will be due "
                f"{poc_due_days} days after you receive this letter."
            ),
            "Each plan of correction statement must include the following:",
            *[f"- {item}" for item in POC_ELEMENTS],
            "You are not required to write the Plan of Correction on the Statement of Deficiency Report.",
            ENFORCEMENT_RCW_HINT,
            (
                "Please email the report and Plans of Correction to the Investigator. You can also "
                "sign and send the original reports and Plans of Correction to the Investigator at "
                "the following address:"
            ),
            f"Investigator: {inv}",
            DOH_RETURN_BLOCK,
            "Enclosures: Statement of Deficiency Report; Plan of Correction Instructions",
        ]
    )
    return lines


def poc_instruction_paragraphs() -> list[str]:
    """Standard Plan of Correction Instructions from the SOD pack."""
    return [
        "Plan of Correction Instructions",
        "Introduction",
        (
            "We require that you submit a plan of correction for each deficiency listed on the "
            "statement of deficiency form. Your plan of correction must be submitted to DOH "
            "within fourteen calendar days of receipt of the list of deficiencies."
        ),
        (
            "You are required to respond to the statement of deficiencies by submitting a plan of "
            "correction (POC). Be sure to refer to the deficiency number. If you include exhibits, "
            "identify them and refer to them as such in your POC."
        ),
        "Descriptive Content",
        (
            "Your plan of correction must provide a step-by-step description of the methods to "
            "correct each deficient practice to prevent recurrence and provide information that "
            "ensures the intent of the regulation is met."
        ),
        "An acceptable plan of correction must contain the following elements:",
        "- The plan of correcting the specific deficiency;",
        "- The procedure for implementing the acceptable plan of correction for the specific deficiency cited;",
        (
            "- The monitoring procedure to ensure that the plan of correction is effective and that "
            "specific deficiency cited remains corrected and/or in compliance with the regulatory requirements;"
        ),
        "- The title of the person responsible for implementing the acceptable plan of correction.",
        (
            'Simply stating that a deficiency has been "corrected" is not acceptable. If a deficiency '
            "has already been corrected, the plan of correction must include the following:"
        ),
        "- How the deficiency was corrected,",
        "- The completion date (date the correction was accomplished),",
        "- How the plan of correction will prevent possible recurrence of the deficiency.",
        "Completion Dates",
        (
            "The POC must include a completion date that is realistic and coinciding with the amount "
            "of time your facility will need to correct the deficiency. Direct care issues must be "
            "corrected immediately and monitored appropriately. Some deficiencies may require a staged "
            "plan to accomplish total correction. Deficiencies that require bids, remodeling, "
            "replacement of equipment, etc., may need more time to accomplish correction; the target "
            "completion date, however, should be within a reasonable and mutually agreeable time-frame."
        ),
        "Continued Monitoring",
        (
            "Each plan of correction must indicate the appropriate person, either by position or title, "
            "who will be responsible for monitoring the correction of the deficiency to prevent recurrence."
        ),
        "Checklist:",
        "Before submitting your plan of correction, please use the checklist below to prevent delays.",
        "- Have you provided a plan of correction for each deficiency listed?",
        "- Does each plan of correction show a completion date of when the deficiency will be corrected?",
        "- Is each plan descriptive as to how the correction will be accomplished?",
        "- Have you indicated what staff position will monitor the correction of each deficiency?",
        (
            "- If you included any attachments, have they been identified with the corresponding "
            "deficiency number or identified with the page number to which they are associated?"
        ),
        "Your plan of correction will be returned to you for proper completion if not filled out according to these guidelines.",
        "Note: Failure to submit an acceptable plan of correction may result in enforcement action.",
        "Approval of POC",
        (
            "Your submitted POC will be reviewed for adequacy by DOH. If your POC does not adequately "
            "address the deficiencies, you will be sent a letter detailing why your POC was not accepted."
        ),
        "Questions?",
        (
            "Please review the cited regulation first. If you need clarification or have questions about "
            "deficiencies, you must contact the investigator who conducted the investigation."
        ),
    ]


def format_findings_column(deficiency: dict[str, Any] | Any) -> str:
    """Assemble the Findings cell: Based on, Failure to, Findings included."""
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
            numbered.append(f"Item #{it.get('number', 1)} - {it.get('title') or ''}".strip().rstrip("-").strip())
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
        # Investigator text is authoritative; method is a draft hint only when body is empty.
        text = body
    elif method and not body:
        text = method
    prefix = f"{n}. " if number else ""
    return f"{prefix}{text}".strip()
