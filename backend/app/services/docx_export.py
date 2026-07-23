"""DOCX export for Investigation Reports — fill from the official blank template styles."""

from __future__ import annotations

import io
from typing import Any

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt

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
)
from app.services.ir_format import (
    allegation_export_line,
    conclusion_export_lines,
    facility_header_lines,
    sync_report_text,
)


STYLE_TITLE = "No Spacing"
STYLE_HEADER = "Header"
STYLE_BODY = "No Spacing"


def _clear_body(doc: Document) -> None:
    body = doc.element.body
    for child in list(body):
        if child.tag == qn("w:sectPr"):
            continue
        body.remove(child)


def _set_run_font(run, *, size_pt: float = 11, bold: bool | None = None) -> None:
    run.font.name = "Times New Roman"
    run.font.size = Pt(size_pt)
    if bold is not None:
        run.bold = bold
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.get_or_add_rFonts()
    rFonts.set(qn("w:ascii"), "Times New Roman")
    rFonts.set(qn("w:hAnsi"), "Times New Roman")
    rFonts.set(qn("w:eastAsia"), "Times New Roman")


def _add(doc: Document, text: str, style: str, *, bold: bool = False, center: bool = False) -> None:
    try:
        p = doc.add_paragraph(style=style)
    except KeyError:
        p = doc.add_paragraph()
    if p.runs:
        for run in p.runs:
            run.text = ""
    run = p.add_run(text or "")
    _set_run_font(run, bold=bold)
    if center:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER


def _add_blank(doc: Document, style: str = STYLE_BODY) -> None:
    _add(doc, "", style)


def build_investigation_docx(
    report: InvestigationReport | dict[str, Any],
    *,
    draft_label: str = "Working draft — for investigator review",
) -> bytes:
    """Build IR DOCX using blank template styles (Header / No Spacing).

    draft_label is accepted for API compatibility but is not written into the
    document body — peers and the blank have no draft watermark.
    """
    del draft_label
    if isinstance(report, dict):
        report = InvestigationReport.model_validate(report)
    report = sync_report_text(report)

    path = blank_docx_path()
    if not path.is_file():
        raise FileNotFoundError(f"Blank Investigation Report template missing: {path}")

    doc = Document(str(path))
    _clear_body(doc)

    _add(doc, TITLE, STYLE_TITLE, bold=True, center=True)
    _add_blank(doc, STYLE_BODY)

    for label, value in facility_header_lines(report):
        # Blank uses a trailing space after some labels; keep "Label: value"
        line = f"{label} {value}".rstrip() if value else f"{label} "
        _add(doc, line, STYLE_HEADER)

    _add_blank(doc, STYLE_BODY)
    _add(doc, INTAKE_LABEL, STYLE_BODY)
    _add_blank(doc, STYLE_BODY)
    _add(doc, (report.intake_details or "").strip(), STYLE_BODY)
    _add_blank(doc, STYLE_BODY)

    _add(doc, ALLEGATION_HEADER, STYLE_BODY)
    _add_blank(doc, STYLE_BODY)
    for a in report.allegations:
        _add(doc, allegation_export_line(a), STYLE_BODY)
        _add_blank(doc, STYLE_BODY)

    _add(doc, PROCESS_HEADER, STYLE_BODY)
    _add_blank(doc, STYLE_BODY)
    for step in report.investigative_process or []:
        _add(doc, str(step), STYLE_BODY)

    _add_blank(doc, STYLE_BODY)
    _add(doc, SUMMARY_HEADER, STYLE_BODY)
    _add_blank(doc, STYLE_BODY)
    _add(doc, (report.summary_of_findings or "").strip(), STYLE_BODY)
    _add_blank(doc, STYLE_BODY)

    _add(doc, CONCLUSION_HEADER, STYLE_BODY)
    _add_blank(doc, STYLE_BODY)
    for line in conclusion_export_lines(report):
        _add(doc, line, STYLE_BODY)
        _add_blank(doc, STYLE_BODY)

    _add(doc, ACTIONS_LABEL, STYLE_BODY)
    _add(doc, (report.actions or "[To be determined after investigation]").strip(), STYLE_BODY)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def build_deficiency_cite_sheet(report: InvestigationReport | dict[str, Any]) -> bytes:
    """Simple multi-doc pack companion: deficiency cite sheet from conclusions."""
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

    substantiated = [
        c
        for c in (data.get("conclusions") or [])
        if (c.get("result") or "") == "Substantiated"
    ]
    if not substantiated:
        doc.add_paragraph("No substantiated conclusions in the current draft.")
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
