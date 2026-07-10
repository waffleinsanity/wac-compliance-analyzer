"""Example DOCX / baseline helpers for intake voice and theme detection.

Example templates guide phrasing shape and investigative themes only.
They are NOT used for which WAC subsections apply or for duty text —
that authority remains with the ingested PDFs (see wac_scope.py).
"""

from __future__ import annotations

import re
from pathlib import Path

from app.config import settings
from app.services.documents import extract_text_from_path


THEME_KEYWORDS: dict[str, list[str]] = {
    "confidentiality": [
        "confidential",
        "phi",
        "protected health",
        "disclosure",
        "disclosed",
        "release of information",
        "without consent",
        "hipaa",
        "privacy",
    ],
    "assault": [
        "assault",
        "sexually assaulted",
        "sexual assault",
        "abuse",
        "physical altercation",
        "attacked",
    ],
    "safety": [
        "safety",
        "security",
        "elopement",
        "injury",
        "harm",
        "incident report",
    ],
    "death": [
        "death",
        "died",
        "deceased",
        "fatality",
        "mortality",
    ],
    "medication": [
        "medication",
        "prescription",
        "pharmacy",
        "dosage",
        "administered",
    ],
    "pediatric": [
        "pediatric",
        "minor",
        "child",
        "parent",
        "guardian",
        "18 years",
    ],
    "grievance": [
        "grievance",
        "complaint process",
        "quality improvement",
        "qi",
    ],
}


def _clean(text: str) -> str:
    text = (text or "").replace("\u00ad", "").replace("\ufffd", "'").replace("�", "'")
    return re.sub(r"[ \t]+", " ", text).strip()


def _detect_themes(text: str) -> list[str]:
    lower = (text or "").lower()
    found: list[str] = []
    for theme, keys in THEME_KEYWORDS.items():
        if any(k in lower for k in keys):
            found.append(theme)
    return found


def format_intake_narrative(text: str) -> str:
    """Normalize complaint text into DOH-style Intake Details voice."""
    raw = _clean(text)
    if not raw:
        return ""
    # Collapse whitespace / keep paragraph breaks lightly
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    lower = raw.lower()
    if lower.startswith("it was alleged") or lower.startswith("respondent is alleged"):
        return raw if raw.endswith(".") else raw + "."
    if "the department received" in lower[:80] or "alleged" in lower[:120]:
        return raw if raw.endswith(".") else raw + "."
    themes = _detect_themes(raw)
    if "confidentiality" in themes or "pediatric" in themes:
        body = raw[0].lower() + raw[1:] if raw else raw
        body = re.sub(r"^(that\s+)+", "", body, flags=re.IGNORECASE)
        return f"Respondent is alleged to have {body}".rstrip(".") + "."
    body = raw[0].lower() + raw[1:] if raw else raw
    body = re.sub(r"^(that\s+)+", "", body, flags=re.IGNORECASE)
    return f"It was alleged that {body}".rstrip(".") + "."


def load_example_texts() -> list[dict[str, str]]:
    """Load Example*.docx texts for health/metrics (not subsection authority)."""
    out: list[dict[str, str]] = []
    if not settings.examples_dir.exists():
        return out
    for path in sorted(settings.examples_dir.glob("Example*.*")):
        try:
            text = extract_text_from_path(path)
        except Exception:
            continue
        out.append({"name": path.name, "text": text})
    return out


def corpus_stats() -> dict[str, int]:
    examples = load_example_texts()
    codes: set[str] = set()
    allegation_lines = 0
    for ex in examples:
        codes.update(re.findall(r"246-(?:341|337)-\d{3,4}", ex["text"]))
        allegation_lines += len(
            re.findall(r"(?i)potential violation of WAC", ex["text"])
        )
    return {
        "template_examples": len(examples),
        "template_allegations": allegation_lines,
        "template_codes": len(codes),
    }
