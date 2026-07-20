from __future__ import annotations

import base64
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth import get_admin_user, get_current_user
from app.config import settings
from app.database import AuditLog, BugReport, User, UserFeedback, get_db, utcnow
from app.schemas import (
    AdminInboxCounts,
    AuditLogOut,
    BugReportCreate,
    BugReportOut,
    BugReportUpdate,
    FeedbackCreate,
    FeedbackOut,
    FeedbackUpdate,
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/support", tags=["support"])

BUG_DIR = settings.data_dir / "bug-reports"
OPEN_BUG_STATUSES = ("open", "in_progress")
UNREAD_FEEDBACK = ("new",)


def _user_brief(user: User | None) -> dict | None:
    if not user:
        return None
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "display_name": getattr(user, "display_name", None),
        "role": getattr(user, "role", None) or ("admin" if user.is_admin else "editor"),
        "is_admin": bool(user.is_admin) or getattr(user, "role", "") == "admin",
    }


def _bug_out(row: BugReport, reporter: User | None = None) -> BugReportOut:
    return BugReportOut(
        id=row.id,
        title=row.title,
        description=row.description,
        page_url=row.page_url or "",
        user_agent=row.user_agent or "",
        viewport_json=row.viewport_json or "{}",
        diagnostics_json=row.diagnostics_json or "{}",
        has_screenshot=bool(row.screenshot_path),
        status=row.status or "open",
        admin_note=row.admin_note or "",
        resolved_by=row.resolved_by,
        resolved_at=row.resolved_at.isoformat() if row.resolved_at else None,
        created_at=row.created_at.isoformat() if row.created_at else None,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
        user=_user_brief(reporter),
    )


def _feedback_out(row: UserFeedback, reporter: User | None = None) -> FeedbackOut:
    return FeedbackOut(
        id=row.id,
        category=row.category or "suggestion",
        subject=row.subject,
        message=row.message,
        page_url=row.page_url or "",
        status=row.status or "new",
        admin_note=row.admin_note or "",
        read_by=row.read_by,
        read_at=row.read_at.isoformat() if row.read_at else None,
        created_at=row.created_at.isoformat() if row.created_at else None,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
        user=_user_brief(reporter),
    )


def _save_screenshot(report_id: int, data_url: str) -> str | None:
    if not data_url or not data_url.startswith("data:image"):
        return None
    match = re.match(r"^data:image/(png|jpeg|jpg|webp);base64,(.+)$", data_url, re.I | re.S)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid screenshot data URL")
    ext = match.group(1).lower()
    if ext == "jpg":
        ext = "jpeg"
    raw = base64.b64decode(match.group(2), validate=False)
    if len(raw) > 8_000_000:
        raise HTTPException(status_code=400, detail="Screenshot too large (max 8MB)")
    BUG_DIR.mkdir(parents=True, exist_ok=True)
    path = BUG_DIR / f"{report_id}.{ext}"
    path.write_bytes(raw)
    return str(path)


