"""Quote fidelity unit tests."""

from __future__ import annotations

from app.services.quote_verify import (
    extract_quoted_spans,
    is_contiguous_substring,
    normalize_ws,
    verify_allegation,
    verify_report_quotes,
)
from app.services.wac_scope import (
    draft_allegation_from_source,
    exact_quotes_from_subsections,
    score_relevant_subsections,
    sentence_boundary_excerpt,
)


def test_normalize_and_substring():
    source = "The  agency   shall  protect  patients."
    quote = "agency shall protect"
    assert is_contiguous_substring(quote, source)
    assert not is_contiguous_substring("agency must invent", source)


def test_extract_quoted_spans():
    text = 'A potential violation of WAC 246-341-0600, by having failed to: "(1) keep records" and "(2) train staff".'
    spans = extract_quoted_spans(text)
    assert spans == ["(1) keep records", "(2) train staff"]


def test_sentence_boundary_no_ellipsis(store_ready):
    long = "First sentence here. Second sentence continues with more detail. Third wraps up."
    excerpt = sentence_boundary_excerpt(long * 40, max_chars=80)
    assert "…" not in excerpt
    assert "..." not in excerpt
    # Contiguous from original
    assert excerpt in normalize_ws(long * 40) or excerpt.endswith(".")


def test_exact_quotes_are_store_substrings(store_ready):
    complaint = (
        "It was alleged that a patient was sexually assaulted by another patient "
        "while residing at the facility and staff failed to protect safety."
    )
    subs = score_relevant_subsections(complaint, "246-341-0600", max_items=4)
    quotes = exact_quotes_from_subsections(subs, max_quotes=4)
    assert quotes
    for label, quote in quotes:
        assert "…" not in quote
        assert "..." not in quote.rstrip(".")
        # Find matching subsection text
        matched = False
        for s in subs:
            if s.label == label and is_contiguous_substring(quote, s.text):
                matched = True
                break
        assert matched, f"quote not found in subsection {label}"


def test_verify_rejects_paraphrase_and_ellipsis(store_ready):
    fake = 'A potential violation of WAC 246-341-0600, regarding: "NOT_IN_STORE_PHRASE".'
    fails = verify_allegation(
        fake,
        wac_code="246-341-0600",
        matched_subsections=["246-341-0600"],
        selected_codes=["246-341-0600"],
    )
    assert any(f.reason == "not_in_store" for f in fails)

    ellipsis_text = 'A potential violation of WAC 246-341-0600, regarding: "shall protect…".'
    fails2 = verify_allegation(
        ellipsis_text,
        wac_code="246-341-0600",
        matched_subsections=["246-341-0600"],
        selected_codes=["246-341-0600"],
    )
    assert any(f.reason == "truncated_ellipsis" for f in fails2)


def test_fresh_draft_passes_quote_verify(store_ready):
    draft = draft_allegation_from_source(
        "246-341-0600",
        "Agency administration",
        "patient was assaulted and facility failed to protect safety and security",
        max_subs=3,
    )
    integrity = verify_report_quotes(
        allegations=[
            {
                "wac_code": "246-341-0600",
                "allegation_text": draft.text,
                "matched_subsections": draft.cites,
            }
        ],
        selected_codes=["246-341-0600"],
    )
    assert integrity.ok, [f.to_dict() for f in integrity.failures]
