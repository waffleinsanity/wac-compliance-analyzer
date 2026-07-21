from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
import secrets

from app.auth import (
    authenticate_user,
    clear_password_reset,
    create_access_token,
    exchange_google_auth_code,
    get_current_user,
    get_user_by_email,
    get_user_by_username,
    google_authorize_url,
    google_configured,
    google_redirect_uri,
    hash_password,
    hash_reset_token,
    issue_password_reset_token,
    link_google_to_user,
    user_to_out_dict,
    upsert_google_user,
    validate_password_strength,
    verify_google_id_token,
    verify_password,
)
from app.config import settings
from app.database import AccessRequest, User, get_db, utcnow
from app.permissions import normalize_role, sync_admin_flag
from app.rate_limit import enforce_rate_limit, client_ip
from app.schemas import (
    AccessRequestCreate,
    AccessRequestOut,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    MessageResponse,
    ProfileUpdate,
    RegisterRequest,
    ResetPasswordRequest,
    ThemeUpdate,
    TokenResponse,
    UserOut,
)
from app.services.audit import log_action
from app.services.email import send_password_reset_email, smtp_configured
from app.services.invite_codes import find_valid_invite, redeem_invite
from app.services.login_lockout import (
    clear_failed_logins,
    is_lockout_active,
    record_failed_login,
)


def _email_domain_allowed(email: str) -> bool:
    raw = (settings.allowed_email_domains or "").strip()
    if not raw:
        return True
    domains = {d.strip().lower().lstrip("@") for d in raw.split(",") if d.strip()}
    if not domains:
        return True
    host = (email or "").split("@")[-1].strip().lower()
    return host in domains


router = APIRouter(prefix="/api/auth", tags=["auth"])

_GOOGLE_STATE_COOKIE = "wac_google_oauth_state"


def _token_for(user: User) -> TokenResponse:
    return TokenResponse(access_token=create_access_token(user.username), username=user.username)


def _user_out(user: User) -> UserOut:
    return UserOut(**user_to_out_dict(user))


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    invite = None
    if payload.invite_code:
        invite = find_valid_invite(db, payload.invite_code)
        if not invite:
            raise HTTPException(status_code=400, detail="Invalid or expired invite code")
    elif not settings.allow_public_registration:
        if settings.allow_invite_signup:
            raise HTTPException(
                status_code=403,
                detail="Public registration is disabled. Ask an administrator for an invite code, or sign in with Google.",
            )
        raise HTTPException(
            status_code=403,
            detail="Public registration is disabled. Sign in with Google, or ask an administrator for an account.",
        )
    enforce_rate_limit(
        request,
        "register",
        settings.auth_rate_limit_register,
        settings.auth_rate_limit_window_seconds,
    )
    validate_password_strength(payload.password)
    email = str(payload.email).lower()
    if not _email_domain_allowed(email):
        raise HTTPException(status_code=403, detail="Email domain is not allowed for this deployment")
    if get_user_by_username(db, payload.username):
        raise HTTPException(status_code=400, detail="Username already registered")
    if get_user_by_email(db, email):
        raise HTTPException(status_code=400, detail="Email already registered")
    role = normalize_role(invite.role) if invite else "editor"
    user = User(
        username=payload.username,
        email=email,
        hashed_password=hash_password(payload.password),
        role=role,
        is_admin=role == "admin",
        is_active=True,
        must_change_password=False,
    )
    sync_admin_flag(user)
    db.add(user)
    db.commit()
    db.refresh(user)
    if invite:
        redeem_invite(db, invite)
    log_action(
        db,
        user_id=user.id,
        action="auth.register",
        entity_type="user",
        entity_id=user.id,
        details=f"role={role}; invite={'yes' if invite else 'no'}",
        ip_address=client_ip(request),
    )
    return _token_for(user)


