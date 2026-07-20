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


CASE_STATUSES = {"draft", "in_review", "final", "reopened", "archived"}
EDITABLE_STATUSES = {"draft", "reopened"}


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
    from app.permissions import is_admin_role, user_role

    if is_admin_role(user_role(user)):
        return
    if case.owner_user_id != user.id:
        raise HTTPException(status_code=403, detail="Not allowed to access this case")


def assert_case_editable(case: InvestigationCase, user: User | None = None) -> None:
    from app.permissions import can_edit, user_role

    if user is not None and not can_edit(user_role(user)):
        raise HTTPException(status_code=403, detail="Editor or admin role required to edit cases")
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
    payload = report if isinstance(report, dict) else report.model_dump()
    text = payload.get("report_text") or ""
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
    case.updated_at = utcnow()
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


def evidence_dir(case_id: int):
    path = settings.cases_dir / str(case_id) / "evidence"
    path.mkdir(parents=True, exist_ok=True)
    return path


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
    for c in cases:
        by_status[c.status] = by_status.get(c.status, 0) + 1
        for w in parse_json_list(c.approved_wac_ids):
            wac_counts[w] = wac_counts.get(w, 0) + 1
    top_wacs = sorted(wac_counts.items(), key=lambda x: (-x[1], x[0]))[:15]
    return {
        "total_cases": len(cases),
        "by_status": by_status,
        "top_approved_wacs": [{"wac_id": w, "count": n} for w, n in top_wacs],
    }
