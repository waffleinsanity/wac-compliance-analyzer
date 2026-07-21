"""Google OAuth route registration smoke tests."""

from __future__ import annotations


def test_google_oauth_routes_registered():
    from app.main import app

    paths = {getattr(r, "path", "") for r in app.routes}
    assert "/api/auth/google/start" in paths
    assert "/api/auth/google/callback" in paths
    assert "/api/auth/google/status" in paths


def test_google_status_endpoint(client):
    res = client.get("/api/auth/google/status")
    assert res.status_code == 200
    body = res.json()
    assert "enabled" in body
    assert isinstance(body["enabled"], bool)
