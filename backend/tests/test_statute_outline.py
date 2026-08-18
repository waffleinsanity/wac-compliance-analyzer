"""Full-code Compare pane: outline formatting must not invent or drop WAC words."""

from __future__ import annotations

from app.rag.store import wac_store
from app.services.statute_outline import (
    format_statute_outline,
    outline_plain_text,
    parse_statute_outline,
)
from app.services.wac_scope import normalize_statute_text


def test_list_items_break_and_cross_refs_stay_inline():
    text = (
        "Each agency must: (1) Comply with subsection (3) of this section; "
        "(2) Keep records; and (3) Notify the department."
    )
    outline = parse_statute_outline(text)
    labels = [item.label for item in outline.items]
    assert labels == ["(1)", "(2)", "(3)"]
    assert "subsection (3) of this section" in outline.items[0].body
    assert outline.items[0].depth == 0
    assert outline_plain_text(outline) == normalize_statute_text(text)


def test_nested_letter_roman_upper_depths():
    text = (
        "The agency must: (4) Ensure policies: (a) Adopt a plan: "
        "(i) Include: (A) staff training; and (B) record review; "
        "(ii) Report annually; (b) Keep the plan current; (5) Retain records."
    )
    outline = parse_statute_outline(text)
    by_label = {item.label: item for item in outline.items}
    assert by_label["(4)"].depth == 0
    assert by_label["(a)"].depth == 1
    assert by_label["(i)"].depth == 2
    assert by_label["(A)"].depth == 3
    assert by_label["(B)"].depth == 3
    assert by_label["(ii)"].depth == 2
    assert by_label["(b)"].depth == 1
    assert by_label["(5)"].depth == 0
    assert outline_plain_text(outline) == normalize_statute_text(text)


def test_letter_i_after_h_is_not_roman():
    text = (
        "Each agency must: (1) Cover: (a) one; (b) two; (c) three; (d) four; "
        "(e) five; (f) six; (g) seven; (h) eight; (i) nine; (j) ten."
    )
    outline = parse_statute_outline(text)
    item_i = next(item for item in outline.items if item.label == "(i)")
    assert item_i.kind == "alpha"
    assert item_i.depth == 1


def test_0425_store_text_outlines_numbered_and_nested_items(store_ready):
    node = wac_store.code_index.get("246-341-0425")
    assert node is not None and node.text, "missing 246-341-0425 in PDF store"
    source = normalize_statute_text(node.text)
    outline = parse_statute_outline(source)
    labels = [item.label for item in outline.items]
    assert labels[0] == "(1)"
    assert "(2)" in labels
    assert "(10)" in labels
    assert any(item.label == "(a)" and item.depth == 1 for item in outline.items)
    assert outline_plain_text(outline) == source
    formatted = format_statute_outline(source)
    assert "\n(1) " in formatted or formatted.startswith("(1) ")
    assert "\n  (a) " in formatted
