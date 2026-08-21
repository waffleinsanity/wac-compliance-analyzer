from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import (
    CaseComment,
    CaseEvidence,
    CaseProcessEntry,
    CaseReportSnapshot,
    InvestigationCase,
    IrLearningSnippet,
    User,
    utcnow,
)
from app.schemas import InvestigationReport


CASE_STATUSES = {"draft", "in_review", "final", "reopened", "archived", "trashed"}
EDITABLE_STATUSES = {"draft", "reopened"}
ACTIVE_STATUSES = {"draft", "in_review", "final", "reopened"}


def parse_json_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def dumps_list(items: list[str]) -> str:
    return json.dumps(items)


def report_to_json(report: InvestigationReport | dict[str, Any]) -> str:
    if isinstance(report, InvestigationReport):
        return report.model_dump_json()
    return json.dumps(report)


def report_from_json(raw: str | None) -> InvestigationReport | None:
    if not raw:
        return None
    try:
        report = InvestigationReport.model_validate_json(raw)
    except Exception:
        return None
    if report.investigative_process:
        from app.services.evidence_review import rewrite_legacy_document_review_lines

        report.investigative_process = rewrite_legacy_document_review_lines(
            report.investigative_process
        )
    return report


def report_for_case(db: Session, case: InvestigationCase) -> InvestigationReport | None:
    """Prefer current draft JSON; if unreadable, fall back to newest snapshot."""
    report = report_from_json(case.current_report_json)
    if report is not None:
        return report
    if not (case.current_report_json or "").strip():
        return None
    snaps = (
        db.query(CaseReportSnapshot)
        .filter(CaseReportSnapshot.case_id == case.id)
        .order_by(CaseReportSnapshot.version.desc())
        .all()
    )
    for snap in snaps:
        recovered = report_from_json(snap.report_json)
        if recovered is not None:
            return recovered
    return None


def raw_has_legacy_document_review(raw: str | None) -> bool:
    """True when stored JSON still contains legacy exhibit process lines."""
    text = raw or ""
    if "Record review of exhibit" in text:
        return True
    return bool(re.search(r'"[Ee]xhibit\s+\d+\s*:', text))


def maybe_persist_legacy_document_review(
    db: Session,
    case: InvestigationCase,
    user: User,
) -> bool:
    """Rewrite legacy Document Review lines into current format and persist once.

    Display-only for locked/trashed cases. Editable drafts are written so API,
    export, and DB stay aligned after first open.
    """
    if not raw_has_legacy_document_review(case.current_report_json):
        return False
    if case.status not in EDITABLE_STATUSES:
        return False
    from app.permissions import can_edit, user_role

    if not can_edit(user_role(user)):
        return False
    report = report_from_json(case.current_report_json)
    if not report:
        return False
    persist_draft(
        db,
        case,
        report,
        user,
        note="Migrated Document Review lines to investigator-reviewed format",
        snapshot_mode="if_changed",
    )
    return True


def get_case_or_404(db: Session, case_id: int) -> InvestigationCase:
    case = db.query(InvestigationCase).filter(InvestigationCase.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def assert_case_access(case: InvestigationCase, user: User) -> None:
    """Owner or admin only. Non-owners get 404 (no case-existence oracle)."""
    from app.permissions import is_admin_role, user_role

    if is_admin_role(user_role(user)):
        return
    if case.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Case not found")


def assert_case_not_trashed(case: InvestigationCase, *, action: str = "continue") -> None:
    if case.status == "trashed":
        raise HTTPException(
            status_code=400,
            detail=f"Case is in trash. Restore it before {action}.",
        )


def assert_case_editable(case: InvestigationCase, user: User | None = None) -> None:
    from app.permissions import can_edit, user_role

    if user is not None and not can_edit(user_role(user)):
        raise HTTPException(status_code=403, detail="Signed-in investigator role required to edit cases")
    assert_case_not_trashed(case, action="editing")
    if case.status not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Case is '{case.status}' and locked for edits. Reopen to continue drafting.",
        )


PERIODIC_SAVE_NOTE = "Periodic save"
PERIODIC_SNAPSHOT_SECONDS = 5 * 60
MAX_PERIODIC_SNAPSHOTS = 20


def next_snapshot_version(db: Session, case_id: int) -> int:
    latest = (
        db.query(CaseReportSnapshot)
        .filter(CaseReportSnapshot.case_id == case_id)
        .order_by(CaseReportSnapshot.version.desc())
        .first()
    )
    return (latest.version + 1) if latest else 1


