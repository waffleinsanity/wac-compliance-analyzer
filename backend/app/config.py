from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "WAC Compliance Analyzer"
    secret_key: str = "wac-compliance-dev-secret-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7

    project_root: Path = Path(__file__).resolve().parents[2]
    data_dir: Path = project_root / "data"
    source_dir: Path = data_dir / "source"
    examples_dir: Path = data_dir / "examples"
    chroma_dir: Path = data_dir / "chroma"
    sqlite_path: Path = data_dir / "wac_app.db"

    wac_341_pdf: str = "WAC 246-341.pdf"
    wac_337_pdf: str = "WAC 246-337.pdf"

    official_341_url: str = "https://app.leg.wa.gov/WAC/default.aspx?cite=246-341&full=true"
    official_337_url: str = "https://app.leg.wa.gov/WAC/default.aspx?cite=246-337&full=true"

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"]


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.chroma_dir.mkdir(parents=True, exist_ok=True)
settings.examples_dir.mkdir(parents=True, exist_ok=True)
settings.source_dir.mkdir(parents=True, exist_ok=True)
