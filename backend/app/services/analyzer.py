"""Legacy local compliance analyzer — NOT part of the WACMAKR IR product path.

Deprecated for investigation reports. Intake → Compare → Report uses
`investigation.build_investigation_report` + `wac_scope` sole-source drafting.
Kept only for historical/reference callers; do not wire new IR features here.
"""

from __future__ import annotations

import re
import time
from typing import Any

from sqlalchemy.orm import Session

from app.database import AnalysisRun, CustomTriggerPhrase, UsageStat, utcnow
from app.rag.store import wac_store
from app.schemas import AnalyzeResponse, ComplianceFinding
from app.services.wac_scope import score_relevant_subsections


STATUS_COMPLIES = "COMPLIES"
STATUS_NON = "NON-COMPLIANT"
STATUS_PARTIAL = "PARTIAL"
STATUS_INFO = "INFORMATIONAL"
STATUS_INSUFFICIENT = "INSUFFICIENT"

VIOLATION_CUES = [
    r"\bfailed to\b",
    r"\bdid not\b",
    r"\bviolation\b",
    r"\bnon[- ]compliant\b",
    r"\ballegation\b",
    r"\bdeficient\b",
    r"\black of\b",
    r"\bwithout\b",
    r"\bnot provid",
    r"\bnot ensur",
    r"\bnot maintain",
    r"\bnot develop",
    r"\bnot implement",
    r"\bnot establish",
    r"\bnot protect",
    r"\bnot review",
    r"\bnot adopt",
    r"\bnot complete",
    r"\bnot address",
    r"\bnot limit",
    r"\bnot refer",
]
COMPLIANCE_CUES = [
    r"\bcomplies\b",
    r"\bin compliance\b",
    r"\bmet the requirement",
    r"\bdocumented\b",
    r"\bmaintained\b",
    r"\bimplemented\b",
    r"\bensured\b",
    r"\bpolicy in place\b",
    r"\bno deficiency\b",
    r"\bno violation\b",
]


def _extract_mentioned_codes(text: str) -> set[str]:
    codes = set(re.findall(r"246-(?:341|337)-\d{3,4}", text))
    return codes


def _sentence_windows(text: str, code: str) -> list[str]:
    """Return paragraphs/sentences tightly scoped to the given code citation."""
    windows: list[str] = []
    # Split on blank lines and allegation markers common in investigative reports
    chunks = re.split(r"\n{2,}|(?=Allegation\s*:)", text, flags=re.IGNORECASE)
    code_patterns = [
        re.compile(rf"WAC\s+{re.escape(code)}\b", re.IGNORECASE),
        re.compile(rf"\b{re.escape(code)}\b"),
    ]
    for chunk in chunks:
        chunk = chunk.strip()
        if chunk and any(p.search(chunk) for p in code_patterns):
            windows.append(chunk)

    if windows:
        return windows

    # Fallback: sentence-level windows containing the code
    sentences = re.split(r"(?<=[.!?])\s+", text)
    for i, sent in enumerate(sentences):
        if any(p.search(sent) for p in code_patterns):
            neighbors = " ".join(sentences[max(0, i - 1) : i + 2]).strip()
            windows.append(neighbors)
    return windows


def _focused_context(text: str, code: str) -> str:
    windows = _sentence_windows(text, code)
    if not windows:
        return ""
    focused = []
    for w in windows:
        if re.search(rf"\b{re.escape(code)}\b", w):
            focused.append(w)
    return "\n".join(focused[:4]).strip()


