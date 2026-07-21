"""Corpus research search should use expanded query + blended RAG (not TF-IDF-only)."""

from __future__ import annotations


def test_corpus_search_blends_and_excludes(store_ready):
    from app.rag.store import wac_store
    from app.services.wac_scope import expand_ranking_query

    complaint = (
        "patient was sexually assaulted; facility failed to protect safety and security "
        "and disclosed confidential information without consent"
    )
    expanded = expand_ranking_query(complaint)
    assert "sexual" in expanded.lower() or "assault" in expanded.lower()
    assert "protect" in expanded.lower() or "safety" in expanded.lower()

    hits = wac_store.corpus_search(complaint, top_k=20)
    assert hits, "expected research hits from local PDF corpus"
    assert all(score > 0 for _, score, _ in hits)

    # Reasons should include modern blend signals when Chroma/TF-IDF agree
    reasons = {reason for _, _, reason in hits}
    assert reasons & {"tfidf", "chroma", "tfidf+chroma", "keyword"}

    excluded = {"246-341-0600"}
    filtered = wac_store.corpus_search(complaint, top_k=20, exclude_codes=excluded)
    assert all(
        n.code.replace("WAC ", "").replace("RCW ", "") not in excluded for n, _, _ in filtered
    )


def test_corpus_search_surfaces_leaf_or_code_levels(store_ready):
    from app.rag.store import wac_store

    hits = wac_store.corpus_search(
        "clinical supervision training quality of care cultural competency",
        top_k=15,
    )
    assert hits
    levels = {n.level for n, _, _ in hits}
    # Prefer actionable statute nodes (code or subsection leaves), not only primaries
    assert levels & {"code", "secondary", "tertiary", "quaternary"}
