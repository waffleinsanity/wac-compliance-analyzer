"""Unit checks for application-strength banding (mirrors frontend cutoffs)."""

from __future__ import annotations


def band_ir(score: float, reason: str = "", low_confidence: bool = False) -> str:
    reason = (reason or "").lower()
    if reason == "explicit_cite":
        return "strong"
    if reason == "code_fallback":
        if score >= 0.35:
            return "moderate"
        return "weak" if score > 0 else "none"
    if low_confidence or score < 0.15:
        return "none" if score <= 0 else "weak"
    if score < 0.35:
        return "moderate"
    return "strong"


def band_research(score: float, *, score_basis: str = "ir_leaf", reason: str = "lexical_overlap") -> str:
    """Mirror frontend: IR-preview research uses Compare bands."""
    reason = (reason or "").lower()
    if reason == "explicit_cite":
        return "strong"
    if reason == "structural_anchor":
        return "moderate"
    if reason == "code_fallback":
        if score >= 0.5:
            return "moderate"
        return "weak" if score > 0 else "none"
    if score_basis == "corpus":
        if score <= 0:
            return "none"
        if score < 0.06:
            return "weak"
        if score < 0.16:
            return "moderate"
        return "strong"
    if score <= 0:
        return "none"
    if score < 0.3:
        return "weak"
    if score < 0.5:
        return "moderate"
    return "strong"


def test_ir_bands():
    assert band_ir(0.5, "explicit_cite") == "strong"
    assert band_ir(0.4) == "strong"
    assert band_ir(0.2) == "moderate"
    assert band_ir(0.1, low_confidence=True) == "weak"
    assert band_ir(0.0, "code_fallback") == "none"


def test_research_bands():
    assert band_research(0.55) == "strong"
    assert band_research(0.35) == "moderate"
    assert band_research(0.2) == "weak"
    assert band_research(0.0) == "none"
    # Legacy corpus blend still bands on lower cutoffs
    assert band_research(0.2, score_basis="corpus", reason="tfidf") == "strong"
    assert band_research(0.1, score_basis="corpus", reason="tfidf") == "moderate"

