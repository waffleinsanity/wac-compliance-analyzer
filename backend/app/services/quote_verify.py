"""Quote fidelity checks against the local PDF statute store.

Every quoted span in allegations / Regulatory Framework / evidentiary examples
must be a contiguous substring of the cited PDF node text (whitespace-normalized).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable

from app.services.wac_scope import (
    FOREIGN_RCW_RE,
    FOREIGN_WAC_RE,
    code_node_for,
    subsections_for_code,
    validate_subsection_cite,
)

QUOTE_RE = re.compile(r'"([^"]+)"')
ELLIPSIS_CHARS = ("…", "...", "\u2026")


def normalize_ws(text: str) -> str:
    text = (text or "").replace("\u00ad", "").replace("\ufffd", "-").replace("�", "-")
    return re.sub(r"\s+", " ", text).strip()


def extract_quoted_spans(text: str) -> list[str]:
    return [m.group(1) for m in QUOTE_RE.finditer(text or "") if m.group(1).strip()]


def _code_from_cite(cite: str) -> str:
    cite = re.sub(r"^(?:WAC|RCW)\s+", "", (cite or "").strip(), flags=re.IGNORECASE)
    m = re.match(
        r"(246-(?:341|337)-\d{3,4}|71\.(?:05|24|34)\.\d{3,4})",
        cite,
    )
    return m.group(1) if m else cite.split("(")[0].strip()


def store_text_for_cite(cite: str) -> str | None:
    """Resolve cite to PDF node text; fall back to code-level body."""
    code = _code_from_cite(cite)
    if not code:
        return None
    sub = validate_subsection_cite(code, cite)
    if sub and sub.text:
        return normalize_ws(sub.text)
    node = code_node_for(code)
    if node and getattr(node, "text", None):
        return normalize_ws(node.text)
    # Last resort: concatenate subsections under the code
    blobs = [normalize_ws(s.text) for s in subsections_for_code(code) if s.text]
    return " ".join(blobs) if blobs else None


def _fold_quotes(text: str) -> str:
    """Treat straight/curly double quotes as apostrophes for store matching."""
    return (
        (text or "")
        .replace('"', "'")
        .replace("“", "'")
        .replace("”", "'")
        .replace("‟", "'")
        .replace("″", "'")
    )


def is_contiguous_substring(quote: str, source: str) -> bool:
    q = _fold_quotes(normalize_ws(quote))
    s = _fold_quotes(normalize_ws(source))
    if not q or not s:
        return False
    return q in s


@dataclass
class QuoteFailure:
    field: str
    cite: str | None
    quote_preview: str
    reason: str  # not_in_store | cite_outside_selection | truncated_ellipsis | empty_quote | no_source

    def to_dict(self) -> dict[str, Any]:
        return {
            "field": self.field,
            "cite": self.cite,
            "quote_preview": self.quote_preview[:160],
            "reason": self.reason,
        }


@dataclass
class QuoteIntegrity:
    ok: bool
    failures: list[QuoteFailure] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "failures": [f.to_dict() for f in self.failures]}


def _allowed_codes(selected: Iterable[str] | None) -> set[str] | None:
    if selected is None:
        return None
    out: set[str] = set()
    for c in selected:
        raw = re.sub(r"^(?:WAC|RCW)\s+", "", str(c).strip(), flags=re.IGNORECASE)
        out.add(raw)
    return out


def _cites_in_text(text: str) -> list[str]:
    cites = [m.group(0) for m in FOREIGN_WAC_RE.finditer(text or "")]
    cites += [m.group(0) for m in FOREIGN_RCW_RE.finditer(text or "")]
    # Prefer longer / more specific cites from matched_subsections-style tokens
    for m in re.finditer(
        r"(?:WAC|RCW)?\s*(246-(?:341|337)-\d{3,4}|71\.(?:05|24|34)\.\d{3,4})((?:\([^)]+\))+)?",
        text or "",
        re.IGNORECASE,
    ):
        code = m.group(1)
        label = m.group(2) or ""
        cites.append(f"{code}{label}")
    # de-dupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for c in cites:
        key = c.lower()
        if key not in seen:
            seen.add(key)
            out.append(c)
    return out


def check_quoted_text(
    text: str,
    *,
    field: str,
    preferred_cites: list[str] | None = None,
    selected_codes: Iterable[str] | None = None,
) -> list[QuoteFailure]:
    failures: list[QuoteFailure] = []
    allowed = _allowed_codes(selected_codes)
    spans = extract_quoted_spans(text)
    if not spans:
        return failures

    cite_candidates = list(preferred_cites or []) + _cites_in_text(text)

    for span in spans:
        preview = normalize_ws(span)
        if not preview:
            failures.append(
                QuoteFailure(field=field, cite=None, quote_preview="", reason="empty_quote")
            )
            continue
        if any(e in span for e in ELLIPSIS_CHARS) or span.rstrip().endswith("..."):
            failures.append(
                QuoteFailure(
                    field=field,
                    cite=cite_candidates[0] if cite_candidates else None,
                    quote_preview=preview,
                    reason="truncated_ellipsis",
                )
            )
            # still check store membership when possible

        matched_cite: str | None = None
        matched_source = False
        for cite in cite_candidates:
            code = _code_from_cite(cite)
            if allowed is not None and code and code not in allowed:
                continue
            source = store_text_for_cite(cite)
            if source and is_contiguous_substring(span, source):
                matched_cite = cite
                matched_source = True
                break

        if not matched_source:
            # Try each selected code body if no cite worked
            if allowed:
                for code in allowed:
                    source = store_text_for_cite(code)
                    if source and is_contiguous_substring(span, source):
                        matched_cite = code
                        matched_source = True
                        break

        if not matched_source:
            # Outside selection?
            foreign = None
            for cite in cite_candidates:
                code = _code_from_cite(cite)
                if allowed is not None and code and code not in allowed:
                    foreign = cite
                    break
            if foreign:
                failures.append(
                    QuoteFailure(
                        field=field,
                        cite=foreign,
                        quote_preview=preview,
                        reason="cite_outside_selection",
                    )
                )
            else:
                source_any = store_text_for_cite(cite_candidates[0]) if cite_candidates else None
                failures.append(
                    QuoteFailure(
                        field=field,
                        cite=matched_cite or (cite_candidates[0] if cite_candidates else None),
                        quote_preview=preview,
                        reason="no_source" if not source_any else "not_in_store",
                    )
                )
    return failures


def verify_allegation(
    allegation_text: str,
    *,
    wac_code: str,
    matched_subsections: list[str] | None = None,
    selected_codes: Iterable[str] | None = None,
) -> list[QuoteFailure]:
    cites = list(matched_subsections or [])
    code = re.sub(r"^(?:WAC|RCW)\s+", "", wac_code.strip(), flags=re.IGNORECASE)
    if code and code not in cites:
        cites.insert(0, code)
    return check_quoted_text(
        allegation_text,
        field=f"allegation:{wac_code}",
        preferred_cites=cites,
        selected_codes=selected_codes,
    )


def verify_report_quotes(
    *,
    allegations: list[Any],
    regulatory_framework: list[Any] | None = None,
    evidentiary_examples: list[str] | None = None,
    selected_codes: Iterable[str] | None = None,
) -> QuoteIntegrity:
    """Validate all quoted statute language in a report-like payload."""
    failures: list[QuoteFailure] = []
    allowed = list(selected_codes or [])

    for a in allegations or []:
        if isinstance(a, dict):
            text = a.get("allegation_text") or ""
            code = a.get("wac_code") or ""
            matched = a.get("matched_subsections") or []
        else:
            text = getattr(a, "allegation_text", "") or ""
            code = getattr(a, "wac_code", "") or ""
            matched = getattr(a, "matched_subsections", None) or []
        failures.extend(
            verify_allegation(
                text,
                wac_code=str(code),
                matched_subsections=[str(x) for x in matched],
                selected_codes=allowed or None,
            )
        )

    for entry in regulatory_framework or []:
        if isinstance(entry, dict):
            code = entry.get("code") or ""
            instrument = entry.get("instrument") or ""
            subs = entry.get("subsections") or []
        else:
            code = getattr(entry, "code", "") or ""
            instrument = getattr(entry, "instrument", "") or ""
            subs = getattr(entry, "subsections", None) or []
        for sub in subs:
            if isinstance(sub, dict):
                cite = sub.get("cite") or f"{instrument} {code}"
                text = sub.get("text") or ""
            else:
                cite = getattr(sub, "cite", None) or f"{instrument} {code}"
                text = getattr(sub, "text", "") or ""
            body = normalize_ws(text)
            if not body:
                continue
            source = store_text_for_cite(str(cite)) or store_text_for_cite(str(code))
            if not source:
                failures.append(
                    QuoteFailure(
                        field=f"regulatory_framework:{cite}",
                        cite=str(cite),
                        quote_preview=body[:160],
                        reason="no_source",
                    )
                )
            elif not is_contiguous_substring(body, source) and normalize_ws(source) != body:
                failures.append(
                    QuoteFailure(
                        field=f"regulatory_framework:{cite}",
                        cite=str(cite),
                        quote_preview=body[:160],
                        reason="not_in_store",
                    )
                )

    for i, example in enumerate(evidentiary_examples or []):
        failures.extend(
            check_quoted_text(
                example,
                field=f"evidentiary_examples[{i}]",
                preferred_cites=_cites_in_text(example),
                selected_codes=allowed or None,
            )
        )

    # De-dupe identical failures
    seen: set[tuple[str, str, str]] = set()
    unique: list[QuoteFailure] = []
    for f in failures:
        key = (f.field, f.reason, f.quote_preview[:80])
        if key in seen:
            continue
        seen.add(key)
        unique.append(f)

    return QuoteIntegrity(ok=len(unique) == 0, failures=unique)
