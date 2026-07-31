"""Quote fidelity checks against the local PDF statute store.

Statute language in allegations (Baseline unquoted duty phrases after subsection
labels), plus any remaining double-quoted spans in framework / evidentiary examples,
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
# Baseline allegation body after the connector: (1)(a) duty…; and (2) duty…
_FAILED_TO_BODY_RE = re.compile(
    r"by having failed to\s+(.+?)(?:\.\s*$|\.$)",
    re.IGNORECASE | re.DOTALL,
)
_SUBSECTION_LABEL_RE = re.compile(r"^((?:\([0-9a-z]+\))+)\s+(.+)$", re.IGNORECASE)


def normalize_ws(text: str) -> str:
    text = (text or "").replace("\u00ad", "").replace("\ufffd", "-").replace("�", "-")
    return re.sub(r"\s+", " ", text).strip()


def extract_quoted_spans(text: str) -> list[str]:
    return [m.group(1) for m in QUOTE_RE.finditer(text or "") if m.group(1).strip()]


def extract_duty_spans(text: str) -> list[str]:
    """Extract unquoted duty phrases after subsection labels (Baseline allegation shape).

    Example:
      … by having failed to (1)(a)(iii) adopting, periodically reviewing…; (1)(b) provide…
    → ["adopting, periodically reviewing…", "provide…"]
    """
    m = _FAILED_TO_BODY_RE.search(text or "")
    if not m:
        return []
    body = normalize_ws(m.group(1)).rstrip(".")
    if not body:
        return []
    clauses = re.split(r";\s*(?:and\s+)?", body)
    spans: list[str] = []
    for clause in clauses:
        clause = re.sub(r"^and\s+", "", clause.strip(), flags=re.IGNORECASE).strip()
        if not clause:
            continue
        labeled = _SUBSECTION_LABEL_RE.match(clause)
        if labeled:
            duty = labeled.group(2).strip().rstrip(".")
            if duty:
                spans.append(duty)
        else:
            # Unlabeled fallback: whole clause is the duty phrase
            spans.append(clause.rstrip("."))
    return spans


def extract_statute_spans(text: str) -> list[str]:
    """Quoted spans plus Baseline-style unquoted duty phrases for store checks."""
    spans = extract_quoted_spans(text)
    seen = {normalize_ws(s) for s in spans}
    for duty in extract_duty_spans(text):
        key = normalize_ws(duty)
        if key and key not in seen:
            seen.add(key)
            spans.append(duty)
    return spans


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


def _fold_for_match(text: str) -> str:
    """Normalize for substring checks — Baseline strips definitional quotes from duties."""
    t = _fold_quotes(normalize_ws(text))
    # Store: `"Release" means…`  Allegation: `Release means…`
    t = re.sub(r"['\"]+", "", t)
    return normalize_ws(t).lower()


def is_contiguous_substring(quote: str, source: str) -> bool:
    """True when quote is a contiguous substring of source (store-authored duties).

    Tolerates definitional quotes, whitespace, case, and trailing punctuation so text we
    just pulled from the PDF store does not false-fail against that same store.
    """
    q = _fold_for_match(quote)
    s = _fold_for_match(source)
    if not q or not s:
        return False
    if q in s:
        return True
    q2 = q.rstrip(" .;,:")
    s2 = s.rstrip(" .;,:")
    return bool(q2) and q2 in s2


def _normalize_duty_opener_for_match(text: str) -> str:
    """Align gerund/infinitive openers (Developing ↔ develop) for store checks."""
    from app.services.wac_scope import gerund_opener_to_infinitive

    body = _fold_for_match(text).rstrip(" .;,:")
    return _fold_for_match(gerund_opener_to_infinitive(body)).rstrip(" .;,:")


def duty_span_matches_cite(span: str, cite: str) -> bool:
    """True when a Baseline duty span is exact store language for the cite.

    Accepts:
    - Contiguous leaf/parent node text
    - List-intro + leaf compositions (same as Compare Exact PDF text)
    - Leading gerund folded to infinitive after 'failed to'
    """
    from app.services.wac_scope import (
        _duty_phrase_for_option,
        subsection_ancestor_context,
        subsection_display_text,
        validate_subsection_cite,
    )

    source = store_text_for_cite(cite)
    if source and is_contiguous_substring(span, source):
        return True

    code = _code_from_cite(cite)
    sub = validate_subsection_cite(code, cite) if code else None
    if not sub:
        return False

    for expected in (
        _duty_phrase_for_option(sub),
        subsection_display_text(sub),
        normalize_ws(sub.text),
    ):
        if expected and _normalize_duty_opener_for_match(span) == _normalize_duty_opener_for_match(
            expected
        ):
            return True

    # Part-wise sole-source check: intro in ancestor node, leaf topic in leaf node.
    intro = subsection_ancestor_context(sub)
    leaf = normalize_ws(sub.text)
    if not intro or not leaf:
        return False
    span_norm = _normalize_duty_opener_for_match(span)
    intro_norm = _normalize_duty_opener_for_match(intro)
    leaf_norm = _fold_for_match(leaf).rstrip(" .;,:")
    if intro_norm and leaf_norm and intro_norm in span_norm and leaf_norm in span_norm:
        parent_ok = False
        for parent_cite_label in (
            # Walk parent labels from the leaf cite, e.g. (1)(f) → (1)
            re.sub(r"\([^)]+\)\s*$", "", cite),
            code,
        ):
            parent_source = store_text_for_cite(parent_cite_label.strip())
            if parent_source and is_contiguous_substring(intro, parent_source):
                parent_ok = True
                break
        leaf_ok = bool(source and is_contiguous_substring(leaf, source))
        return parent_ok and leaf_ok
    return False


def repair_allegation_text_from_store(text: str, wac_code: str) -> str:
    """Rewrite labeled duty phrases using exact PDF store text for each cite.

    Used after auto-draft so Compare never flags statute wording we ourselves emitted.
    Preserves list-intro + leaf compositions (not bare leaf nouns alone).
    Never truncates or rewrites exact WAC duty wording.
    """
    from app.services.wac_scope import (
        _SEE_ALSO_SHORTCUT_RE,
        _duty_phrase_for_option,
        normalize_allegation_line,
        validate_subsection_cite,
    )

    # Drop forbidden cite-only trailer before repairing labeled duties
    text = _SEE_ALSO_SHORTCUT_RE.sub("", text or "").strip()
    text = re.sub(r"\bsee also\b.*$", "", text, flags=re.IGNORECASE).strip()
    text = normalize_allegation_line(text)

    m = _FAILED_TO_BODY_RE.search(text or "")
    if not m:
        return text
    code = re.sub(r"^(?:WAC|RCW)\s+", "", (wac_code or "").strip(), flags=re.IGNORECASE)
    prefix = text[: m.start()]
    body = m.group(1).strip().rstrip(".")
    parts = re.split(r";\s*(?:and\s+)?", body)
    rebuilt: list[str] = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        labeled = _SUBSECTION_LABEL_RE.match(part)
        if not labeled:
            # Skip leftover bare labels from old see-also shortcuts
            if re.fullmatch(r"(?:\([^)]+\))+", part):
                continue
            rebuilt.append(part)
            continue
        label = labeled.group(1)
        remainder = (labeled.group(2) or "").strip()
        # Bare label with no duty text — skip (legacy shortcut residue)
        if not remainder:
            continue
        sub = validate_subsection_cite(code, f"{code}{label}")
        if not sub or not sub.text:
            rebuilt.append(part)
            continue
        duty = _duty_phrase_for_option(sub)
        if not duty:
            duty = normalize_ws(sub.text).rstrip(" ;.")
        rebuilt.append(f"{label} {duty}".strip())
    if not rebuilt:
        return normalize_allegation_line(text)
    if len(rebuilt) == 1:
        mid = rebuilt[0]
    else:
        mid = "; ".join(rebuilt[:-1]) + "; and " + rebuilt[-1]
    return normalize_allegation_line(f"{prefix}by having failed to {mid}.")


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
    # Allegations: Baseline unquoted duties; framework/examples may still use "…"
    spans = extract_statute_spans(text)
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
            if duty_span_matches_cite(span, cite):
                matched_cite = cite
                matched_source = True
                break
            source = store_text_for_cite(cite)
            if source and is_contiguous_substring(span, source):
                matched_cite = cite
                matched_source = True
                break

        if not matched_source:
            # Try each selected code body if no cite worked
            if allowed:
                for code in allowed:
                    if duty_span_matches_cite(span, code):
                        matched_cite = code
                        matched_source = True
                        break
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
