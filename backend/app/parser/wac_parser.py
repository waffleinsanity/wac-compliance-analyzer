"""Hierarchical WAC PDF parser for chapters 246-341 and 246-337."""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from datetime import date
from pathlib import Path
from typing import Any

import fitz


SECTION_HEADER_RE = re.compile(
    r"(?:^|\n)\s*(?:WAC\s+)?(246-(?:341|337)-\d{3,4})\s+([^\n]+?)(?:\.\s+|\.\n)",
    re.IGNORECASE,
)
PRIMARY_RE = re.compile(r"(?:^|\n)\((\d+)\)\s+")
SECONDARY_RE = re.compile(r"(?:^|\n)\(([a-z])\)\s+")
TERTIARY_RE = re.compile(r"(?:^|\n)\(([ivxlcdm]+)\)\s+", re.IGNORECASE)
PAGE_NOISE_RE = re.compile(
    r"(?:Certified on \d{1,2}/\d{1,2}/\d{4}\s*)?Page \d+\s*",
    re.IGNORECASE,
)
LAST_UPDATE_RE = re.compile(r"Last Update:\s*(\d{1,2}/\d{1,2}/\d{2,4})", re.IGNORECASE)
CERTIFIED_RE = re.compile(r"Certified on\s+(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)
DISPOSITION_RE = re.compile(
    r"\[Statutory Authority:.*?\](?:\s*Repealed by.*?)?(?=\n|$)",
    re.IGNORECASE | re.DOTALL,
)
TOC_LINE_RE = re.compile(r"^246-(?:341|337)-\d{3,4}\s+\S", re.MULTILINE)


@dataclass
class WACNode:
    id: str
    chapter: str
    code: str
    title: str
    text: str
    level: str  # code | primary | secondary | tertiary | quaternary
    parent_id: str | None
    hierarchy_path: str
    primary: str | None = None
    secondary: str | None = None
    tertiary: str | None = None
    version_date: str | None = None
    certified_date: str | None = None
    source_file: str | None = None
    trigger_phrases: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _clean_text(text: str) -> str:
    text = PAGE_NOISE_RE.sub("\n", text)
    text = text.replace("\u00ad", "")  # soft hyphen
    # Common PDF encoding artifacts for en/em dashes / replacement chars
    text = text.replace("\ufffd", "—")
    text = text.replace("\u0097", "—")
    text = text.replace("\u0096", "–")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    # Fix hyphenated line breaks common in WAC PDFs
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = re.sub(r"\n(?=[a-z])", " ", text)
    return text.strip()


def _extract_pdf_text(path: Path) -> tuple[str, str | None, str | None]:
    doc = fitz.open(path)
    pages = [doc[i].get_text() for i in range(len(doc))]
    raw = "\n".join(pages)
    certified = None
    last_update = None
    m = CERTIFIED_RE.search(raw)
    if m:
        certified = m.group(1)
    m = LAST_UPDATE_RE.search(raw)
    if m:
        last_update = m.group(1)
    cleaned = _clean_text(raw)
    return cleaned, certified, last_update


def _strip_disposition(text: str) -> str:
    return DISPOSITION_RE.sub("", text).strip()


def _split_sections(full_text: str) -> list[tuple[str, str, str]]:
    """Return list of (code, title, body)."""
    matches = list(SECTION_HEADER_RE.finditer(full_text))
    sections: list[tuple[str, str, str]] = []
    for i, match in enumerate(matches):
        code = match.group(1)
        title = match.group(2).strip().rstrip(".")
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)
        body = full_text[start:end].strip()
        # Skip repealed / disposition-only stubs with almost no operative text
        body = _strip_disposition(body)
        if len(body) < 40 and "repealed" in body.lower():
            continue
        # Skip TOC-like short entries that are just titles without body
        if len(body) < 20:
            continue
        sections.append((code, title, body))
    return sections


def _generate_trigger_phrases(title: str, text: str, max_phrases: int = 8) -> list[str]:
    phrases: list[str] = []
    if title:
        phrases.append(title.strip())

    # Key obligation verbs / regulatory keywords
    obligation_patterns = [
        r"(?:must|shall|may not|is required to|required to)\s+[^.]{10,120}",
        r"(?:policies and procedures|documentation|written plan|individual service|"
        r"administrator|confidentiality|safety and security|quality improvement|"
        r"background|medication|restraint|seclusion|emergency|infection control|"
        r"resident rights|personnel|staffing|assessment|treatment)[^.]{0,80}",
    ]
    for pattern in obligation_patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            phrase = re.sub(r"\s+", " ", m.group(0)).strip(" .;,:")
            if 12 <= len(phrase) <= 140 and phrase.lower() not in {p.lower() for p in phrases}:
                phrases.append(phrase)
            if len(phrases) >= max_phrases:
                return phrases

    # Fallback: first meaningful sentences
    for sent in re.split(r"(?<=[.!?])\s+", text):
        sent = re.sub(r"\s+", " ", sent).strip()
        if 20 <= len(sent) <= 140 and sent.lower() not in {p.lower() for p in phrases}:
            phrases.append(sent)
        if len(phrases) >= max_phrases:
            break
    return phrases[:max_phrases]


