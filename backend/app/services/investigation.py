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
    AllegationDutyOption,
    FacilityInfo,
    InvestigationAllegation,
    InvestigationConclusion,
    InvestigationReport,
    QuoteIntegrityOut,
    RegulatoryFrameworkEntry,
    WACComparison,
)
from app.services.investigator_llm import CodeInvestigation, InvestigatorResult, run_investigator
from app.services.quote_verify import repair_allegation_text_from_store, verify_report_quotes
from app.services.ir_blank import TITLE as IR_TITLE
from app.services.ir_format import build_report_plain_text, sync_report_text
from app.services.template_corpus import (
    DOH_ALLEGATION_PREAMBLE,
    DOH_DEFAULT_PROCESS,
    _detect_themes,
    format_intake_narrative,
    load_template_corpus,
)
from app.services.guidance_corpus import categorical_allegation_text, load_guidance_corpus
from app.services.ir_learning import learned_preamble, preferred_connector_for
from app.services.sod_draft import attach_sod_to_report
from app.services.wac_scope import (
    MAX_ALLEGATION_CLAUSES,
    MAX_ALLEGATION_DRAFT_CLAUSES,
    cite_prefix,
    draft_allegation_from_source,
    normalize_allegation_line,
    normalize_statute_text,
    score_relevant_subsections,
    select_for_allegation,
    sentence_boundary_excerpt,
    subsection_ancestor_context,
    subsection_display_text,
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
    # Never accept LLM/local investigator text as duty authority — always rebuild from PDF.
    _ = investigator_code
    draft = draft_allegation_from_source(
        node.code, node.title or node.code, intake, max_subs=MAX_ALLEGATION_DRAFT_CLAUSES
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


def _relevant_excerpts(
    complaint: str,
    node: Any,
    *,
    matched_subs: list[Any] | None = None,
    max_excerpts: int = 3,
) -> list[str]:
    """Pick complaint windows thematically aligned with matched allegation subsections.

    When matched duties exist, prefer chunks that share their content tokens over
    generic code-title keyword windows (avoids meds excerpts beside gambling cites).
    """
    chunks = [
        c.strip()
        for c in re.split(r"\n{2,}|(?<=[.!?])\s+", complaint)
        if c and len(c.strip()) >= 35
    ]
    code = node.code
    code_re = re.compile(rf"\b{re.escape(code)}\b|WAC\s+{re.escape(code)}\b", re.IGNORECASE)
    stop = {
        "that", "with", "from", "this", "shall", "must", "have", "been", "under",
        "which", "their", "other", "agency", "facility", "services", "including",
        "provide", "provided", "requirements", "section", "chapter", "staff",
        "staffing", "personnel", "clinical", "treatment",
    }

    focus_tokens: list[str] = []
    if matched_subs:
        blob = " ".join(
            f"{getattr(s, 'title', '')} {getattr(s, 'text', '')}" for s in matched_subs
        )
        focus_tokens = [
            t.lower()
            for t in re.findall(r"[A-Za-z]{4,}", blob)
            if t.lower() not in stop
        ][:24]
    if not focus_tokens:
        focus_tokens = [
            t.lower()
            for t in re.findall(r"[A-Za-z]{4,}", f"{node.title} {node.text[:500]}")
            if t.lower() not in stop
        ][:14]

    scored: list[tuple[int, str]] = []
    for chunk in chunks:
        if code_re.search(chunk):
            scored.append((100, chunk))
            continue
        lower = chunk.lower()
        hits = sum(1 for t in focus_tokens if t in lower)
        if hits >= 2:
            scored.append((hits, chunk))
        elif matched_subs and hits >= 1:
            # Soft keep when allegation leaves are sparse but thematically present
            scored.append((hits, chunk))

    scored.sort(key=lambda x: (-x[0], -len(x[1])))
    seen: set[str] = set()
    out: list[str] = []
    for _, w in scored:
        key = w[:90].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(w if len(w) < 520 else w[:520] + "…")
        if len(out) >= max_excerpts:
            break
    if not out:
        # No thematic window for this code's matched duties — stay empty rather than
        # attaching unrelated complaint text to an irrelevant comparison card.
        if matched_subs is not None and len(matched_subs) == 0:
            return []
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


_COLLABORATOR_HEADER = "Investigator collaborator notes (template — not findings):"
_COLLABORATOR_FOOTER = (
    "[Human investigators complete evidentiary findings after interviews, "
    "observations, and document review.]"
)


def format_collaborator_summary_block(
    *,
    areas_of_concern: list[str] | None = None,
    investigation_methods: list[str] | None = None,
) -> str:
    """Marked template block for Summary of Findings (assistive, not determinations)."""
    areas = [a.strip() for a in (areas_of_concern or []) if a and a.strip()]
    methods = [m.strip() for m in (investigation_methods or []) if m and m.strip()]
    if not areas and not methods:
        return ""
    lines = [_COLLABORATOR_HEADER, ""]
    if areas:
        lines.append("Areas of concern:")
        lines.extend(f"- {a}" for a in areas)
        lines.append("")
    if methods:
        lines.append("Suggested methods to begin or strengthen the investigation:")
        lines.extend(f"- {m}" for m in methods)
        lines.append("")
    lines.append(_COLLABORATOR_FOOTER)
    return "\n".join(lines).strip()


def build_summary_of_findings(
    intake_text: str,
    allegations: list[InvestigationAllegation],
    investigator: InvestigatorResult | None = None,
) -> str:
    """Framework starter for Summary of Findings — scope bridge, allegation mapping, collaborator assist.

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
    if investigator is not None:
        block = format_collaborator_summary_block(
            areas_of_concern=investigator.areas_of_concern,
            investigation_methods=investigator.investigation_methods,
        )
        if block:
            sections.append(block)
    return "\n\n".join(sections)


def build_report_text(report: InvestigationReport) -> str:
    """Emit report text matching the blank Investigation Report form (no letterhead)."""
    return build_report_plain_text(report)


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
        # Rank broadly; allegation selection keeps strong + upper-moderate for chips
        # (up to MAX_ALLEGATION_CLAUSES) — draft LINE uses top MAX_ALLEGATION_DRAFT_CLAUSES.
        ranked = score_relevant_subsections(complaint_text, node.code, max_items=14)
        selected = select_for_allegation(
            ranked, max_items=MAX_ALLEGATION_CLAUSES, complaint=complaint_text
        )
        connector = preferred_connector_for(db, node.code, complaint_themes)
        draft = draft_allegation_from_source(
            node.code,
            node.title or node.code,
            intake,
            max_subs=MAX_ALLEGATION_DRAFT_CLAUSES,
            relevant=selected,
            preferred_connector=connector,
        )
        # Compare / SOD: cite-first exact-WAC line. IR Allegation/s: categorical (IR Guidance).
        cite_allegation = normalize_allegation_line(draft.text)
        ir_allegation = categorical_allegation_text(node.code, node.title or node.code)
        cites = draft.cites
        # Compare / chips follow allegation selection only — never fall back to weak leaves.
        closest = selected
        prefix = cite_prefix(node.code)
        cite_labels = list(draft.cites) or [
            f"{node.code}{s.label}" if s.label else node.code
            for s in closest[:MAX_ALLEGATION_CLAUSES]
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
            matched_texts.append(subsection_display_text(sub) if sub else "")
        excerpts = _relevant_excerpts(
            complaint_text, node, matched_subs=selected
        )
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
                        "context": subsection_ancestor_context(s),
                        "level": s.level,
                        "score": s.score,
                    }
                    for s in selected[:MAX_ALLEGATION_CLAUSES]
                ],
            }
        )

        duty_opts = [AllegationDutyOption(**o) for o in (draft.duty_options or [])]
        included_cites = [
            o.cite for o in duty_opts if o.included_by_default
        ] or (matched[:MAX_ALLEGATION_DRAFT_CLAUSES] if matched else [])

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
                allegation_draft=cite_allegation,
                finding=None,
                matched_subsections=matched or cites,
                matched_subsection_texts=matched_texts,
                match_reason=draft.match_reason,
                match_score=draft.match_score,
                low_confidence=draft.low_confidence,
                duty_options=duty_opts,
            )
        )
        allegations.append(
            InvestigationAllegation(
                case_category=bucket,
                wac_code=node.code,
                wac_title=node.title,
                allegation_text=ir_allegation,
                status=source_note,
                confidence=draft.match_score,
                matched_subsections=included_cites or matched or cites,
                match_reason=draft.match_reason,
                match_score=draft.match_score,
                low_confidence=draft.low_confidence,
                duty_options=duty_opts,
            )
        )
        conclusions.append(
            InvestigationConclusion(
                wac_code=node.code,
                allegation_text=ir_allegation,
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

    load_guidance_corpus()
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
        summary_of_findings=build_summary_of_findings(intake, allegations, investigator),
        conclusions=conclusions,
        actions="Choose an item.\nChoose an item.",
        action_determination="",
        action_referral="",
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
        areas_of_concern=list(investigator.areas_of_concern or []),
        investigation_methods=list(investigator.investigation_methods or []),
        known_facts=investigator.known_facts,
        unclear_items=investigator.unclear,
        inferences=investigator.inferences,
        recommended_subsections=investigator.recommended_subsections,
        llm_used=investigator.llm_used,
        llm_assist_used=bool(getattr(investigator, "llm_assist_used", False)),
        llm_model=investigator.llm_model,
        llm_error=investigator.llm_error,
    )
    # Sister SOD skeleton from Compare duty options (exact PDF duties).
    attach_sod_to_report(report)
    sync_report_text(report)

    selected_codes = [n.code for n in code_nodes]
    # Quote-check Compare cite-first drafts (IR categorical lines are not statute quotes).
    integrity = verify_report_quotes(
        allegations=[
            InvestigationAllegation(
                wac_code=c.code,
                wac_title=c.title,
                allegation_text=c.allegation_draft,
                matched_subsections=c.matched_subsections,
            )
            for c in report.comparisons
        ],
        regulatory_framework=report.regulatory_framework,
        evidentiary_examples=report.evidentiary_examples,
        selected_codes=selected_codes,
    )
    failed_fields = {f.field for f in integrity.failures}
    for c in report.comparisons:
        field = f"allegation:{c.code}"
        if field in failed_fields or "see also" in (c.allegation_draft or "").lower():
            c.allegation_draft = repair_allegation_text_from_store(
                c.allegation_draft, c.code
            )
    if failed_fields:
        integrity = verify_report_quotes(
            allegations=[
                InvestigationAllegation(
                    wac_code=c.code,
                    wac_title=c.title,
                    allegation_text=c.allegation_draft,
                    matched_subsections=c.matched_subsections,
                )
                for c in report.comparisons
            ],
            regulatory_framework=report.regulatory_framework,
            evidentiary_examples=report.evidentiary_examples,
            selected_codes=selected_codes,
        )
        failed_fields = {f.field for f in integrity.failures}

    report.quote_integrity = QuoteIntegrityOut(**integrity.to_dict())

    for c in report.comparisons:
        c.quote_ok = f"allegation:{c.code}" not in failed_fields
    for a in report.allegations:
        a.quote_ok = next(
            (c.quote_ok for c in report.comparisons if c.code == a.wac_code), True
        )

    report.duration_ms = (time.perf_counter() - started) * 1000
    return report
