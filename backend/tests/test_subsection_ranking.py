"""Golden ranking cases for subsection selection."""

from __future__ import annotations

import json
from pathlib import Path

from app.services.wac_scope import score_relevant_subsections

CASES = Path(__file__).parent / "fixtures" / "cases"


def test_assault_prefers_0600_family(store_ready):
    case = json.loads((CASES / "assault_safety.json").read_text(encoding="utf-8"))
    ranked = score_relevant_subsections(case["complaint"], "246-341-0600", max_items=6)
    assert ranked
    assert ranked[0].code == "246-341-0600"
    assert any(s.score > 0 or s.reason == "explicit_cite" for s in ranked)


def test_confidentiality_ranks_selected_codes(store_ready):
    case = json.loads((CASES / "confidentiality_rcw.json").read_text(encoding="utf-8"))
    for selected in case["selected_wacs"]:
        code = selected.replace("WAC ", "").replace("RCW ", "").strip()
        ranked = score_relevant_subsections(case["complaint"], code, max_items=4)
        assert ranked, f"no subsections ranked for {code}"
        assert all(s.code == code for s in ranked)


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
