from contextlib import asynccontextmanager
from pathlib import Path
import threading

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.auth import assert_production_secret_safe, bootstrap_admin
from app.config import settings
from app.database import SessionLocal, init_db
from app.rag.store import wac_store
from app.routers import admin_users, analysis, auth, cases, privacy, support, wacs
from app.services.usage_stats import backfill_from_cases

_BOT_UA = (
    "gptbot",
    "chatgpt-user",
    "ccbot",
    "anthropic-ai",
    "claude-web",
    "google-extended",
    "bytespider",
    "petalbot",
)


def _background_corpus_startup() -> None:
    """Heavy Chroma/PDF ingest must not block /api/health (Railway healthchecks)."""
    db = SessionLocal()
    try:
        result = wac_store.ingest(db, force=False)
        seeded = backfill_from_cases(db)
        print(f"[startup] WAC store: {result}")
        if seeded:
            print(f"[startup] Seeded usage stats for {seeded} WACs from existing cases")
    except Exception as exc:  # noqa: BLE001 — keep API up; surface in logs
        print(f"[startup] WAC store ingest failed: {exc}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    assert_production_secret_safe()
    init_db()
    db = SessionLocal()
    try:
        bootstrap_admin(db)
    finally:
        db.close()
    threading.Thread(target=_background_corpus_startup, name="wac-ingest", daemon=True).start()
    yield


app = FastAPI(
    title=settings.app_name,
    description="Self-contained Washington Administrative Code compliance analysis system",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def block_known_collectors(request: Request, call_next):
    ua = (request.headers.get("user-agent") or "").lower()
    if ua and any(bot in ua for bot in _BOT_UA):
        return Response(status_code=403, content="Forbidden")
    return await call_next(request)


@app.get("/robots.txt", include_in_schema=False)
def robots_txt():
    return PlainTextResponse("User-agent: *\nDisallow: /\n")


app.include_router(auth.router)
app.include_router(admin_users.router)
app.include_router(support.router)
app.include_router(privacy.router)
app.include_router(cases.router)
app.include_router(wacs.router)
app.include_router(analysis.router)


@app.api_route(
    "/api/{full_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    include_in_schema=False,
)
async def api_not_found(full_path: str):
    """Unmatched /api/* must be 404, not SPA GET catch-all 405 Method Not Allowed."""
    raise HTTPException(status_code=404, detail="Not Found")


# Serve built frontend if present
frontend_dist = settings.project_root / "frontend" / "dist"
if frontend_dist.exists():
    assets = frontend_dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Never mask missing API routes with the SPA shell.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        index = frontend_dist / "index.html"
        file_path = frontend_dist / full_path
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(index)
