"""Role gates: viewers may edit cases; only editors/admins may export."""

from __future__ import annotations

from io import BytesIO

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.database import InvestigationCase, User
from app.main import app
from app.services.case_store import assert_case_editable, dumps_list


@pytest.fixture
def viewer_user(db):
    user = db.query(User).filter(User.username == "viewer_test").first()
    if not user:
        user = User(
            username="viewer_test",
            email="viewer_test@localhost",
            hashed_password="",
            role="viewer",
            is_admin=False,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.role = "viewer"
        user.is_admin = False
        user.is_active = True
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


@pytest.fixture
def viewer_client(store_ready, viewer_user):
    def _override():
        return viewer_user

    app.dependency_overrides[get_current_user] = _override
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.pop(get_current_user, None)


def _create_viewer_owned_case(db, viewer_user) -> int:
    case = InvestigationCase(
        owner_user_id=viewer_user.id,
        case_id_label="RG-VIEW",
        title="Role gate case",
        status="draft",
        complaint_text="Viewer may edit this case.",
        approved_wac_ids=dumps_list(["WAC 246-341-0600"]),
        status_changed_by=viewer_user.id,
        current_report_json='{"report_text":"Draft IR body","allegations":[],"comparisons":[],"findings":[]}',
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case.id


def test_viewer_can_trash_owned_case(viewer_client, viewer_user, db, store_ready):
    case_id = _create_viewer_owned_case(db, viewer_user)

    res = viewer_client.post(f"/api/cases/{case_id}/trash")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "trashed"


def test_viewer_can_upload_evidence(viewer_client, viewer_user, db, store_ready):
    case_id = _create_viewer_owned_case(db, viewer_user)

    res = viewer_client.post(
        f"/api/cases/{case_id}/evidence",
        files={"file": ("note.txt", BytesIO(b"evidence"), "text/plain")},
        data={"title": "Note", "notes": "", "linked_wac_ids": "[]"},
    )
    assert res.status_code == 200, res.text


def test_assert_case_editable_allows_viewer(db, viewer_user, store_ready):
    case = InvestigationCase(
        owner_user_id=viewer_user.id,
        case_id_label="RG-1",
        title="Viewer editable check",
        status="draft",
        complaint_text="x",
        approved_wac_ids="[]",
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    assert_case_editable(case, viewer_user)


def test_viewer_cannot_export_docx(viewer_client, viewer_user, db, store_ready):
    case_id = _create_viewer_owned_case(db, viewer_user)
    res = viewer_client.post(f"/api/cases/{case_id}/export/docx")
    assert res.status_code == 403, res.text
    assert "Export" in res.json().get("detail", "")


def test_viewer_cannot_export_pack(viewer_client, viewer_user, db, store_ready):
    case_id = _create_viewer_owned_case(db, viewer_user)
    res = viewer_client.post(f"/api/cases/{case_id}/export/pack")
    assert res.status_code == 403, res.text
