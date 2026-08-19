"""DOCX export for Investigation Reports — blank template styles + DOH run formatting."""

from __future__ import annotations

import io
import re
from typing import Any

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_UNDERLINE
from docx.oxml.ns import qn
from docx.shared import Inches, Pt

from app.schemas import InvestigationReport
from app.services.ir_blank import (
    ACTIONS_LABEL,
    ALLEGATION_HEADER,
    CONCLUSION_HEADER,
    INTAKE_LABEL,
    PROCESS_HEADER,
    SUMMARY_HEADER,
    TITLE,
    blank_docx_path,
    compose_actions_text,
    parse_actions_fields,
)
from app.services.sod_blank import (
    DISCLAIMER,
    HEADER_LABELS,
    TABLE_HEADERS,
    TITLE as SOD_TITLE,
    cover_letter_paragraphs,
    format_findings_column,
    poc_instruction_paragraphs,
)


STYLE_TITLE = "No Spacing"
STYLE_HEADER = "Header"
STYLE_BODY = "No Spacing"

SIZE_SECTION = 16.0
SIZE_BODY = 12.0
# Peer IRs indent allegation / intake body ~0.5in under section headings
BODY_INDENT = Inches(0.5)

_UNDERLINE_LABELS = {
    "pre-investigation activity",
    "investigation activity",
}
_BOLD_SUBHEADS = {
    "observations",
    "interviews",
    "document review",
}


def _clear_body(doc: Document) -> None:
    body = doc.element.body
    for child in list(body):
        if child.tag == qn("w:sectPr"):
            continue
        body.remove(child)


def _set_run_font(
    run,
    *,
    size_pt: float = SIZE_BODY,
    bold: bool | None = None,
    italic: bool | None = None,
    underline: bool = False,
) -> None:
    run.font.name = "Times New Roman"
    run.font.size = Pt(size_pt)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if underline:
        run.underline = WD_UNDERLINE.SINGLE
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.get_or_add_rFonts()
    rFonts.set(qn("w:ascii"), "Times New Roman")
    rFonts.set(qn("w:hAnsi"), "Times New Roman")
    rFonts.set(qn("w:eastAsia"), "Times New Roman")


def _new_para(doc: Document, style: str):
    try:
        p = doc.add_paragraph(style=style)
    except KeyError:
        p = doc.add_paragraph()
    if p.runs:
        for run in p.runs:
            run.text = ""
    return p


def _add(
    doc: Document,
    text: str,
    style: str,
    *,
    bold: bool = False,
    italic: bool = False,
    underline: bool = False,
    size_pt: float = SIZE_BODY,
    center: bool = False,
    indent: bool = False,
) -> None:
    p = _new_para(doc, style)
    run = p.add_run(text or "")
    _set_run_font(run, size_pt=size_pt, bold=bold, italic=italic, underline=underline)
    if center:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if indent:
        p.paragraph_format.left_indent = BODY_INDENT


def _add_blank(doc: Document, style: str = STYLE_BODY) -> None:
    _add(doc, "", style)


def _add_facility_line(doc: Document, label: str, value: str) -> None:
    """Bold label + regular value (blank Header style)."""
    p = _new_para(doc, STYLE_HEADER)
    r1 = p.add_run(f"{label} ")
    _set_run_font(r1, size_pt=SIZE_BODY, bold=True)
    r2 = p.add_run(value or "")
    _set_run_font(r2, size_pt=SIZE_BODY, bold=False)


def _parse_heading(label: str) -> tuple[str, str | None]:
    """Split 'Title: (hint…)' or 'Title (hint…)' into title + parenthetical hint."""
    text = (label or "").strip()
    m = re.match(r"^(.+?:)\s*(\(.*\))\s*$", text, flags=re.DOTALL)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    m = re.match(r"^(.+?)\s+(\(.*\))\s*$", text, flags=re.DOTALL)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return text, None


