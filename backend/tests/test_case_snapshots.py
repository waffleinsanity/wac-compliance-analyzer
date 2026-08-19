"""Periodic draft persist and recall-point restore."""

from __future__ import annotations

from app.database import CaseReportSnapshot, InvestigationCase
from app.services.case_store import PERIODIC_SAVE_NOTE, persist_draft


def _create_case(client, title: str = "Recall case") -> tuple[int, dict]:
    inv = client.post(
        "/api/investigate",
        json={
            "text": "The administrator failed to operate the agency day to day.",
            "selected_wacs": ["WAC 246-341-0410"],
        },
    )
    assert inv.status_code == 200, inv.text
    report = inv.json()
    created = client.post(
        "/api/cases",
        json={
            "title": title,
            "complaint_text": "administrator failed day-to-day operation",
            "approved_wac_ids": ["WAC 246-341-0410"],
        },
    )
    assert created.status_code == 200, created.text
    cid = created.json()["id"]
    save = client.post(
        f"/api/cases/{cid}/save-draft",
        json={"report": report, "note": "Initial draft save"},
    )
    assert save.status_code == 200, save.text
    return cid, report


def test_identical_save_does_not_add_snapshot(client, store_ready):
    cid, report = _create_case(client)
    first = client.get(f"/api/cases/{cid}")
    n = len(first.json()["snapshots"])
    again = client.post(
        f"/api/cases/{cid}/save-draft",
        json={"report": report, "note": "Manual draft save"},
    )
    assert again.status_code == 200, again.text
    assert len(again.json()["snapshots"]) == n


def test_periodic_save_updates_current_without_spamming_versions(client, store_ready):
    cid, report = _create_case(client)
    before = client.get(f"/api/cases/{cid}").json()
    n = len(before["snapshots"])
    report["intake_details"] = (report.get("intake_details") or "") + " Investigator note A."
    a = client.post(
        f"/api/cases/{cid}/save-draft",
        json={"report": report, "note": PERIODIC_SAVE_NOTE},
    )
    assert a.status_code == 200, a.text
    # First periodic change can mint a recall point, or only update current if
    # the previous snapshot is still inside the quiet window.
    mid = a.json()
    assert mid["report"]["intake_details"].endswith("Investigator note A.")
    report["intake_details"] = (report.get("intake_details") or "") + " Note B."
    b = client.post(
        f"/api/cases/{cid}/save-draft",
        json={"report": report, "note": PERIODIC_SAVE_NOTE},
    )
    assert b.status_code == 200, b.text
    assert b.json()["report"]["intake_details"].endswith("Note B.")
    # Two rapid periodic saves must not add two versions.
    assert len(b.json()["snapshots"]) <= n + 1


def test_restore_snapshot_replaces_working_draft(client, store_ready):
    cid, report = _create_case(client)
    original = report.get("intake_details") or ""
    report["intake_details"] = original + " Changed for recall test."
    saved = client.post(
        f"/api/cases/{cid}/save-draft",
        json={"report": report, "note": "Manual draft save"},
    )
    assert saved.status_code == 200, saved.text
    snaps = saved.json()["snapshots"]
    assert len(snaps) >= 2
    older = snaps[-1]
    restored = client.post(f"/api/cases/{cid}/snapshots/{older['id']}/restore")
    assert restored.status_code == 200, restored.text
    body = restored.json()
    restored_intake = (body["report"] or {}).get("intake_details") or ""
    assert "Changed for recall test." not in restored_intake
    notes = [s.get("note") or "" for s in body["snapshots"]]
    assert any(n.startswith("Restored from version") for n in notes)


def test_restore_unknown_snapshot_is_404(client, store_ready):
    cid, _report = _create_case(client)
    res = client.post(f"/api/cases/{cid}/snapshots/999999/restore")
    assert res.status_code == 404


def test_prune_keeps_newest_periodic_snapshots(db, auth_user, client, store_ready):
    cid, report = _create_case(client, title="Prune case")
    row = db.query(InvestigationCase).filter(InvestigationCase.id == cid).first()
    assert row is not None
    for i in range(25):
        report["intake_details"] = f"periodic body {i}"
        persist_draft(
            db,
            row,
            report,
            auth_user,
            note=PERIODIC_SAVE_NOTE,
            snapshot_mode="always",
        )
        db.refresh(row)
    left = (
        db.query(CaseReportSnapshot)
        .filter(
            CaseReportSnapshot.case_id == cid,
            CaseReportSnapshot.note.like(f"{PERIODIC_SAVE_NOTE}%"),
        )
        .count()
    )
    assert left == 20
