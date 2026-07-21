"""Unit tests for Summary of Findings framework starter."""

from __future__ import annotations

from app.schemas import InvestigationAllegation
from app.services.investigation import (
    _summary_intake_opener,
    _truncate_at_sentence_boundary,
    build_summary_of_findings,
)


def _allegation(code: str, title: str, text: str) -> InvestigationAllegation:
    return InvestigationAllegation(
        wac_code=code,
        wac_title=title,
        allegation_text=text,
    )


def test_summary_never_contains_ellipsis():
    intake = "It was alleged that staff failed to protect patient safety."
    allegations = [
        _allegation(
            "WAC 246-341-0600",
            "Patient rights and safety",
            "Potential violation of WAC 246-341-0600, Patient rights and safety, by having failed to (2)(e) protect patients from harm.",
        )
    ]
    summary = build_summary_of_findings(intake, allegations)
    assert "…" not in summary
    assert "..." not in summary
    assert "Department of Health" in summary
    assert "Investigative findings (to be completed)" in summary


def test_summary_one_paragraph_per_allegation():
    allegations = [
        _allegation("246-341-0410", "General requirements", "Potential violation of WAC 246-341-0410, General requirements, by having failed to (1) maintain standards."),
        _allegation("246-341-0600", "Patient rights", "Potential violation of WAC 246-341-0600, Patient rights, by having failed to (2)(e) protect patients."),
    ]
    summary = build_summary_of_findings("Patient safety concerns at the facility.", allegations)
    assert summary.count("is authorized for this investigation because") == 2
    assert "WAC 246-341-0410, General requirements," in summary
    assert "WAC 246-341-0600, Patient rights," in summary
    assert "The corresponding allegation asserts:" in summary
    assert "…" not in summary
    assert "..." not in summary


def test_summary_truncates_huge_intake_on_sentence_boundaries():
    sentences = [
        "The Department of Health (DOH) received a complaint alleging unsafe conditions at the facility.",
        "Staff reportedly failed to supervise patients during evening hours.",
        "Witnesses described repeated security breaches on the unit.",
        "The complainant requested immediate corrective action from licensing staff.",
        "Additional concerns included medication errors and incomplete incident reports.",
    ]
    huge_intake = " ".join(sentences)
    opener = _summary_intake_opener(huge_intake)
    assert len(opener) <= 720
    assert "…" not in opener
    assert "..." not in opener
    assert opener.endswith(".")
    # Must not cut mid-sentence — every kept sentence ends with terminal punctuation.
    kept = [s for s in sentences if s.rstrip(".") in opener]
    assert kept, "expected at least one full intake sentence in opener"
    truncated = _truncate_at_sentence_boundary(huge_intake, 120)
    assert truncated.endswith(".")
    assert "…" not in truncated
    assert "..." not in truncated
    assert len(truncated) <= 120 or truncated == sentences[0]
