"""SOD structural / style validators from DOH Formatting Standards + SOD Writing."""

from __future__ import annotations

import re
from typing import Any

from app.schemas import InvestigationReport, StatementOfDeficiency
from app.services.guidance_corpus import (
    SOD_BANNED_FIRST_PERSON,
    SOD_BANNED_VAGUE,
)
from app.services.quote_verify import is_contiguous_substring, store_text_for_cite
from app.services.sod_writing import (
    ABBREV_PERIODS,
    DID_NOT_ALWAYS,
    evidence_buckets,
    finding_covers_bucket,
)

_HE_SHE_RE = re.compile(r"\b(he/she|she/he|his/her|her/his)\b", re.IGNORECASE)
_IN_PART_RE = re.compile(r"\bin part\b", re.IGNORECASE)


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
            buckets = evidence_buckets(based)
            if len(buckets) < 2:
                out.append(
                    {
                        "field": f"{prefix}.based_on",
                        "reason": "need_two_evidence_types",
                        "preview": based[:80],
                    }
                )
            findings = list(d.findings or [])
            for it in d.items or []:
                findings.extend(it.findings or [])
            if findings and buckets:
                missing = [
                    b
                    for b in buckets
                    if not any(finding_covers_bucket(f.method, f.text, b) for f in findings)
                ]
                if missing:
                    out.append(
                        {
                            "field": f"{prefix}.findings",
                            "reason": "evidence_without_finding",
                            "preview": ", ".join(sorted(missing)),
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
        if _HE_SHE_RE.search(blob):
            out.append(
                {
                    "field": prefix,
                    "reason": "gendered_slash",
                    "preview": "Do not use he/she or his/her",
                }
            )
        if _IN_PART_RE.search(blob):
            out.append(
                {
                    "field": prefix,
                    "reason": "in_part",
                    "preview": "Do not write in part when quoting policy",
                }
            )
        if DID_NOT_ALWAYS.search(blob):
            out.append(
                {
                    "field": prefix,
                    "reason": "vague_lexicon",
                    "preview": "did not always",
                }
            )
        if ABBREV_PERIODS.search(blob):
            out.append(
                {
                    "field": prefix,
                    "reason": "abbrev_periods",
                    "preview": "Write RN not R.N.",
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
