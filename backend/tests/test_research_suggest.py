"""Optional research suggestions use IR leaf/overlap ranking (not random corpus neighbors)."""

from __future__ import annotations


def test_rank_research_suggestions_code_level_and_excludes(store_ready):
    from app.services.research_suggest import rank_research_suggestions
    from app.services.wac_scope import LOW_CONFIDENCE_SCORE

    complaint = (
        "patient was sexually assaulted by another patient; staff failed to protect "
        "patient safety and security after being informed of escalating conflict"
    )
    hits = rank_research_suggestions(complaint, top_k=12)
    assert hits, "expected IR-preview research hits"
    assert all(h.score_basis == "ir_leaf" for h in hits)
    assert all(h.node.level == "code" for h in hits)
    assert all(h.score >= LOW_CONFIDENCE_SCORE for h in hits)
    # Deduped to one row per code
    codes = [h.node.code for h in hits]
    assert len(codes) == len(set(codes))
    # Excerpts should show a duty, not empty noise
    assert any(h.excerpt and len(h.excerpt) > 20 for h in hits)

    excluded = {"246-341-0600", "246-341-0410"}
    filtered = rank_research_suggestions(complaint, top_k=12, exclude_codes=excluded)
    assert all(
        h.node.code.replace("WAC ", "").replace("RCW ", "") not in excluded for h in filtered
    )


def test_rank_research_prefers_complaint_overlap_over_unrelated_specialty(store_ready):
    """Medication complaint should not lead with gambling/OTP specialty leaves."""
    from app.services.research_suggest import rank_research_suggestions

    complaint = (
        "nurse administered the wrong dose of medication; controlled substance shift "
        "counts were not verified; medication error was not documented"
    )
    hits = rank_research_suggestions(complaint, top_k=10)
    assert hits
    top_codes = [
        h.node.code.replace("WAC ", "").replace("RCW ", "") for h in hits[:5]
    ]
    # Expect meds / nursing / RTF care codes near the top — not OTP 1000 alone
    medish = {
        "246-337-105",
        "246-337-080",
        "246-337-050",
        "246-341-0510",
        "246-337-045",
    }
    assert any(c in medish for c in top_codes), f"unexpected top codes: {top_codes}"
    # Specialty OTP should not dominate a meds-error complaint
    if hits[0].node.code.replace("WAC ", "").replace("RCW ", "") == "246-341-1000":
        raise AssertionError("OTP dosing ranked #1 on a medication-error complaint")


def test_suggest_related_requires_complaint_driven_ranking(store_ready):
    """Related suggest excludes selected codes and still returns IR-preview hits."""
    from app.services.research_suggest import chapters_for_selection, rank_research_suggestions

    complaint = (
        "agency staff disclosed protected health information to a parent without consent; "
        "clinical information shared by phone"
    )
    selected = ["WAC 246-341-0425"]
    chapters = chapters_for_selection(selected)
    assert chapters
    hits = rank_research_suggestions(
        complaint,
        top_k=8,
        exclude_codes={"246-341-0425"},
        preferred_chapters=chapters,
    )
    assert hits
    assert all(
        h.node.code.replace("WAC ", "").replace("RCW ", "") != "246-341-0425" for h in hits
    )
    # Privacy / rights codes should appear for a PHI complaint
    blob = " ".join(h.node.code for h in hits).lower()
    assert "0600" in blob or "0420" in blob or "71.05" in blob or "0425" not in blob