def _add_section_heading(doc: Document, label: str) -> None:
    """16pt bold title + 12pt italic hint — matches blank Intake / Process / Summary."""
    title, hint = _parse_heading(label)
    p = _new_para(doc, STYLE_BODY)
    title_text = f"{title} " if hint else title
    r = p.add_run(title_text)
    _set_run_font(r, size_pt=SIZE_SECTION, bold=True)
    if hint:
        r2 = p.add_run(hint)
        _set_run_font(r2, size_pt=SIZE_BODY, italic=True)


def _norm_label(line: str) -> str:
    return re.sub(r"\s+", " ", (line or "").strip().rstrip(":").lower())


def _add_process_line(doc: Document, line: str) -> None:
    text = (line or "").rstrip()
    key = _norm_label(text)
    if key in _UNDERLINE_LABELS:
        # Blank: bold+underline on words; colon bold only (not underlined)
        p = _new_para(doc, STYLE_BODY)
        body = text.strip()
        if body.endswith(":"):
            r1 = p.add_run(body[:-1])
            _set_run_font(r1, size_pt=SIZE_BODY, bold=True, underline=True)
            r2 = p.add_run(":")
            _set_run_font(r2, size_pt=SIZE_BODY, bold=True)
        else:
            r = p.add_run(body)
            _set_run_font(r, size_pt=SIZE_BODY, bold=True, underline=True)
        return
    if key in _BOLD_SUBHEADS:
        _add(doc, text, STYLE_BODY, bold=True, size_pt=SIZE_BODY)
        return
    _add(doc, text, STYLE_BODY, size_pt=SIZE_BODY, indent=True)


