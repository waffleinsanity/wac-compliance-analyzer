"""Evidence cite model: pack-relative hyperlinks from IR/SOD to exhibit files.

Primary model for referring to evidence (not the Excel log alone):
- Stable exhibit ordinals (#1, #2, …)
- Pack path ``evidence/Exhibit_NN_SafeName.ext``
- Excerpt + page/paragraph label for tooltips
- DOCX superscript runs as hyperlinks so unzipped packs stay navigable offline
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

from app.database import CaseEvidence
from app.schemas import InvestigationReport
from app.services.documents import extract_text_from_bytes
from app.services.evidence_log import (
    ExhibitRow,
    append_exhibit_superscript,
    exhibit_superscript,
    strip_trailing_superscripts,
)
from app.services.evidence_review import display_evidence_title, evidence_file_path

_SAFE = re.compile(r"[^a-zA-Z0-9._-]+")
_TITLE_IN_SUMMARY = re.compile(
    r'Review of (?:a |the )?document titled\s+"([^"]+)"\s*,\s*dated\s+',
    re.IGNORECASE,
)


@dataclass(frozen=True)
class EvidenceCite:
    evidence_id: int
    exhibit_no: int
    title: str
    filename: str
    pack_relpath: str
    excerpt: str
    page_label: str
    document_date: str = ""

    @property
    def superscript(self) -> str:
        return exhibit_superscript(self.exhibit_no)

    @property
    def tooltip(self) -> str:
        parts = [f"Exhibit #{self.exhibit_no}: {self.title}"]
        if self.page_label:
            parts.append(self.page_label)
        body = (self.excerpt or "").strip()
        if body:
            sample = body if len(body) <= 280 else body[:277].rsplit(" ", 1)[0] + "…"
            parts.append(sample)
        return " · ".join(parts)


def pack_exhibit_filename(ex: ExhibitRow) -> str:
    """Safe filename for the evidence/ folder inside the case pack zip."""
    ev = ex.evidence
    raw = (ev.original_filename or ev.title or f"exhibit_{ex.exhibit_no}").strip()
    stem = Path(raw).stem
    ext = Path(raw).suffix or ".txt"
    if ext.lower() not in {".pdf", ".docx", ".doc", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp"}:
        ext = ".txt"
    safe = _SAFE.sub("_", stem).strip("._")[:60] or f"exhibit_{ex.exhibit_no}"
    return f"Exhibit_{ex.exhibit_no:02d}_{safe}{ext}"


def pack_exhibit_relpath(ex: ExhibitRow) -> str:
    return f"evidence/{pack_exhibit_filename(ex)}"


def locate_excerpt_locus(
    filename: str,
    data: bytes,
    excerpt: str,
) -> str:
    """Human page/paragraph label for a tooltip (best-effort; never invent statute text)."""
    needle = re.sub(r"\s+", " ", (excerpt or "").strip())
    if len(needle) < 12:
        return ""
    name = (filename or "").lower()
    sample = needle[:80]
    try:
        if name.endswith(".pdf"):
            import fitz

            doc = fitz.open(stream=data, filetype="pdf")
            for i in range(len(doc)):
                page_text = re.sub(r"\s+", " ", (doc[i].get_text() or ""))
                if sample.lower() in page_text.lower() or needle[:40].lower() in page_text.lower():
                    return f"p. {i + 1}"
            if len(doc) >= 1:
                return "p. 1"
            return ""
        text = extract_text_from_bytes(filename, data)
        paras = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
        for i, para in enumerate(paras, start=1):
            flat = re.sub(r"\s+", " ", para)
            if sample.lower() in flat.lower() or needle[:40].lower() in flat.lower():
                return f"¶ {i}"
        # Fall back to character-offset estimate for long single blocks.
        flat_all = re.sub(r"\s+", " ", text)
        idx = flat_all.lower().find(needle[:40].lower())
        if idx >= 0:
            # Rough 1800 chars/page heuristic for plain text / DOCX paste.
            page = max(1, idx // 1800 + 1)
            return f"p. {page} (est.)"
    except Exception:
        return ""
    return ""


def _hit_excerpt_for_evidence(
    report: InvestigationReport,
    evidence_id: int,
) -> tuple[str, str]:
    """Best included evidence_review excerpt + document_date for an exhibit."""
    best = ""
    dated = ""
    best_score = -1.0
    for hit in report.evidence_review or []:
        if isinstance(hit, dict):
            eid = hit.get("evidence_id")
            included = bool(hit.get("included_by_default", True))
            excerpt = str(hit.get("excerpt") or "")
            score = float(hit.get("score") or 0)
            doc_date = str(hit.get("document_date") or "")
        else:
            eid = getattr(hit, "evidence_id", None)
            included = bool(getattr(hit, "included_by_default", True))
            excerpt = str(getattr(hit, "excerpt", "") or "")
            score = float(getattr(hit, "score", 0) or 0)
            doc_date = str(getattr(hit, "document_date", "") or "")
        if not included or int(eid or 0) != int(evidence_id):
            continue
        if score >= best_score and excerpt.strip():
            best_score = score
            best = excerpt.strip()
            dated = doc_date
    return best, dated


def build_evidence_cites(
    report: InvestigationReport,
    exhibits: list[ExhibitRow],
) -> list[EvidenceCite]:
    """One cite row per exhibit with pack path, excerpt, and locus label."""
    out: list[EvidenceCite] = []
    for ex in exhibits:
        ev = ex.evidence
        title = display_evidence_title(ev.title or ev.original_filename or f"document {ev.id}")
        excerpt, dated = _hit_excerpt_for_evidence(report, ex.evidence_id)
        page_label = ""
        try:
            path = evidence_file_path(ev)
            if path.is_file() and excerpt:
                page_label = locate_excerpt_locus(
                    ev.original_filename or path.name,
                    path.read_bytes(),
                    excerpt,
                )
        except Exception:
            page_label = ""
        out.append(
            EvidenceCite(
                evidence_id=ex.evidence_id,
                exhibit_no=ex.exhibit_no,
                title=title,
                filename=ev.original_filename or pack_exhibit_filename(ex),
                pack_relpath=pack_exhibit_relpath(ex),
                excerpt=excerpt,
                page_label=page_label,
                document_date=dated,
            )
        )
    return out


def cite_map_by_title(cites: list[EvidenceCite]) -> dict[str, EvidenceCite]:
    out: dict[str, EvidenceCite] = {}
    for c in cites:
        key = c.title.strip().lower()
        if key and key not in out:
            out[key] = c
        stem = Path(c.filename).stem.strip().lower()
        if stem and stem not in out:
            out[stem] = c
    return out


def resolve_summary_paragraph_cite(
    paragraph: str,
    cites: list[EvidenceCite],
) -> EvidenceCite | None:
    """Match a Summary document-review paragraph to its exhibit cite."""
    m = _TITLE_IN_SUMMARY.search(paragraph or "")
    if not m:
        return None
    title = display_evidence_title(m.group(1)).strip().lower()
    by_title = cite_map_by_title(cites)
    if title in by_title:
        return by_title[title]
    for key, cite in by_title.items():
        if title in key or key in title:
            return cite
    return None


def annotate_summary_with_exhibit_cites(
    summary: str,
    cites: list[EvidenceCite],
) -> str:
    """Append Unicode exhibit superscripts to matching Summary paragraphs."""
    parts = [p.strip() for p in (summary or "").split("\n\n") if p.strip()]
    out: list[str] = []
    for para in parts:
        cite = resolve_summary_paragraph_cite(para, cites)
        if cite and cite.exhibit_no > 0:
            base, _ = strip_trailing_superscripts(para)
            # Keep any trailing narrative before the superscript.
            out.append(append_exhibit_superscript(base, cite.exhibit_no))
        else:
            out.append(para)
    return "\n\n".join(out)


def add_superscript_hyperlink(
    paragraph: Paragraph,
    digits: str,
    href: str,
    *,
    tooltip: str = "",
) -> None:
    """Append a Word superscript hyperlink run (relative pack path or URL)."""
    if not digits or not href:
        return
    part = paragraph.part
    r_id = part.relate_to(
        href,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), r_id)
    tip = (tooltip or "").replace("\n", " ").strip()
    if tip:
        hyperlink.set(qn("w:tooltip"), tip[:512])

    new_run = OxmlElement("w:r")
    rPr = OxmlElement("w:rPr")
    # Match body font size-ish; hyperlink blue + underline + superscript.
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), "22")
    rPr.append(sz)
    szCs = OxmlElement("w:szCs")
    szCs.set(qn("w:val"), "22")
    rPr.append(szCs)
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "0563C1")
    rPr.append(color)
    u = OxmlElement("w:u")
    u.set(qn("w:val"), "single")
    rPr.append(u)
    vert = OxmlElement("w:vertAlign")
    vert.set(qn("w:val"), "superscript")
    rPr.append(vert)
    new_run.append(rPr)
    text_el = OxmlElement("w:t")
    text_el.set(qn("xml:space"), "preserve")
    text_el.text = digits
    new_run.append(text_el)
    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)


def write_body_with_exhibit_hyperlinks(
    paragraph: Paragraph,
    text: str,
    cites_by_no: dict[int, EvidenceCite],
    *,
    set_run_font=None,
) -> bool:
    """Write body text; trailing Unicode superscripts become hyperlinked Word superscripts.

    Returns True when a hyperlink was added.
    """
    body, marks = strip_trailing_superscripts(text or "")
    run = paragraph.add_run(body)
    if set_run_font:
        set_run_font(run)
    if not marks:
        return False
    digits = marks.translate(str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789"))
    linked = False
    for dig in digits:
        try:
            n = int(dig)
        except ValueError:
            continue
        cite = cites_by_no.get(n)
        if cite:
            add_superscript_hyperlink(
                paragraph,
                dig,
                cite.pack_relpath,
                tooltip=cite.tooltip,
            )
            linked = True
        else:
            # Fall back to plain Word superscript digit.
            sup = paragraph.add_run(dig)
            if set_run_font:
                set_run_font(sup)
            try:
                sup.font.superscript = True
            except Exception:
                pass
    return linked


def build_evidence_index_html(
    cites: list[EvidenceCite],
    *,
    case_label: str = "",
) -> str:
    """Offline HTML index so pack users can open exhibits + read excerpts without Word."""
    rows = []
    for c in cites:
        excerpt = html.escape(c.excerpt or "(No duty-matched excerpt stored.)")
        locus = html.escape(c.page_label or "")
        rows.append(
            f'<section id="exhibit-{c.exhibit_no}" class="exhibit">'
            f"<h2>Exhibit #{c.exhibit_no}: {html.escape(c.title)}</h2>"
            f'<p><a href="{html.escape(c.pack_relpath)}">Open file ({html.escape(c.filename)})</a>'
            f"{f' · {locus}' if locus else ''}</p>"
            f'<blockquote><pre>{excerpt}</pre></blockquote>'
            f"</section>"
        )
    body = "\n".join(rows) or "<p>No exhibits attached.</p>"
    title = html.escape(f"Evidence index — {case_label}" if case_label else "Evidence index")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{title}</title>
<style>
body {{ font-family: Georgia, serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; color: #111; }}
h1 {{ font-size: 1.35rem; }}
h2 {{ font-size: 1.1rem; margin-top: 1.75rem; }}
blockquote {{ background: #f4f7f4; border-left: 3px solid #2f6f4e; padding: 0.75rem 1rem; }}
pre {{ white-space: pre-wrap; font-family: Georgia, serif; margin: 0; }}
a {{ color: #0563C1; }}
.note {{ font-size: 0.9rem; color: #444; }}
</style>
</head>
<body>
<h1>{title}</h1>
<p class="note">Open Investigation Report or Statement of Deficiencies from this folder.
Superscript numbers in those Word files link to the files under <code>evidence/</code>.
Hover a superscript in Word to see the excerpt tooltip.</p>
{body}
</body>
</html>
"""


def read_evidence_bytes(ev: CaseEvidence) -> bytes:
    path = evidence_file_path(ev)
    if not path.is_file():
        raise FileNotFoundError(f"Evidence file missing: {path}")
    return path.read_bytes()
