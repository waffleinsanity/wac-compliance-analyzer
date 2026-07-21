"""Build Investigative Reports that follow peer-reviewed DOH IR structure/language.

Pipeline:
  1. Ingest complaint → normalize Intake Details voice (DOH received…)
  2. Run investigator (LLM when configured, else scoped local) on SELECTED codes only
  3. Draft WAC-templated portions only: allegations + Regulatory Framework from PDF subsections
  4. Emit blank DOH process/facility shell; investigation activity / findings remain human-owned
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
from app.services.quote_verify import repair_allegation_text_from_store, verify_report_quotes
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
from app.services.ir_learning import learned_preamble, preferred_connector_for
from app.services.wac_scope import (
    cite_prefix,
    draft_allegation_from_source,
    normalize_allegation_line,
    normalize_statute_text,
    score_relevant_subsections,
    sentence_boundary_excerpt,
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
    del themes  # themes are not subsection authority; investigation activity is human-owned
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


def _suggest_process() -> list[str]:
    """Blank DOH Investigative Process shell only — no theme/keyword-invented steps."""
    shell = _shell()
    return list(shell.default_process or DOH_DEFAULT_PROCESS)


_SUMMARY_INTAKE_MAX_CHARS = 720
_SUMMARY_SCOPE_BRIDGE = (
    "This summary outlines how authorized WAC/RCW selections relate to the drafted "
    "allegations; investigative findings will be completed after interviews, "
    "observations, and document review."
)
_SUMMARY_FINDINGS_SHELL = (
    "Investigative findings (to be completed):\n"
    "[Document review]\n"
    "[Interviews]\n"
    "[Observations]"
)


def _truncate_at_sentence_boundary(text: str, max_chars: int) -> str:
    """Keep complete sentences only; never append ellipsis."""
    cleaned = _clean(text)
    if len(cleaned) <= max_chars:
        return cleaned
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    parts: list[str] = []
    total = 0
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        add_len = len(sentence) + (1 if parts else 0)
        if parts and total + add_len > max_chars:
            break
        parts.append(sentence)
        total += add_len
        # Always keep at least the first full sentence, even if it exceeds max_chars
        if total >= max_chars:
            break
    if parts:
        out = " ".join(parts)
        if not re.search(r"[.!?]$", out):
            out += "."
        return out
    # No sentence punctuation — keep a word-boundary cut and end with a period
    window = cleaned[:max_chars].rsplit(" ", 1)[0].rstrip(" ,;")
    return (window or cleaned[:max_chars].rstrip()) + "."


def _summary_intake_opener(intake_text: str) -> str:
    """DOH complaint opener for Summary of Findings (adapt intake narrative patterns)."""
    text = _clean(intake_text)
    if not text:
        return (
            "The Department of Health (DOH) received a complaint alleging concerns "
            "within the scope of the authorized WAC/RCW selections."
        )
    lower = text.lower()
    if lower.startswith("the department of health (doh) received a complaint alleging"):
        opener = text
    elif lower.startswith("it was alleged that"):
        body = text[len("It was alleged that") :].strip()
        if body and body[0].isupper():
            body = body[0].lower() + body[1:]
        opener = f"The Department of Health (DOH) received a complaint alleging that {body}"
    elif lower.startswith("it was alleged"):
        body = re.sub(r"^it was alleged\s*", "", text, flags=re.IGNORECASE).strip()
        if body and body[0].isupper():
            body = body[0].lower() + body[1:]
        opener = f"The Department of Health (DOH) received a complaint alleging {body}"
    elif lower.startswith(
        (
            "the department of health",
            "doh received",
            "the doh received",
            "the department received",
            "respondent is alleged",
        )
    ):
        opener = text if "received a complaint alleging" in lower else format_intake_narrative(text)
    else:
        opener = format_intake_narrative(text)
    return _truncate_at_sentence_boundary(opener, _SUMMARY_INTAKE_MAX_CHARS)


def _allegation_summary_paragraph(code: str, title: str, allegation_text: str) -> str:
    code_clean = (code or "").replace("WAC ", "").replace("RCW ", "").strip()
    prefix = cite_prefix(code_clean)
    clean_title = _clean(title or code_clean).replace("—", " - ").replace("–", " - ")
    allegation = normalize_allegation_line(allegation_text)
    if allegation and not allegation.endswith("."):
        allegation += "."
    return (
        f"{prefix} {code_clean}, {clean_title}, is authorized for this investigation "
        f"because the complaint raises concerns within the scope of that section. "
        f"The corresponding allegation asserts: {allegation}"
    )


def build_summary_of_findings(
    intake_text: str,
    allegations: list[InvestigationAllegation],
) -> str:
    """Framework starter for Summary of Findings — scope bridge and allegation mapping only.

    Does not invent investigative outcomes; evidentiary findings remain human-owned.
    """
    sections: list[str] = [_summary_intake_opener(intake_text), _SUMMARY_SCOPE_BRIDGE]
    for allegation in allegations:
        sections.append(
            _allegation_summary_paragraph(
                allegation.wac_code,
                allegation.wac_title or allegation.wac_code,
                allegation.allegation_text,
            )
        )
    sections.append(_SUMMARY_FINDINGS_SHELL)
    return "\n\n".join(sections)


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
        text = normalize_allegation_line(a.allegation_text)
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
    inv_date = investigation_date or date.today().strftime("%m/%d/%Y")
    complaint_themes = _detect_themes(complaint_text)

    # Local investigator is instant; LLM is opt-in (settings.llm_for_investigate / use_llm)
    investigator = run_investigator(complaint_text, code_nodes, use_llm=use_llm)
    inv_by_code = {c.code: c for c in investigator.codes}

    comparisons: list[WACComparison] = []
    allegations: list[InvestigationAllegation] = []
    conclusions: list[InvestigationConclusion] = []
    framework_raw: list[dict[str, Any]] = []

    for node in code_nodes:
        # One TF-IDF pass per code — shared by allegation, matches, and Regulatory Framework
        ranked = score_relevant_subsections(complaint_text, node.code, max_items=4)
        connector = preferred_connector_for(db, node.code, complaint_themes)
        draft = draft_allegation_from_source(
            node.code,
            node.title or node.code,
            intake,
            max_subs=2,
            relevant=ranked,
            preferred_connector=connector,
        )
        allegation_text = normalize_allegation_line(draft.text)
        cites = draft.cites
        # Allegation stays concise (top duties); review UI gets the closest cluster for verification.
        relevant = ranked[:2]
        closest = ranked[:4] or relevant
        prefix = cite_prefix(node.code)
        # Cites/texts shown in Compare must match what the allegation line actually uses
        # (draft.cites), not the full closest-4 ranking cluster — avoids false verify noise.
        cite_labels = list(draft.cites) or [
            f"{node.code}{s.label}" if s.label else node.code for s in closest[:2]
        ]
        matched = [
            f"{prefix} {c}" if not c.upper().startswith(("WAC ", "RCW ")) else c for c in cite_labels
        ]
        matched_texts: list[str] = []
        for c in cite_labels:
            raw = c.replace("WAC ", "").replace("RCW ", "").strip()
            label = raw[len(node.code) :] if raw.startswith(node.code) else ""
            sub = next((s for s in closest if (s.label or "") == label), None)
            if sub is None and closest:
                sub = closest[0]
            matched_texts.append(normalize_statute_text(sub.text) if sub else "")
        excerpts = _relevant_excerpts(complaint_text, node)
        # Summary stays short for list chrome; expandable "full code" uses fuller body below.
        full_code = normalize_statute_text(node.text)
        wac_summary = full_code[:500] + ("…" if len(full_code) > 500 else "")
        wac_full = full_code if len(full_code) <= 12000 else full_code[:12000]

        inv_code = inv_by_code.get(node.code)
        bucket = _chapter_bucket(node.code)

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
                        "text": normalize_statute_text(s.text),
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
                # Full code for "Show full selected code text"; summary for compact chrome
                wac_text=wac_full,
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
    # Evidentiary examples / investigation scripts are human-owned — do not auto-fabricate.
    examples: list[str] = []
    process = _suggest_process()

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
    preamble = learned_preamble(db) or shell.allegation_preamble or DOH_ALLEGATION_PREAMBLE
    report = InvestigationReport(
        title=IR_TITLE,
        subtitle="",
        investigation_date=inv_date,
        case_id=case_id,
        facility_info=facility,
        intake_details=intake,
        allegation_preamble=preamble,
        allegations=allegations,
        investigative_process=process,
        summary_of_findings=build_summary_of_findings(intake, allegations),
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
    # Auto-draft comes from the PDF store — repair any false mismatches before surfacing UI flags.
    failed_fields = {f.field for f in integrity.failures}
    if failed_fields:
        for a in report.allegations:
            if f"allegation:{a.wac_code}" in failed_fields:
                a.allegation_text = repair_allegation_text_from_store(
                    a.allegation_text, a.wac_code
                )
        for conc in report.conclusions:
            match = next((a for a in report.allegations if a.wac_code == conc.wac_code), None)
            if match:
                conc.allegation_text = match.allegation_text
        for c in report.comparisons:
            match = next((a for a in report.allegations if a.wac_code == c.code), None)
            if match:
                c.allegation_draft = match.allegation_text
        integrity = verify_report_quotes(
            allegations=report.allegations,
            regulatory_framework=report.regulatory_framework,
            evidentiary_examples=report.evidentiary_examples,
            selected_codes=selected_codes,
        )
        failed_fields = {f.field for f in integrity.failures}

    report.quote_integrity = QuoteIntegrityOut(**integrity.to_dict())

    # Per-allegation quote_ok from integrity failures
    for a in report.allegations:
        a.quote_ok = f"allegation:{a.wac_code}" not in failed_fields
    for c in report.comparisons:
        a_ok = next((a.quote_ok for a in report.allegations if a.wac_code == c.code), None)
        c.quote_ok = a_ok

    report.duration_ms = (time.perf_counter() - started) * 1000
    return report
