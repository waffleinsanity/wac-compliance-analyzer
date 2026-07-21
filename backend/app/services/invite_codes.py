"""Invite codes for gated signup (adapted from Navy EHIP)."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.database import InviteCode, utcnow
from app.permissions import ROLES, normalize_role

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def normalize_invite_code(raw: str) -> str:
    return (raw or "").strip().upper().replace(" ", "")


def generate_invite_code(length: int = 10) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def find_valid_invite(db: Session, code: str) -> InviteCode | None:
    normalized = normalize_invite_code(code)
    if not normalized:
        return None
    row = db.query(InviteCode).filter(InviteCode.code == normalized).first()
    if not row:
        return None
    if row.expires_at:
        exp = row.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < utcnow():
            return None
    if int(row.used_count or 0) >= int(row.max_uses or 1):
        return None
    if normalize_role(row.role) not in ROLES:
        return None
    return row


def redeem_invite(db: Session, invite: InviteCode) -> None:
    invite.used_count = int(invite.used_count or 0) + 1
    db.add(invite)
    db.commit()


def create_invite(
    db: Session,
    *,
    role: str = "viewer",
    max_uses: int = 1,
    expires_at: datetime | None = None,
    note: str = "",
    created_by: int | None = None,
    code: str | None = None,
) -> InviteCode:
    role_n = normalize_role(role)
    if role_n not in ROLES:
        role_n = "viewer"
    uses = max(1, int(max_uses or 1))
    if role_n == "admin":
        uses = 1
    row = InviteCode(
        code=normalize_invite_code(code) if code else generate_invite_code(),
        role=role_n,
        max_uses=uses,
        used_count=0,
        expires_at=expires_at,
        note=(note or "")[:255],
        created_by=created_by,
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
