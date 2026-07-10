"""Build Investigative Reports that follow the language of the provided DOH templates.

Pipeline:
  1. Ingest complaint → normalize Intake Details voice
  2. Match selected WACs to PDF subsections (sole source)
  3. Draft allegations from relevant subsections of each selected code
  4. Emit Regulatory Framework, Evidentiary Framework, and full IR skeleton
"""

from __future__ import annotations

import re
import time
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.rag.store import wac_store
from app.schemas import (
    AnalyzeResponse,
    ComplianceFinding,
    FacilityInfo,
    InvestigationAllegation,
    InvestigationConclusion,
    InvestigationReport,
    RegulatoryFrameworkEntry,
    RegulatorySubsection,
    WACComparison,
)
from app.services.analyzer import analyze_document
from app.services.template_corpus import _detect_themes, format_intake_narrative
from app.services.wac_scope import (
    ScopedSubsection,
    draft_allegation_from_source,
    score_relevant_subsections,
)


ALLEGATION_PREAMBLE = (
    "The allegation/s listed below is what the department has jurisdiction and "
    "authorization to investigate. An allegation is considered an assertion of "
    "improper practice or condition that could result in a violation of facility "
    "law or rule."
)

AUTHORITY_STATEMENT = (
    "The selected Washington Administrative Codes (WACs) are the primary authority "
    "and foundational standard for this investigation and for all formulated "
    "allegations. This authority stands unless concrete evidence developed during "
    "the investigation definitively contradicts or supersedes it."
)

INTAKE_HINT = "List of concerns reported in the original complaint."

DEFAULT_PROCESS = [
    "The investigator reviewed the complaint intake and supporting documentation.",
    "The investigator reviewed clinical records relevant to the allegation.",
    "The investigator reviewed facility policies and procedures.",
    "The investigator conducted interviews with facility staff.",
    "The investigator documented findings for each authorized WAC allegation.",
]


def _clean(text: str) -> str:
    text = (text or "").replace("\u00ad", "").replace("\ufffd", "'").replace("�", "'")
    return re.sub(r"[ \t]+", " ", text).strip()


def draft_allegation(
    node: Any,
    intake: str,
) -> tuple[str, list[str], list[ScopedSubsection]]:
    """Draft one allegation using ONLY PDF-derived subsections of this selected WAC."""
    return draft_allegation_from_source(
        node.code, node.title or node.code, intake, max_subs=4
    )


def _chapter_bucket(code: str) -> str:
    if code.startswith("246-341"):
        return "BHA"
    if code.startswith("246-337"):
        return "RTF"
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
        if len(windows) >= max_excerpts:
            break
    return windows[:max_excerpts]


def _finding_for(code: str, findings: list[ComplianceFinding]) -> ComplianceFinding | None:
    for f in findings:
        if code in f.wac_reference or f.wac_reference.endswith(code):
            return f
    return None


def _suggest_process(complaint: str, buckets: set[str], themes: list[str]) -> list[str]:
    del complaint
    steps = list(DEFAULT_PROCESS)
    if "confidentiality" in themes:
        steps.insert(1, "The investigator reviewed confidentiality and release-of-information policies.")
    if "assault" in themes or "abuse" in themes or "safety" in themes:
        steps.insert(1, "The investigator contacted Adult Protective Services and/or law enforcement as applicable.")
        steps.insert(2, "The investigator reviewed incident reports and safety/security documentation.")
    if "death" in themes:
        steps.insert(1, "The investigator reviewed critical incident and death reporting documentation.")
    if "BHA" in buckets and "RTF" in buckets:
        steps.append("The investigator evaluated both BHA (246-341) and RTF (246-337) licensing requirements.")
    seen: set[str] = set()
    out: list[str] = []
    for s in steps:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out[:8]


def _summary_placeholder(intake: str, allegations: list[InvestigationAllegation]) -> str:
    codes = ", ".join(a.wac_code for a in allegations[:8])
    more = f" and {len(allegations) - 8} additional codes" if len(allegations) > 8 else ""
    return (
        f"The Department received a complaint alleging: {_clean(intake)[:500]}"
        f"{'…' if len(intake) > 500 else ''}\n\n"
        f"Authorized WAC citations for this investigation include {codes}{more}. "
        f"Summary of Findings is to be completed after investigative activities are finished."
    )


