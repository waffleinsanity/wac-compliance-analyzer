"""Account roles: admin | editor | viewer (Navy-style, WACMAKR-scoped)."""

from __future__ import annotations

from typing import Literal

from fastapi import Depends, HTTPException, status

Role = Literal["admin", "editor", "viewer"]

ROLES: tuple[Role, ...] = ("admin", "editor", "viewer")

ROLE_LABELS: dict[str, str] = {
    "admin": "Administrator",
    "editor": "Editor",
    "viewer": "Viewer",
}

ROLE_DESCRIPTIONS: dict[str, str] = {
    "admin": "Full control: users, inbox, audit, review finalize, and visibility into all cases",
    "editor": "Create and edit only their own investigation cases; submit for review",
    "viewer": "Read-only access to their own cases and the WAC directory",
}


def normalize_role(role: str | None, *, is_admin: bool = False) -> Role:
    value = (role or "").strip().lower()
    if value in ROLES:
        return value  # type: ignore[return-value]
    if is_admin:
        return "admin"
    return "editor"


def is_admin_role(role: str | None) -> bool:
    return normalize_role(role) == "admin"


def can_edit(role: str | None) -> bool:
    """Editors and admins may create/edit investigation work."""
    return normalize_role(role) in {"admin", "editor"}


def can_review(role: str | None) -> bool:
    """Admins finalize in-review cases (supervisor path)."""
    return is_admin_role(role)


def can_access_admin(role: str | None) -> bool:
    return is_admin_role(role)


def user_role(user) -> Role:
    return normalize_role(getattr(user, "role", None), is_admin=bool(getattr(user, "is_admin", False)))


def sync_admin_flag(user) -> None:
    """Keep legacy is_admin boolean aligned with role."""
    role = user_role(user)
    user.role = role
    user.is_admin = role == "admin"


def require_role_edit(user) -> None:
    if not can_edit(user_role(user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Editor or admin role required",
        )


def require_role_admin(user) -> None:
    if not can_access_admin(user_role(user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )


def require_role_review(user) -> None:
    if not can_review(user_role(user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin reviewer role required",
        )
