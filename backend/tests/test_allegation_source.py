"""Allegation drafts must stay concise and match Baseline shape (no quotation marks)."""

from __future__ import annotations

import json
from pathlib import Path

from app.services.quote_verify import extract_duty_spans, is_contiguous_substring, store_text_for_cite
from app.services.wac_scope import ALLEGATION_TARGET_CHARS, draft_allegation_from_source

CASES = Path(__file__).parent / "fixtures" / "cases"


def test_draft_duty_phrases_are_store_substrings(store_ready):
    draft = draft_allegation_from_source(
        "246-341-0600",
        "Agency administration",
        "patient assault safety security protection staff failed to protect",
        max_subs=2,
    )
    assert '"' not in draft.text, "Baseline allegation lines must not wrap duties in quotes"
    assert draft.text.startswith("Potential violation of")
    assert not draft.text.startswith("A potential")
    spans = extract_duty_spans(draft.text)
    assert spans, "allegation must include duty phrases after subsection labels"
    assert "by having failed to" in draft.text.lower()
    assert "failed to comply with the following requirements" not in draft.text.lower()
    assert len(draft.text) <= ALLEGATION_TARGET_CHARS + 120
    for span in spans:
        matched = False
        for cite in draft.cites or ["246-341-0600"]:
            source = store_text_for_cite(cite) or store_text_for_cite("246-341-0600")
            if source and is_contiguous_substring(span, source):
                matched = True
                break
        assert matched, f"span not in store: {span[:80]}"


def test_weak_overlap_flags_confidence_not_meta_fluff(store_ready):
    case = json.loads((CASES / "weak_overlap.json").read_text(encoding="utf-8"))
    code = case["selected_wacs"][0].replace("WAC ", "").replace("RCW ", "")
    draft = draft_allegation_from_source(code, code, case["complaint"], max_subs=2)
    assert draft.low_confidence or draft.match_reason == "code_fallback" or draft.match_score < 0.15
    assert "investigator review" not in draft.text.lower()
    assert "limited overlap" not in draft.text.lower()
    assert "failed to comply with the following requirements" not in draft.text.lower()
    assert "by having failed to" in draft.text.lower() or "as applied to the reported concern" in draft.text.lower()
    assert '"' not in draft.text
    spans = extract_duty_spans(draft.text)
    assert spans or "as applied to the reported concern" in draft.text.lower()


def test_allegation_stays_concise(store_ready):
    draft = draft_allegation_from_source(
        "246-341-0600",
        "Agency administration — Administrator key responsibilities",
        "patient was sexually assaulted; facility failed to protect safety and security of patients",
        max_subs=2,
    )
    assert len(draft.text) <= ALLEGATION_TARGET_CHARS + 80
    assert '"' not in draft.text
    assert "\n" not in draft.text


def test_0410_picks_leaf_duties_not_parent_dump(store_ready):
    draft = draft_allegation_from_source(
        "246-341-0410",
        "Agency administration - Administrator key responsibilities",
        "The agency administrator failed to ensure adequate staffing and did not respond "
        "to resident safety concerns after a reported incident of neglect.",
        max_subs=2,
    )
    assert "for investigator review" not in draft.text.lower()
    assert "limited overlap" not in draft.text.lower()
    assert "by having failed to" in draft.text.lower()
    assert '"' not in draft.text
    assert len(draft.text) <= ALLEGATION_TARGET_CHARS + 80
    assert "\n" not in draft.text
    # Must not paste the giant parent (4) "must ensure:" list opener
    assert "must ensure:" not in draft.text.lower()


def test_0410_no_list_intro_stub_or_double_punct(store_ready):
    draft = draft_allegation_from_source(
        "246-341-0410",
        "Agency administration - Administrator key responsibilities",
        "clinical supervision and training of staff continuously improves the quality of care",
        max_subs=2,
    )
    assert '"' not in draft.text
    assert ";;" not in draft.text
    assert ":." not in draft.text
    assert ";." not in draft.text
    assert "the following:" not in draft.text.lower()
    assert draft.text.endswith(".")
    assert "by having failed to" in draft.text.lower()
    # Prefer concrete quaternary / leaf duties over the (iii) list intro
    assert "(4)(g)(iii) Cultural" not in draft.text
