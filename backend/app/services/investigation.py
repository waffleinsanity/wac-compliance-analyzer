"""Build Investigative Reports that follow peer-reviewed DOH IR structure/language.

Pipeline:
  1. Ingest complaint → normalize Intake Details voice (DOH received…)
  2. Run investigator (LLM when configured, else scoped local) on SELECTED codes only
  3. Draft allegations from exact PDF subsections (Example DOCX = phrasing shape only)
  4. Emit a facility Investigative Report skeleton matching the expanded example corpus
"""

from __future__ import annotations

import re
import time
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.rag.store import wac_store
from app.schemas import (
    FacilityInfo,
    InvestigationAllegation,
    InvestigationConclusion,
    InvestigationReport,
    QuoteIntegrityOut,
    RegulatoryFrameworkEntry,
    WACComparison,
)
from app.services.investigator_llm import CodeInvestigation, run_investigator
from app.services.quote_verify import verify_report_quotes
from app.services.ir_blank import ACTIONS_LABEL, TITLE as IR_TITLE, format_conclusion_line
from app.services.template_corpus import (
    DOH_ALLEGATION_BLOCK_HEADER,
    DOH_ALLEGATION_PREAMBLE,
    DOH_CONCLUSION_HEADER,
    DOH_DEFAULT_PROCESS,
    DOH_INTAKE_LABEL,
    DOH_PROCESS_LABEL,
    DOH_SUMMARY_LABEL,
    _detect_themes,
    format_intake_narrative,
    load_template_corpus,
)
from app.services.wac_scope import (
    cite_prefix,
    draft_allegation_from_source,
    duty_phrase_from_text,
    evidentiary_examples_from_matches,
    score_relevant_subsections,
)


def _shell():
    """Live shell labels derived from the expanded example corpus."""
    corpus = load_template_corpus()
    return corpus


def _clean(text: str) -> str:
    text = (text or "").replace("\u00ad", "").replace("\ufffd", "'").replace("�", "'")
    return re.sub(r"[ \t]+", " ", text).strip()


def _extract_intake(text: str) -> str:
    return format_intake_narrative(text)


def draft_allegation(
    node: Any,
    intake: str,
    themes: list[str],
    *,
    investigator_code: CodeInvestigation | None = None,
) -> str:
    """Draft one allegation using ONLY PDF-derived subsections of this selected WAC.

    Example DOCX templates are NOT used for which subsections apply or for duty text.
    Investigator output is accepted only when already rebuilt from source (see investigator_llm).
    """
    del themes  # themes may inform process steps elsewhere; not subsection authority
    if investigator_code and investigator_code.allegation_text:
        text = investigator_code.allegation_text.strip()
        if not text.endswith("."):
            text += "."
        return text

    draft = draft_allegation_from_source(
        node.code, node.title or node.code, intake, max_subs=2
    )
    return draft.text


def _chapter_bucket(code: str) -> str:
    code = code.replace("WAC ", "").replace("RCW ", "")
    if code.startswith("246-341"):
        return "BHA"
    if code.startswith("246-337"):
        return "RTF"
    if code.startswith("71."):
        return "RCW"
    return "Other"


def _relevant_excerpts(complaint: str, node: Any, max_excerpts: int = 3) -> list[str]:
    windows: list[str] = []
    code = node.code
    chunks = re.split(r"\n{2,}|(?<=[.!?])\s+", complaint)
    code_re = re.compile(rf"\b{re.escape(code)}\b|WAC\s+{re.escape(code)}\b", re.IGNORECASE)
    stop = {
        "that", "with", "from", "this", "shall", "must", "have", "been", "under",
        "which", "their", "other", "agency", "facility", "services", "including",
        "provide", "provided", "requirements", "section", "chapter",
    }
    title_tokens = [
        t.lower()
        for t in re.findall(r"[A-Za-z]{4,}", f"{node.title} {node.text[:500]}")
        if t.lower() not in stop
    ][:14]

    for chunk in chunks:
        chunk = chunk.strip()
        if len(chunk) < 35:
            continue
        if code_re.search(chunk):
            windows.append(chunk)
            continue
        lower = chunk.lower()
        hits = sum(1 for t in title_tokens if t in lower)
        if hits >= 2:
            windows.append(chunk)

    seen: set[str] = set()
    out: list[str] = []
    for w in windows:
        key = w[:90].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(w if len(w) < 520 else w[:520] + "…")
        if len(out) >= max_excerpts:
            break
    if not out:
        intake = _extract_intake(complaint)
        out.append(intake if len(intake) < 420 else intake[:420] + "…")
    return out


