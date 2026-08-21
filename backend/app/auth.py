from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import User, get_db

logger = logging.getLogger(__name__)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

MIN_PASSWORD_LENGTH = settings.min_password_length


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password[:72].encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain[:72].encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def validate_password_strength(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(
        {"sub": subject, "exp": expire},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email.lower()).first()


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = get_user_by_username(db, username)
    if not user or not user.is_active:
        return None
    if not user.hashed_password:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def ensure_active(user: User) -> User:
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
    return user


def user_to_out_dict(user: User) -> dict:
    from app.permissions import can_access_admin, can_edit, can_export, can_review, user_role

    role = user_role(user)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "display_name": getattr(user, "display_name", None),
        "role": role,
        "theme_preference": user.theme_preference or "system",
        "is_admin": role == "admin",
        "is_active": bool(user.is_active),
        "must_change_password": bool(user.must_change_password),
        "has_password": bool(user.hashed_password),  # empty string means Google-only / unset
        "has_google": bool(user.google_sub),
        "can_edit": can_edit(role),
        "can_export": can_export(role),
        "can_review": can_review(role),
        "can_access_admin": can_access_admin(role),
    }


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError as exc:
        raise credentials_exception from exc
    user = get_user_by_username(db, username)
    if user is None:
        raise credentials_exception
    return ensure_active(user)


async def get_optional_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    if not token:
        return None
    try:
        return await get_current_user(token=token, db=db)
    except HTTPException:
        return None


async def get_admin_user(user: User = Depends(get_current_user)) -> User:
    from app.permissions import require_role_admin

    require_role_admin(user)
    return user


async def get_editor_user(user: User = Depends(get_current_user)) -> User:
    from app.permissions import require_role_edit

    require_role_edit(user)
    return user


def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_password_reset_token(user: User) -> str:
    raw = secrets.token_urlsafe(32)
    user.password_reset_token_hash = hash_reset_token(raw)
    user.password_reset_expires = datetime.now(timezone.utc) + timedelta(
        minutes=settings.password_reset_expire_minutes
    )
    return raw


def clear_password_reset(user: User) -> None:
    user.password_reset_token_hash = None
    user.password_reset_expires = None


def unique_username_from_email(db: Session, email: str) -> str:
    local = email.split("@", 1)[0].lower()
    base = re.sub(r"[^a-z0-9._-]", "", local)[:40] or "user"
    candidate = base
    n = 1
    while get_user_by_username(db, candidate):
        n += 1
        candidate = f"{base}{n}"[:64]
    return candidate


GOOGLE_CALLBACK_PATH = "/api/auth/google/callback"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def google_configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def google_redirect_uri() -> str:
    """Canonical OAuth redirect URI (must match Google Cloud Console exactly)."""
    if settings.google_redirect_uri.strip():
        return settings.google_redirect_uri.strip()
    base = (settings.app_public_url or "http://localhost:5173").rstrip("/")
    return f"{base}{GOOGLE_CALLBACK_PATH}"


def google_authorize_url(*, state: str, redirect_uri: str | None = None) -> str:
    from urllib.parse import urlencode

    if not google_configured():
        raise HTTPException(status_code=503, detail="Google Sign-In is not configured")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri or google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "include_granted_scopes": "true",
        "prompt": "select_account",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def google_authorize_url_is_accepted(redirect_uri: str | None = None) -> bool:
    """Best-effort probe used by setup scripts (does not prove console config)."""
    try:
        google_authorize_url(state="probe", redirect_uri=redirect_uri)
        return True
    except HTTPException:
        return False


def exchange_google_auth_code(code: str, redirect_uri: str | None = None) -> dict:
    """Exchange an OAuth authorization code for tokens; return verified ID token claims."""
    import httpx

    if not google_configured():
        raise HTTPException(status_code=503, detail="Google Sign-In is not configured")
    uri = redirect_uri or google_redirect_uri()
    try:
        with httpx.Client(timeout=20.0) as client:
            res = client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": uri,
                    "grant_type": "authorization_code",
                },
            )
    except Exception as exc:
        logger.warning("Google token exchange failed: %s", exc)
        raise HTTPException(status_code=401, detail="Google sign-in failed") from exc

    if res.status_code >= 400:
        logger.warning("Google token exchange HTTP %s: %s", res.status_code, res.text[:300])
        raise HTTPException(status_code=401, detail="Google sign-in failed")

    payload = res.json()
    id_token = payload.get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Google did not return an ID token")
    return verify_google_id_token(id_token)


def verify_google_id_token(id_token: str) -> dict:
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google Sign-In is not configured")
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Google auth library not installed") from exc

    try:
        info = google_id_token.verify_oauth2_token(
            id_token,
            google_requests.Request(),
            settings.google_client_id,
        )
    except Exception as exc:
        logger.warning("Google token verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid Google token") from exc

    if info.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=401, detail="Invalid Google token issuer")
    if not info.get("email") or not info.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google account email is not verified")
    return info