def is_periodic_note(note: str | None) -> bool:
    return (note or "").strip().lower().startswith(PERIODIC_SAVE_NOTE.lower())


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def latest_snapshot(db: Session, case_id: int) -> CaseReportSnapshot | None:
    return (
        db.query(CaseReportSnapshot)
        .filter(CaseReportSnapshot.case_id == case_id)
        .order_by(CaseReportSnapshot.version.desc())
        .first()
    )


def prune_periodic_snapshots(
    db: Session,
    case_id: int,
    keep: int = MAX_PERIODIC_SNAPSHOTS,
) -> int:
    """Drop oldest periodic recall points; keep named / manual snapshots."""
    if keep < 1:
        return 0
    rows = (
        db.query(CaseReportSnapshot)
        .filter(
            CaseReportSnapshot.case_id == case_id,
            CaseReportSnapshot.note.like(f"{PERIODIC_SAVE_NOTE}%"),
        )
        .order_by(CaseReportSnapshot.version.desc())
        .all()
    )
    extra = rows[keep:]
    ids = [row.id for row in extra if row.id is not None]
    if ids:
        db.query(IrLearningSnippet).filter(IrLearningSnippet.source_snapshot_id.in_(ids)).update(
            {IrLearningSnippet.source_snapshot_id: None},
            synchronize_session=False,
        )
    for row in extra:
        db.delete(row)
    return len(extra)


def _should_write_snapshot(
    latest: CaseReportSnapshot | None,
    payload_json: str,
    note: str,
    snapshot_mode: str,
) -> bool:
    if snapshot_mode == "never":
        return False
    if latest and latest.report_json == payload_json:
        return False
    if snapshot_mode == "always":
        return True
    # auto: named saves always snapshot when content changed; periodic saves
    # mint a recall point at most every PERIODIC_SNAPSHOT_SECONDS.
    if not is_periodic_note(note):
        return True
    if latest is None:
        return True
    created = _aware(latest.created_at)
    if created is None:
        return True
    age = (datetime.now(timezone.utc) - created).total_seconds()
    return age >= PERIODIC_SNAPSHOT_SECONDS


def persist_draft(
    db: Session,
    case: InvestigationCase,
    report: InvestigationReport | dict[str, Any],
    user: User,
    note: str = "",
    *,
    snapshot_mode: str = "always",
) -> CaseReportSnapshot | None:
    """Write current IR/SOD JSON. Optionally add a versioned recall snapshot."""
    from app.services.ir_format import sync_report_text

    if isinstance(report, dict):
        report = InvestigationReport.model_validate(report)
    sync_report_text(report)
    payload = report.model_dump()
    payload_json = json.dumps(payload)
    text = report.report_text or ""
    note = (note or "")[:512]
    latest = latest_snapshot(db, case.id)
    write_snap = _should_write_snapshot(latest, payload_json, note, snapshot_mode)
    snap: CaseReportSnapshot | None = None
    if write_snap:
        snap = CaseReportSnapshot(
            case_id=case.id,
            version=next_snapshot_version(db, case.id),
            report_json=payload_json,
            report_text=text,
            note=note,
            created_by=user.id,
        )
        db.add(snap)
        db.flush()
        if is_periodic_note(note):
            prune_periodic_snapshots(db, case.id)
    case.current_report_json = payload_json
    case.updated_at = utcnow()
    db.add(case)
    db.commit()
    if snap is not None:
        db.refresh(snap)
    db.refresh(case)
    return snap if snap is not None else latest_snapshot(db, case.id)


def save_snapshot(
    db: Session,
    case: InvestigationCase,
    report: InvestigationReport | dict[str, Any],
    user: User,
    note: str = "",
) -> CaseReportSnapshot:
    snap = persist_draft(db, case, report, user, note=note, snapshot_mode="always")
    if snap is None:
        raise HTTPException(status_code=500, detail="Draft save did not produce a recall point")
    return snap


def set_status(
    db: Session,
    case: InvestigationCase,
    status: str,
    user: User,
) -> InvestigationCase:
    if status not in CASE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    case.status = status
    case.status_changed_at = utcnow()
    case.status_changed_by = user.id
    if status == "archived":
        case.archived_at = utcnow()
        case.trashed_at = None
    elif status == "trashed":
        case.trashed_at = utcnow()
    else:
        # Restored / active statuses clear archive & trash markers
        case.archived_at = None
        case.trashed_at = None
    case.updated_at = utcnow()
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


def hard_delete_case(db: Session, case: InvestigationCase) -> None:
    """Permanently delete a case and on-disk evidence folder."""
    import shutil

    case_id = case.id
    case_path = settings.cases_dir / str(case_id)
    db.delete(case)
    db.commit()
    if case_path.exists():
        shutil.rmtree(case_path, ignore_errors=True)


