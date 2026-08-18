"""Display-only outline for flattened WAC/RCW section text.

Does not invent or drop statute words. Markers that are cross-references
(subsection (3) of this section) stay inline; true list items become rows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.wac_scope import normalize_statute_text

_MARKER_RE = re.compile(r"\((\d{1,3}|[a-z]{1,2}|[ivxlcdm]{1,6}|[A-Z])\)")
_XREF_FOLLOW_RE = re.compile(r"^(of|and|or|through|to)\b|^,", re.IGNORECASE)
_ROMANS = (
    "i",
    "ii",
    "iii",
    "iv",
    "v",
    "vi",
    "vii",
    "viii",
    "ix",
    "x",
    "xi",
    "xii",
    "xiii",
    "xiv",
    "xv",
    "xvi",
    "xvii",
    "xviii",
    "xix",
    "xx",
)
_ROMAN_SET = frozenset(_ROMANS)
_ROMAN_NEXT = {a: b for a, b in zip(_ROMANS, _ROMANS[1:])}
_KIND_DEPTH = {"arabic": 0, "alpha": 1, "roman": 2, "upper": 3}
_AMBIGUOUS = frozenset({"i", "v", "x"})


@dataclass(frozen=True)
class StatuteOutlineItem:
    label: str
    body: str
    depth: int
    kind: str


@dataclass(frozen=True)
class StatuteOutline:
    lead: str
    items: tuple[StatuteOutlineItem, ...]


def _can_break_before(before: str) -> bool:
    prev = before.rstrip()
    if not prev:
        return True
    if prev[-1] in ":;.":
        return True
    return bool(re.search(r"\b(?:and|or)$", prev, flags=re.IGNORECASE))


def _is_xref_follower(after: str) -> bool:
    rest = after.lstrip()
    return bool(_XREF_FOLLOW_RE.match(rest))


def _next_alpha(inner: str) -> str | None:
    if inner == "z":
        return "aa"
    if len(inner) == 1 and "a" <= inner <= "y":
        return chr(ord(inner) + 1)
    return None


def _classify(inner: str, items: list[StatuteOutlineItem]) -> str:
    if inner.isdigit():
        return "arabic"
    if len(inner) == 1 and inner.isupper():
        return "upper"
    lower = inner.lower()
    last = items[-1] if items else None
    if len(inner) >= 2 and lower == inner and lower in _ROMAN_SET:
        return "roman"
    if len(inner) >= 2 and lower == inner and re.fullmatch(r"[a-z]{2}", inner):
        return "alpha"
    if len(inner) == 1 and inner.islower():
        if inner in _AMBIGUOUS:
            if last and last.kind == "alpha" and _next_alpha(last.label.strip("()")) == inner:
                return "alpha"
            if last and last.kind == "roman" and _ROMAN_NEXT.get(last.label.strip("()").lower()) == inner:
                return "roman"
            return "roman"
        return "alpha"
    return "alpha"


def parse_statute_outline(text: str) -> StatuteOutline:
    """Split collapsed section text into a lead sentence plus indented list items."""
    body = normalize_statute_text(text)
    if not body:
        return StatuteOutline("", ())

    items: list[StatuteOutlineItem] = []
    lead = ""
    found = False
    last_end = 0

    for match in _MARKER_RE.finditer(body):
        start, end = match.span()
        inner = match.group(1)
        after = body[end:]
        if not _can_break_before(body[:start]):
            continue
        if _is_xref_follower(after):
            continue
        if not after.strip():
            continue

        if not found:
            lead = body[:start].strip()
            found = True
        else:
            prev = items[-1]
            items[-1] = StatuteOutlineItem(
                label=prev.label,
                body=body[last_end:start].strip(),
                depth=prev.depth,
                kind=prev.kind,
            )

        kind = _classify(inner, items)
        items.append(
            StatuteOutlineItem(
                label=f"({inner})",
                body="",
                depth=_KIND_DEPTH[kind],
                kind=kind,
            )
        )
        last_end = end

    if not items:
        return StatuteOutline(body, ())

    prev = items[-1]
    items[-1] = StatuteOutlineItem(
        label=prev.label,
        body=body[last_end:].strip(),
        depth=prev.depth,
        kind=prev.kind,
    )
    return StatuteOutline(lead, tuple(items))


def format_statute_outline(text: str) -> str:
    """Plain-text outline (newlines + indent) for tests and copy-friendly fallbacks."""
    outline = parse_statute_outline(text)
    lines: list[str] = []
    if outline.lead:
        lines.append(outline.lead)
        if outline.items:
            lines.append("")
    for item in outline.items:
        indent = "  " * item.depth
        lines.append(f"{indent}{item.label} {item.body}".rstrip())
    return "\n".join(lines).strip()


def outline_plain_text(outline: StatuteOutline) -> str:
    """Rejoin outline parts so wording can be compared to the source span."""
    parts: list[str] = []
    if outline.lead:
        parts.append(outline.lead)
    for item in outline.items:
        chunk = f"{item.label} {item.body}".strip()
        if chunk:
            parts.append(chunk)
    return normalize_statute_text(" ".join(parts))