_MARKER_RE = re.compile(
    r"(?:^|\n)\(("
    r"\d+"
    r"|[a-z]"
    r"|[A-Z]"
    r"|[ivxlcdm]{2,}"
    r"|[IVXLCDM]{2,}"
    r")\)\s+",
)
_ROMAN_ONLY = re.compile(r"^[ivxlcdm]+$", re.IGNORECASE)


def _is_roman_token(token: str) -> bool:
    """True for tertiary-style roman numerals, including ambiguous i/v/x when appropriate."""
    t = token.lower()
    if len(t) >= 2 and _ROMAN_ONLY.match(t):
        return True
    return False


def _parse_subsections(
    code: str,
    chapter: str,
    title: str,
    body: str,
    version_date: str | None,
    certified_date: str | None,
    source_file: str,
) -> list[WACNode]:
    nodes: list[WACNode] = []
    code_id = f"WAC {code}"
    code_text = f"{title}. {body}".strip()
    nodes.append(
        WACNode(
            id=code_id,
            chapter=chapter,
            code=code,
            title=title,
            text=code_text,
            level="code",
            parent_id=None,
            hierarchy_path=code_id,
            version_date=version_date,
            certified_date=certified_date,
            source_file=source_file,
            trigger_phrases=_generate_trigger_phrases(title, body),
            metadata={"full_reference": code_id},
        )
    )

    primary_matches = list(re.finditer(r"(?:^|\n)\((\d+)\)\s+", body))
    if not primary_matches:
        return nodes

    for i, pm in enumerate(primary_matches):
        pnum = pm.group(1)
        p_start = pm.end()
        p_end = primary_matches[i + 1].start() if i + 1 < len(primary_matches) else len(body)
        p_body = body[p_start:p_end].strip()
        primary_id = f"{code_id}({pnum})"
        nodes.append(
            WACNode(
                id=primary_id,
                chapter=chapter,
                code=code,
                title=title,
                text=p_body,
                level="primary",
                parent_id=code_id,
                hierarchy_path=primary_id,
                primary=pnum,
                version_date=version_date,
                certified_date=certified_date,
                source_file=source_file,
                trigger_phrases=_generate_trigger_phrases(f"{title} ({pnum})", p_body, max_phrases=6),
                metadata={"full_reference": primary_id},
            )
        )

        # Case-sensitive markers: (a) secondary, (i)/(ii) tertiary, (A) quaternary.
        # IGNORECASE must not be used — uppercase (A) is not secondary (a).
        raw_markers = list(
            re.finditer(r"(?:^|\n)\(([a-z]+|[A-Z]+|[ivxlcdm]+|[IVXLCDM]+)\)\s+", p_body)
        )
        if not raw_markers:
            continue

        classified: list[tuple[re.Match[str], str]] = []
        raw_tokens = [m.group(1) for m in raw_markers]
        tokens = [t.lower() for t in raw_tokens]
        for idx, m in enumerate(raw_markers):
            raw_tok = raw_tokens[idx]
            tok = tokens[idx]
            nxt = tokens[idx + 1] if idx + 1 < len(tokens) else ""
            prev = tokens[idx - 1] if idx > 0 else ""

            # Uppercase letter(s) → quaternary (e.g. (A) (B) under (iii))
            if raw_tok.isupper() and raw_tok.isalpha():
                kind = "quaternary"
            elif len(tok) > 1 and _ROMAN_ONLY.match(tok):
                kind = "tertiary"
            elif tok in {"i", "v", "x"}:
                # Ambiguous single char: tertiary if neighbors are roman-ish
                romanish = (
                    (nxt.startswith(tok) and len(nxt) > 1)
                    or (
                        prev in {"i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"}
                        and _is_roman_token(prev)
                    )
                    or nxt in {"ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi", "xii"}
                    or (tok == "i" and nxt == "ii")
                    or (tok == "v" and nxt in {"vi", "vii"})
                    or (tok == "x" and nxt in {"xi", "xii"})
                )
                # Letter secondary if sequential after h/j etc.
                letterish = prev in {"h", "j", "u", "w"} or (
                    prev and len(prev) == 1 and prev.isalpha() and prev not in {"i", "v", "x"}
                )
                if romanish and not (letterish and prev == "h" and tok == "i" and nxt == "j"):
                    kind = "tertiary"
                elif letterish or (tok == "i" and prev == "h"):
                    kind = "secondary"
                else:
                    has_letter_secondary = any(
                        len(t) == 1 and t.isalpha() and t not in {"i", "v", "x"} for t in tokens
                    )
                    kind = "tertiary" if has_letter_secondary or romanish else "secondary"
            elif len(tok) == 1 and tok.isalpha() and raw_tok.islower():
                kind = "secondary"
            else:
                kind = "tertiary"
            classified.append((m, kind))

        # Build secondary/tertiary/quaternary nodes from classified markers
        secondary_indices = [idx for idx, (_, kind) in enumerate(classified) if kind == "secondary"]
        for s_pos, s_idx in enumerate(secondary_indices):
            sm, _ = classified[s_idx]
            sletter = sm.group(1).lower()
            s_start = sm.end()
            # Secondary ends at next secondary only — quaternary (A) stays inside this secondary
            if s_pos + 1 < len(secondary_indices):
                s_end = classified[secondary_indices[s_pos + 1]][0].start()
            else:
                s_end = len(p_body)
            s_body = p_body[s_start:s_end].strip()
            secondary_id = f"{primary_id}({sletter})"
            nodes.append(
                WACNode(
                    id=secondary_id,
                    chapter=chapter,
                    code=code,
                    title=title,
                    text=s_body,
                    level="secondary",
                    parent_id=primary_id,
                    hierarchy_path=secondary_id,
                    primary=pnum,
                    secondary=sletter,
                    version_date=version_date,
                    certified_date=certified_date,
                    source_file=source_file,
                    trigger_phrases=_generate_trigger_phrases(
                        f"{title} ({pnum})({sletter})", s_body, max_phrases=5
                    ),
                    metadata={"full_reference": secondary_id},
                )
            )

            # Tertiaries belonging to this secondary
            t_start_idx = s_idx + 1
            t_end_idx = (
                secondary_indices[s_pos + 1] if s_pos + 1 < len(secondary_indices) else len(classified)
            )
            tert_markers = [
                classified[t]
                for t in range(t_start_idx, t_end_idx)
                if classified[t][1] == "tertiary"
            ]
            for t_i, (tm, _) in enumerate(tert_markers):
                troman = tm.group(1).lower()
                t_body_start = tm.end()
                t_body_end = tert_markers[t_i + 1][0].start() if t_i + 1 < len(tert_markers) else s_end
                t_body = p_body[t_body_start:t_body_end].strip()
                tertiary_id = f"{secondary_id}({troman})"
                nodes.append(
                    WACNode(
                        id=tertiary_id,
                        chapter=chapter,
                        code=code,
                        title=title,
                        text=t_body,
                        level="tertiary",
                        parent_id=secondary_id,
                        hierarchy_path=tertiary_id,
                        primary=pnum,
                        secondary=sletter,
                        tertiary=troman,
                        version_date=version_date,
                        certified_date=certified_date,
                        source_file=source_file,
                        trigger_phrases=_generate_trigger_phrases(
                            f"{title} ({pnum})({sletter})({troman})", t_body, max_phrases=4
                        ),
                        metadata={"full_reference": tertiary_id},
                    )
                )

                # Quaternaries (A)(B)(C) under this tertiary
                next_tert_start = (
                    tert_markers[t_i + 1][0].start() if t_i + 1 < len(tert_markers) else s_end
                )
                quat_markers = [
                    classified[qi]
                    for qi in range(t_start_idx, t_end_idx)
                    if classified[qi][1] == "quaternary"
                    and tm.end() <= classified[qi][0].start() < next_tert_start
                ]
                for q_i, (qm, _) in enumerate(quat_markers):
                    qletter = qm.group(1).upper()
                    q_body_start = qm.end()
                    q_body_end = (
                        quat_markers[q_i + 1][0].start()
                        if q_i + 1 < len(quat_markers)
                        else next_tert_start
                    )
                    q_body = p_body[q_body_start:q_body_end].strip()
                    quaternary_id = f"{tertiary_id}({qletter})"
                    nodes.append(
                        WACNode(
                            id=quaternary_id,
                            chapter=chapter,
                            code=code,
                            title=title,
                            text=q_body,
                            level="quaternary",
                            parent_id=tertiary_id,
                            hierarchy_path=quaternary_id,
                            primary=pnum,
                            secondary=sletter,
                            tertiary=troman,
                            version_date=version_date,
                            certified_date=certified_date,
                            source_file=source_file,
                            trigger_phrases=_generate_trigger_phrases(
                                f"{title} ({pnum})({sletter})({troman})({qletter})",
                                q_body,
                                max_phrases=3,
                            ),
                            metadata={"full_reference": quaternary_id, "quaternary": qletter},
                        )
                    )

        # Orphan tertiaries directly under primary (no letter secondary)
        if not secondary_indices:
            tert_markers = [c for c in classified if c[1] == "tertiary"]
            # Also treat leftover secondary-classified romans as tertiary when no letters
            if not tert_markers:
                tert_markers = [c for c in classified if c[1] != "quaternary"]
            for t_i, (tm, _) in enumerate(tert_markers):
                troman = tm.group(1).lower()
                t_body_start = tm.end()
                t_body_end = (
                    tert_markers[t_i + 1][0].start() if t_i + 1 < len(tert_markers) else len(p_body)
                )
                t_body = p_body[t_body_start:t_body_end].strip()
                # Represent as synthetic secondary-less tertiary path under primary
                tertiary_id = f"{primary_id}({troman})"
                nodes.append(
                    WACNode(
                        id=tertiary_id,
                        chapter=chapter,
                        code=code,
                        title=title,
                        text=t_body,
                        level="tertiary",
                        parent_id=primary_id,
                        hierarchy_path=tertiary_id,
                        primary=pnum,
                        tertiary=troman,
                        version_date=version_date,
                        certified_date=certified_date,
                        source_file=source_file,
                        trigger_phrases=_generate_trigger_phrases(
                            f"{title} ({pnum})({troman})", t_body, max_phrases=4
                        ),
                        metadata={"full_reference": tertiary_id},
                    )
                )

    # Final dedupe within this section
    deduped: dict[str, WACNode] = {}
    for node in nodes:
        prev = deduped.get(node.id)
        if not prev or len(node.text) > len(prev.text):
            deduped[node.id] = node
    return list(deduped.values())