def _subsection_snippet(sub: ScopedSubsection, max_len: int = 160) -> str:
    text = _clean(sub.text)
    text = re.sub(r"^(?:\([0-9a-z]+\))+\s*", "", text, flags=re.IGNORECASE)
    if len(text) > max_len:
        return text[: max_len - 1].rstrip() + "…"
    return text


def _build_regulatory_framework(
    code_nodes: list[Any],
    matched_by_code: dict[str, list[ScopedSubsection]],
) -> list[RegulatoryFrameworkEntry]:
    entries: list[RegulatoryFrameworkEntry] = []
    for node in code_nodes:
        subs = matched_by_code.get(node.code, [])
        entries.append(
            RegulatoryFrameworkEntry(
                wac_code=node.code,
                wac_title=node.title or node.code,
                chapter=node.chapter,
                matched_subsections=[
                    RegulatorySubsection(
                        label=s.label or "",
                        cite=f"{node.code}{s.label}" if s.label else node.code,
                        snippet=_subsection_snippet(s),
                        reason=s.reason,
                    )
                    for s in subs
                ],
            )
        )
    return entries


def _evidentiary_examples(
    matched_by_code: dict[str, list[ScopedSubsection]],
    code_nodes: list[Any],
    themes: list[str],
) -> list[str]:
    """Generate exactly 5 investigator-facing evidence categories tied to matched WAC language."""
    examples: list[str] = []
    seen: set[str] = set()

    # Duty-derived examples from matched subsections
    for node in code_nodes:
        for sub in matched_by_code.get(node.code, []):
            cite = f"{node.code}{sub.label}" if sub.label else node.code
            snippet = _subsection_snippet(sub, max_len=100).lower()
            # Shape evidence language from WAC duty keywords
            if any(k in snippet for k in ("document", "record", "log", "secur")):
                ex = (
                    f"Review of facility logs and clinical/service records to determine whether "
                    f"documentation was secured and maintained per WAC {cite}."
                )
            elif any(k in snippet for k in ("polic", "procedure", "govern")):
                ex = (
                    f"Review of facility policies and procedures to determine whether required "
                    f"standards were adopted and implemented per WAC {cite}."
                )
            elif any(k in snippet for k in ("train", "orient", "compet", "staff", "supervis")):
                ex = (
                    f"Review of staffing, orientation, and training records to determine whether "
                    f"personnel met competency requirements per WAC {cite}."
                )
            elif any(k in snippet for k in ("confidential", "privacy", "disclosure", "consent", "release")):
                ex = (
                    f"Review of release-of-information authorizations and disclosure logs to "
                    f"determine whether confidentiality requirements were met per WAC {cite}."
                )
            elif any(k in snippet for k in ("safety", "secur", "incident", "abuse", "assault")):
                ex = (
                    f"Review of incident reports and safety/security documentation to determine "
                    f"whether protective measures were implemented per WAC {cite}."
                )
            elif any(k in snippet for k in ("right", "grievance", "complaint")):
                ex = (
                    f"Review of individual rights notices and grievance documentation to determine "
                    f"whether required protections were afforded per WAC {cite}."
                )
            else:
                ex = (
                    f"Obtain and review documentary evidence to prove or disprove compliance with "
                    f"the duty described in WAC {cite}: {_subsection_snippet(sub, 90)}."
                )
            key = ex.lower()
            if key not in seen:
                seen.add(key)
                examples.append(ex)
            if len(examples) >= 5:
                return examples[:5]

    # Theme-aware / generic fillers still citing selected codes
    primary = code_nodes[0].code if code_nodes else "246-341"
    fillers = [
        f"Interview facility staff with knowledge of the reported events to corroborate or refute "
        f"compliance with WAC {primary}.",
        f"Review clinical and administrative records relevant to the allegation for evidence "
        f"supporting or contradicting duties under the selected WACs.",
        f"Compare facility practices against the written policies required by the matched WAC "
        f"subsections to identify gaps.",
        f"Obtain training and competency records for staff involved in the reported incident "
        f"relative to WAC {primary}.",
        f"Document investigator observations and timeline reconstruction to evaluate whether "
        f"regulatory duties under the selected WACs were met.",
    ]
    if "confidentiality" in themes:
        fillers.insert(
            0,
            f"Review confidentiality, ROI, and PHI disclosure documentation against WAC {primary} "
            f"requirements.",
        )
    if "assault" in themes or "safety" in themes:
        fillers.insert(
            0,
            f"Review APS/law-enforcement referrals and incident response records for alignment with "
            f"WAC {primary} safety obligations.",
        )

    for ex in fillers:
        if len(examples) >= 5:
            break
        key = ex.lower()
        if key not in seen:
            seen.add(key)
            examples.append(ex)

    while len(examples) < 5:
        examples.append(
            f"Collect additional documentary and testimonial evidence to prove or disprove the "
            f"formulated allegations under the selected WACs ({primary})."
        )
    return examples[:5]