def _score_status(context: str, hits: list[str], node_title: str) -> tuple[str, float, str]:
    ctx = context.lower()
    viol = sum(1 for p in VIOLATION_CUES if re.search(p, ctx))
    comp = sum(1 for p in COMPLIANCE_CUES if re.search(p, ctx))
    has_code_mention = bool(re.search(r"246-(?:341|337)-\d{3,4}", context))
    hit_boost = min(len(hits) * 0.08, 0.4)

    if not context.strip() or (not has_code_mention and not hits):
        return STATUS_INSUFFICIENT, 0.35 + hit_boost * 0.2, "Insufficient linked documentation."

    if viol > comp and (has_code_mention or hits):
        conf = min(0.55 + viol * 0.08 + hit_boost, 0.97)
        action = _derive_corrective_action(context, node_title)
        return STATUS_NON, conf, action

    if comp > viol and hits:
        conf = min(0.55 + comp * 0.08 + hit_boost, 0.95)
        return STATUS_COMPLIES, conf, "Continue current practices."

    if has_code_mention and viol == 0 and comp == 0:
        if len(context) < 120:
            return STATUS_INSUFFICIENT, 0.45, "Expand documentation around this citation."
        return STATUS_INFO, 0.55 + hit_boost * 0.5, "Monitor for future compliance needs."

    if viol and comp:
        conf = min(0.5 + hit_boost + 0.1, 0.9)
        return STATUS_PARTIAL, conf, "Address specific gaps identified in non-compliant subsections."

    if hits and viol:
        return STATUS_NON, min(0.6 + hit_boost, 0.92), _derive_corrective_action(context, node_title)

    if hits:
        return STATUS_INFO, 0.5 + hit_boost, "Monitor for future compliance needs."

    return STATUS_INSUFFICIENT, 0.4, "Provide additional evidence for this WAC."


def _derive_corrective_action(context: str, title: str) -> str:
    # Prefer text after the first WAC code token (do not swallow the failure clause)
    cite = re.search(r"WAC\s+246-(?:341|337)-\d{3,4}", context, re.IGNORECASE)
    scoped = context[cite.end() :] if cite else context
    patterns = [
        r"by having failed to\s+([^.]{15,220})",
        r"failed to\s+([^.]{15,220})",
    ]
    for pattern in patterns:
        m = re.search(pattern, scoped, re.IGNORECASE)
        if m:
            gap = re.sub(r"\s+", " ", m.group(1)).strip().rstrip(";")
            return f"Correct the identified gap: ensure the facility {gap}."
    # Fallback: search whole context
    for pattern in patterns:
        m = re.search(pattern, context, re.IGNORECASE)
        if m:
            gap = re.sub(r"\s+", " ", m.group(1)).strip().rstrip(";")
            return f"Correct the identified gap: ensure the facility {gap}."
    return (
        f"Review and update policies, procedures, and documentation to fully meet "
        f"requirements for {title}."
    )


def _format_finding(
    status: str,
    reference: str,
    title: str,
    confidence: float,
    matched: list[str],
    corrective: str | None = None,
    compliant_subs: list[str] | None = None,
    non_subs: list[str] | None = None,
    additional: str | None = None,
    recommendation: str | None = None,
) -> str:
    conf = f"{int(round(confidence * 100))}%"
    matched_str = ", ".join(matched[:8]) if matched else "None"
    if status == STATUS_COMPLIES:
        return (
            f"WAC Reference: [{reference}] – [{title}]. The submitted documentation COMPLIES "
            f"with all requirements. Action: Continue current practices. Confidence: [{conf}] "
            f"Matched Phrases: [{matched_str}]"
        )
    if status == STATUS_NON:
        return (
            f"WAC Reference: [{reference}] – [{title}]. NON-COMPLIANT with regulatory requirements. "
            f"Required Corrective Action: [{corrective or 'Review and remediate deficiencies.'}]. "
            f"Confidence: [{conf}] Matched Phrases: [{matched_str}]"
        )
    if status == STATUS_PARTIAL:
        return (
            f"WAC Reference: [{reference}] – [{title}]. PARTIAL COMPLIANCE across subsections. "
            f"Compliant: {', '.join(compliant_subs or []) or 'None'}. "
            f"Non-Compliant: {', '.join(non_subs or []) or 'None'}. "
            f"Action Required: [{corrective or 'Address specific gaps.'}]. Confidence: [{conf}]"
        )
    if status == STATUS_INFO:
        return (
            f"WAC Reference: [{reference}] – [{title}]. INFORMATIONAL - Relevant for future consideration. "
            f"Applicable Subsections: [{recommendation or 'See selected code'}]. "
            f"Recommendation: Monitor for future compliance needs. Confidence: [{conf}]"
        )
    return (
        f"WAC Reference: [{reference}] – [{title}]. REQUIRES ADDITIONAL REVIEW - Insufficient "
        f"documentation for complete analysis. Additional Information Needed: "
        f"[{additional or 'Provide policies, procedures, and evidence tied to this WAC.'}]. "
        f"Confidence: [{conf}]"
    )


