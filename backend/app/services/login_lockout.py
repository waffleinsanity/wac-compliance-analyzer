"""Login lockout (Navy EHIP / STIG-style: 3 failures in 15 minutes)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.database import User, utcnow

LOGIN_LOCKOUT_MAX_FAILURES = 3
LOGIN_LOCKOUT_WINDOW = timedelta(minutes=15)


def is_lockout_active(user: User, now: datetime | None = None) -> tuple[bool, datetime | None]:
    until = getattr(user, "lockout_until", None)
    if not until:
        return False, None
    now = now or utcnow()
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    if until <= now:
        return False, None
    return True, until


def record_failed_login(db: Session, user: User) -> bool:
    """Increment failures; return True if account is now locked."""
    now = utcnow()
    locked, _ = is_lockout_active(user, now)
    if locked:
        return True

    prior_until = getattr(user, "lockout_until", None)
    base = int(getattr(user, "failed_login_count", 0) or 0)
    if prior_until is not None:
        if prior_until.tzinfo is None:
            prior_until = prior_until.replace(tzinfo=timezone.utc)
        if prior_until <= now:
            base = 0

    next_count = base + 1
    user.failed_login_count = next_count
    if next_count >= LOGIN_LOCKOUT_MAX_FAILURES:
        user.lockout_until = now + LOGIN_LOCKOUT_WINDOW
        db.add(user)
        db.commit()
        return True
    user.lockout_until = None
    db.add(user)
    db.commit()
    return False


def clear_failed_logins(db: Session, user: User) -> None:
    user.failed_login_count = 0
    user.lockout_until = None
    db.add(user)
    db.commit()


def unlock_user_logins(db: Session, user: User) -> None:
    clear_failed_logins(db, user)
