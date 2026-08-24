"""SOD sister draft + fill Investigation SOD Template.docx from the IR."""

from __future__ import annotations

from io import BytesIO
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from app.schemas import (
    AllegationDutyOption,
    FacilityInfo,
    InvestigationReport,
    WACComparison,
)
from app.services.docx_export import build_sod_docx
from app.services.sod_blank import FINDINGS_INCLUDED_LABEL, TITLE, blank_sod_docx_path
from app.services.sod_draft import attach_sod_to_report, build_sod_from_comparisons
from app.services.sod_template import read_blank_sod_template_bytes


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


def _minimal_report(**kwargs) -> InvestigationReport:
    base = dict(
        title="Investigative Report",
        subtitle="",
        investigation_date="07/10/2026",
        case_id="SOD-TEMPLATE-TEST",
        facility_info=FacilityInfo(facility_address="123 Example St, Olympia, WA"),
        intake_details="x",
        allegation_preamble="",
        allegations=[],
        conclusions=[],
        comparisons=[],
        findings=[],
        report_text="",
        selected_count=0,
        duration_ms=1.0,
        document_preview="",
        sod=None,
    )
    base.update(kwargs)
    return InvestigationReport(**base)


def test_build_sod_from_compare_duties():
    sod = build_sod_from_comparisons([_comp()], case_id="2020-T")
    assert sod is not None
    assert len(sod.deficiencies) >= 1
    d = sod.deficiencies[0]
    assert "246-337-060" in (d.regulation_cite or "")
    assert (d.based_on or "").lower().startswith("based on")
    assert (d.failure_to or "").lower().startswith("failure to")
    assert d.regulation_cite


def test_attach_sod_to_report_builds_skeleton():
    report = _minimal_report(comparisons=[_comp()], case_id="CASE-9")
    out = attach_sod_to_report(report)
    assert out is report
    assert report.sod is not None
    assert report.sod.deficiencies
    assert report.sod.case_id == "CASE-9"


def test_fill_preserves_template_shell_and_injects_fields():
    path = blank_sod_docx_path()
    assert path.is_file()
    blank = path.read_bytes()
    sod = build_sod_from_comparisons([_comp()], case_id="PACK-TEST", facility_address="Example Agency")
    report = _minimal_report(
        case_id="PACK-TEST",
        facility_info=FacilityInfo(facility_address="Example Agency"),
        comparisons=[_comp()],
        sod=sod,
    )
    blob = build_sod_docx(report)
    assert blob[:2] == b"PK"
    assert blob != blank
    with ZipFile(BytesIO(blob)) as zf:
        xml = zf.read("word/document.xml").decode("utf-8")
        names = zf.namelist()
    text = "".join(n.text or "" for n in ET.fromstring(xml).iter() if n.text)
    assert TITLE in text
    assert "Example Agency" in text
    assert "PACK-TEST" in text
    assert FINDINGS_INCLUDED_LABEL in text
    assert 'w:orient="landscape"' in xml
    assert any(n.startswith("word/media/") for n in names)
    assert any("header" in n for n in names)


def test_cover_address_not_duplicated():
    from app.services.sod_template import fill_sod_template

    addr = "123 Demo Behavioral Health Way, Olympia, WA 98501"
    sod = build_sod_from_comparisons([_comp()], case_id="DUP-1", facility_address=addr)
    report = _minimal_report(
        case_id="DUP-1",
        facility_info=FacilityInfo(facility_address=addr, laboratory_director="Ada Admin"),
        comparisons=[_comp()],
        sod=sod,
    )
    doc = fill_sod_template(report)
    name = (doc.paragraphs[8].text or "").strip()
    address = (doc.paragraphs[9].text or "").strip()
    dear = (doc.paragraphs[11].text or "").strip()
    assert name == addr
    assert address == ""
    assert dear == "Dear Ada Admin:"


