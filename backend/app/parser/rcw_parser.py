"""Hierarchical RCW PDF parser for chapters 71.05, 71.24, and 71.34."""

from __future__ import annotations

import re
from pathlib import Path

from app.parser.wac_parser import (
    WACNode,
    _clean_text,
    _extract_pdf_text,
    _generate_trigger_phrases,
    _parse_subsections,
)

RCW_CHAPTERS = ("71.05", "71.24", "71.34")
RCW_SECTION_RE = re.compile(
    r"(?:^|\n)\s*RCW\s+(71\.(?:05|24|34)\.\d{3,4})\s+([^\n]+?)(?:\.\s+|\.\n)",
    re.IGNORECASE,
)
PAGE_NOISE_EXTRA = re.compile(
    r"Certified on \d{1,2}/\d{1,2}/\d{4}\s*Combined Chapter 71\.\d{2} RCW\s*Page \d+\s*",
    re.IGNORECASE,
)


def _split_rcw_sections(full_text: str, chapter: str) -> list[tuple[str, str, str]]:
    """Return list of (code, title, body) for one RCW chapter."""
    matches = list(RCW_SECTION_RE.finditer(full_text))
    sections: list[tuple[str, str, str]] = []
    for i, match in enumerate(matches):
        code = match.group(1)
        if not code.startswith(chapter):
            continue
        title = match.group(2).strip().rstrip(".")
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)
        body = full_text[start:end].strip()
        # Drop historical notes / session-law stubs that dominate many RCW pages
        body = re.split(
            r"\n(?:NOTES:|Effective date|Expiration date|Short title)",
            body,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip()
        if len(body) < 20:
            continue
        sections.append((code, title, body))
    return sections


def parse_rcw_pdf(path: Path) -> list[WACNode]:
    path = Path(path)
    text, certified, last_update = _extract_pdf_text(path)
    text = PAGE_NOISE_EXTRA.sub("\n", text)
    text = _clean_text(text)

    chapter_match = re.search(r"71\.(05|24|34)", path.name)
    chapter = f"71.{chapter_match.group(1)}" if chapter_match else "unknown"
    cm = re.search(r"Chapter\s+(71\.(?:05|24|34))\s+RCW", text, re.IGNORECASE)
    if cm:
        chapter = cm.group(1)

    sections = _split_rcw_sections(text, chapter)
    best: dict[str, tuple[str, str]] = {}
    for code, title, body in sections:
        prev = best.get(code)
        if not prev or len(body) > len(prev[1]):
            best[code] = (title, body)

    nodes: list[WACNode] = []
    for code in sorted(best.keys()):
        title, body = best[code]
        # Reuse WAC subsection splitter; override ids to RCW-prefixed form
        section_nodes = _parse_subsections(
            code=code,
            chapter=chapter,
            title=title,
            body=body,
            version_date=last_update,
            certified_date=certified,
            source_file=path.name,
        )
        for node in section_nodes:
            # Convert "WAC 71.05.010…" ids produced by shared helper into RCW ids
            node.id = node.id.replace("WAC ", "RCW ", 1) if node.id.startswith("WAC ") else f"RCW {node.id}"
            if node.parent_id:
                node.parent_id = (
                    node.parent_id.replace("WAC ", "RCW ", 1)
                    if node.parent_id.startswith("WAC ")
                    else f"RCW {node.parent_id}"
                )
            node.hierarchy_path = node.id
            if node.level == "code":
                node.trigger_phrases = _generate_trigger_phrases(title, body, max_phrases=8)
            node.metadata = {**(node.metadata or {}), "instrument": "RCW", "full_reference": node.id}
        nodes.extend(section_nodes)
    return nodes


def parse_all_rcw_sources(source_dir: Path) -> list[WACNode]:
    source_dir = Path(source_dir)
    all_nodes: list[WACNode] = []
    for chapter in RCW_CHAPTERS:
        path = source_dir / f"RCW {chapter}.pdf"
        if path.exists():
            all_nodes.extend(parse_rcw_pdf(path))
    deduped: dict[str, WACNode] = {}
    for node in all_nodes:
        prev = deduped.get(node.id)
        if not prev or len(node.text) > len(prev.text):
            deduped[node.id] = node
    return list(deduped.values())
