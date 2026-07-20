"""Washington Cat 3/4-style PII/PHI detectors for complaint intake.

Category 1 (public) is allowed. Category 2 (sensitive/official use) is not
auto-redacted — investigation narrative is inherently Cat 2. Detectors target
Cat 3/4 patterns (RCW personal information / HIPAA PHI identifiers).

Assistive control only — not a substitute for a BAA or formal HIPAA program.
Never log raw PII; return offsets, kinds, and redacted previews only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# Severity for overlap resolution (higher wins; then longer span).
KIND_SEVERITY: dict[str, int] = {
    "ssn": 100,
    "itin": 95,
    "mrn": 90,
    "drivers_license": 85,
    "email": 70,
    "phone": 70,
    "dob": 75,
    "address": 65,
    "zip": 40,
    "name": 60,
    "clinical_phi": 55,
}

TOKEN_FOR_KIND: dict[str, str] = {
    "ssn": "[REDACTED_SSN]",
    "itin": "[REDACTED_ITIN]",
    "mrn": "[REDACTED_MRN]",
    "drivers_license": "[REDACTED_DL]",
    "email": "[REDACTED_EMAIL]",
    "phone": "[REDACTED_PHONE]",
    "dob": "[REDACTED_DOB]",
    "address": "[REDACTED_ADDRESS]",
    "zip": "[REDACTED_ZIP]",
    "name": "[REDACTED_NAME]",
    "clinical_phi": "[REDACTED_PHI]",
}

CATEGORY_FOR_KIND: dict[str, str] = {
    "ssn": "3",
    "itin": "3",
    "mrn": "4",
    "drivers_license": "3",
    "email": "3",
    "phone": "3",
    "dob": "3",
    "address": "3",
    "zip": "3",
    "name": "3",
    "clinical_phi": "4",
}

PERSON_CUES = re.compile(
    r"\b(patient|resident|client|complainant|individual|consumer|member|"
    r"guardian|mother|father|spouse|child|dob|date of birth)\b",
    re.I,
)

DIAGNOSIS_CUES = re.compile(
    r"\b(diagnos(?:is|ed)|schizophrenia|bipolar|depression|anxiety|PTSD|"
    r"substance\s+use|HIV|AIDS|cancer|diabetes|pregnancy|pregnant)\b",
    re.I,
)


@dataclass
class PiiHit:
    id: str
    start: int
    end: int
    kind: str
    category: str
    preview: str
    replacement: str
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "start": self.start,
            "end": self.end,
            "kind": self.kind,
            "category": self.category,
            "preview": self.preview,
            "replacement": self.replacement,
            "confidence": self.confidence,
        }


def _preview(text: str, start: int, end: int) -> str:
    raw = text[start:end]
    if len(raw) <= 4:
        return "***"
    if "@" in raw:
        local, _, domain = raw.partition("@")
        return f"{local[:1]}***@{domain[:1]}***"
    return f"{raw[:2]}***{raw[-1:]}"


def _add(
    hits: list[PiiHit],
    text: str,
    start: int,
    end: int,
    kind: str,
    confidence: float = 0.9,
) -> None:
    if start < 0 or end > len(text) or start >= end:
        return
    hits.append(
        PiiHit(
            id="",
            start=start,
            end=end,
            kind=kind,
            category=CATEGORY_FOR_KIND.get(kind, "3"),
            preview=_preview(text, start, end),
            replacement=TOKEN_FOR_KIND.get(kind, "[REDACTED]"),
            confidence=confidence,
        )
    )


def _find_regex(hits: list[PiiHit], text: str, pattern: re.Pattern[str], kind: str, conf: float = 0.9) -> None:
    for m in pattern.finditer(text):
        _add(hits, text, m.start(), m.end(), kind, conf)


def _scan_raw(text: str) -> list[PiiHit]:
    hits: list[PiiHit] = []
    if not text:
        return hits

    # SSN / ITIN
    _find_regex(
        hits,
        text,
        re.compile(r"\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b"),
        "ssn",
        0.95,
    )
    _find_regex(hits, text, re.compile(r"\b9\d{2}[-\s]?\d{2}[-\s]?\d{4}\b"), "itin", 0.85)

    # Email / phone
    _find_regex(
        hits,
        text,
        re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        "email",
        0.95,
    )
    _find_regex(
        hits,
        text,
        re.compile(
            r"(?<!\d)(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)"
        ),
        "phone",
        0.9,
    )

    # DOB: labeled or near person cues
    for m in re.finditer(
        r"\b(?:DOB|D\.O\.B\.|date of birth)\s*[:\-]?\s*"
        r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b",
        text,
        re.I,
    ):
        _add(hits, text, m.start(1), m.end(1), "dob", 0.95)

    for m in re.finditer(r"\b(\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2})\b", text):
        window = text[max(0, m.start() - 40) : min(len(text), m.end() + 40)]
        if PERSON_CUES.search(window) or re.search(r"\b(born|birthday|age)\b", window, re.I):
            _add(hits, text, m.start(1), m.end(1), "dob", 0.8)

    # Street addresses
    _find_regex(
        hits,
        text,
        re.compile(
            r"\b\d{1,5}\s+[A-Za-z0-9.'\-]+\s+"
            r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|"
            r"Court|Ct|Way|Place|Pl|Circle|Cir|Parkway|Pkwy)\.?\b",
            re.I,
        ),
        "address",
        0.85,
    )

    # ZIP (only when near address-like context to reduce false positives)
    for m in re.finditer(r"\b(\d{5})(?:-\d{4})?\b", text):
        window = text[max(0, m.start() - 60) : m.start()]
        if re.search(
            r"\b(WA|Washington|Street|St|Avenue|Ave|Road|Rd|Drive|Dr|ZIP|zip)\b",
            window,
            re.I,
        ):
            _add(hits, text, m.start(), m.end(), "zip", 0.7)

    # WA driver's license-ish (WDL / WA DL + alphanumerics)
    _find_regex(
        hits,
        text,
        re.compile(r"\b(?:WA\s*)?(?:DL|driver'?s?\s*license)\s*[:#]?\s*[A-Z0-9]{5,12}\b", re.I),
        "drivers_license",
        0.85,
    )

    # MRN / patient id
    _find_regex(
        hits,
        text,
        re.compile(
            r"\b(?:MRN|medical\s*record\s*(?:number|no\.?)|patient\s*(?:id|number)|"
            r"Medicaid\s*(?:id|number)|ProviderOne)\s*[:#]?\s*[A-Z0-9\-]{4,20}\b",
            re.I,
        ),
        "mrn",
        0.9,
    )

    # Names: honorific + capitalized pair, or capitalized pair near person cues
    for m in re.finditer(
        r"\b(?:Mr|Mrs|Ms|Miss|Dr|Mx)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b",
        text,
    ):
        _add(hits, text, m.start(1), m.end(1), "name", 0.85)

    name_stop = {
        "patient",
        "resident",
        "client",
        "complainant",
        "individual",
        "consumer",
        "member",
        "guardian",
        "department",
        "facility",
        "hospital",
        "clinic",
        "center",
        "county",
        "state",
        "washington",
    }
    name_pair = re.compile(r"([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b")
    # Names immediately after a person cue (avoids "Patient John" consuming "John Smith").
    for cue in PERSON_CUES.finditer(text):
        m = re.match(r"\s+" + name_pair.pattern, text[cue.end() :])
        if not m:
            continue
        first, second = m.group(1), m.group(2)
        if first.lower() in name_stop or second.lower() in name_stop:
            continue
        start = cue.end() + m.start(1)
        end = cue.end() + m.end(2)
        _add(hits, text, start, end, "name", 0.8)
    # Also capitalized pairs near cues elsewhere in a window.
    for m in name_pair.finditer(text):
        first, second = m.group(1), m.group(2)
        if first.lower() in name_stop or second.lower() in name_stop:
            continue
        window = text[max(0, m.start() - 50) : min(len(text), m.end() + 50)]
        if PERSON_CUES.search(window):
            _add(hits, text, m.start(1), m.end(2), "name", 0.65)

    # Clinical PHI near person context (lower confidence)
    for m in DIAGNOSIS_CUES.finditer(text):
        window = text[max(0, m.start() - 80) : min(len(text), m.end() + 40)]
        if PERSON_CUES.search(window):
            _add(hits, text, m.start(), m.end(), "clinical_phi", 0.55)

    return hits


def _resolve_overlaps(hits: list[PiiHit]) -> list[PiiHit]:
    if not hits:
        return []
    ordered = sorted(
        hits,
        key=lambda h: (
            -KIND_SEVERITY.get(h.kind, 0),
            -(h.end - h.start),
            -h.confidence,
            h.start,
        ),
    )
    chosen: list[PiiHit] = []
    for hit in ordered:
        overlap = False
        for c in chosen:
            if hit.start < c.end and hit.end > c.start:
                overlap = True
                break
        if not overlap:
            chosen.append(hit)
    chosen.sort(key=lambda h: h.start)
    for i, hit in enumerate(chosen):
        hit.id = f"h{i + 1}"
    return chosen


def scan_text(text: str) -> dict[str, Any]:
    raw = _scan_raw(text or "")
    hits = _resolve_overlaps(raw)
    by_kind: dict[str, int] = {}
    by_category: dict[str, int] = {}
    for h in hits:
        by_kind[h.kind] = by_kind.get(h.kind, 0) + 1
        by_category[h.category] = by_category.get(h.category, 0) + 1
    return {
        "has_hits": bool(hits),
        "hit_count": len(hits),
        "hits": [h.to_dict() for h in hits],
        "summary": {
            "by_kind": by_kind,
            "by_category": by_category,
            "message": (
                "Possible Category 3/4 information detected (PII/PHI). "
                "Public Category 1 content may remain."
                if hits
                else "No Category 3/4 patterns detected."
            ),
        },
    }


def redact_text(text: str, hit_ids: list[str] | None = None) -> dict[str, Any]:
    scan = scan_text(text or "")
    hits = scan["hits"]
    if hit_ids:
        allow = set(hit_ids)
        hits = [h for h in hits if h["id"] in allow]
    # Apply from end so offsets stay valid
    out = text or ""
    applied: list[dict[str, Any]] = []
    for h in sorted(hits, key=lambda x: x["start"], reverse=True):
        out = out[: h["start"]] + h["replacement"] + out[h["end"] :]
        applied.append(
            {
                "id": h["id"],
                "kind": h["kind"],
                "category": h["category"],
                "replacement": h["replacement"],
            }
        )
    applied.reverse()
    # Re-scan to confirm
    residual = scan_text(out)
    return {
        "redacted_text": out,
        "applied": applied,
        "applied_count": len(applied),
        "residual_hits": residual["hit_count"],
        "clean": residual["hit_count"] == 0,
    }


def ensure_clean_or_redact(text: str, *, auto_redact: bool = True) -> tuple[str, dict[str, Any]]:
    """Server-side gate: return clean text + metadata.

    If hits remain and auto_redact is True, redact them.
    """
    scan = scan_text(text or "")
    if not scan["has_hits"]:
        return text or "", {"redacted": False, "applied_count": 0, "scan": scan}
    if not auto_redact:
        return text or "", {"redacted": False, "blocked": True, "scan": scan}
    result = redact_text(text or "")
    return result["redacted_text"], {
        "redacted": True,
        "applied_count": result["applied_count"],
        "applied": result["applied"],
        "scan": scan,
    }
