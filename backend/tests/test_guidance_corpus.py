"""Guidance corpus ingest + IR/SOD structure helpers (not statute authority)."""

from __future__ import annotations

from app.services.guidance_corpus import (
    IR_CONCLUSION_OPTIONS,
    categorical_allegation_text,
    guidance_dir,
    load_guidance_corpus,
    recommend_enforcement_outcomes,
    reload_guidance_corpus,
)


def test_guidance_dir_has_policy_manuals():
    root = guidance_dir()
    assert root.is_dir(), f"missing guidance dir: {root}"
    names = {p.name.lower() for p in root.iterdir()}
    assert any("investigative report" in n and "guidance" in n for n in names)
    assert any("formatting standards" in n for n in names)


def test_load_guidance_corpus_parses_docx_pptx():
    corpus = reload_guidance_corpus()
    assert len(corpus.files) >= 4
    kinds = {f.kind for f in corpus.files}
    assert "ir_guidance" in kinds
    assert any(f.char_count > 100 for f in corpus.files)
    assert IR_CONCLUSION_OPTIONS[0].endswith("cited")
    assert "citied" not in IR_CONCLUSION_OPTIONS[0]


def test_categorical_allegation_not_cite_first():
    text = categorical_allegation_text("246-337-060", "Infection control — policies")
    assert "Potential violation" not in text
    assert "Infection control" in text


def test_enforcement_recommender_advisory():
    assert recommend_enforcement_outcomes("isolated", "immediate_jeopardy") == [
        "ij_notice",
        "sod_cmt_referral",
        "cmt_emergency_actions",
    ]
    assert recommend_enforcement_outcomes("isolated", "no_actual_harm_minimal") == ["no_citation"]
    assert "sod_dpoc_rtf" in recommend_enforcement_outcomes(
        "pattern", "actual_harm_not_ij", is_rtf=True
    )
    assert recommend_enforcement_outcomes("", "") == []


def test_guidance_api(client):
    load_guidance_corpus()
    res = client.get("/api/guidance")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["file_count"] >= 1
    assert "ir_conclusion_options" in body
