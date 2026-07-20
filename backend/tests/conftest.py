"""Shared fixtures for offline IR accuracy tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.database import SessionLocal, User, init_db
from app.main import app
from app.rag.store import wac_store


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
            assert loaded > 0, "WAC store has no nodes — ingest PDFs under data/source/"
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
