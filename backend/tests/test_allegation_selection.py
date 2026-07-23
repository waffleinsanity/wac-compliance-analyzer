"""Allegation subsection selection: strong + upper-moderate, capped, not full-code."""

from __future__ import annotations

from app.services.wac_scope import (
    ALLEGATION_INCLUDE_MIN,
    MODERATE_SCORE,
    ScopedSubsection,
    draft_allegation_from_source,
    score_relevant_subsections,
    select_for_allegation,
)


def _sub(label: str, score: float, *, reason: str = "lexical_overlap", text: str = "") -> ScopedSubsection:
    return ScopedSubsection(
        code="246-341-0410",
        label=label,
        hierarchy_path=f"WAC 246-341-0410{label}",
        title="test",
        text=text
        or "Duty text long enough for ranking filters to treat as actionable content here.",
        level="secondary",
        score=score,
        reason=reason,
    )


def test_select_includes_strong_and_upper_moderate_only():
    ranked = [
        _sub("(4)(b)", 0.62),
        _sub("(4)(g)(i)", 0.55),
        _sub("(1)(a)", 0.44),  # upper moderate
        _sub("(1)(b)", 0.41),
        _sub("(2)", 0.35),  # lower moderate — exclude unless needed for floor
        _sub("(3)", 0.12),  # weak
    ]
    selected = select_for_allegation(ranked, max_items=10)
    labels = [s.label for s in selected]
    assert "(4)(b)" in labels
    assert "(4)(g)(i)" in labels
    assert "(1)(a)" in labels
    assert "(1)(b)" in labels
    assert "(2)" not in labels
    assert "(3)" not in labels
    assert all(
        s.score >= ALLEGATION_INCLUDE_MIN or s.reason in {"explicit_cite", "structural_anchor"}
        for s in selected
    )


def test_structural_anchor_reason_always_included():
    ranked = [
        _sub("(4)(b)", 0.62),
        _sub("(1)(a)", 0.05, reason="structural_anchor"),
    ]
    # Force low score with structural reason
    ranked[1].score = 0.05
    ranked[1].reason = "structural_anchor"
    selected = select_for_allegation(ranked, max_items=10)
    assert "(1)(a)" in [s.label for s in selected]


def test_select_drops_weak_floor_without_overlap():
    """Do not invent a 'best of the worst' cite when leaves lack complaint substance."""
    complaint = (
        "The complainant reported dissatisfaction with cafeteria menu options and parking."
    )
    ranked = [
        _sub("(4)(a)", 0.22, text="Clinical supervision of behavioral health clinical services staff."),
        _sub(
            "(4)(b)",
            0.18,
            text="Problem gambling and gambling disorder treatment staffing ratios.",
        ),
        _sub("(1)(a)", 0.05, text="Unrelated cafeteria and parking lot duties."),
    ]
    selected = select_for_allegation(ranked, max_items=10, complaint=complaint)
    assert selected == []
    assert "gambling" not in " ".join(s.text for s in selected).lower()


def test_select_floor_keeps_moderate_overlap_passes():
    """Top-2 floor still fills leaves that share complaint substance above noise."""
    complaint = (
        "Staff failed to protect patient safety and security after a sexual assault."
    )
    ranked = [
        _sub(
            "(2)(e)",
            0.37,
            text="Protect each individual from sexual abuse harassment and exploitation.",
        ),
        _sub(
            "(1)",
            0.35,
            text="Ensure the safety and security of individuals receiving behavioral health services.",
        ),
        _sub("(9)", 0.12, text="Unrelated cafeteria menu and parking lot duties."),
    ]
    selected = select_for_allegation(ranked, max_items=10, complaint=complaint)
    assert [s.label for s in selected] == ["(2)(e)", "(1)"]
    assert all(s.score >= MODERATE_SCORE for s in selected)


def test_select_respects_cap():
    ranked = [_sub(f"({i})", 0.55) for i in range(1, 16)]
    selected = select_for_allegation(ranked, max_items=10)
    assert len(selected) == 10


def test_0410_structural_anchors_include_1a(store_ready):
    complaint = (
        "Staff failed to protect patient safety and security. "
        "The administrator failed to ensure day-to-day operations and adequate staffing."
    )
    ranked = score_relevant_subsections(complaint, "246-341-0410", max_items=14)
    labels = {s.label for s in ranked}
    assert "(1)(a)" in labels
    anchor = next(s for s in ranked if s.label == "(1)(a)")
    assert anchor.reason == "structural_anchor" or anchor.score >= ALLEGATION_INCLUDE_MIN
    selected = select_for_allegation(ranked, max_items=10, complaint=complaint)
    assert "(1)(a)" in [s.label for s in selected]
    assert "(1)(b)" in [s.label for s in selected]
    assert "(1)(c)" in [s.label for s in selected]


def test_medication_complaint_0515_excludes_gambling_and_generic_supervision(store_ready):
    """Meds facts must not pull 0515 problem-gambling staffing or weak clinical-supervision cites."""
    complaint = (
        "The complaint alleged repeated medication errors at a residential treatment facility, "
        "including missed evening doses and administration of the wrong dose of a psychiatric "
        "medication. Staff allegedly failed to document medication administration accurately, "
        "did not notify a prescriber after an adverse reaction, and storage of controlled "
        "medications was left unlocked on one shift. The complainant also alleged inadequate "
        "staffing and supervision of medication-trained personnel."
    )
    ranked = score_relevant_subsections(complaint, "246-341-0515", max_items=14)
    selected = select_for_allegation(ranked, max_items=10, complaint=complaint)
    labels = [s.label for s in selected]
    joined = " ".join(f"{s.label} {s.title} {s.text}" for s in selected).lower()
    assert "gambling" not in joined
    assert "problem gambling" not in joined
    # (4) is the gambling staffing leaf; (2) is generic clinical supervision — both fail the gate.
    assert "(4)" not in labels
    assert "(2)" not in labels

    draft = draft_allegation_from_source(
        "246-341-0515",
        "Personnel — Agency staffing requirements",
        complaint,
        max_subs=10,
        relevant=selected,
    )
    assert "gambling" not in draft.text.lower()
    assert "problem gambling" not in draft.text.lower()
    for cite in draft.cites:
        assert "(4)" not in cite
        assert not cite.endswith("(2)")
    assert draft.low_confidence or not draft.cites
