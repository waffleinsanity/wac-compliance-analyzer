"""Evolving IR learning bank: harvest on complete + connector reuse."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.database import InvestigationCase, IrLearningSnippet, User
from app.main import app
from app.schemas import (
    FacilityInfo,
    InvestigationAllegation,
    InvestigationConclusion,
    InvestigationReport,
)
from app.services.case_store import dumps_list
from app.services.ir_learning import harvest_completed_ir, preferred_connector_for
from app.services.wac_scope import draft_allegation_from_source


def _sample_report(*, connector: str = "failing to") -> InvestigationReport:
    allegation = (
        f"Potential violation of WAC 246-341-0600, Agency policies and procedures, "
        f"by {connector} (1) maintain confidentiality of patient records as required."
    )
    return InvestigationReport(
        title="Investigative Report",
        subtitle="",
        investigation_date="01/15/2026",
        case_id="LRN-1",
        facility_info=FacilityInfo(facility_address="Test Facility", credential_number="BHA.FS.1"),
        intake_details=(
            "The Department of Health (DOH) received a complaint alleging the agency "
            "disclosed confidential patient information without consent."
        ),
        allegation_preamble=(
            "The allegation(s) listed below is what the department has jurisdiction and "
            "authorization to investigate. An allegation is considered an assertion of "
            "improper practice or condition that could result in a violation of facility "
            "law or rule."
        ),
        allegations=[
            InvestigationAllegation(
                case_category="BHA",
                wac_code="246-341-0600",
                wac_title="Agency policies and procedures",
                allegation_text=allegation,
                status="source-pdf",
                confidence=0.9,
                matched_subsections=["246-341-0600(1)"],
                match_reason="test",
                match_score=0.9,
                low_confidence=False,
            )
        ],
        investigative_process=[
            "Reviewed agency policies and procedures for confidentiality.",
            "Interviewed the complainant regarding the alleged disclosure.",
        ],
        summary_of_findings=(
            "This summary outlines how authorized WAC selections relate to the drafted "
            "allegations; investigative findings will be completed after interviews."
        ),
        conclusions=[
            InvestigationConclusion(
                wac_code="246-341-0600",
                allegation_text=allegation,
                result="Pending Investigation",
            )
        ],
        actions="[To be determined after investigation]",
        comparisons=[],
        findings=[],
        report_text=allegation,
        selected_count=1,
        duration_ms=1.0,
        document_preview="complaint preview",
    )


def test_harvest_stores_wac_language_and_connector(db, store_ready, auth_user):
    case = InvestigationCase(
        owner_user_id=auth_user.id,
        case_id_label="LRN-H1",
        title="Learning harvest",
        status="draft",
        complaint_text="Agency disclosed PHI without consent.",
        approved_wac_ids=dumps_list(["246-341-0600"]),
        status_changed_by=auth_user.id,
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    report = _sample_report(connector="failing to")
    result = harvest_completed_ir(db, case, report, auth_user, trigger="submitted")
    assert result["saved"] >= 2

    rows = (
        db.query(IrLearningSnippet)
        .filter(IrLearningSnippet.source_case_id == case.id)
        .all()
    )
    assert rows
    assert any(r.section_type == "wac_language" for r in rows)
    assert any(r.section_type == "allegation_shape" for r in rows)
    assert preferred_connector_for(db, "246-341-0600", ["confidentiality"]) == "failing to"


def test_preferred_connector_shapes_new_draft(db, store_ready, auth_user):
    case = InvestigationCase(
        owner_user_id=auth_user.id,
        case_id_label="LRN-H2",
        title="Connector reuse",
        status="draft",
        complaint_text="Confidentiality breach complaint.",
        approved_wac_ids=dumps_list(["246-341-0600"]),
        status_changed_by=auth_user.id,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    # Harvest twice so weight beats the Baseline prior on "having failed to".
    report = _sample_report(connector="failing to")
    harvest_completed_ir(db, case, report, auth_user, trigger="finalized")
    harvest_completed_ir(db, case, report, auth_user, trigger="export_docx")

    connector = preferred_connector_for(db, "246-341-0600", ["confidentiality"])
    assert connector == "failing to"
    draft = draft_allegation_from_source(
        "246-341-0600",
        "Agency policies and procedures",
        "The Department of Health (DOH) received a complaint alleging disclosure of confidential information.",
        preferred_connector=connector,
    )
    assert "by failing to" in draft.text.lower()


def test_submit_status_harvests_via_api(db, store_ready, auth_user):
    case = InvestigationCase(
        owner_user_id=auth_user.id,
        case_id_label="LRN-API",
        title="API harvest",
        status="draft",
        complaint_text="Agency disclosed PHI without consent.",
        approved_wac_ids=dumps_list(["246-341-0600"]),
        status_changed_by=auth_user.id,
        current_report_json=_sample_report().model_dump_json(),
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    def _override():
        return auth_user

    app.dependency_overrides[get_current_user] = _override
    try:
        with TestClient(app) as client:
            res = client.post(f"/api/cases/{case.id}/status", json={"status": "in_review"})
            assert res.status_code == 200, res.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    learned = (
        db.query(IrLearningSnippet)
        .filter(IrLearningSnippet.wac_code == "246-341-0600")
        .count()
    )
    assert learned >= 1
