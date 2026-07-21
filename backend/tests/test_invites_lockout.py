"""Invite signup + login lockout (Navy EHIP ports)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.auth import get_current_user, hash_password
from app.database import User
from app.main import app
from app.services.invite_codes import create_invite
from app.services.login_lockout import is_lockout_active, record_failed_login


def test_invite_registers_with_role(db, store_ready, auth_user, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "allow_public_registration", False)
    monkeypatch.setattr(settings, "allow_invite_signup", True)
    invite = create_invite(db, role="viewer", max_uses=1, created_by=auth_user.id)

    with TestClient(app) as client:
        res = client.post(
            "/api/auth/register",
            json={
                "username": "invite_viewer_1",
                "password": "InvitePass12!",
                "email": "invite_viewer_1@example.com",
                "invite_code": invite.code,
            },
        )
        assert res.status_code == 200, res.text

    user = db.query(User).filter(User.username == "invite_viewer_1").first()
    assert user is not None
    assert user.role == "viewer"


def test_lockout_after_three_failures(db, store_ready):
    user = db.query(User).filter(User.username == "lockout_test").first()
    if not user:
        user = User(
            username="lockout_test",
            email="lockout_test@example.com",
            hashed_password=hash_password("CorrectPass12!"),
            role="editor",
            is_admin=False,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    user.failed_login_count = 0
    user.lockout_until = None
    db.add(user)
    db.commit()

    assert record_failed_login(db, user) is False
    assert record_failed_login(db, user) is False
    assert record_failed_login(db, user) is True
    db.refresh(user)
    locked, _ = is_lockout_active(user)
    assert locked is True


def test_admin_can_list_invites(db, store_ready, auth_user):
    create_invite(db, role="editor", max_uses=2, created_by=auth_user.id)

    def _override():
        return auth_user

    app.dependency_overrides[get_current_user] = _override
    try:
        with TestClient(app) as client:
            res = client.get("/api/admin/invites")
            assert res.status_code == 200, res.text
            assert isinstance(res.json(), list)
            assert len(res.json()) >= 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
