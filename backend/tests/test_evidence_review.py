"""Lexical evidence-to-duty ranking; exhibit text is not statute authority."""

from __future__ import annotations

from app.schemas import EvidenceReviewHit
from app.services.evidence_review import (
    chunk_evidence_text,
    format_exhibit_process_line,
    merge_exhibit_process_lines,
)
from app.services.evidence_review import _overlap_score, _duty_targets
from app.schemas import InvestigationAllegation, InvestigationReport, WACComparison, AllegationDutyOption, FacilityInfo


def _report() -> InvestigationReport:
    return InvestigationReport(
        investigation_date="2026-08-19",
        facility_info=FacilityInfo(),
        intake_details="DOH received a complaint.",
        allegation_preamble="",
        allegations=[
            InvestigationAllegation(
                wac_code="246-341-0410",
                wac_title="Administrator",
                allegation_text="Potential violation of WAC 246-341-0410.",
            )
        ],
        comparisons=[
            WACComparison(
                wac_id="WAC 246-341-0410",
                code="246-341-0410",
                title="Administrator key responsibilities",
                chapter="246-341",
                hierarchy_path="246-341-0410",
                wac_text="must",
                wac_summary="must",
                allegation_draft="Potential violation of WAC 246-341-0410.",
                duty_options=[
                    AllegationDutyOption(
                        cite="WAC 246-341-0410(1)",
                        label="(1)",
                        duty_phrase=(
                            "be responsible for the day-to-day operation of the agency's "
                            "provision of certified behavioral health treatment services"
                        ),
                        included_by_default=True,
                    )
                ],
            )
        ],
        findings=[],
        report_text="",
        selected_count=1,
        duration_ms=0,
        document_preview="",
    )


def test_policy_chunk_overlaps_administrator_duty():
    policy = (
        "The administrator is responsible for the day-to-day operation of the agency "
        "and shall ensure certified behavioral health treatment services are provided."
    )
    chunks = chunk_evidence_text(policy)
    assert chunks
    report = _report()
    targets = _duty_targets(report)
    assert targets
    score = _overlap_score(targets[0][2], chunks[0])
    assert score >= 0.28


def test_unrelated_policy_scores_low():
    chunk = "Fire extinguishers shall be inspected monthly and tagged by facilities staff."
    query = (
        "WAC 246-341-0410(1) be responsible for the day-to-day operation of the agency's "
        "provision of certified behavioral health treatment services"
    )
    assert _overlap_score(query, chunk) < 0.18


def test_process_line_has_no_quotation_marks():
    hit = EvidenceReviewHit(
        id="ev1",
        evidence_id=1,
        evidence_title="P&P Infection Control",
        cite="WAC 246-341-0410(1)",
        excerpt="The administrator oversees day-to-day operation of certified services.",
        included_by_default=True,
    )
    line = format_exhibit_process_line(hit)
    assert '"' not in line
    assert "P&P Infection Control" in line
    assert "WAC 246-341-0410(1)" in line
    merged = merge_exhibit_process_lines(
        ["Interviewed the administrator.", "Record review of exhibit OLD.pdf as applied to WAC 1: stale."],
        [hit],
    )
    assert merged[0].startswith("Interviewed")
    assert not any("OLD.pdf" in p for p in merged)
    assert any("P&P Infection Control" in p for p in merged)


def test_evidence_review_api_returns_hits(client, store_ready):
    from io import BytesIO

    inv = client.post(
        "/api/investigate",
        json={
            "text": (
                "The administrator failed to operate the agency day to day and did not "
                "follow policies for certified behavioral health treatment services."
            ),
            "selected_wacs": ["WAC 246-341-0410"],
        },
    )
    assert inv.status_code == 200, inv.text
    report = inv.json()
    created = client.post(
        "/api/cases",
        json={
            "title": "EV review",
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
    policy = (
        b"Agency policy: The administrator is responsible for the day-to-day operation "
        b"of the agency and certified behavioral health treatment services. Staff shall "
        b"adhere to clinical policies."
    )
    up = client.post(
        f"/api/cases/{cid}/evidence",
        files={"file": ("policy.txt", BytesIO(policy), "text/plain")},
        data={"title": "Admin P&P", "notes": "", "linked_wac_ids": "[]"},
    )
    assert up.status_code == 200, up.text
    rev = client.post(f"/api/cases/{cid}/evidence/review")
    assert rev.status_code == 200, rev.text
    body = rev.json()
    assert body["scanned_count"] >= 1
    assert body["hits"], body.get("message")
    assert any("0410" in (h.get("cite") or "") for h in body["hits"])
