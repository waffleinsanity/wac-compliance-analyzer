"""SOD writing standards from Behavioral Health SOD Writing.pptx.

This PowerPoint is the design specification for how a Statement of Deficiency
is written. Peer SOD DOCX/PDF files are shells for pack layout only. Neither
source is authority for which WAC/RCW apply or for statute quote text.
"""

from __future__ import annotations

import re

# Slide 16: two or more of these three forms. Record / policy review may be used
# when they apply and count as document review.
PRIMARY_EVIDENCE = ("observation", "interview", "document review")
DOCUMENT_REVIEW_ALIASES = (
    "document review",
    "documentation review",
    "record review",
    "clinical record review",
    "policy and procedure review",
    "policy review",
    "invoice/laboratory review",
    "laboratory review",
)
OBSERVATION_ALIASES = ("observation", "visual investigation")
INTERVIEW_ALIASES = ("interview",)

FINDINGS_INCLUDED_LABEL = "Findings included:"
POLICY_TITLED_PATTERN = re.compile(r"\btitled,\s+[\"“]")
ABBREV_PERIODS = re.compile(r"\b[A-Z]\.[A-Z]\.(?:[A-Z]\.)?")
DOUBLE_SPACE_AFTER_PERIOD = re.compile(r"\.\s{2,}")
DID_NOT_ALWAYS = re.compile(r"\bdid not always\b", re.IGNORECASE)

BANNED_VAGUE_EXTRA = frozenset({"did not always"})
BANNED_OPINION = frozenset({"only", "just", "unsatisfactory", "unnecessary", "inadequate"})

WRITING_PRINCIPLES = (
    "Based on must name two or more of observation, interview, and document review. "
    "Record review or policy and procedure review may be used when they apply.",
    "Every evidence type named in Based on must have a matching Findings included row.",
    "Based on must echo the cited WAC/RCW duty language.",
    "Failure to states the risk if the failed practice is left uncorrected, and must connect to Based on.",
    "Optional Reference: lines sit above Findings included (ASAM, DSM-5, CDC).",
    "Each citation starts with Findings included:",
    "Document review uses showed. Interviews use stated (quotes) or stated that (paraphrase).",
    "Time observations and interviews (MM/DD/YY, 1:00 AM). Do not date document reviews unless needed.",
    "Policy titles go in quotation marks after titled, with commas. Do not write in part.",
    "Refer to clients as patients and staff as Staff A, Staff B from the internal identifier key.",
    "Write in past tense unless quoting. Plain language. One space after a period.",
    "Do not use first person, he/she, or vague/opinion words (several, seems, appears, timely, only, just).",
    "Number findings 1. then a. then (1) when there is more than one. Split multi-duty WACs as Item #1, Item #2.",
    "Findings are left justified with space between numbered items. Plan of Correction stays blank.",
)


def evidence_buckets(text: str) -> set[str]:
    """Map Based-on wording onto the three PPTX evidence forms."""
    low = (text or "").lower()
    buckets: set[str] = set()
    if any(a in low for a in OBSERVATION_ALIASES):
        buckets.add("observation")
    if any(a in low for a in INTERVIEW_ALIASES):
        buckets.add("interview")
    if any(a in low for a in DOCUMENT_REVIEW_ALIASES):
        buckets.add("document review")
    return buckets


def default_evidence_phrase(duty_phrase: str) -> str:
    """Default Based-on evidence list from SOD Writing slide 16-17."""
    duty = (duty_phrase or "").lower()
    if "polic" in duty:
        return "observation, interview, document review, and policy and procedure review"
    return "observation, interview, and document review"


def finding_covers_bucket(finding_method: str, finding_text: str, bucket: str) -> bool:
    blob = f"{finding_method} {finding_text}".lower()
    if bucket == "observation":
        return any(a in blob for a in OBSERVATION_ALIASES)
    if bucket == "interview":
        return "interview" in blob or "stated" in blob
    if bucket == "document review":
        return any(a in blob for a in DOCUMENT_REVIEW_ALIASES) or "showed" in blob or "titled" in blob
    return False
