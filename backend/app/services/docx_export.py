from __future__ import annotations

import io
from typing import Any

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt

from app.schemas import InvestigationReport


def _add_heading(doc: Document, text: str, level: int = 1) -> None:
    doc.add_heading(text, level=level)


def _add_para(doc: Document, text: str, *, bold: bool = False) -> None:
    p = doc.add_paragraph()
    run = p.add_run(text or "")
    run.bold = bold
    run.font.size = Pt(11)


def build_investigation_docx(
    report: InvestigationReport | dict[str, Any],
    *,
    draft_label: str = "Working draft — for investigator review",
) -> bytes:
    if isinstance(report, InvestigationReport):
        data = report.model_dump()
    else:
        data = report

    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(11)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = title.add_run(data.get("title") or "Investigative Report")
    r.bold = True
    r.font.size = Pt(16)

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sr = sub.add_run(data.get("subtitle") or "State Investigation")
    sr.italic = True

    label = doc.add_paragraph()
    label.alignment = WD_ALIGN_PARAGRAPH.CENTER
    lr = label.add_run(draft_label)
    lr.italic = True
    lr.font.size = Pt(9)

    fi = data.get("facility_info") or {}
    _add_heading(doc, "Facility Information", 2)
    _add_para(doc, f"Facility address: {fi.get('facility_address') or ''}")
    _add_para(doc, f"Credential number: {fi.get('credential_number') or ''}")
    _add_para(doc, f"Medicare number: {fi.get('medicare_number') or 'N/A'}")
    _add_para(doc, f"Shell number: {fi.get('shell_number') or 'N/A'}")
    _add_para(
        doc,
        f"Date(s) of Investigation: {fi.get('investigation_dates') or data.get('investigation_date') or ''}",
    )
    if data.get("case_id"):
        _add_para(doc, f"Case ID: {data.get('case_id')}")

    _add_heading(doc, "Intake Details", 2)
    _add_para(doc, data.get("intake_details") or "")

    _add_heading(doc, "Allegation(s)", 2)
    preamble = data.get("allegation_preamble") or ""
    if preamble:
        _add_para(doc, preamble, bold=True)
    for a in data.get("allegations") or []:
        _add_para(doc, f"WAC/RCW {a.get('wac_code') or ''}: {a.get('wac_title') or ''}", bold=True)
        _add_para(doc, a.get("allegation_text") or "")

    _add_heading(doc, "Investigative Process Included", 2)
    for step in data.get("investigative_process") or []:
        doc.add_paragraph(str(step), style="List Bullet")

    _add_heading(doc, "Summary of Findings", 2)
    _add_para(doc, data.get("summary_of_findings") or "")

    _add_heading(doc, "Conclusion / Results of Investigation", 2)
    for c in data.get("conclusions") or []:
        result = c.get("result") or "Pending Investigation"
        line = f"{c.get('wac_code') or ''}: {result}."
        if c.get("deficiency_cited") and c.get("deficiency_details"):
            line += f" {c.get('deficiency_details')}"
        _add_para(doc, line)

    _add_heading(doc, "Actions", 2)
    _add_para(doc, data.get("actions") or "")

    if data.get("regulatory_framework"):
        _add_heading(doc, "Regulatory Framework", 2)
        for entry in data["regulatory_framework"]:
            _add_para(
                doc,
                f"{entry.get('instrument') or ''} {entry.get('code') or ''}: {entry.get('title') or ''}",
                bold=True,
            )
            for sub in entry.get("subsections") or []:
                cite = sub.get("cite") or sub.get("label") or ""
                text = sub.get("text") or ""
                if cite or text:
                    _add_para(doc, f"{cite} {text}".strip())

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

    _add_para(doc, f"Case ID: {data.get('case_id') or '—'}")
    fi = data.get("facility_info") or {}
    _add_para(doc, f"Facility: {fi.get('facility_address') or '—'}")
    _add_para(doc, f"Credential: {fi.get('credential_number') or '—'}")
    doc.add_paragraph()

    substantiated = [
        c
        for c in (data.get("conclusions") or [])
        if (c.get("result") or "") == "Substantiated"
    ]
    if not substantiated:
        _add_para(doc, "No substantiated conclusions in the current draft.")
    else:
        for c in substantiated:
            _add_para(doc, f"Cite: {c.get('wac_code') or ''}", bold=True)
            _add_para(doc, c.get("allegation_text") or "")
            _add_para(doc, c.get("deficiency_details") or "Deficiency details pending.")
            doc.add_paragraph()

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
