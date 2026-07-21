"""Cross-user case isolation: editors only see their own cases; admins see all."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user, hash_password, link_google_to_user, upsert_google_user
from app.database import InvestigationCase, User
from app.main import app
from app.services.case_store import dumps_list


def _ensure_user(db, *, username: str, email: str, role: str = "editor", is_admin: bool = False) -> User:
    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = User(
            username=username,
            email=email,
            hashed_password=hash_password("IsolationTest1!"),
            role=role,
            is_admin=is_admin,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.role = role
        user.is_admin = is_admin
        user.is_active = True
        user.email = email
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _owned_case(db, owner: User, label: str) -> InvestigationCase:
    case = InvestigationCase(
        owner_user_id=owner.id,
        case_id_label=label,
        title=f"Private case {label}",
        status="draft",
        complaint_text=f"Confidential complaint for {label}",
        approved_wac_ids=dumps_list(["WAC 246-341-0600"]),
        status_changed_by=owner.id,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@pytest.fixture
def editor_a(db):
    return _ensure_user(db, username="iso_editor_a", email="iso_a@localhost", role="editor")


@pytest.fixture
def editor_b(db):
    return _ensure_user(db, username="iso_editor_b", email="iso_b@localhost", role="editor")


@pytest.fixture
def admin_user(db):
    return _ensure_user(db, username="iso_admin", email="iso_admin@localhost", role="admin", is_admin=True)


@pytest.fixture
def as_user():
    """Override get_current_user for the duration of a with-block."""

    class _Ctx:
        def __init__(self):
            self._user = None

        def __call__(self, user: User):
            self._user = user
            return self

        def __enter__(self):
            app.dependency_overrides[get_current_user] = lambda: self._user
            self.client = TestClient(app)
            self.client.__enter__()
            return self.client

        def __exit__(self, *args):
            self.client.__exit__(*args)
            app.dependency_overrides.pop(get_current_user, None)

    return _Ctx()


def test_editor_cannot_read_another_editors_case(store_ready, db, editor_a, editor_b, as_user):
    case = _owned_case(db, editor_a, "ISO-A1")
    with as_user(editor_b) as client:
        res = client.get(f"/api/cases/{case.id}")
        assert res.status_code == 404, res.text
        assert res.json().get("detail") == "Case not found"


def test_editor_list_excludes_other_owners(store_ready, db, editor_a, editor_b, as_user):
    a_case = _owned_case(db, editor_a, "ISO-A2")
    b_case = _owned_case(db, editor_b, "ISO-B2")
    with as_user(editor_b) as client:
        res = client.get("/api/cases?view=active")
        assert res.status_code == 200, res.text
        ids = {c["id"] for c in res.json()}
        assert b_case.id in ids
        assert a_case.id not in ids


def test_admin_can_read_any_case(store_ready, db, editor_a, admin_user, as_user):
    case = _owned_case(db, editor_a, "ISO-A3")
    with as_user(admin_user) as client:
        res = client.get(f"/api/cases/{case.id}")
        assert res.status_code == 200, res.text
        assert res.json()["id"] == case.id
        assert "Confidential complaint" in res.json()["complaint_text"]


def test_editor_cannot_export_another_case(store_ready, db, editor_a, editor_b, as_user):
    case = _owned_case(db, editor_a, "ISO-A4")
    with as_user(editor_b) as client:
        res = client.post(f"/api/cases/{case.id}/export/docx")
        assert res.status_code == 404, res.text


def test_google_does_not_auto_link_password_account(db):
    password_user = _ensure_user(db, username="iso_pwd", email="overlap@example.com", role="editor")
    assert (password_user.hashed_password or "").strip()

    with pytest.raises(HTTPException) as excinfo:
        upsert_google_user(
            db,
            {
                "sub": "google-sub-overlap-1",
                "email": "overlap@example.com",
                "email_verified": True,
                "name": "Overlap User",
            },
        )
    assert excinfo.value.status_code == 409
    assert "already exists" in str(excinfo.value.detail).lower()


def test_link_google_attaches_to_existing_password_account(db):
    admin = _ensure_user(db, username="iso_link_admin", email="iso_link_admin@localhost", role="admin", is_admin=True)
    admin.google_sub = None
    db.add(admin)
    db.commit()
    db.refresh(admin)
    assert not admin.google_sub

    # Stray Google-only account that previously claimed this sub
    stray = db.query(User).filter(User.username == "iso_google_stray").first()
    if not stray:
        stray = User(
            username="iso_google_stray",
            email="real.google@example.com",
            hashed_password="",
            google_sub="google-sub-admin-link",
            role="editor",
            is_admin=False,
            is_active=True,
        )
        db.add(stray)
    else:
        stray.google_sub = "google-sub-admin-link"
        stray.email = "real.google@example.com"
        db.add(stray)
    db.commit()
    db.refresh(stray)

    linked = link_google_to_user(
        db,
        admin,
        {
            "sub": "google-sub-admin-link",
            "email": "real.google@example.com",
            "email_verified": True,
            "name": "Admin Person",
        },
    )
    assert linked.id == admin.id
    assert linked.google_sub == "google-sub-admin-link"
    # Email stays put when another account still owns the Google mailbox.
    assert linked.email == "iso_link_admin@localhost"
    db.refresh(stray)
    assert stray.google_sub is None