@router.post("/login", response_model=TokenResponse)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    enforce_rate_limit(
        request,
        "login",
        settings.auth_rate_limit_login,
        settings.auth_rate_limit_window_seconds,
    )
    existing = get_user_by_username(db, form_data.username)
    if existing:
        locked, until = is_lockout_active(existing)
        if locked:
            mins = max(1, int(((until - utcnow()).total_seconds() if until else 0) / 60))
            raise HTTPException(
                status_code=403,
                detail=f"Account locked after failed sign-in attempts. Try again in about {mins} minute(s), or ask an administrator to unlock.",
            )
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        if existing and existing.hashed_password:
            if verify_password(form_data.password, existing.hashed_password) and not existing.is_active:
                raise HTTPException(status_code=403, detail="Account is disabled")
            if existing.hashed_password and not verify_password(form_data.password, existing.hashed_password):
                if record_failed_login(db, existing):
                    raise HTTPException(
                        status_code=403,
                        detail="Account locked after 3 failed sign-in attempts. Try again in 15 minutes, or ask an administrator to unlock.",
                    )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    clear_failed_logins(db, user)
    log_action(
        db,
        user_id=user.id,
        action="auth.login",
        entity_type="user",
        entity_id=user.id,
        ip_address=client_ip(request),
    )
    return _token_for(user)


def _login_redirect(query: str) -> RedirectResponse:
    base = (settings.app_public_url or "http://localhost:5173").rstrip("/")
    return RedirectResponse(url=f"{base}/login?{query}", status_code=302)


def _set_oauth_state_cookie(resp: RedirectResponse | None, value: str, *, secure: bool) -> None:
    """Attach OAuth state cookie to a redirect, or return cookie kwargs for JSON responses."""
    if resp is None:
        return
    resp.set_cookie(
        key=_GOOGLE_STATE_COOKIE,
        value=value,
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=600,
        path="/",
    )


def _parse_oauth_state_cookie(raw: str | None) -> tuple[str, int | None, str] | None:
    """Return (mode, link_user_id|None, nonce) from cookie value."""
    if not raw:
        return None
    parts = raw.split(":")
    if len(parts) == 2 and parts[0] == "login":
        return ("login", None, parts[1])
    if len(parts) == 3 and parts[0] == "link":
        try:
            return ("link", int(parts[1]), parts[2])
        except ValueError:
            return None
    # Legacy plain state → treat as login
    return ("login", None, raw)


@router.get("/google/status")
def google_status():
    """Public: whether Google OAuth is configured for this deployment."""
    return {
        "enabled": google_configured(),
        "redirect_uri": google_redirect_uri() if google_configured() else None,
        "app_public_url": (settings.app_public_url or "").rstrip("/") or None,
        "allow_public_registration": bool(settings.allow_public_registration),
    }


@router.get("/config")
def auth_config():
    """Public auth/UI flags (no secrets)."""
    return {
        "allow_public_registration": bool(settings.allow_public_registration),
        "allow_invite_signup": bool(settings.allow_invite_signup),
        "allowed_email_domains": [
            d.strip().lower().lstrip("@")
            for d in (settings.allowed_email_domains or "").split(",")
            if d.strip()
        ],
        "google_enabled": google_configured(),
    }


@router.get("/google/start")
@router.get("/google/authorize-url")
def google_start(request: Request):
    """Begin server-side Google OAuth (full-page redirect) for sign-in."""
    enforce_rate_limit(
        request,
        "google",
        settings.auth_rate_limit_google,
        settings.auth_rate_limit_window_seconds,
    )
    if not google_configured():
        raise HTTPException(status_code=503, detail="Google Sign-In is not configured")

    nonce = secrets.token_urlsafe(24)
    redirect = RedirectResponse(url=google_authorize_url(state=nonce), status_code=302)
    _set_oauth_state_cookie(
        redirect,
        f"login:{nonce}",
        secure=request.url.scheme == "https",
    )
    return redirect


