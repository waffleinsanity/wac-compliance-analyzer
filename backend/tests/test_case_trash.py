"""Case trash / restore / purge lifecycle."""

from __future__ import annotations


def test_trash_restore_purge_case(client, store_ready):
    """client fixture already authenticates as accuracy_test admin/editor."""
    created = client.post(
        "/api/cases",
        json={
            "title": "Trash me",
            "complaint_text": "Test complaint for trash lifecycle.",
            "approved_wac_ids": ["WAC 246-341-0600"],
        },
    )
    assert created.status_code == 200, created.text
    case_id = created.json()["id"]

    trashed = client.post(f"/api/cases/{case_id}/trash")
    assert trashed.status_code == 200, trashed.text
    body = trashed.json()
    assert body["status"] == "trashed"
    assert body.get("trashed_at")

    # /status alias must also accept trashed
    again = client.post(f"/api/cases/{case_id}/status", json={"status": "trashed"})
    assert again.status_code == 200, again.text

    listed = client.get("/api/cases?view=trash")
    assert listed.status_code == 200
    assert any(c["id"] == case_id for c in listed.json())

    restored = client.post(f"/api/cases/{case_id}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "draft"

    assert client.post(f"/api/cases/{case_id}/trash").status_code == 200
    purged = client.delete(f"/api/cases/{case_id}")
    assert purged.status_code == 200, purged.text
    assert purged.json()["ok"] is True

    gone = client.get(f"/api/cases/{case_id}")
    assert gone.status_code == 404


def test_status_trashed_not_unsupported(client, store_ready):
    created = client.post(
        "/api/cases",
        json={"title": "Status trash", "complaint_text": "x"},
    )
    assert created.status_code == 200, created.text
    case_id = created.json()["id"]
    res = client.post(f"/api/cases/{case_id}/status", json={"status": "trashed"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "trashed"
    assert "Unsupported" not in (res.text or "")