def parse_wac_pdf(path: Path) -> list[WACNode]:
    path = Path(path)
    text, certified, last_update = _extract_pdf_text(path)
    chapter_match = re.search(r"246-(341|337)", path.name)
    chapter = f"246-{chapter_match.group(1)}" if chapter_match else "unknown"
    # Prefer chapter from content
    cm = re.search(r"Chapter\s+(246-(?:341|337))\s+WAC", text, re.IGNORECASE)
    if cm:
        chapter = cm.group(1)

    sections = _split_sections(text)
    # Prefer the longest body for each code (skips TOC stubs in favor of full text)
    best: dict[str, tuple[str, str]] = {}
    for code, title, body in sections:
        if not code.startswith(chapter):
            continue
        prev = best.get(code)
        if not prev or len(body) > len(prev[1]):
            best[code] = (title, body)

    nodes: list[WACNode] = []
    for code in sorted(best.keys(), key=lambda c: (len(c), c)):
        title, body = best[code]
        nodes.extend(
            _parse_subsections(
                code=code,
                chapter=chapter,
                title=title,
                body=body,
                version_date=last_update,
                certified_date=certified,
                source_file=path.name,
            )
        )
    return nodes


def parse_all_sources(source_dir: Path) -> list[WACNode]:
    source_dir = Path(source_dir)
    all_nodes: list[WACNode] = []
    for name in ("WAC 246-341.pdf", "WAC 246-337.pdf"):
        path = source_dir / name
        if path.exists():
            all_nodes.extend(parse_wac_pdf(path))

    # Official single-code section PDFs override chapter extracts for that code
    # (e.g. data/source/sections/WAC 246-341-0600.pdf certified on leg.wa.gov).
    sections_dir = source_dir / "sections"
    if sections_dir.is_dir():
        override_codes: set[str] = set()
        override_nodes: list[WACNode] = []
        for path in sorted(sections_dir.glob("WAC *.pdf")):
            parsed = parse_wac_pdf(path)
            if not parsed:
                continue
            codes = {n.code for n in parsed}
            override_codes |= codes
            override_nodes.extend(parsed)
        if override_codes:
            all_nodes = [n for n in all_nodes if n.code not in override_codes]
            all_nodes.extend(override_nodes)

    # Global dedupe
    deduped: dict[str, WACNode] = {}
    for node in all_nodes:
        prev = deduped.get(node.id)
        if not prev or len(node.text) > len(prev.text):
            deduped[node.id] = node
    return list(deduped.values())


if __name__ == "__main__":
    from app.config import settings

    nodes = parse_all_sources(settings.source_dir)
    codes = [n for n in nodes if n.level == "code"]
    print(f"Total nodes: {len(nodes)}")
    print(f"Code-level: {len(codes)}")
    print(f"341 codes: {sum(1 for c in codes if c.chapter=='246-341')}")
    print(f"337 codes: {sum(1 for c in codes if c.chapter=='246-337')}")
    for c in codes[:5]:
        print(c.id, "-", c.title[:60], "| phrases:", len(c.trigger_phrases))
