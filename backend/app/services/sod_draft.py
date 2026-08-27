"""Build Statement of Deficiency sister draft from Compare exact duties.

Statute text comes only from the PDF store. Guidance corpus supplies structure
and Failure-to risk stubs — never invented cites.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from app.schemas import (
    AllegationDutyOption,
    InvestigationReport,
    SodDeficiency,
    SodFinding,
    StatementOfDeficiency,
    WACComparison,
)
from app.services.guidance_corpus import (
    DEFAULT_POC_DUE_DAYS,
    failure_to_risk_stub,
    load_guidance_corpus,
    recommend_enforcement_outcomes,
)
from app.services.sod_blank import TITLE as SOD_TITLE
from app.services.sod_writing import default_evidence_phrase
from app.services.wac_scope import (
    cite_prefix,
    normalize_statute_text,
    validate_subsection_cite,
)


def _bare_code(code: str) -> str:
    return (code or "").replace("WAC ", "").replace("RCW ", "").strip()


def _cite_label(cite: str, code: str) -> str:
    raw = (cite or "").replace("WAC ", "").replace("RCW ", "").strip()
    if raw.startswith(code):
        return raw[len(code) :]
    m = re.search(r"((?:\([^)]+\))+)\s*$", raw)
    return m.group(1) if m else ""


def _regulation_blob(code: str, cite: str) -> tuple[str, str]:
    """Return (display_cite, exact store text) for a duty cite."""
    bare = _bare_code(code)
    prefix = cite_prefix(bare)
    label = _cite_label(cite, bare)
    full = f"{prefix} {bare}{label}" if label else f"{prefix} {bare}"
    sub = validate_subsection_cite(bare, f"{bare}{label}" if label else bare)
    if sub and sub.text:
        return full, normalize_statute_text(sub.text)
    # Fall back to code node body only when leaf missing
    return full, ""


def _based_on_seed(duty_phrase: str, evidence_hint: str | None = None) -> str:
    """Based-on seed: two or more evidence types plus WAC duty language.

    Findings included stay empty (investigator-owned). Do not invent Patient #n here.
    """
    phrase = re.sub(r"\s+", " ", (duty_phrase or "").strip()).rstrip(" .;")
    if not phrase:
        phrase = "comply with the cited requirements"
    opener = phrase[0].lower() + phrase[1:] if phrase else phrase
    hint = (evidence_hint or "").strip() or default_evidence_phrase(phrase)
    return f"Based on {hint}, the agency failed to {opener}."


def deficiency_from_duty(
    code: str,
    title: str,
    option: AllegationDutyOption | dict[str, Any],
    *,
    scope: str = "",
    severity: str = "",
    is_rtf: bool = False,
) -> SodDeficiency:
    if isinstance(option, dict):
        option = AllegationDutyOption(**option)
    cite = option.cite or f"{cite_prefix(code)} {code}{option.label}"
    display_cite, reg_text = _regulation_blob(code, cite)
    duty = option.duty_phrase or ""
    rec = recommend_enforcement_outcomes(scope, severity, is_rtf=is_rtf)
    return SodDeficiency(
        id=str(uuid.uuid4())[:8],
        regulation_cite=display_cite,
        regulation_text=reg_text,
        based_on=_based_on_seed(duty),
        failure_to=failure_to_risk_stub(duty),
        reference="",
        items=[],
        findings=[],
        scope=scope,
        severity=severity,
        recommended_outcomes=rec,
        dpoc_actions=[],
        revisit_required="revisit" in " ".join(rec),
    )


def build_sod_from_comparisons(
    comparisons: list[WACComparison] | list[dict[str, Any]],
    *,
    case_id: str | None = None,
    facility_address: str = "",
    credential_number: str = "",
    investigation_dates: str = "",
    is_rtf: bool | None = None,
) -> StatementOfDeficiency:
    """Create SOD skeleton from included_by_default (or all) duty options."""
    load_guidance_corpus()  # ensure guidance files are discoverable
    cred = credential_number or ""
    rtf = bool(is_rtf) if is_rtf is not None else ("RTF" in cred.upper() or "337" in cred)
    deficiencies: list[SodDeficiency] = []
    for comp in comparisons:
        if isinstance(comp, dict):
            comp = WACComparison(**comp)
        code = comp.code
        opts = list(comp.duty_options or [])
        included = [o for o in opts if o.included_by_default]
        if not included:
            included = opts[:2]
        for opt in included:
            if not (opt.duty_phrase or "").strip():
                continue
            deficiencies.append(
                deficiency_from_duty(code, comp.title or code, opt, is_rtf=rtf)
            )
    return StatementOfDeficiency(
        title=SOD_TITLE,
        facility_name="",
        facility_address=facility_address or "",
        case_id=case_id or "",
        credential_number=cred,
        administrator="",
        inspection_type="Investigation",
        investigator_number="",
        investigation_dates=investigation_dates or "",
        agency_services_type="",
        deficiencies=deficiencies,
        identifier_key=[],
        poc_due_days=DEFAULT_POC_DUE_DAYS,
        is_rtf=rtf,
        notes="",
    )


def attach_sod_to_report(report: InvestigationReport) -> InvestigationReport:
    """Ensure report.sod exists from current comparisons (idempotent refresh of empty shells)."""
    fi = report.facility_info
    sod = build_sod_from_comparisons(
        report.comparisons,
        case_id=report.case_id,
        facility_address=getattr(fi, "facility_address", "") or "",
        credential_number=getattr(fi, "credential_number", "") or "",
        investigation_dates=getattr(fi, "investigation_dates", "") or report.investigation_date,
    )
    # Seed Dear/administrator from IR laboratory director when unset.
    director = (getattr(fi, "laboratory_director", "") or "").strip()
    if director and not sod.administrator:
        sod.administrator = director
    # Preserve investigator-edited findings when regenerating same cites
    if report.sod and report.sod.deficiencies:
        prior = {d.regulation_cite: d for d in report.sod.deficiencies if d.regulation_cite}
        for d in sod.deficiencies:
            old = prior.get(d.regulation_cite)
            if not old:
                continue
            if old.findings:
                d.findings = old.findings
            if old.based_on and "pending" not in (old.based_on or "").lower():
                d.based_on = old.based_on
            if old.failure_to:
                d.failure_to = old.failure_to
            if old.scope:
                d.scope = old.scope
            if old.severity:
                d.severity = old.severity
                d.recommended_outcomes = recommend_enforcement_outcomes(
                    old.scope, old.severity, is_rtf=sod.is_rtf
                )
            if old.dpoc_actions:
                d.dpoc_actions = old.dpoc_actions
            if old.items:
                d.items = old.items
        sod.identifier_key = report.sod.identifier_key or []
        sod.notes = report.sod.notes or ""
        sod.facility_name = report.sod.facility_name or sod.facility_name
        sod.administrator = report.sod.administrator or sod.administrator
        sod.investigator_number = report.sod.investigator_number or ""
        sod.agency_services_type = report.sod.agency_services_type or ""
        sod.inspection_type = report.sod.inspection_type or sod.inspection_type
    report.sod = sod
    return report


def link_evidence_to_finding(
    sod: StatementOfDeficiency,
    *,
    deficiency_id: str,
    evidence_id: str,
    method: str = "document review",
    text: str = "",
) -> StatementOfDeficiency:
    """Append or update a finding row with an evidence attachment id."""
    for d in sod.deficiencies:
        if d.id != deficiency_id:
            continue
        note = (text or "").strip() or f"Linked case evidence {evidence_id}."
        for f in d.findings:
            if evidence_id in (f.evidence_ids or []):
                return sod
        d.findings.append(
            SodFinding(method=method, text=note, evidence_ids=[evidence_id])
        )
        return sod
    return sod


def _cite_key(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower().replace("wac", "").replace("rcw", ""))


def link_evidence_hits_to_sod(
    report: InvestigationReport,
    hits: list[Any],
) -> InvestigationReport:
    """Attach consolidated exhibit findings to matching SOD deficiencies.

    One Findings included row per evidence document per deficiency. Multiple duty
    hits for the same upload are merged into a single showed-paragraph.
    """
    if not report.sod or not report.sod.deficiencies:
        return report
    from app.services.evidence_review import (
        consolidate_hits_by_evidence,
        format_sod_document_finding,
        selected_evidence_hits,
    )

    selected = selected_evidence_hits(hits, included_only=True)
    for d in report.sod.deficiencies:
        reg_k = _cite_key(d.regulation_cite or "")
        if not reg_k:
            continue
        matching = [
            h
            for h in selected
            if (ck := _cite_key(str(h.get("cite") or "")))
            and (ck in reg_k or reg_k in ck)
        ]
        if not matching:
            continue
        for row in consolidate_hits_by_evidence(matching, included_only=True):
            eid = str(row.get("evidence_id") or "").strip()
            if not eid:
                continue
            note = format_sod_document_finding(
                str(row.get("evidence_title") or "document"),
                str(row.get("excerpt") or ""),
            )
            if not note:
                continue
            link_evidence_to_finding(
                report.sod,
                deficiency_id=d.id,
                evidence_id=eid,
                method="document review",
                text=note[:900],
            )
    return report
