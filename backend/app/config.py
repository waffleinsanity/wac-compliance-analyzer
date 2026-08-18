from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "WACMAKR"
    secret_key: str = "wac-compliance-dev-secret-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7

    project_root: Path = Path(__file__).resolve().parents[2]
    data_dir: Path = project_root / "data"
    source_dir: Path = data_dir / "source"
    examples_dir: Path = data_dir / "examples"
    templates_dir: Path = data_dir / "templates"
    chroma_dir: Path = data_dir / "chroma"
    cases_dir: Path = data_dir / "cases"
    sqlite_path: Path = data_dir / "wac_app.db"
    case_retention_days: int = 365
    # Soft-deleted (trashed) cases are hard-deleted after this many days
    case_trash_retention_days: int = 7
    case_upload_max_mb: int = 15

    # Auth: public password registration (disable on shared/multi-user hosts)
    # Default off for shared/Railway hosts; local .env can set true for open signup.
    allow_public_registration: bool = False
    # When public registration is off, allow signup only with a valid invite code
    allow_invite_signup: bool = True
    # Comma-separated email domains (empty = any). Example: "doh.wa.gov,wa.gov"
    allowed_email_domains: str = ""
    # Refuse known default JWT secret when APP_PUBLIC_URL is https or RAILWAY_* is set
    require_secure_secret: bool = True

    wac_341_pdf: str = "WAC 246-341.pdf"
    wac_337_pdf: str = "WAC 246-337.pdf"
    rcw_source_pdfs: tuple[str, ...] = (
        "RCW 71.05.pdf",
        "RCW 71.24.pdf",
        "RCW 71.34.pdf",
    )

    official_341_url: str = "https://app.leg.wa.gov/WAC/default.aspx?cite=246-341&full=true"
    official_337_url: str = "https://app.leg.wa.gov/WAC/default.aspx?cite=246-337&full=true"

    # OpenAI-compatible investigator LLM (Groq free tier by default; also Ollama/Cerebras/Gemini)
    llm_enabled: bool = True
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_api_key: str = ""  # Groq key from https://console.groq.com/keys
    llm_model: str = "openai/gpt-oss-120b"
    llm_timeout_seconds: float = 90.0
    # IR draft is PDF-driven; keep the LLM off the critical path unless explicitly enabled.
    llm_for_investigate: bool = False

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"]

    # Auth / Google SSO (server-side OAuth)
    google_client_id: str = ""
    google_client_secret: str = ""
    # Empty = {app_public_url}/api/auth/google/callback
    google_redirect_uri: str = ""
    admin_bootstrap_username: str = "admin"
    admin_bootstrap_password: str = "ChangeMeAdmin1!"
    admin_bootstrap_email: str = "admin@localhost"
    # Fixed public origin for OAuth (like NEXTAUTH_URL). Prefer localhost over 127.0.0.1.
    # Default 5173 so local WAC does not collide with Navy EHIP on :3000.
    app_public_url: str = "http://localhost:5173"
    password_reset_expire_minutes: int = 60
    min_password_length: int = 10

    # SMTP (optional — forgot-password emails skipped when host empty)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True

    # Sliding-window rate limits (requests per window per IP)
    auth_rate_limit_window_seconds: int = 900
    auth_rate_limit_register: int = 8
    auth_rate_limit_login: int = 30
    auth_rate_limit_forgot: int = 5
    auth_rate_limit_google: int = 30


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.chroma_dir.mkdir(parents=True, exist_ok=True)
settings.examples_dir.mkdir(parents=True, exist_ok=True)
settings.templates_dir.mkdir(parents=True, exist_ok=True)
settings.source_dir.mkdir(parents=True, exist_ok=True)
settings.cases_dir.mkdir(parents=True, exist_ok=True)
(settings.data_dir / "bug-reports").mkdir(parents=True, exist_ok=True)
