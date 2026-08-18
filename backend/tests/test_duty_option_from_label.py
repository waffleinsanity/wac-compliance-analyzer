"""User-picked duty options from full code outline labels."""

from __future__ import annotations

from app.services.wac_scope import build_duty_option_from_label


def test_build_duty_option_from_ranked_leaf(store_ready):
    opt = build_duty_option_from_label("246-341-0410", "(4)(a)")
    assert opt is not None
    assert opt["label"] == "(4)(a)"
    assert "policies" in opt["duty_phrase"].lower()
    assert opt["picked_from_outline"] is True


def test_build_duty_option_from_delegation_subsection(store_ready):
    """Structural subsections like (2) must still resolve for Compare outline picks."""
    opt = build_duty_option_from_label("246-341-0410", "(2)")
    assert opt is not None
    assert opt["label"] == "(2)"
    assert "delegate" in opt["duty_phrase"].lower()


def test_build_duty_option_unknown_label_returns_none(store_ready):
    assert build_duty_option_from_label("246-341-0410", "(99)") is None


def test_duty_option_api(client):
    resp = client.post(
        "/api/investigate/duty-option",
        json={"code": "246-341-0410", "label": "(2)"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] == "(2)"
    assert body["picked_from_outline"] is True
    assert "delegate" in body["duty_phrase"].lower()
