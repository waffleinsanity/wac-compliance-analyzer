"""Content review flags assistive IR/SOD text for removal before submission."""

from __future__ import annotations

from app.services.content_review import find_removal_spans, scan_investigation_report
from app.schemas import InvestigationReport, FacilityInfo


def test_flags_summary_shell_and_collaborator_block():
    text = (
        "This summary outlines how authorized WAC/RCW selections relate to the drafted "
        "allegations; investigative findings will be completed after interviews, "
        "observations, and document review.\n\n"
        "Investigative findings (to be completed):\n"
        "[Document review]\n"
        "Investigator collaborator notes (template — not findings):"
    )
    spans = find_removal_spans(text)
    assert spans
    joined = text[spans[0]["start"] : spans[-1]["end"]]
    assert "Investigative findings" in joined or "authorized WAC/RCW" in joined


def test_flags_sod_seed_sentences():
    based = "Based on observation, interview, and document review, the agency failed to maintain records."
    failure = (
        "Failure to maintain records places patients at risk of harm if the failed practice "
        "is left uncorrected."
    )
    assert find_removal_spans(based)
    assert find_removal_spans(failure)


def test_scan_report_groups_sod_and_ir_fields():
    report = InvestigationReport(
        investigation_date="2026-08-19",
        facility_info=FacilityInfo(facility_address="Washington State"),
        intake_details="Complaint text",
        allegation_preamble="",
        allegations=[],
        findings=[],
        report_text="",
        selected_count=0,
        duration_ms=0,
        document_preview="",
        summary_of_findings="Investigative findings (to be completed):\n[Interviews]",
        investigative_process=["Document Review", "[To be completed]"],
        sod={
            "title": "Statement of Deficiency Report",
            "deficiencies": [
                {
                    "regulation_cite": "WAC 246-341-0410(1)",
                    "based_on": "Based on observation, interview, and document review, the agency failed to operate the agency.",
                    "failure_to": "Failure to operate the agency places patients at risk of harm if the failed practice is left uncorrected.",
                    "findings": [{"text": "Review of case evidence Policy.pdf showed [describe the failed practice]."}],
                }
            ],
        },
    )
    flags = scan_investigation_report(report)
    fields = {f["field"] for f in flags}
    assert "facility.address" in fields
    assert "summary" in fields
    assert any(f.startswith("sod.") for f in fields)


def test_defensibility_includes_removal_checks():
    from app.services.defensibility import check_defensibility

    report = InvestigationReport(
        investigation_date="2026-08-19",
        facility_info=FacilityInfo(),
        intake_details="Complaint",
        allegation_preamble="",
        allegations=[],
        findings=[],
        report_text="",
        selected_count=0,
        duration_ms=0,
        document_preview="",
        summary_of_findings="Investigative findings (to be completed):\n[Observations]",
    )
    result = check_defensibility(report)
    assert any(c["code"].startswith("removal_required:") for c in result["checks"])


def test_shared_content_review_rules_file_loads():
    from app.services.content_review import load_content_review_rules
    from app.config import settings

    path = settings.project_root / "data" / "content_review_rules.json"
    assert path.is_file(), path
    rules = load_content_review_rules()
    assert "[To be completed]" in rules["literals"]
    assert "[document date]" in rules["literals"]
    assert any(p.get("reason") == "legacy_exhibit_line" for p in rules["patterns"])
    assert "Washington State" in rules["facility_placeholders"]


def test_prose_as_applied_to_wac_is_not_flagged():
    prose = "The investigator documented how the policy as applied to WAC 246-341-0410."
    assert not find_removal_spans(prose)