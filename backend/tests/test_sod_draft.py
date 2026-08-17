"""SOD sister draft + validators (structure/voice; PDF store for statute text)."""

from __future__ import annotations

import json
from pathlib import Path

from app.schemas import (
    AllegationDutyOption,
    FacilityInfo,
    InvestigationConclusion,
    InvestigationReport,
    SodIdentifierEntry,
    WACComparison,
)
from app.services.docx_export import build_sod_docx
from app.services.guidance_corpus import IR_CONCLUSION_SUBSTANTIATED_DEFICIENT
from app.services.ir_blank import format_conclusion_line, normalize_ir_conclusion
from app.services.sod_draft import attach_sod_to_report, build_sod_from_comparisons
from app.services.sod_validate import validate_report_sod_consistency, validate_sod

CASES = Path(__file__).parent / "fixtures" / "cases"


def _duty(cite: str = "(1)(f)", phrase: str | None = None) -> AllegationDutyOption:
    return AllegationDutyOption(
        cite=cite,
        label=cite,
        duty_phrase=phrase
        or "Developing and implementing policies for: Management of staff.",
        included_by_default=True,
        band="strong",
        score=0.9,
    )


def _comp(code: str = "246-337-060") -> WACComparison:
    return WACComparison(
        wac_id="x",
        code=code,
        title="Infection control",
        chapter="246-337",
        hierarchy_path=code,
        wac_text="Developing and implementing policies for: Management of staff.",
        wac_summary="Infection control",
        allegation_draft=f"Potential violation of WAC {code}",
        duty_options=[_duty()],
        matched_subsections=["(1)(f)"],
    )


def test_build_sod_from_compare_duties():
    sod = build_sod_from_comparisons([_comp()], case_id="2020-T")
    assert len(sod.deficiencies) >= 1
    d = sod.deficiencies[0]
    assert "246-337-060" in (d.regulation_cite or "")
    assert (d.based_on or "").lower().startswith("based on")
    assert (d.failure_to or "").lower().startswith("failure to")
    assert d.regulation_text


def test_validate_sod_flags_empty_findings():
    sod = build_sod_from_comparisons([_comp()])
    issues = validate_sod(sod)
    reasons = {i["reason"] for i in issues}
    assert "findings_empty" in reasons


def test_ir_conclusion_normalization():
    assert normalize_ir_conclusion("not in compliance") == IR_CONCLUSION_SUBSTANTIATED_DEFICIENT
    assert normalize_ir_conclusion("in compliance") == "Not Substantiated"
    line = format_conclusion_line(
        wac_code="246-337-060",
        wac_title="Infection control",
        result=IR_CONCLUSION_SUBSTANTIATED_DEFICIENT,
    )
    assert "Concerning Infection control" in line
    assert "Substantiated with deficient" in line


def test_sod_docx_omits_identifier_key():
    report = InvestigationReport(
        title="Investigative Report",
        subtitle="",
        investigation_date="07/10/2026",
        case_id="KEY-TEST",
        facility_info=FacilityInfo(facility_address="WA"),
        intake_details="x",
        allegation_preamble="",
        allegations=[],
        conclusions=[],
        comparisons=[_comp()],
        findings=[],
        report_text="",
        selected_count=1,
        duration_ms=1.0,
        document_preview="",
    )
    attach_sod_to_report(report)
    assert report.sod is not None
    report.sod.identifier_key = [
        SodIdentifierEntry(kind="Patient", code="Patient #1", description="Jane Doe")
    ]
    blob = build_sod_docx(report)
    assert blob[:2] == b"PK"
    assert b"Jane Doe" not in blob
    assert b"Patient #1" not in blob


def test_consistency_warns_deficient_without_sod():
    report = InvestigationReport(
        title="Investigative Report",
        subtitle="",
        investigation_date="07/10/2026",
        facility_info=FacilityInfo(),
        intake_details="x",
        allegation_preamble="",
        allegations=[],
        conclusions=[
            InvestigationConclusion(
                wac_code="246-337-060",
                allegation_text="Infection control",
                result=IR_CONCLUSION_SUBSTANTIATED_DEFICIENT,
                deficiency_cited=True,
            )
        ],
        findings=[],
        report_text="",
        selected_count=0,
        duration_ms=1.0,
        document_preview="",
        sod=None,
    )
    issues = validate_report_sod_consistency(report)
    assert any(i["reason"] == "ir_deficient_without_sod" for i in issues)


def test_investigate_returns_sister_sod(client):
    case = json.loads((CASES / "assault_safety.json").read_text(encoding="utf-8"))
    res = client.post(
        "/api/investigate",
        json={"text": case["complaint"], "selected_wacs": case["selected_wacs"]},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data.get("sod", {}).get("deficiencies")
    raw = build_sod_docx(data)
    assert raw[:2] == b"PK"
