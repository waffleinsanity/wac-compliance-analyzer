"""Lexical evidence-to-duty ranking; exhibit text is not statute authority."""

from __future__ import annotations

from app.schemas import EvidenceReviewHit
from app.services.evidence_review import (
    chunk_evidence_text,
    format_exhibit_process_line,
    is_citation_catalog,
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


MULTISTATE_CITE_TABLE = (
    "VA 12VAC35-105-800 MCA 37.106.1945 WAC 246-341-0670 LA §5655 NM 8.321.2 NMAC"
)


def test_multistate_cite_table_is_not_a_duty_match():
    assert is_citation_catalog(MULTISTATE_CITE_TABLE)
    query = (
        "be responsible for the day-to-day operation of the agency's "
        "provision of certified behavioral health treatment services"
    )
    assert _overlap_score(query, MULTISTATE_CITE_TABLE) == 0.0
    duty = (
        "maintain personnel records and complete criminal background checks "
        "before the employee provides services"
    )
    assert _overlap_score(duty, MULTISTATE_CITE_TABLE) == 0.0


def test_duty_query_is_statute_language_not_a_cite_string():
    report = _report()
    targets = _duty_targets(report)
    assert targets
    _cite, phrase, query = targets[0]
    assert phrase
    assert not query.upper().startswith("WAC ")
    assert "12VAC" not in query.upper()
    assert "NMAC" not in query.upper()


def test_process_line_uses_investigator_reviewed_title_and_date():
    hit = EvidenceReviewHit(
        id="ev1",
        evidence_id=1,
        evidence_title="P&P Infection Control.pdf",
        cite="WAC 246-341-0410(1)",
        excerpt="The administrator oversees day-to-day operation of certified services.",
        document_date="Effective Date: January 12, 2024",
        included_by_default=True,
    )
    line = format_exhibit_process_line(hit)
    assert line == 'The investigator reviewed "P&P Infection Control" dated January 12, 2024.'
    assert "as applied to" not in line
    assert "…" not in line
    assert "delegat" not in line
    merged = merge_exhibit_process_lines(
        [
            "Pre-investigation Activity:",
            "The Investigator reviewed the complaint allegations.",
            "Document Review",
            "The Investigator will review facility policies, procedures, and records relevant "
            "to the authorized allegations.",
            "Record review of exhibit OLD.pdf as applied to WAC 1: stale.",
        ],
        [hit],
    )
    assert "The Investigator reviewed the complaint allegations." in merged
    assert not any("OLD.pdf" in p for p in merged)
    assert not any("Record review of exhibit" in p for p in merged)
    docs = [p for p in merged if p.startswith("The investigator reviewed ")]
    assert len(docs) == 1
    assert '"P&P Infection Control"' in docs[0]


def test_legacy_record_review_lines_group_by_title_and_keep_complaint_review():
    from app.services.evidence_review import rewrite_legacy_document_review_lines

    merged = rewrite_legacy_document_review_lines(
        [
            "Pre-investigation Activity:",
            "The Investigator reviewed the complaint allegations.",
            "Document Review",
            "Record review of exhibit Administrator Responsibilities Policy-WA.pdf as applied "
            "to WAC 246-341-0410(1): a. All administrative matters b. Individual care services "
            "delegat...",
            "Record review of exhibit Administrator Responsibilities Policy-WA.pdf as applied "
            "to WAC 246-341-0600(1): PROCEDURE: 1. Charlie Health's administrator is responsible",
            "Record review of exhibit Suicide Risk Assessment and Prevention Policy.pdf as "
            "applied to WAC 246-341-0640(1)(c)(ii): Subject: Suicide Risk Assessment",
        ]
    )
    assert "The Investigator reviewed the complaint allegations." in merged
    assert not any("Record review of exhibit" in p for p in merged)
    assert not any("as applied to WAC" in p for p in merged)
    docs = [p for p in merged if p.startswith("The investigator reviewed ")]
    assert len(docs) == 2
    assert any('"Administrator Responsibilities Policy-WA"' in p for p in docs)
    assert any('"Suicide Risk Assessment and Prevention Policy"' in p for p in docs)
    assert all("dated" in p for p in docs)


def test_complaint_review_is_not_an_exhibit_line():
    from app.services.evidence_review import is_exhibit_process_line

    assert not is_exhibit_process_line("The Investigator reviewed the complaint allegations.")
    assert is_exhibit_process_line(
        'The investigator reviewed "P&P Infection Control" dated January 12, 2024.'
    )


def test_extract_document_date_from_policy_header():
    from app.services.evidence_review import extract_document_date

    assert extract_document_date("POLICY\nEffective Date: 3/4/2025\nThe administrator") == (
        "March 4, 2025"
    )


def test_complete_sentence_does_not_midword_clip():
    from app.services.evidence_review import complete_sentence_excerpt

    text = (
        "Charlie Health's administrator is responsible for the day-to-day operations of the "
        "agency's provision of certified behavioral health treatment services, including "
        "administrative matters."
    )
    out = complete_sentence_excerpt(text, max_chars=400)
    assert "…" not in out
    assert out.endswith(".")
    assert "day-to-day operations" in out


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
    assert any((h.get("wac_title") or "").strip() for h in body["hits"])
    assert all("12VAC" not in (h.get("excerpt") or "").upper() for h in body["hits"])


def test_evidence_review_skips_multistate_cite_table(client, store_ready):
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
            "title": "EV catalog",
            "complaint_text": "administrator failed day-to-day operation",
            "approved_wac_ids": ["WAC 246-341-0410"],
        },
    )
    cid = created.json()["id"]
    assert client.post(
        f"/api/cases/{cid}/save-draft",
        json={"report": report, "note": "test"},
    ).status_code == 200
    catalog = (
        "VA 12VAC35-105-800 MCA 37.106.1945 WAC 246-341-0670 LA §5655 NM 8.321.2 NMAC"
    ).encode("utf-8")
    up = client.post(
        f"/api/cases/{cid}/evidence",
        files={"file": ("crosswalk.txt", BytesIO(catalog), "text/plain")},
        data={"title": "Client Emergency-Crisis Prevention and Response Policy.pdf", "notes": "", "linked_wac_ids": "[]"},
    )
    assert up.status_code == 200, up.text
    rev = client.post(f"/api/cases/{cid}/evidence/review")
    assert rev.status_code == 200, rev.text
    body = rev.json()
    excerpts = " ".join(h.get("excerpt") or "" for h in body.get("hits") or [])
    assert "12VAC" not in excerpts.upper()
    assert "NMAC" not in excerpts.upper()
    assert not any("0420" in (h.get("cite") or "") for h in body.get("hits") or [])


def test_ranking_query_keeps_washington_cites_drops_foreign():
    from app.services.wac_scope import strip_foreign_jurisdiction_cites

    raw = (
        "Failed crisis response. VA 12VAC35-105-800 MCA 37.106.1945 "
        "WAC 246-341-0420 LA §5655 NM 8.321.2 NMAC"
    )
    cleaned = strip_foreign_jurisdiction_cites(raw)
    compact = cleaned.replace(" ", "").upper()
    assert "12VAC" not in compact
    assert "37.106" not in cleaned
    assert "246-341-0420" in cleaned