@router.post("/google/link/prepare")
def google_link_prepare(
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
):
    """Authenticated: prepare OAuth to link Google to the current account (e.g. admin)."""
    enforce_rate_limit(
        request,
        "google",
        settings.auth_rate_limit_google,
        settings.auth_rate_limit_window_seconds,
    )
    if not google_configured():
        raise HTTPException(status_code=503, detail="Google Sign-In is not configured")
    if user.google_sub:
        raise HTTPException(status_code=400, detail="Google is already linked to this account")

    nonce = secrets.token_urlsafe(24)
    secure = request.url.scheme == "https"
    response.set_cookie(
        key=_GOOGLE_STATE_COOKIE,
        value=f"link:{user.id}:{nonce}",
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=600,
        path="/",
    )
    return {
        "authorize_url": google_authorize_url(state=nonce),
        "username": user.username,
    }


@router.get("/google/callback")
def google_callback(
    request: Request,
    db: Session = Depends(get_db),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Google redirects here; exchange code and send the SPA a short-lived app JWT."""
    parsed = _parse_oauth_state_cookie(request.cookies.get(_GOOGLE_STATE_COOKIE))

    def _clear(resp: RedirectResponse) -> RedirectResponse:
        resp.delete_cookie(_GOOGLE_STATE_COOKIE, path="/")
        return resp

    if error:
        return _clear(_login_redirect(f"google_error={quote(error)}"))
    if not code or not state or not parsed:
        return _clear(_login_redirect("google_error=invalid_oauth_state"))
    mode, link_user_id, nonce = parsed
    if state != nonce:
        return _clear(_login_redirect("google_error=invalid_oauth_state"))

    try:
        info = exchange_google_auth_code(code)
        if mode == "link":
            if not link_user_id:
                return _clear(_login_redirect("google_error=invalid_link_session"))
            target = db.query(User).filter(User.id == link_user_id).first()
            if not target:
                return _clear(_login_redirect("google_error=account_not_found"))
            user = link_google_to_user(db, target, info)
            token = create_access_token(user.username)
            return _clear(_login_redirect(f"google_token={quote(token)}&google_linked=1"))

        user = upsert_google_user(db, info)
        token = create_access_token(user.username)
        return _clear(_login_redirect(f"google_token={quote(token)}"))
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Google sign-in failed"
        return _clear(_login_redirect(f"google_error={quote(detail)}"))
    except Exception:
        return _clear(_login_redirect("google_error=Google%20sign-in%20failed"))


@router.post("/google", response_model=TokenResponse)
def google_login(payload: GoogleAuthRequest, request: Request, db: Session = Depends(get_db)):
    """GIS ID-token or auth-code exchange (API clients). Prefer /google/start for the UI."""
    enforce_rate_limit(
        request,
        "google",
        settings.auth_rate_limit_google,
        settings.auth_rate_limit_window_seconds,
    )
    if payload.code:
        info = exchange_google_auth_code(payload.code, redirect_uri=payload.redirect_uri)
    else:
        if not payload.id_token:
            raise HTTPException(status_code=400, detail="Provide a Google auth code or ID token")
        info = verify_google_id_token(payload.id_token)
    user = upsert_google_user(db, info)
    return _token_for(user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return _user_out(user)


@router.patch("/theme", response_model=UserOut)
def update_theme(
    payload: ThemeUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.theme_preference not in {"light", "dark", "system"}:
        raise HTTPException(status_code=400, detail="theme_preference must be light, dark, or system")
    user.theme_preference = payload.theme_preference
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.patch("/profile", response_model=UserOut)
def update_profile(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.email is not None:
        email = str(payload.email).lower()
        other = get_user_by_email(db, email)
        if other and other.id != user.id:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = email
    if payload.display_name is not None:
        name = payload.display_name.strip()
        user.display_name = name[:128] if name else None
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.post("/change-password", response_model=UserOut)
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    validate_password_strength(payload.new_password)
    if user.hashed_password:
        if not payload.current_password or not verify_password(
            payload.current_password, user.hashed_password
        ):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.hashed_password = hash_password(payload.new_password)
    user.must_change_password = False
    clear_password_reset(user)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_rate_limit(
        request,
        "forgot",
        settings.auth_rate_limit_forgot,
        settings.auth_rate_limit_window_seconds,
    )
    generic = MessageResponse(
        message="If that email is registered, password reset instructions have been sent."
    )
    email = str(payload.email).lower()
    user = get_user_by_email(db, email)
    if not user or not user.is_active:
        return generic

    token = issue_password_reset_token(user)
    db.add(user)
    db.commit()

    if smtp_configured():
        send_password_reset_email(email, token)
    else:
        # Dev-friendly: log reset link so local testing works without SMTP
        link = f"{settings.app_public_url.rstrip('/')}/reset-password?token={token}"
        print(f"[auth] SMTP not configured — password reset link for {email}: {link}")

    return generic


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    validate_password_strength(payload.new_password)
    token_hash = hash_reset_token(payload.token)
    user = (
        db.query(User)
        .filter(User.password_reset_token_hash == token_hash)
        .first()
    )
    if not user or not user.password_reset_expires:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    expires = user.password_reset_expires
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        clear_password_reset(user)
        db.add(user)
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    user.hashed_password = hash_password(payload.new_password)
    user.must_change_password = False
    clear_password_reset(user)
    db.add(user)
    db.commit()
    return MessageResponse(message="Password updated. You can sign in with your new password.")

@router.post("/access-requests", response_model=AccessRequestOut)
def create_access_request(
    payload: AccessRequestCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    requested = normalize_role(payload.requested_role)
    if requested not in {"editor", "admin"}:
        raise HTTPException(status_code=400, detail="requested_role must be editor or admin")
    current = normalize_role(user.role, is_admin=bool(user.is_admin))
    if current == "admin" or (current == "editor" and requested == "editor"):
        raise HTTPException(status_code=400, detail="You already have equal or higher access")
    pending = (
        db.query(AccessRequest)
        .filter(AccessRequest.user_id == user.id, AccessRequest.status == "pending")
        .first()
    )
    if pending:
        raise HTTPException(status_code=400, detail="You already have a pending access request")
    row = AccessRequest(
        user_id=user.id,
        requested_role=requested,
        justification=(payload.justification or "").strip()[:2000],
        status="pending",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(
        db,
        user_id=user.id,
        action="access_request.create",
        entity_type="access_request",
        entity_id=row.id,
        details=f"requested={requested}",
    )
    return AccessRequestOut(
        id=row.id,
        user_id=row.user_id,
        username=user.username,
        email=user.email,
        current_role=current,
        requested_role=row.requested_role,
        justification=row.justification or "",
        status=row.status,
        admin_note="",
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
    )


@router.get("/access-requests/mine", response_model=list[AccessRequestOut])
def my_access_requests(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(AccessRequest)
        .filter(AccessRequest.user_id == user.id)
        .order_by(AccessRequest.created_at.desc())
        .limit(20)
        .all()
    )
    current = normalize_role(user.role, is_admin=bool(user.is_admin))
    return [
        AccessRequestOut(
            id=r.id,
            user_id=r.user_id,
            username=user.username,
            email=user.email,
            current_role=current,
            requested_role=r.requested_role,
            justification=r.justification or "",
            status=r.status,
            admin_note=r.admin_note or "",
            created_at=r.created_at,
            reviewed_at=r.reviewed_at,
        )
        for r in rows
    ]


@router.delete("/google/link", response_model=UserOut)
def unlink_google(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user.google_sub:
        raise HTTPException(status_code=400, detail="No Google account is linked")
    if not user.hashed_password:
        raise HTTPException(
            status_code=400,
            detail="Set a password before unlinking Google so you can still sign in",
        )
    user.google_sub = None
    db.add(user)
    db.commit()
    db.refresh(user)
    log_action(
        db,
        user_id=user.id,
        action="auth.google.unlink",
        entity_type="user",
        entity_id=user.id,
    )
    return _user_out(user)
