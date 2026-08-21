"""Persist legacy Document Review rewrite on first case open."""

from __future__ import annotations

import json

from app.schemas import FacilityInfo, InvestigationReport
from app.services.case_store import raw_has_legacy_document_review, report_from_json


def _legacy_report_payload() -> dict:
    report = InvestigationReport(
        investigation_date="2026-08-19",
        facility_info=FacilityInfo(facility_address="123 Main St"),
        intake_details="Complaint text",
        allegation_preamble="",
        allegations=[],
        findings=[],
        report_text="",
        selected_count=0,
        duration_ms=0,
        document_preview="",
        investigative_process=[
            "Pre-investigation Activity:",
            "The Investigator reviewed the complaint allegations.",
            "Document Review",
            "Record review of exhibit Admin Policy.pdf as applied to WAC 246-341-0410(1): stale excerpt.",
        ],
    )
    return report.model_dump()


def test_raw_has_legacy_document_review_detects_prefix():
    payload = json.dumps(_legacy_report_payload())
    assert raw_has_legacy_document_review(payload)
    cleaned = report_from_json(payload)
    assert cleaned is not None
    assert not any("Record review of exhibit" in (p or "") for p in cleaned.investigative_process)
    assert any('The investigator reviewed "Admin Policy"' in (p or "") for p in cleaned.investigative_process)


def test_get_case_persists_legacy_document_review_rewrite(client, store_ready, db, auth_user):
    from app.database import InvestigationCase
    from app.services.case_store import dumps_list

    payload = _legacy_report_payload()
    case = InvestigationCase(
        owner_user_id=auth_user.id,
        case_id_label="LEGACY-DOC-1",
        title="Legacy document review",
        status="draft",
        complaint_text="administrator failed day-to-day",
        approved_wac_ids=dumps_list(["WAC 246-341-0410"]),
        current_report_json=json.dumps(payload),
        status_changed_by=auth_user.id,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    assert raw_has_legacy_document_review(case.current_report_json)

    res = client.get(f"/api/cases/{case.id}")
    assert res.status_code == 200, res.text
    process = res.json()["report"]["investigative_process"]
    assert not any("Record review of exhibit" in (p or "") for p in process)
    assert any('The investigator reviewed "Admin Policy"' in (p or "") for p in process)

    db.refresh(case)
    assert not raw_has_legacy_document_review(case.current_report_json)
    stored = json.loads(case.current_report_json or "{}")
    assert any(
        'The investigator reviewed "Admin Policy"' in (p or "")
        for p in (stored.get("investigative_process") or [])
    )
