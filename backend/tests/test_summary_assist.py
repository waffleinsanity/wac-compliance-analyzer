"""Summary of Findings collaborator assist — PII redaction + template wording."""

from __future__ import annotations

from unittest.mock import patch

from app.schemas import InvestigationAllegation
from app.services.investigation import build_summary_of_findings, format_collaborator_summary_block
from app.services.investigator_llm import (
    InvestigatorResult,
    _build_summary_assist_prompt,
    _build_user_prompt,
    _local_summary_assist,
    run_investigator,
)


def test_local_summary_assist_nonempty_for_selected_wac():
    selected = [
        {
            "code": "246-341-0410",
            "title": "Administrator key responsibilities",
            "text": "The administrator is responsible for day-to-day operations.",
        }
    ]
    areas, methods = _local_summary_assist(
        "Facility self-reported concerns about day-to-day operations.",
        selected,
    )
    assert areas
    assert methods
    joined = " ".join(areas + methods).lower()
    assert "246-341-0410" in joined
    assert "in compliance" not in joined
    assert "out of compliance" not in joined


def test_collaborator_block_template_wording():
    block = format_collaborator_summary_block(
        areas_of_concern=["Timeline gaps need reconstruction."],
        investigation_methods=["Request policies tied to the authorized WAC."],
    )
    assert "Investigator collaborator notes (template; not findings):" in block
    assert "Areas of concern:" in block
    assert "Suggested methods to begin or strengthen the investigation:" in block
    assert "Human investigators complete evidentiary findings" in block
    assert "in compliance" not in block.lower()


def test_build_summary_excludes_collaborator_block():
    inv = InvestigatorResult(
        intake_summary="test",
        areas_of_concern=["Whether staffing documentation matches authorized scope."],
        investigation_methods=["Interview the administrator about day-to-day oversight."],
    )
    text = build_summary_of_findings(
        "The Department of Health (DOH) received a complaint alleging staffing concerns.",
        [
            InvestigationAllegation(
                case_category="BHA",
                wac_code="246-341-0410",
                wac_title="Administrator key responsibilities",
                allegation_text="Potential violation of WAC 246-341-0410, Administrator key responsibilities.",
            )
        ],
        inv,
    )
    assert "Investigator collaborator notes" not in text
    assert "Areas of concern:" not in text
    assert "Suggested methods" not in text
    assert "authorized for this investigation" not in text
    assert "Potential violation of WAC" not in text
    assert "document review" in text.lower()
    assert "in compliance" not in text.lower()
    assert "out of compliance" not in text.lower()


def test_strip_collaborator_from_summary_removes_legacy_block():
    from app.services.investigation import strip_collaborator_from_summary

    shell = (
        "The Department of Health (DOH) received a complaint.\n\n"
        "Evidentiary findings will be documented after investigation activities.\n\n"
    )
    block = format_collaborator_summary_block(
        areas_of_concern=["WAC 246-341-0410 staffing gaps."],
        investigation_methods=["Interview the administrator."],
    )
    cleaned = strip_collaborator_from_summary(shell + block)
    assert "Investigator collaborator notes" not in cleaned
    assert "Areas of concern:" not in cleaned
    assert "Suggested methods" not in cleaned
    assert "DOH" in cleaned
    assert "Evidentiary findings will be documented" in cleaned
    assert strip_collaborator_from_summary(shell) == shell.strip()
    # Summary that is only the collaborator block becomes empty.
    assert strip_collaborator_from_summary(block) == ""
    # Header-less Areas + Suggested methods pair is also removed.
    orphan = (
        shell
        + "Areas of concern:\n"
        + "- Staffing gaps.\n\n"
        + "Suggested methods to begin or strengthen the investigation:\n"
        + "- Interview staff.\n"
    )
    orphan_clean = strip_collaborator_from_summary(orphan)
    assert "Areas of concern:" not in orphan_clean
    assert "Suggested methods" not in orphan_clean
    assert "DOH" in orphan_clean


def test_llm_prompt_uses_redacted_complaint_not_raw_ssn():
    """Ensure ensure_clean_or_redact output is what prompt builders receive from run_investigator."""
    raw = (
        "Patient John Doe SSN 536-12-3456 was involved. "
        "Facility self-reported administrator oversight concerns on 01/15/2026."
    )
    selected_node = type(
        "N",
        (),
        {
            "code": "246-341-0410",
            "title": "Administrator key responsibilities",
            "text": "Administrator duties.",
            "level": "code",
        },
    )()

    captured: dict[str, str] = {}

    def fake_assist(complaint_redacted, selected, base):
        captured["complaint"] = complaint_redacted
        base.areas_of_concern = ["gap"]
        base.investigation_methods = ["method"]
        return base

    with patch("app.services.investigator_llm.llm_available", return_value=False):
        with patch("app.services.investigator_llm.run_summary_assist", side_effect=fake_assist):
            result = run_investigator(raw, [selected_node], use_llm=False)

    assert "complaint" in captured
    # Redaction should remove or token-replace SSN-like content
    assert "536-12-3456" not in captured["complaint"]
    assert result.complaint_redacted_for_llm is True or "536-12-3456" not in (
        result.intake_summary or ""
    )


def test_user_prompt_builder_embeds_only_provided_complaint_slice():
    prompt = _build_user_prompt(
        "REDACTED_MARKER facility self-report about operations.",
        [{"code": "246-341-0410", "title": "Admin", "text": "duties"}],
    )
    assert "REDACTED_MARKER" in prompt
    assert "areas_of_concern" in prompt
    assist = _build_summary_assist_prompt(
        "REDACTED_MARKER only",
        [{"code": "246-341-0410", "title": "Admin", "text": "duties"}],
    )
    assert "REDACTED_MARKER only" in assist
    assert "not findings" in assist.lower()
