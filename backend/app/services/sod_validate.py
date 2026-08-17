"""SOD structural / style validators from DOH Formatting Standards + SOD Writing."""

from __future__ import annotations

import re
from typing import Any

from app.schemas import InvestigationReport, StatementOfDeficiency
from app.services.guidance_corpus import (
    SOD_BANNED_FIRST_PERSON,
    SOD_BANNED_VAGUE,
    SOD_EVIDENCE_TYPES,
)
from app.services.quote_verify import is_contiguous_substring, store_text_for_cite


def _issues() -> list[dict[str, str]]:
    return []


def validate_sod(sod: StatementOfDeficiency | dict[str, Any] | None) -> list[dict[str, str]]:
    """Return list of {field, reason, preview} issues (empty = ok for structure)."""
    out: list[dict[str, str]] = []
    if not sod:
        return [{"field": "sod", "reason": "missing", "preview": "No SOD draft on report"}]
    if isinstance(sod, dict):
        sod = StatementOfDeficiency.model_validate(sod)
    if not sod.deficiencies:
        out.append(
            {
                "field": "deficiencies",
                "reason": "empty",
                "preview": "SOD has no deficiency blocks — confirm Compare duties",
            }
        )
        return out

    for i, d in enumerate(sod.deficiencies):
        prefix = f"deficiencies[{i}]"
        if not (d.regulation_cite or "").strip():
            out.append({"field": prefix, "reason": "missing_cite", "preview": ""})
        if not (d.regulation_text or "").strip():
            out.append(
                {
                    "field": f"{prefix}.regulation_text",
                    "reason": "missing_regulation_text",
                    "preview": d.regulation_cite,
                }
            )
        elif d.regulation_cite:
            source = store_text_for_cite(d.regulation_cite)
            if source and not is_contiguous_substring(d.regulation_text[:240], source):
                # Allow short leaf text that is still in store
                if not is_contiguous_substring(d.regulation_text[:120], source):
                    out.append(
                        {
                            "field": f"{prefix}.regulation_text",
                            "reason": "not_in_store",
                            "preview": (d.regulation_text or "")[:120],
                        }
                    )
        based = (d.based_on or "").strip()
        if not based.lower().startswith("based on"):
            out.append(
                {
                    "field": f"{prefix}.based_on",
                    "reason": "missing_based_on",
                    "preview": based[:80],
                }
            )
        else:
            low = based.lower()
            mentioned = [e for e in SOD_EVIDENCE_TYPES if e in low]
            if not mentioned:
                out.append(
                    {
                        "field": f"{prefix}.based_on",
                        "reason": "no_evidence_type",
                        "preview": based[:80],
                    }
                )
        fail = (d.failure_to or "").strip()
        if not fail.lower().startswith("failure to"):
            out.append(
                {
                    "field": f"{prefix}.failure_to",
                    "reason": "missing_failure_to",
                    "preview": fail[:80],
                }
            )
        blob = f"{based} {fail} " + " ".join(f.text for f in d.findings)
        if SOD_BANNED_FIRST_PERSON.search(blob):
            out.append(
                {
                    "field": prefix,
                    "reason": "first_person",
                    "preview": "Avoid surveyor first person (I/we)",
                }
            )
        for word in SOD_BANNED_VAGUE:
            if re.search(rf"\b{re.escape(word)}\b", blob, re.I):
                out.append(
                    {
                        "field": prefix,
                        "reason": "vague_lexicon",
                        "preview": word,
                    }
                )
                break
        # Findings required before facility export when citing deficient practice
        if not d.findings and not any(it.findings for it in d.items):
            out.append(
                {
                    "field": f"{prefix}.findings",
                    "reason": "findings_empty",
                    "preview": "Add Findings included: evidence before exporting SOD to facility",
                }
            )
    return out


def validate_report_sod_consistency(report: InvestigationReport | dict[str, Any]) -> list[dict[str, str]]:
    """Warn when IR says deficient cited but SOD empty, etc."""
    if isinstance(report, dict):
        report = InvestigationReport.model_validate(report)
    out: list[dict[str, str]] = []
    deficient = [
        c
        for c in report.conclusions
        if "deficient practice or condition cited" in (c.result or "").lower()
        and "no current" not in (c.result or "").lower()
    ]
    sod = report.sod
    if deficient and (not sod or not sod.deficiencies):
        out.append(
            {
                "field": "sod",
                "reason": "ir_deficient_without_sod",
                "preview": "IR conclusion cites deficient practice but SOD has no blocks",
            }
        )
    out.extend(validate_sod(sod))
    return out
