"""Recover readable draft from newest snapshot when current JSON is corrupt."""

from __future__ import annotations

import json

from app.database import CaseReportSnapshot, InvestigationCase
from app.schemas import FacilityInfo, InvestigationReport
from app.services.case_store import dumps_list, report_for_case, report_from_json


def _valid_report_json() -> str:
    report = InvestigationReport(
        investigation_date="2026-08-20",
        facility_info=FacilityInfo(facility_address="123 Main St"),
        intake_details="Complaint text",
        allegation_preamble="",
        allegations=[],
        findings=[],
        report_text="Potential violation of WAC 246-341-0400.",
        selected_count=0,
        duration_ms=0,
        document_preview="",
        investigative_process=["Document Review"],
    )
    return report.model_dump_json()


def test_report_for_case_falls_back_to_newest_snapshot(db, auth_user):
    case = InvestigationCase(
        owner_user_id=auth_user.id,
        case_id_label="RECOVER-1",
        title="Corrupt current draft",
        status="draft",
        complaint_text="complaint",
        approved_wac_ids=dumps_list(["WAC 246-341-0400"]),
        current_report_json="{not-valid-json",
        status_changed_by=auth_user.id,
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    assert report_from_json(case.current_report_json) is None

    snap = CaseReportSnapshot(
        case_id=case.id,
        version=1,
        report_json=_valid_report_json(),
        report_text="ok",
        note="Last good draft",
        created_by=auth_user.id,
    )
    db.add(snap)
    db.commit()

    recovered = report_for_case(db, case)
    assert recovered is not None
    assert "246-341-0400" in (recovered.report_text or "")


def test_get_case_returns_snapshot_when_current_corrupt(client, store_ready, db, auth_user):
    case = InvestigationCase(
        owner_user_id=auth_user.id,
        case_id_label="RECOVER-2",
        title="Open with corrupt current",
        status="draft",
        complaint_text="complaint",
        approved_wac_ids=dumps_list(["WAC 246-341-0400"]),
        current_report_json=json.dumps({"title": "broken"}),
        status_changed_by=auth_user.id,
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    db.add(
        CaseReportSnapshot(
            case_id=case.id,
            version=2,
            report_json=_valid_report_json(),
            report_text="ok",
            note="Recoverable",
            created_by=auth_user.id,
        )
    )
    db.commit()

    res = client.get(f"/api/cases/{case.id}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["report"] is not None
    assert "246-341-0400" in (body["report"]["report_text"] or "")
