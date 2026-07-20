from __future__ import annotations

from sqlalchemy.orm import Session

from app.database import AuditLog, utcnow


def log_action(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    entity_type: str = "",
    entity_id: str | int | None = "",
    details: str = "",
    outcome: str = "ok",
    ip_address: str = "",
) -> AuditLog:
    row = AuditLog(
        user_id=user_id,
        action=action[:128],
        entity_type=(entity_type or "")[:64],
        entity_id=str(entity_id or "")[:64],
        details=(details or "")[:4000],
        outcome=(outcome or "ok")[:32],
        ip_address=(ip_address or "")[:64],
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def recent_for_user(db: Session, user_id: int, limit: int = 30) -> list[dict]:
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "details": r.details,
            "outcome": r.outcome,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