@router.post("/bugs", response_model=BugReportOut)
def create_bug(
    payload: BugReportCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    title = (payload.title or "").strip() or "Bug report"
    description = (payload.description or "").strip()
    if len(description) < 10:
        raise HTTPException(status_code=400, detail="Description must be at least 10 characters")

    row = BugReport(
        user_id=user.id,
        title=title[:255],
        description=description[:20000],
        page_url=(payload.page_url or "")[:1024],
        user_agent=(payload.user_agent or "")[:512],
        viewport_json=(payload.viewport_json or "{}")[:4000],
        diagnostics_json=(payload.diagnostics_json or "{}")[:100_000],
        status="open",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    if payload.screenshot_data_url:
        try:
            path = _save_screenshot(row.id, payload.screenshot_data_url)
            if path:
                row.screenshot_path = path
                db.add(row)
                db.commit()
                db.refresh(row)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not save screenshot: {exc}") from exc

    log_action(
        db,
        user_id=user.id,
        action="bug_report.create",
        entity_type="bug_report",
        entity_id=row.id,
        details=title[:120],
    )
    return _bug_out(row, user)


@router.get("/bugs", response_model=list[BugReportOut])
def list_bugs(
    status: str | None = Query(default=None),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    q = db.query(BugReport).order_by(BugReport.created_at.desc())
    if status and status != "all":
        q = q.filter(BugReport.status == status)
    rows = q.limit(200).all()
    user_ids = {r.user_id for r in rows}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [_bug_out(r, users.get(r.user_id)) for r in rows]


@router.patch("/bugs/{bug_id}", response_model=BugReportOut)
def update_bug(
    bug_id: int,
    payload: BugReportUpdate,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    row = db.query(BugReport).filter(BugReport.id == bug_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Bug report not found")
    if payload.status is not None:
        if payload.status not in {"open", "in_progress", "resolved", "closed"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        row.status = payload.status
        if payload.status in {"resolved", "closed"}:
            row.resolved_by = admin.id
            row.resolved_at = utcnow()
        elif payload.status in {"open", "in_progress"}:
            row.resolved_by = None
            row.resolved_at = None
    if payload.admin_note is not None:
        row.admin_note = payload.admin_note[:10000]
    row.updated_at = utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(
        db,
        user_id=admin.id,
        action="bug_report.update",
        entity_type="bug_report",
        entity_id=row.id,
        details=f"status={row.status}",
    )
    reporter = db.query(User).filter(User.id == row.user_id).first()
    return _bug_out(row, reporter)


@router.get("/bugs/{bug_id}/screenshot")
def bug_screenshot(
    bug_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    row = db.query(BugReport).filter(BugReport.id == bug_id).first()
    if not row or not row.screenshot_path:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    path = Path(row.screenshot_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot file missing")
    media = "image/png"
    if path.suffix.lower() in {".jpg", ".jpeg"}:
        media = "image/jpeg"
    elif path.suffix.lower() == ".webp":
        media = "image/webp"
    return FileResponse(path, media_type=media)


@router.post("/feedback", response_model=FeedbackOut)
def create_feedback(
    payload: FeedbackCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    subject = (payload.subject or "").strip()
    message = (payload.message or "").strip()
    if len(subject) < 3:
        raise HTTPException(status_code=400, detail="Subject must be at least 3 characters")
    if len(message) < 10:
        raise HTTPException(status_code=400, detail="Message must be at least 10 characters")
    category = (payload.category or "suggestion").strip().lower()
    if category not in {"suggestion", "usability", "content", "other"}:
        category = "other"

    row = UserFeedback(
        user_id=user.id,
        category=category,
        subject=subject[:255],
        message=message[:20000],
        page_url=(payload.page_url or "")[:1024],
        status="new",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(
        db,
        user_id=user.id,
        action="feedback.create",
        entity_type="user_feedback",
        entity_id=row.id,
        details=subject[:120],
    )
    return _feedback_out(row, user)


@router.get("/feedback", response_model=list[FeedbackOut])
def list_feedback(
    status: str | None = Query(default=None),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    q = db.query(UserFeedback).order_by(UserFeedback.created_at.desc())
    if status and status != "all":
        q = q.filter(UserFeedback.status == status)
    rows = q.limit(200).all()
    user_ids = {r.user_id for r in rows}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [_feedback_out(r, users.get(r.user_id)) for r in rows]


@router.patch("/feedback/{feedback_id}", response_model=FeedbackOut)
def update_feedback(
    feedback_id: int,
    payload: FeedbackUpdate,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserFeedback).filter(UserFeedback.id == feedback_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if payload.status is not None:
        if payload.status not in {"new", "read", "archived"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        row.status = payload.status
        if payload.status == "read" and not row.read_at:
            row.read_by = admin.id
            row.read_at = utcnow()
        if payload.status == "new":
            row.read_by = None
            row.read_at = None
    if payload.admin_note is not None:
        row.admin_note = payload.admin_note[:10000]
    row.updated_at = utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(
        db,
        user_id=admin.id,
        action="feedback.update",
        entity_type="user_feedback",
        entity_id=row.id,
        details=f"status={row.status}",
    )
    reporter = db.query(User).filter(User.id == row.user_id).first()
    return _feedback_out(row, reporter)


@router.get("/inbox-counts", response_model=AdminInboxCounts)
def inbox_counts(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    open_bugs = db.query(BugReport).filter(BugReport.status.in_(OPEN_BUG_STATUSES)).count()
    new_feedback = db.query(UserFeedback).filter(UserFeedback.status.in_(UNREAD_FEEDBACK)).count()
    return AdminInboxCounts(open_bugs=open_bugs, new_feedback=new_feedback, total=open_bugs + new_feedback)


@router.get("/audit", response_model=list[AuditLogOut])
def list_audit(
    limit: int = Query(default=50, ge=1, le=200),
    user_id: int | None = Query(default=None),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if user_id is not None:
        q = q.filter(AuditLog.user_id == user_id)
    rows = q.limit(limit).all()
    user_ids = {r.user_id for r in rows if r.user_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [
        AuditLogOut(
            id=r.id,
            user_id=r.user_id,
            username=users[r.user_id].username if r.user_id and r.user_id in users else None,
            action=r.action,
            entity_type=r.entity_type or "",
            entity_id=r.entity_id or "",
            details=r.details or "",
            outcome=r.outcome or "ok",
            created_at=r.created_at.isoformat() if r.created_at else None,
        )
        for r in rows
    ]


@router.get("/my-activity", response_model=list[AuditLogOut])
def my_activity(
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        AuditLogOut(
            id=r.id,
            user_id=r.user_id,
            username=user.username,
            action=r.action,
            entity_type=r.entity_type or "",
            entity_id=r.entity_id or "",
            details=r.details or "",
            outcome=r.outcome or "ok",
            created_at=r.created_at.isoformat() if r.created_at else None,
        )
        for r in rows
    ]
