"""Optional research suggestions ranked with the same leaf/overlap logic as IR drafts.

Discovery-only: never auto-authorizes codes. Corpus search finds candidate codes;
``score_relevant_subsections`` + complaint-overlap gates decide whether a code would
actually produce useful Compare duties if the investigator approved it.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.rag.store import WACNode, wac_store
from app.services.wac_scope import (
    LOW_CONFIDENCE_SCORE,
    MODERATE_SCORE,
    code_node_for,
    score_relevant_subsections,
    select_for_allegation,
    subsection_passes_complaint_overlap,
)

# How many corpus hits to consider before IR re-scoring (latency vs recall).
_CANDIDATE_POOL = 48
# Cap IR re-score calls — each is a per-code TF-IDF pass.
_MAX_CODES_TO_SCORE = 28
# Chapter diversity so one chapter does not flood the list.
_MAX_PER_CHAPTER = 3
# Soft boost when related-suggest prefers chapters already on the case.
_CHAPTER_AFFINITY = 0.04


@dataclass
class ResearchSuggestion:
    """One code-level research hit with IR-preview strength."""

    node: WACNode
    score: float
    reason: str
    excerpt: str
    duty_label: str = ""
    score_basis: str = "ir_leaf"
    corpus_score: float = 0.0


def _norm_code(code: str) -> str:
    return code.replace("WAC ", "").replace("RCW ", "").strip()


def _parent_code_node(node: WACNode) -> WACNode | None:
    code = _norm_code(node.code)
    parent = code_node_for(code)
    if parent is not None:
        return parent
    # Fall back to the hit itself when it is already a code header.
    if node.level == "code":
        return node
    return None


def _duty_excerpt(label: str, text: str, *, max_chars: int = 420) -> str:
    body = (text or "").strip()
    if label:
        body = f"{label} {body}".strip()
    if len(body) <= max_chars:
        return body
    return body[: max_chars - 1].rstrip() + "…"


def _candidate_codes(
    complaint: str,
    *,
    exclude: set[str],
    preferred_chapters: set[str] | None,
) -> list[tuple[str, float, str]]:
    """Unique parent codes from corpus RAG, ordered by blended corpus score."""
    ranked = wac_store.corpus_search(
        complaint,
        top_k=_CANDIDATE_POOL,
        exclude_codes=exclude or None,
    )
    best: dict[str, tuple[float, str, str]] = {}
    for node, score, reason in ranked:
        code = _norm_code(node.code)
        if not code or code in exclude:
            continue
        parent = _parent_code_node(node)
        if parent is None:
            continue
        code = _norm_code(parent.code)
        if code in exclude:
            continue
        chapter = parent.chapter or node.chapter or ""
        adj = float(score)
        if preferred_chapters and chapter in preferred_chapters:
            adj += _CHAPTER_AFFINITY
        prev = best.get(code)
        if prev is None or adj > prev[0]:
            best[code] = (adj, reason, chapter)

    ordered = sorted(best.items(), key=lambda kv: kv[1][0], reverse=True)
    return [(code, sc, reason) for code, (sc, reason, _ch) in ordered]


def _preview_best_leaf(complaint: str, code: str):
    """Best overlap-passing leaf under one code (same gates as allegation draft)."""
    ranked = score_relevant_subsections(complaint, code, max_items=6)
    if not ranked:
        return None
    # Prefer what Compare would actually surface if this code were approved.
    selected = select_for_allegation(ranked, max_items=2, complaint=complaint)
    if selected:
        return selected[0]
    # Otherwise take the strongest overlap-passing leaf above noise.
    for sub in ranked:
        if float(sub.score) < LOW_CONFIDENCE_SCORE:
            continue
        if not subsection_passes_complaint_overlap(complaint, sub):
            continue
        return sub
    return None


def rank_research_suggestions(
    complaint: str,
    *,
    top_k: int = 15,
    exclude_codes: set[str] | None = None,
    preferred_chapters: set[str] | None = None,
) -> list[ResearchSuggestion]:
    """Rank code-level WAC/RCW suggestions with IR leaf preview scores.

    Returns useful, non-random recommendations: corpus discovery, then the same
    per-code leaf ranker + overlap gates used for draft Compare duties.
    """
    text = (complaint or "").strip()
    if not text or not wac_store.ready:
        return []

    exclude = {_norm_code(c) for c in (exclude_codes or set()) if c}
    preferred = {c for c in (preferred_chapters or set()) if c}
    candidates = _candidate_codes(
        text, exclude=exclude, preferred_chapters=preferred or None
    )[:_MAX_CODES_TO_SCORE]

    strong: list[ResearchSuggestion] = []
    weak: list[ResearchSuggestion] = []

    for code, corpus_score, _corpus_reason in candidates:
        leaf = _preview_best_leaf(text, code)
        if leaf is None:
            continue
        node = code_node_for(code)
        if node is None:
            continue
        score = float(leaf.score)
        reason = leaf.reason or "lexical_overlap"
        excerpt = _duty_excerpt(leaf.label or "", leaf.text or "")
        hit = ResearchSuggestion(
            node=node,
            score=round(score, 4),
            reason=reason,
            excerpt=excerpt,
            duty_label=leaf.label or "",
            score_basis="ir_leaf",
            corpus_score=round(float(corpus_score), 4),
        )
        if score >= MODERATE_SCORE or reason == "explicit_cite":
            strong.append(hit)
        elif score >= LOW_CONFIDENCE_SCORE:
            weak.append(hit)

    strong.sort(key=lambda h: (-h.score, h.node.code))
    weak.sort(key=lambda h: (-h.score, h.node.code))

    out: list[ResearchSuggestion] = []
    per_chapter: dict[str, int] = {}

    def _take(pool: list[ResearchSuggestion]) -> None:
        for hit in pool:
            if len(out) >= top_k:
                return
            chapter = hit.node.chapter or ""
            if per_chapter.get(chapter, 0) >= _MAX_PER_CHAPTER:
                continue
            out.append(hit)
            per_chapter[chapter] = per_chapter.get(chapter, 0) + 1

    _take(strong)
    # Fill remaining slots with weaker-but-real overlaps (never empty-noise codes).
    _take(weak)
    return out[:top_k]


def chapters_for_selection(selected_wacs: list[str]) -> set[str]:
    """Chapters of currently approved codes — soft affinity for related suggest."""
    chapters: set[str] = set()
    for item in selected_wacs:
        code = _norm_code(item)
        node = code_node_for(code)
        if node and node.chapter:
            chapters.add(node.chapter)
    return chapters
