"""Post-select allegation cite goldens (not just TF-IDF top-1)."""

from __future__ import annotations

import json
from pathlib import Path

from app.services.wac_scope import score_relevant_subsections, select_for_allegation

CASES = Path(__file__).parent / "fixtures" / "cases"


def _code(selected: str) -> str:
    return selected.replace("WAC ", "").replace("RCW ", "").strip()


def _load_cases():
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(CASES.glob("*.json"))]


def test_expected_selected_labels(store_ready):
    for case in _load_cases():
        expected_map = case.get("expected_selected_labels") or {}
        if not expected_map:
            continue
        complaint = case["complaint"]
        for code, expected in expected_map.items():
            ranked = score_relevant_subsections(complaint, code, max_items=14)
            selected = select_for_allegation(ranked, max_items=10, complaint=complaint)
            labels = {s.label for s in selected}
            assert labels & set(expected), (
                f"{case['id']}/{code}: expected selected ∩ {expected}, got "
                f"{[(s.label, round(s.score, 3), s.reason) for s in selected]}"
            )


def test_forbid_selected_tokens_and_labels(store_ready):
    for case in _load_cases():
        forbid_tokens = case.get("forbid_selected_tokens") or {}
        forbid_labels = case.get("forbid_selected_labels") or {}
        if not forbid_tokens and not forbid_labels:
            continue
        complaint = case["complaint"]
        for code in set(forbid_tokens) | set(forbid_labels):
            ranked = score_relevant_subsections(complaint, code, max_items=14)
            selected = select_for_allegation(ranked, max_items=10, complaint=complaint)
            labels = [s.label for s in selected]
            blob = " ".join(f"{s.label} {s.title} {s.text}" for s in selected).lower()
            for token in forbid_tokens.get(code) or []:
                assert token.lower() not in blob, (
                    f"{case['id']}/{code}: forbidden token {token!r} in selected {labels}"
                )
            for lab in forbid_labels.get(code) or []:
                assert lab not in labels, (
                    f"{case['id']}/{code}: forbidden label {lab} in selected {labels}"
                )


def test_require_any_selected_token(store_ready):
    for case in _load_cases():
        require_map = case.get("require_any_selected_token") or {}
        if not require_map:
            continue
        complaint = case["complaint"]
        for code, tokens in require_map.items():
            ranked = score_relevant_subsections(complaint, code, max_items=14)
            selected = select_for_allegation(ranked, max_items=10, complaint=complaint)
            blob = " ".join(f"{s.label} {s.title} {s.text}" for s in selected).lower()
            assert selected, f"{case['id']}/{code}: expected non-empty selection"
            assert any(t.lower() in blob for t in tokens), (
                f"{case['id']}/{code}: expected one of {tokens} in selected text; "
                f"got {[s.label for s in selected]}"
            )


def test_investigate_goldens_quote_and_selection(client):
    """Full /api/investigate asserts for fixtures that opt into quote integrity."""
    for case in _load_cases():
        if not case.get("expect_quote_integrity"):
            continue
        res = client.post(
            "/api/investigate",
            json={
                "text": case["complaint"],
                "selected_wacs": case["selected_wacs"],
                "case_id": f"GOLDEN-{case['id']}",
                "investigation_date": "07/22/2026",
            },
        )
        assert res.status_code == 200, f"{case['id']}: {res.text}"
        data = res.json()
        assert data.get("quote_integrity", {}).get("ok") is True, (
            f"{case['id']}: {data.get('quote_integrity')}"
        )
        by_code = {_code(a["wac_code"]): a for a in data.get("allegations") or []}
        for code, expected in (case.get("expected_selected_labels") or {}).items():
            a = by_code.get(_code(code))
            assert a, (
                f"{case['id']}: missing allegation for {code}; "
                f"got {sorted(by_code)}"
            )
            matched = set(a.get("matched_subsections") or [])
            # matched_subsections may be full cites or labels — accept either
            label_hits = {
                m if m.startswith("(") else (m.split(code)[-1] if code in m else m)
                for m in matched
            }
            assert label_hits & set(expected) or any(
                any(exp in m for exp in expected) for m in matched
            ), f"{case['id']}/{code}: expected {expected} in matched {matched}"
        for code, tokens in (case.get("forbid_selected_tokens") or {}).items():
            a = by_code.get(code)
            if not a:
                continue
            blob = " ".join(
                [
                    a.get("allegation_text") or "",
                    " ".join(a.get("matched_subsections") or []),
                    " ".join(a.get("matched_subsection_texts") or []),
                ]
            ).lower()
            for token in tokens:
                assert token.lower() not in blob, (
                    f"{case['id']}/{code}: forbidden {token!r} in allegation output"
                )