def _suggest_process(complaint: str, buckets: set[str], themes: list[str]) -> list[str]:
    """Seed Investigative Process from the blank IR skeleton (Pre-investigation / Activity / …)."""
    del complaint
    shell = _shell()
    steps = list(shell.default_process or DOH_DEFAULT_PROCESS)

    # Insert theme-specific pre-investigation bullets after the blank's plan line
    extras: list[str] = []
    if "confidentiality" in themes:
        extras.append(
            "The Investigator reviewed confidentiality and release-of-information policies."
        )
    if "assault" in themes or "abuse" in themes or "safety" in themes:
        extras.append(
            "The Investigator contacted Adult Protective Services and/or law enforcement as applicable."
        )
        extras.append(
            "The Investigator reviewed incident reports and safety/security documentation."
        )
    if "death" in themes:
        extras.append(
            "The Investigator reviewed critical incident and death reporting documentation."
        )
    if "unlicensed" in themes:
        extras.append(
            "The Investigator reviewed licensure/certification records and publicly available facility information."
        )
    if "BHA" in buckets and "RTF" in buckets:
        extras.append(
            "The Investigator evaluated both BHA (246-341) and RTF (246-337) licensing requirements."
        )
    if "RCW" in buckets:
        extras.append(
            "The Investigator reviewed related RCW provisions authorized for this investigation."
        )

    if extras:
        try:
            anchor = steps.index("The Investigator developed an investigation plan.")
            for i, line in enumerate(extras):
                steps.insert(anchor + 1 + i, line)
        except ValueError:
            # Fallback: place under Pre-investigation Activity header
            try:
                anchor = steps.index("Pre-investigation Activity:")
                for i, line in enumerate(extras):
                    steps.insert(anchor + 1 + i, line)
            except ValueError:
                steps.extend(extras)

    seen: set[str] = set()
    out: list[str] = []
    for s in steps:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _summary_placeholder(intake: str, allegations: list[InvestigationAllegation]) -> str:
    codes = ", ".join(a.wac_code for a in allegations[:8])
    more = f" and {len(allegations) - 8} additional codes" if len(allegations) > 8 else ""
    return (
        f"{_clean(intake)[:500]}{'…' if len(intake) > 500 else ''}\n\n"
        f"Authorized citations for this investigation include {codes}{more}. "
        f"Summary of Findings is to be completed after investigative activities are finished."
    )


def build_report_text(report: InvestigationReport) -> str:
    """Emit report text matching the blank Investigation Report form (no letterhead).

    Authority / Regulatory Framework / Evidentiary Framework remain structured
    fields for the editor UI; they are not injected into the DOH IR body.
    """
    fi = report.facility_info
    lines = [
        IR_TITLE,
        f"Facility Address: {fi.facility_address or ''}",
        f"Laboratory Director: {getattr(fi, 'laboratory_director', None) or ''}",
        f"CLIA Number: {getattr(fi, 'clia_number', None) or ''}",
        f"Credential Number: {fi.credential_number or ''}",
        f"Medicare Number: {fi.medicare_number or ''}",
        f"Shell Number: {fi.shell_number or ''}",
        f"Date(s) of Investigation: {fi.investigation_dates or report.investigation_date or ''}",
        f"State Licensing Priority: {fi.state_licensing_priority or ''}",
        f"Federal Certification Priority: {fi.federal_certification_priority or ''}",
        "",
        DOH_INTAKE_LABEL,
        "",
        report.intake_details,
        "",
        DOH_ALLEGATION_BLOCK_HEADER,
        "",
    ]

    for a in report.allegations:
        text = a.allegation_text.strip()
        if text.lower().startswith("allegation:"):
            lines.append(text)
        else:
            lines.append(f"Allegation: {text}")
        lines.append("")

    lines.extend(["", DOH_PROCESS_LABEL, ""])
    for step in report.investigative_process:
        lines.append(step)

    lines.extend(
        [
            "",
            DOH_SUMMARY_LABEL,
            "",
            report.summary_of_findings,
            "",
            DOH_CONCLUSION_HEADER,
            "",
        ]
    )

    conclusions_by_code = {c.wac_code: c for c in report.conclusions}
    title_by_code = {a.wac_code: a.wac_title for a in report.allegations}
    for a in report.allegations:
        c = conclusions_by_code.get(a.wac_code)
        lines.append(
            format_conclusion_line(
                wac_code=a.wac_code,
                wac_title=title_by_code.get(a.wac_code, a.wac_title or ""),
                result=c.result if c else "Pending Investigation",
                deficiency_details=(c.deficiency_details if c and c.deficiency_cited else "") or "",
            )
        )
        lines.append("")

    lines.extend(
        [
            ACTIONS_LABEL,
            report.actions or "[To be determined after investigation]",
        ]
    )
    return "\n".join(lines).strip() + "\n"


