"""Shared fixtures for offline IR accuracy tests.

Pytest must not write cases into the live investigator DB. Before importing the
app, redirect SQLITE_PATH / CASES_DIR to a temp copy of the live DB so WAC
corpus stays available while case creates stay isolated.
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile
from pathlib import Path

# --- Isolate before any ``from app...`` import (engine binds at import time). ---
_REPO_ROOT = Path(__file__).resolve().parents[2]
_LIVE_DB = _REPO_ROOT / "data" / "wac_app.db"
_TEST_ROOT = Path(tempfile.mkdtemp(prefix="wacmakr_pytest_"))
_TEST_DB = _TEST_ROOT / "wac_app.db"
_TEST_CASES = _TEST_ROOT / "cases"
_TEST_CASES.mkdir(parents=True, exist_ok=True)

if _LIVE_DB.exists():
    shutil.copy2(_LIVE_DB, _TEST_DB)
else:
    _TEST_DB.touch()

os.environ["SQLITE_PATH"] = str(_TEST_DB)
os.environ["CASES_DIR"] = str(_TEST_CASES)


def _cleanup_test_root() -> None:
    shutil.rmtree(_TEST_ROOT, ignore_errors=True)


atexit.register(_cleanup_test_root)

# Imports after env redirect so SessionLocal binds to the temp DB.
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import get_current_user  # noqa: E402
from app.config import settings  # noqa: E402
from app.database import SessionLocal, User, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.rag.store import wac_store  # noqa: E402
from app.services.case_store import (  # noqa: E402
    TEST_HARNESS_USERNAMES,
    purge_cases_owned_by_usernames,
)

# Confirm settings match the redirect (engine already bound via env at import).
assert Path(settings.sqlite_path).resolve() == _TEST_DB.resolve()
assert Path(settings.cases_dir).resolve() == _TEST_CASES.resolve()
settings.cases_dir.mkdir(parents=True, exist_ok=True)


@pytest.fixture(scope="session", autouse=True)
def _scrub_harness_cases():
    """Remove harness-owned cases from the temp DB at session start and end."""
    init_db()
    db = SessionLocal()
    try:
        purge_cases_owned_by_usernames(db, TEST_HARNESS_USERNAMES)
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        purge_cases_owned_by_usernames(db, TEST_HARNESS_USERNAMES)
    finally:
        db.close()


@pytest.fixture(scope="session")
def store_ready():
    """Ensure PDF store is loaded once for the test session."""
    init_db()
    db = SessionLocal()
    try:
        if not wac_store.ready:
            wac_store.ingest(db, force=False)
        if not wac_store.ready:
            loaded = wac_store.load_from_db(db)
            assert loaded > 0, "WAC store has no nodes; ingest PDFs under data/source/"
        assert wac_store.ready
        yield wac_store
    finally:
        db.close()


@pytest.fixture
def db(store_ready):
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def auth_user(db):
    user = db.query(User).filter(User.username == "accuracy_test").first()
    if not user:
        user = User(
            username="accuracy_test",
            email="accuracy_test@localhost",
            hashed_password="",
            is_admin=True,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


@pytest.fixture
def client(store_ready, auth_user):
    def _override():
        return auth_user

    app.dependency_overrides[get_current_user] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_current_user, None)