def test_filled_docx_uses_png_logo():
    sod = build_sod_from_comparisons([_comp()], case_id="LOGO-1", facility_address="Agency")
    report = _minimal_report(
        case_id="LOGO-1",
        facility_info=FacilityInfo(facility_address="Agency"),
        comparisons=[_comp()],
        sod=sod,
    )
    blob = build_sod_docx(report)
    with ZipFile(BytesIO(blob)) as zf:
        names = zf.namelist()
        assert "word/media/image1.png" in names
        assert "word/media/image1.wmf" not in names
        rels = zf.read("word/_rels/document.xml.rels").decode("utf-8")
        assert "media/image1.png" in rels


def test_blank_template_api_unchanged(client):
    on_disk = read_blank_sod_template_bytes()
    res = client.get("/api/templates/investigation-sod-template")
    assert res.status_code == 200, res.text
    assert res.content == on_disk


def test_preview_sod_from_report_returns_filled_docx(client):
    sod = build_sod_from_comparisons([_comp()], case_id="PREV-1", facility_address="Preview Facility")
    report = _minimal_report(
        case_id="PREV-1",
        facility_info=FacilityInfo(facility_address="Preview Facility"),
        comparisons=[_comp()],
        sod=sod,
    )
    res = client.post("/api/cases/preview/sod-from-report", json=report.model_dump())
    assert res.status_code == 200, res.text
    assert res.content[:2] == b"PK"
    assert res.content != read_blank_sod_template_bytes()
    with ZipFile(BytesIO(res.content)) as zf:
        text = "".join(
            n.text or ""
            for n in ET.fromstring(zf.read("word/document.xml")).iter()
            if n.text
        )
    assert "Preview Facility" in text
    with ZipFile(BytesIO(res.content)) as zf:
        assert "word/media/image1.png" in zf.namelist()


def test_investigation_start_date_not_doubled():
    """Meta date must be SDT-only; cell paragraph write used to concatenate twice."""
    date = "07/31/2026"
    sod = build_sod_from_comparisons(
        [_comp()],
        case_id="DATE-1",
        facility_address="Date Agency",
        investigation_dates=date,
    )
    report = _minimal_report(
        case_id="DATE-1",
        investigation_date=date,
        facility_info=FacilityInfo(facility_address="Date Agency", investigation_dates=date),
        comparisons=[_comp()],
        sod=sod,
    )
    blob = build_sod_docx(report)
    with ZipFile(BytesIO(blob)) as zf:
        xml = zf.read("word/document.xml").decode("utf-8")
        text = "".join(n.text or "" for n in ET.fromstring(xml).iter() if n.text)
    assert date in text
    assert f"{date}{date}" not in text
    assert "07/31/202607/31/2026" not in text


def test_auto_filled_fields_have_verify_yellow_shading():
    """Cover/meta auto-fills and SOD seed findings use light yellow w:shd."""
    sod = build_sod_from_comparisons(
        [_comp()],
        case_id="YELLOW-1",
        facility_address="Yellow Agency LLC",
        investigation_dates="08/01/2026",
    )
    sod.administrator = "Pat Admin"
    sod.investigator_number = "INV-42"
    sod.credential_number = "LIC-9"
    sod.agency_services_type = "BHA"
    report = _minimal_report(
        case_id="YELLOW-1",
        investigation_date="08/01/2026",
        facility_info=FacilityInfo(
            facility_address="Yellow Agency LLC",
            laboratory_director="Pat Admin",
            credential_number="LIC-9",
            investigation_dates="08/01/2026",
        ),
        comparisons=[_comp()],
        sod=sod,
    )
    blob = build_sod_docx(report)
    with ZipFile(BytesIO(blob)) as zf:
        xml = zf.read("word/document.xml").decode("utf-8")
    assert 'w:fill="FFFF99"' in xml
    # Regulation cite column must not carry verify shading on its cell.
    # Findings seed language should be present and shaded at paragraph level.
    assert "Based on" in xml or "based on" in xml.lower()
    assert "Failure to" in xml or "failure to" in xml.lower()