def build_investigation_docx(
    report: InvestigationReport | dict[str, Any],
    *,
    draft_label: str = "Working draft — for investigator review",
) -> bytes:
    """Build IR DOCX using blank template styles and DOH run formatting."""
    del draft_label
    if isinstance(report, dict):
        report = InvestigationReport.model_validate(report)
    report = sync_report_text(report)

    path = blank_docx_path()
    if not path.is_file():
        raise FileNotFoundError(f"Blank Investigation Report template missing: {path}")

    doc = Document(str(path))
    _clear_body(doc)

    # Title: 16pt bold underline, centered
    p = _new_para(doc, STYLE_TITLE)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(TITLE)
    _set_run_font(r, size_pt=SIZE_SECTION, bold=True, underline=True)
    _add_blank(doc, STYLE_BODY)

    # Investigation type (blank content-control dropdown under title)
    inv_type = (getattr(report, "subtitle", None) or "").strip()
    if inv_type:
        _add(doc, inv_type, STYLE_BODY, italic=True, center=True, size_pt=SIZE_BODY)
        _add_blank(doc, STYLE_BODY)

    for label, value in facility_header_lines(report):
        _add_facility_line(doc, label, value)

    _add_blank(doc, STYLE_BODY)
    _add_section_heading(doc, INTAKE_LABEL)
    _add_blank(doc, STYLE_BODY)
    _add(
        doc,
        (report.intake_details or "").strip(),
        STYLE_BODY,
        size_pt=SIZE_BODY,
        indent=True,
    )
    _add_blank(doc, STYLE_BODY)

    _add_section_heading(doc, ALLEGATION_HEADER)
    _add_blank(doc, STYLE_BODY)
    for i, a in enumerate(report.allegations, start=1):
        _add(
            doc,
            allegation_export_line(a, index=i),
            STYLE_BODY,
            size_pt=SIZE_BODY,
            indent=True,
        )
        _add_blank(doc, STYLE_BODY)

    _add_section_heading(doc, PROCESS_HEADER)
    _add_blank(doc, STYLE_BODY)
    for step in report.investigative_process or []:
        _add_process_line(doc, str(step))

    _add_blank(doc, STYLE_BODY)
    _add_section_heading(doc, SUMMARY_HEADER)
    _add_blank(doc, STYLE_BODY)
    _add(
        doc,
        (report.summary_of_findings or "").strip(),
        STYLE_BODY,
        size_pt=SIZE_BODY,
        indent=True,
    )
    _add_blank(doc, STYLE_BODY)

    _add(doc, CONCLUSION_HEADER.strip(), STYLE_BODY, bold=True, size_pt=SIZE_SECTION)
    _add_blank(doc, STYLE_BODY)
    for line in conclusion_export_lines(report):
        _add(doc, line, STYLE_BODY, size_pt=SIZE_BODY, indent=True)
        _add_blank(doc, STYLE_BODY)

    _add(doc, ACTIONS_LABEL.strip(), STYLE_BODY, bold=True, size_pt=SIZE_SECTION)
    det, ref = parse_actions_fields(
        report.actions or "",
        determination=getattr(report, "action_determination", "") or "",
        referral=getattr(report, "action_referral", "") or "",
    )
    for line in compose_actions_text(det, ref).splitlines():
        _add(doc, line, STYLE_BODY, size_pt=SIZE_BODY, indent=True)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def build_deficiency_cite_sheet(report: InvestigationReport | dict[str, Any]) -> bytes:
    """Working cite sheet (internal). Prefer build_sod_docx for facility-facing SOD."""
    if isinstance(report, InvestigationReport):
        data = report.model_dump()
    else:
        data = report

    doc = Document()
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = title.add_run("Deficiency Cite Sheet (Working draft)")
    r.bold = True
    r.font.size = Pt(14)

    p = doc.add_paragraph(f"Case ID: {data.get('case_id') or '—'}")
    for run in p.runs:
        run.font.size = Pt(11)

    fi = data.get("facility_info") or {}
    doc.add_paragraph(f"Facility: {fi.get('facility_address') or '—'}")
    doc.add_paragraph(f"Credential: {fi.get('credential_number') or '—'}")
    doc.add_paragraph()

    sod = data.get("sod") or {}
    defs = sod.get("deficiencies") or []
    if defs:
        for d in defs:
            bp = doc.add_paragraph()
            br = bp.add_run(f"Cite: {d.get('regulation_cite') or ''}")
            br.bold = True
            doc.add_paragraph((d.get("based_on") or "")[:500])
            doc.add_paragraph()
    else:
        substantiated = [
            c
            for c in (data.get("conclusions") or [])
            if "substantiated" in (c.get("result") or "").lower()
        ]
        if not substantiated:
            doc.add_paragraph("No SOD deficiency blocks and no substantiated conclusions yet.")
        else:
            for c in substantiated:
                bp = doc.add_paragraph()
                br = bp.add_run(f"Cite: {c.get('wac_code') or ''}")
                br.bold = True
                doc.add_paragraph(c.get("allegation_text") or "")
                doc.add_paragraph(c.get("deficiency_details") or "Deficiency details pending.")
                doc.add_paragraph()

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def build_sod_docx(report: InvestigationReport | dict[str, Any]) -> bytes:
    """Facility-facing SOD pack: cover letter, POC instructions, report table.

    Identifier key is intentionally omitted. Plan of Correction column stays blank.
    """
    if isinstance(report, InvestigationReport):
        data = report.model_dump()
    else:
        data = report
    sod = data.get("sod") or {}
    fi = data.get("facility_info") or {}

    facility_name = (sod.get("facility_name") or fi.get("facility_address") or "").strip()
    facility_address = (sod.get("facility_address") or fi.get("facility_address") or "").strip()
    administrator = (sod.get("administrator") or "").strip()
    dates = (
        sod.get("investigation_dates")
        or fi.get("investigation_dates")
        or data.get("investigation_date")
        or ""
    )
    investigator = (sod.get("investigator_number") or "").strip()
    poc = int(sod.get("poc_due_days") or 14)
    case_id = sod.get("case_id") or data.get("case_id") or ""
    license_no = sod.get("credential_number") or fi.get("credential_number") or ""
    services = (sod.get("agency_services_type") or "").strip()
    inspection = (sod.get("inspection_type") or "Investigation").strip() or "Investigation"

    doc = Document()
    for section in doc.sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)

    def _p(text: str, *, bold: bool = False, size: float = 12.0, center: bool = False) -> None:
        para = doc.add_paragraph()
        if center:
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = para.add_run(text)
        run.font.size = Pt(size)
        run.font.name = "Arial"
        run.bold = bold

    for line in cover_letter_paragraphs(
        facility_name=facility_name,
        facility_address=facility_address,
        administrator=administrator,
        completed_on=dates,
        investigator_number=investigator,
        poc_due_days=poc,
        letter_date=dates,
    ):
        _p(line, bold=line.startswith("STATE OF WASHINGTON") or line.startswith("DEPARTMENT OF HEALTH"))

    doc.add_paragraph()
    _p(SOD_TITLE, bold=True, size=14.0, center=True)
    _p("Department of Health")
    _p("P.O. Box 47874, Olympia, WA 98504-7874")
    _p("TEL: 360-236-4732")
    _p(DISCLAIMER)

    doc.add_paragraph()
    for line in poc_instruction_paragraphs():
        heading = line in {
            "Plan of Correction Instructions",
            "Introduction",
            "Descriptive Content",
            "Completion Dates",
            "Continued Monitoring",
            "Checklist:",
            "Approval of POC",
            "Questions?",
        }
        _p(line, bold=heading)

    doc.add_paragraph()
    meta = doc.add_table(rows=4, cols=2)
    meta.style = "Table Grid"
    meta_rows = [
        (
            f"{HEADER_LABELS['agency']}\n{facility_name or 'N/A'}\n{facility_address or 'N/A'}",
            f"{HEADER_LABELS['administrator']}\n{administrator or 'N/A'}",
        ),
        (
            f"{HEADER_LABELS['inspection_type']}\n{inspection}",
            f"{HEADER_LABELS['investigation_start']}\n{dates or 'N/A'}",
        ),
        (
            f"{HEADER_LABELS['investigator_number']}\n{investigator or 'N/A'}",
            f"{HEADER_LABELS['case_number']}\n{case_id or 'N/A'}",
        ),
        (
            f"{HEADER_LABELS['license_number']}\n{license_no or 'N/A'}",
            f"{HEADER_LABELS['services_type']}\n{services or 'N/A'}",
        ),
    ]
    for i, (left, right) in enumerate(meta_rows):
        meta.rows[i].cells[0].text = left
        meta.rows[i].cells[1].text = right
    for row in meta.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.size = Pt(11)
                    run.font.name = "Arial"

    doc.add_paragraph()
    table = doc.add_table(rows=1, cols=3)
    table.style = "Table Grid"
    hdr = table.rows[0].cells
    hdr[0].text = TABLE_HEADERS[0]
    hdr[1].text = TABLE_HEADERS[1]
    hdr[2].text = TABLE_HEADERS[2]
    for cell in hdr:
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                run.bold = True
                run.font.size = Pt(11)
                run.font.name = "Arial"

    deficiencies = sod.get("deficiencies") or []
    if not deficiencies:
        row = table.add_row().cells
        row[0].text = "N/A"
        row[1].text = (
            "No deficiency blocks drafted yet. Confirm Compare duties and complete Findings included."
        )
        row[2].text = ""
    else:
        for idx, d in enumerate(deficiencies, start=1):
            row = table.add_row().cells
            cite_parts = [
                f"{idx}. {d.get('regulation_cite') or ''}",
                (d.get("regulation_text") or "").strip(),
            ]
            row[0].text = "\n\n".join(p for p in cite_parts if p)
            row[1].text = format_findings_column(d)
            row[2].text = ""
            for cell in row:
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        run.font.size = Pt(11)
                        run.font.name = "Arial"

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def build_sod_identifier_key(report: InvestigationReport | dict[str, Any]) -> bytes:
    """Internal-only identifier key — do not include in facility-facing packs by default."""
    if isinstance(report, InvestigationReport):
        data = report.model_dump()
    else:
        data = report
    sod = data.get("sod") or {}
    doc = Document()
    t = doc.add_paragraph()
    r = t.add_run("SOD Identifier Key (INTERNAL — do not send to facility)")
    r.bold = True
    r.font.size = Pt(14)
    for entry in sod.get("identifier_key") or []:
        doc.add_paragraph(
            f"{entry.get('kind') or 'Patient'} {entry.get('code') or ''}: "
            f"{entry.get('description') or ''}"
        )
    if not (sod.get("identifier_key") or []):
        doc.add_paragraph("No identifier mappings recorded yet.")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
