"""Harvest completed IR writing style into a DB bank that improves future drafts.

Triggers: export (DOCX/pack) and submission (in_review / final).
Statute duty quotes remain PDF-only; learned rows guide connectors, themes,
intake voice, preamble votes, and process-line patterns.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from sqlalchemy.orm import Session

from app.database import IrLearningSnippet, InvestigationCase, User, utcnow
from app.schemas import InvestigationReport
from app.services.pii_gate import redact_text
from app.services.template_corpus import (
    AllegationTemplate,
    DOH_ALLEGATION_PREAMBLE,
    _detect_themes,
    _has_subsection_cites,
    _parse_allegation,
)

logger = logging.getLogger(__name__)

PLACEHOLDER_RE = re.compile(
    r"^\[|^to be (determined|completed)|^pending\b|^n/?a\b",
    re.IGNORECASE,
)
INTAKE_OPENER_RE = re.compile(
    r"^(The Department of Health \(DOH\) received|DOH received|The department received|"
    r"It was alleged|Respondent is alleged)",
    re.IGNORECASE,
)

CONNECTORS = (
    "having failed to",
    "failing to",
    "not",
    "violating",
)


def _hash_text(*parts: str) -> str:
    raw = "\n".join((p or "").strip().lower() for p in parts)
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:40]


def _redact(text: str) -> str:
    if not (text or "").strip():
        return ""
    try:
        return (redact_text(text).get("redacted_text") or text).strip()
    except Exception:
        logger.exception("PII redact failed during IR learning harvest")
        return text.strip()


def _is_placeholder(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 12:
        return True
    return bool(PLACEHOLDER_RE.search(t))


def _upsert_snippet(
    db: Session,
    *,
    section_type: str,
    wac_code: str,
    text_excerpt: str,
    themes: list[str],
    connector: str = "",
    uses_a_prefix: bool = False,
    has_subsection_cites: bool = False,
    case: InvestigationCase | None,
    user: User | None,
    trigger: str,
    snapshot_id: int | None = None,
) -> IrLearningSnippet | None:
    excerpt = _redact(text_excerpt)
    if not excerpt or _is_placeholder(excerpt):
        return None
    # Cap stored prose — style bank, not full case archive
    if len(excerpt) > 1800:
        excerpt = excerpt[:1800].rstrip() + "…"
    code = (wac_code or "").replace("WAC ", "").replace("RCW ", "").strip()
    content_hash = _hash_text(section_type, code, excerpt)
    existing = (
        db.query(IrLearningSnippet)
        .filter(
            IrLearningSnippet.section_type == section_type,
            IrLearningSnippet.wac_code == code,
            IrLearningSnippet.content_hash == content_hash,
        )
        .first()
    )
    if existing:
        existing.weight = int(existing.weight or 1) + 1
        existing.trigger_event = trigger[:64]
        existing.source_case_id = case.id if case else existing.source_case_id
        existing.source_snapshot_id = snapshot_id or existing.source_snapshot_id
        existing.harvested_by = user.id if user else existing.harvested_by
        existing.updated_at = utcnow()
        if connector:
            existing.connector = connector[:64]
        if themes:
            existing.themes_json = json.dumps(themes)
        db.add(existing)
        return existing

    row = IrLearningSnippet(
        source_case_id=case.id if case else None,
        source_snapshot_id=snapshot_id,
        harvested_by=user.id if user else None,
        trigger_event=trigger[:64],
        section_type=section_type[:64],
        wac_code=code[:64],
        themes_json=json.dumps(themes or ["general"]),
        connector=(connector or "")[:64],
        text_excerpt=excerpt,
        uses_a_prefix=bool(uses_a_prefix),
        has_subsection_cites=bool(has_subsection_cites),
        content_hash=content_hash,
        weight=1,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(row)
    return row


def harvest_completed_ir(
    db: Session,
    case: InvestigationCase,
    report: InvestigationReport,
    user: User | None,
    *,
    trigger: str,
    snapshot_id: int | None = None,
) -> dict[str, Any]:
    """Persist writing-style signals from a completed/exported IR into the learning bank."""
    saved = 0
    complaint_themes = _detect_themes(
        f"{report.intake_details or ''} {case.complaint_text or ''}"
    )

    preamble = (report.allegation_preamble or "").strip()
    if preamble and preamble != DOH_ALLEGATION_PREAMBLE:
        if _upsert_snippet(
            db,
            section_type="preamble",
            wac_code="",
            text_excerpt=preamble,
            themes=complaint_themes,
            case=case,
            user=user,
            trigger=trigger,
            snapshot_id=snapshot_id,
        ):
            saved += 1

    intake = (report.intake_details or "").strip()
    if intake and not _is_placeholder(intake):
        first = re.split(r"(?<=[.!?])\s+", intake, maxsplit=1)[0].strip()
        if INTAKE_OPENER_RE.search(first) or len(first) >= 40:
            if _upsert_snippet(
                db,
                section_type="intake_voice",
                wac_code="",
                text_excerpt=first if len(first) <= 400 else first[:400],
                themes=complaint_themes,
                case=case,
                user=user,
                trigger=trigger,
                snapshot_id=snapshot_id,
            ):
                saved += 1

    for step in report.investigative_process or []:
        if _upsert_snippet(
            db,
            section_type="process_line",
            wac_code="",
            text_excerpt=step,
            themes=complaint_themes,
            case=case,
            user=user,
            trigger=trigger,
            snapshot_id=snapshot_id,
        ):
            saved += 1

    summary = (report.summary_of_findings or "").strip()
    if summary and not _is_placeholder(summary):
        opener = re.split(r"(?<=[.!?])\s+", summary, maxsplit=1)[0].strip()
        if len(opener) >= 40:
            if _upsert_snippet(
                db,
                section_type="summary_opener",
                wac_code="",
                text_excerpt=opener[:500],
                themes=complaint_themes,
                case=case,
                user=user,
                trigger=trigger,
                snapshot_id=snapshot_id,
            ):
                saved += 1

    for allegation in report.allegations or []:
        raw = (allegation.allegation_text or "").strip()
        if not raw:
            continue
        code = (allegation.wac_code or "").replace("WAC ", "").replace("RCW ", "").strip()
        themes = list(
            dict.fromkeys(
                [
                    *complaint_themes,
                    *_detect_themes(raw),
                    *_detect_themes(allegation.wac_title or ""),
                ]
            )
        )
        parsed = _parse_allegation(raw, f"case-{case.id}", themes)
        connector = (parsed.connector if parsed else "") or ""
        if not connector:
            lower = raw.lower()
            for c in CONNECTORS:
                if f" by {c} " in lower or f", by {c} " in lower:
                    connector = c
                    break
        uses_a = bool(parsed.uses_a_prefix) if parsed else raw.lower().startswith("a potential")
        cites = bool(parsed.has_subsection_cites) if parsed else _has_subsection_cites(raw)
        failure = (parsed.failure_clause if parsed else raw)[:900]

        if _upsert_snippet(
            db,
            section_type="allegation_shape",
            wac_code=code,
            text_excerpt=failure,
            themes=themes,
            connector=connector,
            uses_a_prefix=uses_a,
            has_subsection_cites=cites,
            case=case,
            user=user,
            trigger=trigger,
            snapshot_id=snapshot_id,
        ):
            saved += 1

        # Full investigator-adjusted allegation line (redacted) for WAC language evolution.
        if _upsert_snippet(
            db,
            section_type="wac_language",
            wac_code=code,
            text_excerpt=raw,
            themes=themes,
            connector=connector,
            uses_a_prefix=uses_a,
            has_subsection_cites=cites,
            case=case,
            user=user,
            trigger=trigger,
            snapshot_id=snapshot_id,
        ):
            saved += 1

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to commit IR learning harvest for case %s", case.id)
        return {"saved": 0, "trigger": trigger, "error": "commit_failed"}

    logger.info(
        "IR learning harvest case=%s trigger=%s snippets=%s",
        case.id,
        trigger,
        saved,
    )
    return {"saved": saved, "trigger": trigger, "case_id": case.id}


def learned_templates_for_code(db: Session, code: str) -> list[AllegationTemplate]:
    code = (code or "").replace("WAC ", "").replace("RCW ", "").strip()
    rows = (
        db.query(IrLearningSnippet)
        .filter(
            IrLearningSnippet.section_type.in_(["allegation_shape", "wac_language"]),
            IrLearningSnippet.wac_code == code,
        )
        .order_by(IrLearningSnippet.weight.desc(), IrLearningSnippet.updated_at.desc())
        .limit(40)
        .all()
    )
    out: list[AllegationTemplate] = []
    for row in rows:
        try:
            themes = json.loads(row.themes_json or "[]")
        except json.JSONDecodeError:
            themes = ["general"]
        excerpt = row.text_excerpt or ""
        full = excerpt if excerpt.lower().startswith("potential") or excerpt.lower().startswith("a potential") else (
            f"Potential violation of WAC {code}, by {row.connector or 'having failed to'} {excerpt}"
        )
        if not full.endswith("."):
            full += "."
        out.append(
            AllegationTemplate(
                wac_code=code,
                title_in_template="",
                connector=row.connector or "having failed to",
                failure_clause=excerpt,
                full_text=full,
                source_file=f"learned:case-{row.source_case_id or 0}",
                themes=themes if isinstance(themes, list) else ["general"],
                uses_a_prefix=bool(row.uses_a_prefix),
                has_subsection_cites=bool(row.has_subsection_cites),
            )
        )
    return out


def preferred_connector_for(
    db: Session,
    code: str,
    complaint_themes: list[str] | None = None,
) -> str:
    """Weighted vote for allegation connector from harvested WAC language."""
    code = (code or "").replace("WAC ", "").replace("RCW ", "").strip()
    rows = (
        db.query(IrLearningSnippet)
        .filter(
            IrLearningSnippet.section_type.in_(["allegation_shape", "wac_language"]),
            IrLearningSnippet.wac_code == code,
            IrLearningSnippet.connector != "",
        )
        .all()
    )
    if not rows:
        return "having failed to"

    theme_set = set(complaint_themes or [])
    # Prior toward Baseline / DOH default so a single harvest does not flip style.
    scores: dict[str, float] = {"having failed to": 2.0}
    for row in rows:
        conn = (row.connector or "").lower().strip()
        if conn not in CONNECTORS:
            continue
        try:
            themes = set(json.loads(row.themes_json or "[]"))
        except json.JSONDecodeError:
            themes = set()
        overlap = len(theme_set & themes) if theme_set else 0
        scores[conn] = scores.get(conn, 0.0) + float(row.weight or 1) * (1.0 + 0.35 * overlap)

    return max(scores, key=scores.get)


def learned_process_lines(db: Session, *, limit: int = 8) -> list[str]:
    rows = (
        db.query(IrLearningSnippet)
        .filter(IrLearningSnippet.section_type == "process_line")
        .order_by(IrLearningSnippet.weight.desc(), IrLearningSnippet.updated_at.desc())
        .limit(limit * 3)
        .all()
    )
    seen: set[str] = set()
    out: list[str] = []
    for row in rows:
        line = (row.text_excerpt or "").strip()
        if _is_placeholder(line):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
        if len(out) >= limit:
            break
    return out


def learned_preamble(db: Session) -> str | None:
    rows = (
        db.query(IrLearningSnippet)
        .filter(IrLearningSnippet.section_type == "preamble")
        .order_by(IrLearningSnippet.weight.desc())
        .limit(5)
        .all()
    )
    if not rows:
        return None
    # Prefer highest weight that is still DOH-shaped
    best = max(rows, key=lambda r: int(r.weight or 1))
    text = (best.text_excerpt or "").strip()
    if "jurisdiction" in text.lower() and "allegation" in text.lower():
        return text
    return None


def corpus_stats(db: Session) -> dict[str, Any]:
    rows = db.query(IrLearningSnippet).all()
    by_section: dict[str, int] = {}
    by_code: dict[str, int] = {}
    for row in rows:
        by_section[row.section_type] = by_section.get(row.section_type, 0) + 1
        if row.wac_code:
            by_code[row.wac_code] = by_code.get(row.wac_code, 0) + 1
    return {
        "snippet_count": len(rows),
        "by_section": by_section,
        "codes_covered": sorted(by_code.keys()),
        "by_code_counts": dict(sorted(by_code.items())),
        "total_weight": sum(int(r.weight or 1) for r in rows),
    }
