from __future__ import annotations

import json
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
        return InvestigationReport.model_validate_json(raw)
    except Exception:
        return None


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


def next_snapshot_version(db: Session, case_id: int) -> int:
    latest = (
        db.query(CaseReportSnapshot)
        .filter(CaseReportSnapshot.case_id == case_id)
        .order_by(CaseReportSnapshot.version.desc())
        .first()
    )
    return (latest.version + 1) if latest else 1


def save_snapshot(
    db: Session,
    case: InvestigationCase,
    report: InvestigationReport | dict[str, Any],
    user: User,
    note: str = "",
) -> CaseReportSnapshot:
    from app.services.ir_format import sync_report_text

    if isinstance(report, dict):
        report = InvestigationReport.model_validate(report)
    sync_report_text(report)
    payload = report.model_dump()
    text = report.report_text or ""
    snap = CaseReportSnapshot(
        case_id=case.id,
        version=next_snapshot_version(db, case.id),
        report_json=json.dumps(payload),
        report_text=text,
        note=note[:512],
        created_by=user.id,
    )
    case.current_report_json = snap.report_json
    case.updated_at = utcnow()
    db.add(snap)
    db.add(case)
    db.commit()
    db.refresh(snap)
    db.refresh(case)
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


def evidence_exhibit_lines(items: list[CaseEvidence]) -> list[str]:
    lines: list[str] = []
    for i, ev in enumerate(items, start=1):
        links = parse_json_list(ev.linked_wac_ids)
        link_note = f" (linked: {', '.join(links)})" if links else ""
        note = f" — {ev.notes.strip()}" if ev.notes and ev.notes.strip() else ""
        lines.append(f"Exhibit {i}: {ev.title}{link_note}{note}")
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