def _bump_stat(db: Session, wac_id: str, stat_type: str, amount: int = 1) -> None:
    row = (
        db.query(UsageStat)
        .filter(UsageStat.wac_id == wac_id, UsageStat.stat_type == stat_type)
        .first()
    )
    if not row:
        row = UsageStat(wac_id=wac_id, stat_type=stat_type, count=0)
        db.add(row)
    row.count = (row.count or 0) + amount
    row.last_used = utcnow()


def analyze_document(
    db: Session,
    text: str,
    selected_wacs: list[str],
    user_id: int | None = None,
    document_name: str | None = None,
    include_informational: bool = True,
) -> AnalyzeResponse:
    started = time.perf_counter()
    if not wac_store.ready:
        raise RuntimeError("WAC store not loaded")

    selected_nodes = wac_store.resolve_selection(selected_wacs)
    if not selected_nodes:
        raise ValueError("Select at least one authorized WAC before analysis.")

    # Custom phrases for user
    custom_map: dict[str, list[str]] = {}
    if user_id:
        customs = db.query(CustomTriggerPhrase).filter(CustomTriggerPhrase.user_id == user_id).all()
        for c in customs:
            custom_map.setdefault(c.wac_id, []).append(c.phrase)

    mentioned = _extract_mentioned_codes(text)
    selected_codes = {n.code for n in selected_nodes if n.level == "code"}
    # Also include code from subsection selections
    for n in selected_nodes:
        selected_codes.add(n.code)

    findings: list[ComplianceFinding] = []

    # Analyze each selected CODE-level WAC for precision
    code_nodes = [n for n in selected_nodes if n.level == "code"]
    if not code_nodes:
        # Promote subsection parents
        parents = {}
        for n in selected_nodes:
            parent = wac_store.code_index.get(n.code)
            if parent:
                parents[parent.id] = parent
        code_nodes = list(parents.values())

    for node in code_nodes:
        _bump_stat(db, node.id, "selected")
        context = _focused_context(text, node.code)

        extras = custom_map.get(node.id, []) + custom_map.get(f"WAC {node.code}", [])
        # Gather phrases from code against focused context (PDF-derived trigger phrases)
        search_blob = context if context else (text[:2000] if node.code in mentioned else "")
        all_hits = wac_store.phrase_hits(search_blob or text[:2000], node, extras)
        child_hits: dict[str, list[str]] = {}
        compliant_subs: list[str] = []
        non_subs: list[str] = []

        # Applicable subsections: SOLELY from PDF hierarchy under this selected code
        applicable = score_relevant_subsections(text, node.code, max_items=8)
        for sub in applicable:
            label = sub.label or ""
            if not label:
                continue
            # Score status using complaint context vs this subsection's PDF text
            sub_blob = context or search_blob or text[:2000]
            c_hits = wac_store.phrase_hits(sub_blob, node, extras)
            # Prefer phrase hits that appear in the subsection text
            sub_text_l = sub.text.lower()
            scoped_hits = [h for h in c_hits if h.lower() in sub_text_l] or c_hits
            if scoped_hits:
                child_hits[label] = scoped_hits
                all_hits.extend(scoped_hits)
            st, _, _ = _score_status(sub_blob, scoped_hits, sub.title or node.title)
            if st == STATUS_COMPLIES:
                compliant_subs.append(label)
            elif st in {STATUS_NON, STATUS_PARTIAL, STATUS_INSUFFICIENT}:
                # Mark as implicated / potentially non-compliant for investigator review
                if label not in non_subs:
                    non_subs.append(label)
            else:
                if label not in non_subs and sub.reason == "explicit_cite":
                    non_subs.append(label)

        # Also walk primary children for phrase coverage (still PDF-derived nodes only)
        for child in wac_store.get_children(node.id):
            if child.level != "primary":
                continue
            c_extras = custom_map.get(child.id, [])
            c_hits = wac_store.phrase_hits(context or search_blob, child, c_extras)
            if c_hits:
                key = child.primary or child.id
                child_hits[str(key)] = c_hits
                all_hits.extend(c_hits)
        # Dedupe hits
        seen = set()
        unique_hits = []
        for h in all_hits:
            k = h.lower()
            if k not in seen:
                seen.add(k)
                unique_hits.append(h)

        status, confidence, action = _score_status(context or text[:500], unique_hits, node.title)

        # If code not mentioned and no strong hits, informational or insufficient
        if node.code not in mentioned and not unique_hits:
            if not include_informational:
                continue
            status = STATUS_INSUFFICIENT
            confidence = min(confidence, 0.42)
        elif node.code not in mentioned and unique_hits and status == STATUS_INSUFFICIENT:
            status = STATUS_INFO

        if status == STATUS_PARTIAL or (compliant_subs and non_subs):
            status = STATUS_PARTIAL
            if not compliant_subs and not non_subs:
                # synthesize from child_hits
                for label in child_hits:
                    non_subs.append(f"({label})" if not str(label).startswith("(") else str(label))

        reference = node.id.replace("WAC ", "") if node.id.startswith("WAC ") else node.hierarchy_path
        # Prefer full WAC style reference
        reference = node.hierarchy_path.replace("WAC ", "") if node.hierarchy_path.startswith("WAC ") else node.hierarchy_path

        additional = None
        recommendation = None
        corrective = action if status in {STATUS_NON, STATUS_PARTIAL} else None
        if status == STATUS_INSUFFICIENT:
            additional = (
                f"Evidence of policies/procedures, staffing, documentation, and practices related to "
                f"'{node.title}'."
            )
        if status == STATUS_INFO:
            recommendation = ", ".join(sorted({f"({c.primary})" for c in wac_store.get_children(node.id) if c.primary})[:6]) or "N/A"

        formatted = _format_finding(
            status=status,
            reference=reference if reference.startswith("246-") else reference,
            title=node.title,
            confidence=confidence,
            matched=unique_hits,
            corrective=corrective,
            compliant_subs=compliant_subs,
            non_subs=non_subs,
            additional=additional,
            recommendation=recommendation,
        )

        if status in {STATUS_NON, STATUS_PARTIAL, STATUS_COMPLIES}:
            _bump_stat(db, node.id, "matched")
        _bump_stat(db, node.id, "analyzed")

        findings.append(
            ComplianceFinding(
                wac_reference=reference,
                title=node.title,
                status=status,
                template={
                    STATUS_COMPLIES: "Template 1 - Full Compliance",
                    STATUS_NON: "Template 2 - Non-Compliance",
                    STATUS_PARTIAL: "Template 3 - Partial Compliance",
                    STATUS_INFO: "Template 4 - Informational Reference",
                    STATUS_INSUFFICIENT: "Template 5 - Insufficient Information",
                }[status],
                formatted_output=formatted,
                confidence=round(confidence, 4),
                matched_phrases=unique_hits[:12],
                compliant_subsections=compliant_subs,
                non_compliant_subsections=non_subs,
                corrective_action=corrective,
                additional_info_needed=additional,
                recommendation=recommendation,
                hierarchy_path=node.hierarchy_path,
                chapter=node.chapter,
            )
        )

    # Sort: NON, PARTIAL, INSUFFICIENT, COMPLIES, INFO
    order = {
        STATUS_NON: 0,
        STATUS_PARTIAL: 1,
        STATUS_INSUFFICIENT: 2,
        STATUS_COMPLIES: 3,
        STATUS_INFO: 4,
    }
    findings.sort(key=lambda f: (order.get(f.status, 9), -f.confidence, f.wac_reference))

    duration_ms = (time.perf_counter() - started) * 1000
    run = AnalysisRun(
        user_id=user_id,
        document_name=document_name,
        selected_count=len(code_nodes),
        result_count=len(findings),
        duration_ms=duration_ms,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    preview = text.strip().replace("\r\n", "\n")
    if len(preview) > 500:
        preview = preview[:500] + "…"

    return AnalyzeResponse(
        findings=findings,
        document_preview=preview,
        selected_count=len(code_nodes),
        duration_ms=round(duration_ms, 2),
        analysis_id=run.id,
    )

