"""Golden ranking cases for subsection selection."""

from __future__ import annotations

import json
from pathlib import Path

from app.services.wac_scope import LOW_CONFIDENCE_SCORE, score_relevant_subsections

CASES = Path(__file__).parent / "fixtures" / "cases"


def test_assault_prefers_0600_family(store_ready):
    case = json.loads((CASES / "assault_safety.json").read_text(encoding="utf-8"))
    ranked = score_relevant_subsections(case["complaint"], "246-341-0600", max_items=6)
    assert ranked
    assert ranked[0].code == "246-341-0600"
    assert any(s.score > 0 or s.reason == "explicit_cite" for s in ranked)
    expected = (case.get("expected_top_labels") or {}).get("246-341-0600") or []
    top_labels = {s.label for s in ranked[:2]}
    assert top_labels & set(expected), (
        f"assault_safety: expected top-1/2 label in {expected}, got "
        f"{[(s.label, round(s.score, 3), s.reason) for s in ranked[:4]]}"
    )


def test_confidentiality_ranks_selected_codes(store_ready):
    case = json.loads((CASES / "confidentiality_rcw.json").read_text(encoding="utf-8"))
    for selected in case["selected_wacs"]:
        code = selected.replace("WAC ", "").replace("RCW ", "").strip()
        ranked = score_relevant_subsections(case["complaint"], code, max_items=4)
        assert ranked, f"no subsections ranked for {code}"
        assert all(s.code == code for s in ranked)
    expected_map = case.get("expected_top_labels") or {}
    for code, expected in expected_map.items():
        ranked = score_relevant_subsections(case["complaint"], code, max_items=4)
        top_labels = {s.label for s in ranked[:2]}
        assert top_labels & set(expected), (
            f"confidentiality: {code} expected top-1/2 in {expected}, got "
            f"{[(s.label, round(s.score, 3)) for s in ranked[:4]]}"
        )


def test_expected_prefixes_appear_across_selection(store_ready):
    for path in sorted(CASES.glob("*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        expected = case.get("expected_cite_prefixes") or []
        if not expected:
            continue
        all_cites: list[str] = []
        for selected in case["selected_wacs"]:
            code = selected.replace("WAC ", "").replace("RCW ", "").strip()
            for s in score_relevant_subsections(case["complaint"], code, max_items=6):
                all_cites.append(f"{s.code}{s.label}")
        joined = " ".join(all_cites)
        assert any(p in joined for p in expected), (
            f"{case['id']}: expected one of {expected} in {all_cites[:24]}"
        )


def test_expected_top_labels_membership(store_ready):
    """Strong fixtures pin top-1/2 leaf labels under the primary code."""
    for path in sorted(CASES.glob("*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        expected_map = case.get("expected_top_labels") or {}
        if not expected_map:
            continue
        for code, expected in expected_map.items():
            ranked = score_relevant_subsections(case["complaint"], code, max_items=6)
            assert ranked, f"{case['id']}: empty ranking for {code}"
            top_labels = {s.label for s in ranked[:2]}
            assert top_labels & set(expected), (
                f"{case['id']}/{code}: expected top-1/2 in {expected}, got "
                f"{[(s.label, round(s.score, 3), s.reason) for s in ranked[:4]]}"
            )


def test_weak_overlap_stays_low_confidence(store_ready):
    case = json.loads((CASES / "weak_overlap.json").read_text(encoding="utf-8"))
    ranked = score_relevant_subsections(case["complaint"], "246-341-0600", max_items=4)
    assert ranked, "always-return should still yield closest leaves"
    top = ranked[0]
    assert top.score < LOW_CONFIDENCE_SCORE or top.reason == "code_fallback", (
        f"weak_overlap should stay low-confidence, got score={top.score:.3f} reason={top.reason}"
    )


def test_explicit_cite_merges_with_lexical(store_ready):
    """Explicit cites boost to the top but lexical fills remaining slots."""
    complaint = (
        "Staff violated WAC 246-341-0600(2)(e) after a patient was assaulted "
        "and the facility failed to protect safety and security."
    )
    ranked = score_relevant_subsections(complaint, "246-341-0600", max_items=4)
    assert ranked
    assert ranked[0].label == "(2)(e)"
    assert ranked[0].reason == "explicit_cite"
    assert len(ranked) >= 2, "lexical ranking should fill slots beyond the explicit cite"
    assert any(s.reason == "lexical_overlap" for s in ranked[1:])
