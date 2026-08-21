"""Case Assist apply-process merges into DOH shell without replacing it."""

from __future__ import annotations

from app.services.case_store import merge_process_activity_bullets
from app.services.ir_blank import BLANK_PROCESS_SKELETON


def test_merge_process_activity_bullets_preserves_shell():
    bullets = ["2026-08-19 — Record review with Investigator: Reviewed policy manual."]
    merged = merge_process_activity_bullets(list(BLANK_PROCESS_SKELETON), bullets)
    assert merged[0] == "Pre-investigation Activity:"
    assert "Document Review" in merged
    assert bullets[0] in merged
    assert merged.index("Document Review") < merged.index(bullets[0])


def test_apply_process_endpoint_preserves_shell(client, store_ready):
    inv = client.post(
        "/api/investigate",
        json={
            "text": "Administrator failed day-to-day operation of certified services.",
            "selected_wacs": ["WAC 246-341-0410"],
        },
    )
    assert inv.status_code == 200, inv.text
    report = inv.json()
    created = client.post(
        "/api/cases",
        json={
            "title": "Apply process shell",
            "complaint_text": "administrator failed day-to-day operation",
            "approved_wac_ids": ["WAC 246-341-0410"],
        },
    )
    assert created.status_code == 200, created.text
    cid = created.json()["id"]
    save = client.post(
        f"/api/cases/{cid}/save-draft",
        json={"report": report, "note": "test"},
    )
    assert save.status_code == 200, save.text
    entry = client.post(
        f"/api/cases/{cid}/process-entries",
        json={
            "activity_date": "2026-08-19",
            "activity_type": "record_review",
            "who": "Investigator",
            "summary": "Reviewed administrator policy.",
        },
    )
    assert entry.status_code == 200, entry.text
    applied = client.post(f"/api/cases/{cid}/process-entries/apply")
    assert applied.status_code == 200, applied.text
    process = applied.json()["report"]["investigative_process"]
    assert any("Pre-investigation Activity" in (p or "") for p in process)
    assert any("Document Review" in (p or "") for p in process)
    assert any("Reviewed administrator policy" in (p or "") for p in process)