def upsert_google_user(db: Session, info: dict) -> User:
    """Find or create a user from verified Google ID token claims.

    Never silently attach Google to an existing password account — that would let
    a pre-registered email collide with a later Google login and share cases.
    """
    sub = info["sub"]
    email = str(info["email"]).lower()

    user = db.query(User).filter(User.google_sub == sub).first()
    if user:
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account is disabled")
        display = (info.get("name") or "").strip()
        if display and not user.display_name:
            user.display_name = display[:128]
            db.add(user)
            db.commit()
            db.refresh(user)
        return user

    existing = get_user_by_email(db, email)
    if existing:
        if existing.google_sub and existing.google_sub != sub:
            raise HTTPException(
                status_code=409,
                detail="This email is already linked to a different Google account. Contact an administrator.",
            )
        # Password (or other) account already owns this email — do not auto-merge.
        if (existing.hashed_password or "").strip():
            raise HTTPException(
                status_code=409,
                detail=(
                    "An account with this email already exists. "
                    "Sign in with your password, or ask an administrator to link Google to your account."
                ),
            )
        # Legacy empty-password row: safe to claim with this Google identity.
        existing.google_sub = sub
        user = existing
    else:
        user = User(
            username=unique_username_from_email(db, email),
            email=email,
            hashed_password="",
            google_sub=sub,
            role="editor",
            is_admin=False,
            is_active=True,
            must_change_password=False,
        )
        db.add(user)

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    display = (info.get("name") or "").strip()
    if display and not user.display_name:
        user.display_name = display[:128]

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def link_google_to_user(db: Session, user: User, info: dict) -> User:
    """Attach a verified Google identity to an already-authenticated account.

    If this Google sub is on another user, detach it there first so the signed-in
    account (e.g. admin) becomes the sole owner of that Google login.
    """
    sub = info["sub"]
    other = db.query(User).filter(User.google_sub == sub, User.id != user.id).first()
    if other is not None:
        # Flush the detach first. SQLite UNIQUE on google_sub rejects a same-statement
        # reassignment while the prior owner still holds the value in the transaction.
        other.google_sub = None
        db.add(other)
        db.flush()

    user.google_sub = sub
    display = (info.get("name") or "").strip()
    if display and not user.display_name:
        user.display_name = display[:128]

    # Prefer a real Google email when the account still has a placeholder local email.
    google_email = str(info.get("email") or "").lower().strip()
    if google_email and (not user.email or user.email.endswith("@localhost")):
        clash = get_user_by_email(db, google_email)
        if clash is None or clash.id == user.id:
            user.email = google_email

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


_DEFAULT_SECRET = "wac-compliance-dev-secret-change-in-production"


def assert_production_secret_safe() -> None:
    """Fail closed when a shared/https deployment still uses the demo JWT secret."""
    import os

    if not settings.require_secure_secret:
        return
    if settings.secret_key != _DEFAULT_SECRET:
        return
    public = (settings.app_public_url or "").strip().lower()
    on_railway = bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_PROJECT_ID"))
    if on_railway or public.startswith("https://"):
        raise RuntimeError(
            "SECRET_KEY is still the development default. "
            "Set a unique SECRET_KEY before serving a multi-user deployment."
        )


def bootstrap_admin(db: Session) -> None:
    """Create or promote bootstrap admin when no admin exists."""
    existing_admin = db.query(User).filter(User.is_admin.is_(True)).first()
    if existing_admin:
        return

    username = (settings.admin_bootstrap_username or "admin").strip()
    password = settings.admin_bootstrap_password or "ChangeMeAdmin1!"
    email = (settings.admin_bootstrap_email or "admin@localhost").strip().lower()

    user = get_user_by_username(db, username)
    if user:
        user.role = "admin"
        user.is_admin = True
        user.is_active = True
        user.must_change_password = True
        if not user.email:
            user.email = email
        if not user.hashed_password:
            user.hashed_password = hash_password(password)
            user.must_change_password = True
        db.add(user)
        db.commit()
        logger.info("Promoted existing user %s to admin", username)
        return

    # Avoid email collision with another account
    if get_user_by_email(db, email):
        email = f"admin+bootstrap@{email.split('@')[-1]}"

    user = User(
        username=username,
        email=email,
        hashed_password=hash_password(password),
        role="admin",
        is_admin=True,
        is_active=True,
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    logger.info("Created bootstrap admin user %s — change the password after first login", username)


def count_active_admins(db: Session, exclude_user_id: int | None = None) -> int:
    q = db.query(User).filter(User.is_active.is_(True)).filter(
        (User.role == "admin") | (User.is_admin.is_(True))
    )
    if exclude_user_id is not None:
        q = q.filter(User.id != exclude_user_id)
    return q.count()