def purge_trashed_cases(db: Session) -> int:
    """Hard-delete cases that have been in trash longer than retention."""
    days = getattr(settings, "case_trash_retention_days", 7) or 7
    if days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        db.query(InvestigationCase)
        .filter(
            InvestigationCase.status == "trashed",
            InvestigationCase.trashed_at.isnot(None),
            InvestigationCase.trashed_at < cutoff,
        )
        .all()
    )
    for case in rows:
        hard_delete_case(db, case)
    return len(rows)


def evidence_dir(case_id: int):
    path = settings.cases_dir / str(case_id) / "evidence"
    path.mkdir(parents=True, exist_ok=True)
    return path


def user_ir_templates_dir(user_id: int):
    path = settings.data_dir / "users" / str(user_id) / "ir_templates"
    path.mkdir(parents=True, exist_ok=True)
    return path


def case_ir_template_dir(case_id: int):
    path = settings.cases_dir / str(case_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_data_path(stored_path: str):
    """Resolve a path stored relative to data_dir (or absolute legacy paths)."""
    from pathlib import Path

    p = Path(stored_path)
    if p.is_absolute():
        return p
    return settings.data_dir / p


def process_entries_to_bullets(entries: list[CaseProcessEntry]) -> list[str]:
    bullets: list[str] = []
    for e in sorted(entries, key=lambda x: (x.sort_order, x.id)):
        label = (e.activity_type or "activity").replace("_", " ").title()
        date = e.activity_date or "Undated"
        who = e.who.strip() or "Investigator"
        summary = (e.summary or "").strip() or "(no summary)"
        bullets.append(f"{date} — {label} with {who}: {summary}")
    return bullets


_PROCESS_SECTION_LABELS = frozenset(
    {
        "pre-investigation activity",
        "investigation activity",
        "observations",
        "interviews",
        "document review",
    }
)


def _is_process_section_label(line: str) -> bool:
    return (line or "").strip().replace(":", "").lower() in _PROCESS_SECTION_LABELS


def merge_process_activity_bullets(process: list[str], bullets: list[str]) -> list[str]:
    """Append dated Case Assist bullets without replacing the DOH process shell."""
    if not bullets:
        return list(process or [])
    from app.services.ir_blank import BLANK_PROCESS_SKELETON

    src = list(process or [])
    if not src:
        src = list(BLANK_PROCESS_SKELETON)
    doc_idx = next(
        (i for i, p in enumerate(src) if (p or "").strip().replace(":", "").lower() == "document review"),
        -1,
    )
    if doc_idx < 0:
        return [*src, "Investigation activity log:", *bullets]
    insert_at = doc_idx + 1
    while insert_at < len(src) and not _is_process_section_label(src[insert_at]):
        insert_at += 1
    return [*src[:insert_at], *bullets, *src[insert_at:]]


def evidence_exhibit_lines(items: list[CaseEvidence]) -> list[str]:
    from app.services.evidence_review import (
        extract_document_date,
        extract_evidence_text,
        format_document_review_line,
    )

    lines: list[str] = []
    for ev in items:
        title = ev.title or ev.original_filename or f"document {ev.id}"
        dated = ""
        try:
            dated = extract_document_date(extract_evidence_text(ev))
        except Exception:
            dated = ""
        lines.append(format_document_review_line(title, dated))
    return lines


def archive_stale_final_cases(db: Session) -> int:
    """Mark old final cases archived per retention policy."""
    if settings.case_retention_days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.case_retention_days)
    rows = (
        db.query(InvestigationCase)
        .filter(
            InvestigationCase.status == "final",
            InvestigationCase.status_changed_at.isnot(None),
            InvestigationCase.status_changed_at < cutoff,
        )
        .all()
    )
    for case in rows:
        case.status = "archived"
        case.archived_at = utcnow()
        case.updated_at = utcnow()
        db.add(case)
    if rows:
        db.commit()
    return len(rows)


def unit_analytics(db: Session, user: User) -> dict[str, Any]:
    from app.permissions import is_admin_role, user_role

    q = db.query(InvestigationCase)
    if not is_admin_role(user_role(user)):
        q = q.filter(InvestigationCase.owner_user_id == user.id)
    cases = q.all()
    by_status: dict[str, int] = {}
    wac_counts: dict[str, int] = {}
    active = 0
    for c in cases:
        by_status[c.status] = by_status.get(c.status, 0) + 1
        if c.status in ACTIVE_STATUSES:
            active += 1
        for w in parse_json_list(c.approved_wac_ids):
            wac_counts[w] = wac_counts.get(w, 0) + 1
    top_wacs = sorted(wac_counts.items(), key=lambda x: (-x[1], x[0]))[:15]
    return {
        "total_cases": active,
        "by_status": by_status,
        "top_approved_wacs": [{"wac_id": w, "count": n} for w, n in top_wacs],
    }
