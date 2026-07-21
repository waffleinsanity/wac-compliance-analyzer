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


def band_research(score: float) -> str:
    if score <= 0:
        return "none"
    if score < 0.06:
        return "weak"
    if score < 0.16:
        return "moderate"
    return "strong"


def test_ir_bands():
    assert band_ir(0.5, "explicit_cite") == "strong"
    assert band_ir(0.4) == "strong"
    assert band_ir(0.2) == "moderate"
    assert band_ir(0.1, low_confidence=True) == "weak"
    assert band_ir(0.0, "code_fallback") == "none"


def test_research_bands():
    assert band_research(0.2) == "strong"
    assert band_research(0.1) == "moderate"
    assert band_research(0.03) == "weak"
    assert band_research(0.0) == "none"
