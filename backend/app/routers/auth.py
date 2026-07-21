from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
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
    user_to_out_dict,
    upsert_google_user,
    validate_password_strength,
    verify_google_id_token,
    verify_password,
)
from app.config import settings
from app.database import User, get_db
from app.rate_limit import enforce_rate_limit
from app.schemas import (
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
from app.services.email import send_password_reset_email, smtp_configured

router = APIRouter(prefix="/api/auth", tags=["auth"])

_GOOGLE_STATE_COOKIE = "wac_google_oauth_state"


def _token_for(user: User) -> TokenResponse:
    return TokenResponse(access_token=create_access_token(user.username), username=user.username)


def _user_out(user: User) -> UserOut:
    return UserOut(**user_to_out_dict(user))


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    if not settings.allow_public_registration:
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
    if get_user_by_username(db, payload.username):
        raise HTTPException(status_code=400, detail="Username already registered")
    email = str(payload.email).lower()
    if get_user_by_email(db, email):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        username=payload.username,
        email=email,
        hashed_password=hash_password(payload.password),
        role="editor",
        is_admin=False,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
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
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        # Distinguish disabled account when credentials would otherwise match
        existing = get_user_by_username(db, form_data.username)
        if existing and existing.hashed_password and verify_password(
            form_data.password, existing.hashed_password
        ):
            if not existing.is_active:
                raise HTTPException(status_code=403, detail="Account is disabled")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _token_for(user)


def _login_redirect(query: str) -> RedirectResponse:
    base = (settings.app_public_url or "http://localhost:5173").rstrip("/")
    return RedirectResponse(url=f"{base}/login?{query}", status_code=302)


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
        "google_enabled": google_configured(),
    }


@router.get("/google/start")
@router.get("/google/authorize-url")
def google_start(request: Request):
    """Begin server-side Google OAuth (full-page redirect)."""
    enforce_rate_limit(
        request,
        "google",
        settings.auth_rate_limit_google,
        settings.auth_rate_limit_window_seconds,
    )
    if not google_configured():
        raise HTTPException(status_code=503, detail="Google Sign-In is not configured")

    state = secrets.token_urlsafe(24)
    redirect = RedirectResponse(url=google_authorize_url(state=state), status_code=302)
    redirect.set_cookie(
        key=_GOOGLE_STATE_COOKIE,
        value=state,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        max_age=600,
        path="/",
    )
    return redirect


@router.get("/google/callback")
def google_callback(
    request: Request,
    db: Session = Depends(get_db),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Google redirects here; exchange code and send the SPA a short-lived app JWT."""
    cookie_state = request.cookies.get(_GOOGLE_STATE_COOKIE)

    def _clear(resp: RedirectResponse) -> RedirectResponse:
        resp.delete_cookie(_GOOGLE_STATE_COOKIE, path="/")
        return resp

    if error:
        return _clear(_login_redirect(f"google_error={quote(error)}"))
    if not code or not state or not cookie_state or state != cookie_state:
        return _clear(_login_redirect("google_error=invalid_oauth_state"))

    try:
        info = exchange_google_auth_code(code)
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