def build_report_text(report: InvestigationReport) -> str:
    """Emit report text matching the Example 1–5 Investigative Report skeleton."""
    fi = report.facility_info
    lines = [
        "Investigative Report",
        "State Investigation",
        f"Date(s) of Investigation: {fi.investigation_dates or report.investigation_date or 'XX/XX/XX'}",
    ]
    if report.case_id:
        lines.append(f"Case Number: {report.case_id}")
    if fi.facility_address:
        lines.append(f"Subject / Facility: {fi.facility_address}")
    if fi.credential_number:
        lines.append(f"Credential Number: {fi.credential_number}")

    lines.extend(
        [
            f"Intake Details: ({INTAKE_HINT})",
            report.intake_details,
            "",
            "Regulatory Framework:",
            report.authority_statement or AUTHORITY_STATEMENT,
            "",
        ]
    )

    for entry in report.regulatory_framework:
        lines.append(f"WAC {entry.wac_code} — {entry.wac_title}")
        if entry.matched_subsections:
            for sub in entry.matched_subsections:
                label = sub.label or "(section)"
                lines.append(f"  {label}: {sub.snippet}")
        else:
            lines.append("  (No specific subsection isolated; code-level review authorized.)")
        lines.append("")

    lines.append(f"Allegation/s: ({ALLEGATION_PREAMBLE})")

    grouped: dict[str, list[InvestigationAllegation]] = {}
    for a in report.allegations:
        grouped.setdefault(a.case_category or "General", []).append(a)

    order = [k for k in ("BHA", "RTF", "Other", "General") if k in grouped]
    for k in grouped:
        if k not in order:
            order.append(k)

    multi = len([k for k in order if k in ("BHA", "RTF")]) > 1
    for category in order:
        items = grouped[category]
        if multi and category in ("BHA", "RTF"):
            if report.case_id:
                lines.append(f"{report.case_id} {category}")
            else:
                lines.append(f"{category}:")
        for a in items:
            text = a.allegation_text.strip()
            if text.lower().startswith("allegation:"):
                lines.append(text)
            else:
                lines.append(f"Allegation: {text}")
            if a.matched_subsections:
                lines.append(f"  Matched subsections: {', '.join(a.matched_subsections)}")
            lines.append("")

    lines.append("Investigative Process Included: (Methods employed to conduct inquiry.)")
    for step in report.investigative_process:
        lines.append(f"- {step}" if not step.startswith("-") else step)

    lines.extend(["", "Evidentiary Framework (5 Examples):"])
    for i, ex in enumerate(report.evidentiary_examples, start=1):
        lines.append(f"{i}. {ex}")

    lines.extend(
        [
            "",
            "Summary of Findings (Narrative overview of the results of investigation.)",
            report.summary_of_findings,
            "",
            "Conclusion / Results of Investigation:",
        ]
    )

    conclusions_by_code = {c.wac_code: c for c in report.conclusions}
    for category in order:
        items = grouped[category]
        if multi and category in ("BHA", "RTF"):
            lines.append(f"{category}:")
        for a in items:
            c = conclusions_by_code.get(a.wac_code)
            result = c.result if c else "Pending Investigation"
            extra = ""
            if c and c.deficiency_cited and c.deficiency_details:
                extra = f" {c.deficiency_details}"
            lines.append(f"Allegation: {a.allegation_text} {result}.{extra}")
            lines.append("")

    lines.extend(["Actions:", report.actions or "[To be determined after investigation]"])
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
) -> InvestigationReport:
    if not complaint_text.strip():
        raise ValueError("Complaint / allegation text is required")
    if not selected_wacs:
        raise ValueError("Select at least one authorized WAC")

    started = time.perf_counter()

    analysis: AnalyzeResponse = analyze_document(
        db=db,
        text=complaint_text,
        selected_wacs=selected_wacs,
        user_id=user_id,
        document_name=document_name or "investigation",
        include_informational=include_informational,
    )

    selected_nodes = wac_store.resolve_selection(selected_wacs)
    code_nodes = [n for n in selected_nodes if n.level == "code"]
    if not code_nodes:
        parents: dict[str, Any] = {}
        for n in selected_nodes:
            parent = wac_store.code_index.get(n.code)
            if parent:
                parents[parent.id] = parent
        code_nodes = list(parents.values())

    code_nodes.sort(key=lambda n: (0 if n.chapter == "246-341" else 1, n.code))

    intake = format_intake_narrative(complaint_text)
    themes = _detect_themes(intake)
    inv_date = investigation_date or date.today().strftime("%m/%d/%Y")

    comparisons: list[WACComparison] = []
    allegations: list[InvestigationAllegation] = []
    conclusions: list[InvestigationConclusion] = []
    buckets: set[str] = set()
    matched_by_code: dict[str, list[ScopedSubsection]] = {}
    recommended: list[str] = []

    for node in code_nodes:
        finding = _finding_for(node.code, analysis.findings)
        excerpts = _relevant_excerpts(complaint_text, node)
        allegation_text, cites, relevant = draft_allegation(node, intake)
        matched_by_code[node.code] = relevant
        for c in cites:
            if c not in recommended:
                recommended.append(c)

        bucket = _chapter_bucket(node.code)
        buckets.add(bucket)

        comparisons.append(
            WACComparison(
                wac_id=node.id,
                code=node.code,
                title=node.title or node.code,
                chapter=node.chapter,
                hierarchy_path=node.hierarchy_path,
                wac_text=node.text or "",
                wac_summary=_clean((node.text or "")[:400]),
                complaint_excerpts=excerpts,
                allegation_draft=allegation_text,
                matched_subsections=cites,
                finding=finding,
            )
        )
        allegations.append(
            InvestigationAllegation(
                case_category=bucket,
                wac_code=node.code,
                wac_title=node.title or node.code,
                allegation_text=allegation_text,
                status=finding.status if finding else None,
                confidence=finding.confidence if finding else None,
                matched_subsections=cites,
            )
        )
        conclusions.append(
            InvestigationConclusion(
                wac_code=node.code,
                allegation_text=allegation_text,
                result="Pending Investigation",
            )
        )

    process = _suggest_process(complaint_text, buckets, themes)
    framework = _build_regulatory_framework(code_nodes, matched_by_code)
    evidence = _evidentiary_examples(matched_by_code, code_nodes, themes)

    facility = FacilityInfo(
        facility_address=facility_address or "Washington State",
        credential_number=credential_number or "",
        investigation_dates=inv_date,
    )

    report = InvestigationReport(
        investigation_date=inv_date,
        case_id=case_id,
        facility_info=facility,
        intake_details=intake,
        allegation_preamble=ALLEGATION_PREAMBLE,
        authority_statement=AUTHORITY_STATEMENT,
        regulatory_framework=framework,
        allegations=allegations,
        investigative_process=process,
        evidentiary_examples=evidence,
        summary_of_findings=_summary_placeholder(intake, allegations),
        conclusions=conclusions,
        actions="[To be determined after investigation]",
        comparisons=comparisons,
        findings=analysis.findings,
        report_text="",
        selected_count=len(code_nodes),
        duration_ms=0.0,
        analysis_id=analysis.analysis_id,
        document_preview=analysis.document_preview,
        recommended_subsections=recommended,
    )
    report.report_text = build_report_text(report)
    report.duration_ms = round((time.perf_counter() - started) * 1000, 2)
    return report
