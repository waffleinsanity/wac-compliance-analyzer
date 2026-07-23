"""Ancestor context for nested WAC leaves — (g) intro + (i) duty stay distinct nodes."""

from __future__ import annotations

from app.services.wac_scope import (
    own_clause_text,
    parent_subsection_labels,
    subsection_ancestor_context,
    subsection_display_text,
    validate_subsection_cite,
)


def test_parent_labels_outer_to_inner():
    assert parent_subsection_labels("(4)(g)(i)") == ["(4)", "(4)(g)"]
    assert parent_subsection_labels("(4)(g)") == ["(4)"]
    assert parent_subsection_labels("(4)") == []


def test_0410_g_and_i_are_distinct_nodes_in_store(store_ready):
    parent = validate_subsection_cite("246-341-0410", "246-341-0410(4)(g)")
    leaf = validate_subsection_cite("246-341-0410", "246-341-0410(4)(g)(i)")
    assert parent is not None, "missing secondary (4)(g) in WAC store"
    assert leaf is not None, "missing tertiary (4)(g)(i) in WAC store"
    assert parent.hierarchy_path != leaf.hierarchy_path
    assert parent.level == "secondary"
    assert leaf.level == "tertiary"
    assert "quality management" in parent.text.lower()
    assert "clinical supervision" in leaf.text.lower()
    assert "quality management" not in leaf.text.lower()


def test_validate_does_not_resolve_parent_to_child(store_ready):
    parent = validate_subsection_cite("246-341-0410", "246-341-0410(4)(g)")
    assert parent is not None
    assert parent.label == "(4)(g)"
    assert parent.level == "secondary"


def test_0410_leaf_display_includes_parent_intro(store_ready):
    leaf = validate_subsection_cite("246-341-0410", "246-341-0410(4)(g)(i)")
    parent = validate_subsection_cite("246-341-0410", "246-341-0410(4)(g)")
    assert leaf and parent
    intro = own_clause_text(parent.text)
    assert "quality management" in intro.lower()
    assert "(i)" not in intro.lower()
    context = subsection_ancestor_context(leaf)
    assert "quality management" in context.lower()
    display = subsection_display_text(leaf)
    assert "quality management" in display.lower()
    assert "clinical supervision" in display.lower()
    # Exact leaf text alone still excludes parent intro (quote-verify field)
    assert "quality management" not in leaf.text.lower()