def build_investigation_report(
    db: Session,
    complaint_text: str,
    selected_wacs: list[str],
    user_id: int | None = None,
    investigation_date: str | None = None,
    case_id: str | None = None,
    include_informational: bool = True,
    document_name: str | None = None,
    facility_address: str | None = None,
    credential_number: str | None = None,
    use_llm: bool | None = None,
) -> InvestigationReport:
    del include_informational, document_name  # legacy analyzer knobs; IR path is PDF-scoped
    started = time.perf_counter()
    if not complaint_text.strip():
        raise ValueError("Complaint / allegation text is required")
    if not selected_wacs:
        raise ValueError("Select at least one authorized WAC")

    from app.services.usage_stats import record_selection

    try:
        record_selection(db, user_id=user_id, wac_ids=list(selected_wacs), stat_type="selected")
    except Exception:
        # Stats must never block report generation.
        pass

    selected_nodes = wac_store.resolve_selection(selected_wacs)
    code_nodes = [n for n in selected_nodes if n.level == "code"]
    if not code_nodes:
        parents: dict[str, Any] = {}
        for n in selected_nodes:
            parent = wac_store.code_index.get(n.code)
            if parent:
                parents[parent.id] = parent
        code_nodes = list(parents.values())

    def _sort_key(n: Any) -> tuple:
        ch = n.chapter
        order = {"246-341": 0, "246-337": 1, "71.05": 2, "71.24": 3, "71.34": 4}.get(ch, 9)
        return (order, n.code)

    code_nodes.sort(key=_sort_key)

    intake = _extract_intake(complaint_text)
    themes = _detect_themes(intake)
    inv_date = investigation_date or date.today().strftime("%m/%d/%Y")

    # Local investigator is instant; LLM is opt-in (settings.llm_for_investigate / use_llm)
    investigator = run_investigator(complaint_text, code_nodes, use_llm=use_llm)
    inv_by_code = {c.code: c for c in investigator.codes}

    comparisons: list[WACComparison] = []
    allegations: list[InvestigationAllegation] = []
    conclusions: list[InvestigationConclusion] = []
    framework_raw: list[dict[str, Any]] = []
    buckets: set[str] = set()

    for node in code_nodes:
        # One TF-IDF pass per code — shared by allegation, matches, and Regulatory Framework
        ranked = score_relevant_subsections(complaint_text, node.code, max_items=4)
        draft = draft_allegation_from_source(
            node.code,
            node.title or node.code,
            intake,
            max_subs=2,
            relevant=ranked,
        )
        allegation_text = draft.text
        cites = draft.cites
        # Allegation stays concise (top duties); review UI gets the closest cluster for verification.
        relevant = ranked[:2]
        closest = ranked[:4] or relevant
        prefix = cite_prefix(node.code)
        matched = [
            f"{prefix} {node.code}{s.label}" if s.label else f"{prefix} {node.code}" for s in closest
        ]
        matched_texts = [
            _clean(s.text)[:720] + ("…" if len(_clean(s.text)) > 720 else "") for s in closest
        ]
        excerpts = _relevant_excerpts(complaint_text, node)
        wac_summary = _clean(node.text[:500])
        if len(node.text) > 500:
            wac_summary += "…"

        inv_code = inv_by_code.get(node.code)
        bucket = _chapter_bucket(node.code)
        buckets.add(bucket)

        if inv_code and inv_code.source.startswith("llm"):
            source_note = f"source-pdf+investigator:{investigator.llm_model or 'llm'}"
        elif inv_code:
            source_note = f"source-pdf:{inv_code.source}"
        else:
            source_note = "source-pdf-subsections"

        framework_raw.append(
            {
                "instrument": prefix,
                "code": node.code,
                "title": _clean(node.title or node.code),
                "subsections": [
                    {
                        "cite": f"{prefix} {node.code}{s.label}" if s.label else f"{prefix} {node.code}",
                        "label": s.label,
                        "text": s.text,
                        "level": s.level,
                        "score": s.score,
                    }
                    for s in ranked[:4]
                ],
            }
        )

        comparisons.append(
            WACComparison(
                wac_id=node.id,
                code=node.code,
                title=node.title,
                chapter=node.chapter,
                hierarchy_path=node.hierarchy_path,
                # Keep payload small — full statute lives in store; UI uses matched texts + summary
                wac_text=wac_summary,
                wac_summary=wac_summary,
                complaint_excerpts=excerpts,
                allegation_draft=allegation_text,
                finding=None,
                matched_subsections=matched or cites,
                matched_subsection_texts=matched_texts,
                match_reason=draft.match_reason,
                match_score=draft.match_score,
                low_confidence=draft.low_confidence,
            )
        )
        allegations.append(
            InvestigationAllegation(
                case_category=bucket,
                wac_code=node.code,
                wac_title=node.title,
                allegation_text=allegation_text,
                status=source_note,
                confidence=draft.match_score,
                matched_subsections=matched or cites,
                match_reason=draft.match_reason,
                match_score=draft.match_score,
                low_confidence=draft.low_confidence,
            )
        )
        conclusions.append(
            InvestigationConclusion(
                wac_code=node.code,
                allegation_text=allegation_text,
                result="Pending Investigation",
                deficiency_cited=False,
                deficiency_details="",
            )
        )

    framework = [RegulatoryFrameworkEntry(**e) for e in framework_raw]
    examples = evidentiary_examples_from_matches(framework_raw, count=5)

    process = _suggest_process(complaint_text, buckets, themes)
    if investigator.next_steps:
        # Merge optional investigator notes under Document Review without truncating the blank shell
        try:
            doc_idx = process.index("Document Review")
            insert_at = doc_idx + 1
        except ValueError:
            insert_at = len(process)
        for step in investigator.next_steps:
            if step and step not in process:
                process.insert(insert_at, step)
                insert_at += 1

    facility = FacilityInfo(
        facility_address=facility_address or "Washington State",
        laboratory_director="",
        clia_number="",
        credential_number=credential_number or "",
        medicare_number="",
        shell_number="",
        investigation_dates=inv_date,
        state_licensing_priority="",
        federal_certification_priority="",
    )

    shell = _shell()
    preview = complaint_text.strip().replace("\n", " ")
    report = InvestigationReport(
        title=IR_TITLE,
        subtitle="",
        investigation_date=inv_date,
        case_id=case_id,
        facility_info=facility,
        intake_details=intake,
        allegation_preamble=shell.allegation_preamble or DOH_ALLEGATION_PREAMBLE,
        allegations=allegations,
        investigative_process=process,
        summary_of_findings=_summary_placeholder(intake, allegations),
        conclusions=conclusions,
        actions="[To be determined after investigation]",
        comparisons=comparisons,
        findings=[],
        report_text="",
        selected_count=len(code_nodes),
        duration_ms=0.0,
        analysis_id=None,
        document_preview=preview if len(preview) <= 240 else preview[:240] + "…",
        regulatory_framework=framework,
        evidentiary_examples=examples,
        investigator_notes=investigator.investigator_notes,
        clarifying_questions=investigator.clarifying_questions,
        next_steps=investigator.next_steps,
        known_facts=investigator.known_facts,
        unclear_items=investigator.unclear,
        inferences=investigator.inferences,
        recommended_subsections=investigator.recommended_subsections,
        llm_used=investigator.llm_used,
        llm_model=investigator.llm_model,
        llm_error=investigator.llm_error,
    )
    report.report_text = build_report_text(report)

    selected_codes = [n.code for n in code_nodes]
    integrity = verify_report_quotes(
        allegations=report.allegations,
        regulatory_framework=report.regulatory_framework,
        evidentiary_examples=report.evidentiary_examples,
        selected_codes=selected_codes,
    )
    report.quote_integrity = QuoteIntegrityOut(**integrity.to_dict())

    # Per-allegation quote_ok from integrity failures
    failed_fields = {f.field for f in integrity.failures}
    for a in report.allegations:
        a.quote_ok = f"allegation:{a.wac_code}" not in failed_fields
    for c in report.comparisons:
        a_ok = next((a.quote_ok for a in report.allegations if a.wac_code == c.code), None)
        c.quote_ok = a_ok

    report.duration_ms = (time.perf_counter() - started) * 1000
    return report
