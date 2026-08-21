"""Flag IR/SOD text that is not format shell, user entry, or user selection.

Assistive drafts, placeholders, and seed sentences are highlighted for removal
before submission. Statute quotes and Compare-selected duties stay unflagged.

Rule lists load from data/content_review_rules.json (shared with the frontend).
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import settings
from app.schemas import InvestigationReport

RemovalReason = str

_RULES_PATH = settings.project_root / "data" / "content_review_rules.json"


@lru_cache(maxsize=1)
def load_content_review_rules() -> dict[str, Any]:
    raw = _RULES_PATH.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("content_review_rules.json must be an object")
    return data


def _flags_to_re(flags: str) -> int:
    out = 0
    for ch in (flags or "").lower():
        if ch == "i":
            out |= re.I
        elif ch == "m":
            out |= re.M
        elif ch == "s":
            out |= re.S
    return out


@lru_cache(maxsize=1)
def _compiled_rules() -> tuple[tuple[str, ...], tuple[tuple[re.Pattern[str], str], ...], tuple[str, ...]]:
    data = load_content_review_rules()
    literals = tuple(str(x) for x in (data.get("literals") or []) if str(x).strip())
    patterns: list[tuple[re.Pattern[str], str]] = []
    for row in data.get("patterns") or []:
        if not isinstance(row, dict):
            continue
        pat = str(row.get("pattern") or "").strip()
        reason = str(row.get("reason") or "assist_placeholder").strip()
        if not pat:
            continue
        patterns.append((re.compile(pat, _flags_to_re(str(row.get("flags") or ""))), reason))
    facilities = tuple(str(x) for x in (data.get("facility_placeholders") or []) if str(x).strip())
    return literals, tuple(patterns), facilities


def _merge_spans(raw: list[tuple[int, int, RemovalReason]]) -> list[dict[str, Any]]:
    if not raw:
        return []
    ordered = sorted(raw, key=lambda row: (row[0], row[1]))
    merged: list[tuple[int, int, RemovalReason]] = [ordered[0]]
    for start, end, reason in ordered[1:]:
        prev_start, prev_end, prev_reason = merged[-1]
        if start <= prev_end:
            merged[-1] = (prev_start, max(prev_end, end), prev_reason)
        else:
            merged.append((start, end, reason))
    return [
        {"start": start, "end": end, "reason": reason}
        for start, end, reason in merged
        if end > start
    ]


def find_removal_spans(text: str) -> list[dict[str, Any]]:
    """Return non-overlapping spans in text that should be removed before submission."""
    body = text or ""
    if not body.strip():
        return []
    literals, patterns, _facilities = _compiled_rules()
    hits: list[tuple[int, int, RemovalReason]] = []
    for literal in literals:
        start = 0
        while True:
            idx = body.find(literal, start)
            if idx < 0:
                break
            hits.append((idx, idx + len(literal), "assist_placeholder"))
            start = idx + max(len(literal), 1)
    for pattern, reason in patterns:
        for match in pattern.finditer(body):
            hits.append((match.start(), match.end(), reason))
    return _merge_spans(hits)


def scan_investigation_report(report: InvestigationReport | dict[str, Any]) -> list[dict[str, Any]]:
    """Structured removal flags for IR + SOD editable fields."""
    if isinstance(report, InvestigationReport):
        data = report.model_dump()
    else:
        data = report

    flags: list[dict[str, Any]] = []
    _literals, _patterns, facilities = _compiled_rules()

    def add(
        field: str,
        label: str,
        text: str,
        *,
        document: str = "ir",
    ) -> None:
        spans = find_removal_spans(text)
        if spans:
            flags.append(
                {
                    "document": document,
                    "field": field,
                    "label": label,
                    "span_count": len(spans),
                    "preview": text[:160].replace("\n", " "),
                    "spans": spans,
                }
            )

    fi = data.get("facility_info") or {}
    addr = (fi.get("facility_address") or "").strip()
    if addr in facilities:
        flags.append(
            {
                "document": "ir",
                "field": "facility.address",
                "label": "Facility address",
                "span_count": 1,
                "preview": addr,
                "spans": [{"start": 0, "end": len(addr), "reason": "facility_placeholder"}],
            }
        )
    else:
        add("facility.address", "Facility address", addr)

    process = data.get("investigative_process") or []
    process_text = "\n".join(str(p) for p in process if str(p).strip())
    add("process.all", "Investigative process", process_text)
    add("summary", "Summary of findings", data.get("summary_of_findings") or "")

    for c in data.get("conclusions") or []:
        code = c.get("wac_code") or "?"
        add(f"conclusion.{code}", f"Conclusion {code}", c.get("result") or "")
        add(
            f"conclusion_detail.{code}",
            f"Deficiency detail {code}",
            c.get("deficiency_details") or "",
        )

    add("actions", "Actions", data.get("actions") or "")
    add("actions.determination", "Action determination", data.get("action_determination") or "")
    add("actions.referral", "Action referral", data.get("action_referral") or "")

    sod = data.get("sod") or {}
    for i, d in enumerate(sod.get("deficiencies") or []):
        cite = d.get("regulation_cite") or f"deficiency {i + 1}"
        add(f"sod.based_on.{i}", f"SOD Based on ({cite})", d.get("based_on") or "", document="sod")
        add(
            f"sod.failure_to.{i}",
            f"SOD Failure to ({cite})",
            d.get("failure_to") or "",
            document="sod",
        )
        for j, finding in enumerate(d.get("findings") or []):
            text = finding.get("text") or finding.get("finding") or ""
            add(f"sod.finding.{i}.{j}", f"SOD finding ({cite})", text, document="sod")

    return flags


def content_review_checks(report: InvestigationReport | dict[str, Any]) -> list[dict[str, str]]:
    """Defensibility-style checks for assistive text still in the draft."""
    checks: list[dict[str, str]] = []
    for flag in scan_investigation_report(report):
        checks.append(
            {
                "code": f"removal_required:{flag['field']}",
                "severity": "warn",
                "message": (
                    f"{flag['label']}: remove or replace {flag['span_count']} assistive "
                    f"placeholder span(s) before submission."
                ),
            }
        )
    return checks
