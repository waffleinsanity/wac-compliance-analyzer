import re
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import (
    count_active_admins,
    get_admin_user,
    get_user_by_email,
    get_user_by_username,
    hash_password,
    user_to_out_dict,
    validate_password_strength,
)
from app.database import User, get_db
from app.permissions import ROLES, normalize_role, sync_admin_flag
from app.schemas import AdminCreateUser, AdminUserUpdate, TempPasswordResponse, UserOut
from app.services.audit import log_action

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _user_out(user: User) -> UserOut:
    return UserOut(**user_to_out_dict(user))


def _generate_temp_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    chars = [
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.digits),
    ]
    chars += [secrets.choice(alphabet) for _ in range(length - 3)]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def _resolve_role(role: str | None, is_admin: bool | None) -> str:
    if role is not None:
        value = normalize_role(role)
        if role.strip().lower() not in ROLES:
            raise HTTPException(status_code=400, detail="role must be admin, editor, or viewer")
        return value
    if is_admin is True:
        return "admin"
    if is_admin is False:
        return "editor"
    return "editor"


@router.get("/users", response_model=list[UserOut])
def list_users(
    q: str | None = Query(default=None),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    query = db.query(User).order_by(User.created_at.desc())
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        query = query.filter(
            or_(
                User.username.ilike(term),
                User.email.ilike(term),
                User.display_name.ilike(term),
                User.role.ilike(term),
            )
        )
    users = query.limit(500).all()
    return [_user_out(u) for u in users]


@router.post("/users", response_model=TempPasswordResponse)
def create_user(
    payload: AdminCreateUser,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    username = payload.username.strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,64}", username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3–64 chars: letters, digits, . _ -",
        )
    if get_user_by_username(db, username):
        raise HTTPException(status_code=400, detail="Username already taken")
    email = str(payload.email).lower()
    if get_user_by_email(db, email):
        raise HTTPException(status_code=400, detail="Email already in use")

    role = _resolve_role(payload.role, payload.is_admin)
    temp = _generate_temp_password()
    validate_password_strength(temp)
    user = User(
        username=username,
        email=email,
        display_name=(payload.display_name or "").strip()[:128] or None,
        hashed_password=hash_password(temp),
        role=role,
        is_admin=role == "admin",
        is_active=True,
        must_change_password=True,
    )
    sync_admin_flag(user)
    db.add(user)
    db.commit()
    db.refresh(user)
    log_action(
        db,
        user_id=admin.id,
        action="admin.user.create",
        entity_type="user",
        entity_id=user.id,
        details=f"{username} role={role}",
    )
    return TempPasswordResponse(
        user_id=user.id,
        username=user.username,
        temporary_password=temp,
        must_change_password=True,
    )


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.email is not None:
        email = str(payload.email).lower()
        other = get_user_by_email(db, email)
        if other and other.id != user.id:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = email

    next_role = normalize_role(user.role, is_admin=bool(user.is_admin))
    if payload.role is not None or payload.is_admin is not None:
        next_role = _resolve_role(payload.role, payload.is_admin)

    next_active = user.is_active if payload.is_active is None else payload.is_active
    currently_admin = normalize_role(user.role, is_admin=bool(user.is_admin)) == "admin"
    will_be_admin = next_role == "admin"

    if currently_admin and (not next_active or not will_be_admin):
        others = count_active_admins(db, exclude_user_id=user.id)
        if others < 1:
            raise HTTPException(status_code=400, detail="Cannot disable or demote the last active admin")

    if admin.id == user.id and currently_admin and not will_be_admin:
        raise HTTPException(status_code=400, detail="Cannot demote your own admin role")

    if payload.is_active is not None:
        user.is_active = payload.is_active
    user.role = next_role
    sync_admin_flag(user)

    db.add(user)
    db.commit()
    db.refresh(user)
    log_action(
        db,
        user_id=admin.id,
        action="admin.user.update",
        entity_type="user",
        entity_id=user.id,
        details=f"active={user.is_active} role={user.role}",
    )
    return _user_out(user)


@router.post("/users/{user_id}/temp-password", response_model=TempPasswordResponse)
def set_temp_password(
    user_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Cannot set password for a disabled account")

    temp = _generate_temp_password()
    validate_password_strength(temp)
    user.hashed_password = hash_password(temp)
    user.must_change_password = True
    user.password_reset_token_hash = None
    user.password_reset_expires = None
    db.add(user)
    db.commit()
    return TempPasswordResponse(
        user_id=user.id,
        username=user.username,
        temporary_password=temp,
        must_change_password=True,
    )
