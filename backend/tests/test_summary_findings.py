"""Summary of Findings is evidence narrative, not allegation copies."""

from app.schemas import InvestigationAllegation
from app.services.evidence_review import is_summary_evidence_paragraph
from app.services.investigation import (
    build_summary_of_findings,
    merge_evidence_into_summary,
    strip_allegation_copies_from_summary,
)

CANONICAL_PREFIX = 'Review of a document titled "'


def test_summary_does_not_copy_allegation_text():
    summary = build_summary_of_findings(
        "The Department of Health (DOH) received a complaint alleging uncredentialed care.",
        [
            InvestigationAllegation(
                case_category="BHA",
                wac_code="246-341-0510",
                wac_title="Personnel — Agency affiliated counselor",
                allegation_text=(
                    "Potential violation of WAC 246-341-0510, Personnel — Agency affiliated counselor, "
                    "by having failed to (1) meet credential requirements."
                ),
            )
        ],
    )
    assert "The corresponding allegation asserts:" not in summary
    assert "Potential violation of WAC" not in summary
    assert "is authorized for this investigation because" not in summary
    assert "received a complaint" in summary.lower()
    assert "Investigative findings (to be completed)" not in summary
    assert "Complete each document-review" not in summary
    assert "Add interview and observation findings" not in summary


def test_strip_removes_legacy_allegation_paragraphs():
    legacy = (
        "The Department of Health (DOH) received a complaint alleging uncredentialed care.\n\n"
        "WAC 246-341-0510 is authorized for this investigation because Selected for investigation scope "
        "Matched subsection (1).\n\n"
        "The corresponding allegation asserts: Potential violation of WAC 246-341-0510, Personnel, "
        "by having failed to (1) meet credential requirements.\n\n"
        "Investigator notes remain."
    )
    cleaned = strip_allegation_copies_from_summary(legacy)
    assert "authorized for this investigation" not in cleaned
    assert "corresponding allegation asserts" not in cleaned
    assert "Potential violation" not in cleaned
    assert "received a complaint" in cleaned.lower()
    assert "Investigator notes remain" in cleaned


def test_clean_summary_for_document_strips_collaborator_and_allegation_paste():
    from app.services.investigation import clean_summary_for_document, format_collaborator_summary_block

    shell = "The Department of Health (DOH) received a complaint alleging uncredentialed care.\n\n"
    legacy = (
        shell
        + "WAC 246-341-0510 is authorized for this investigation because Selected.\n\n"
        + "The corresponding allegation asserts: Potential violation of WAC 246-341-0510.\n\n"
    )
    block = format_collaborator_summary_block(
        areas_of_concern=["Credential gaps."],
        investigation_methods=["Review personnel files."],
    )
    cleaned = clean_summary_for_document(legacy + block)
    assert "Investigator collaborator notes" not in cleaned
    assert "authorized for this investigation" not in cleaned
    assert "Potential violation" not in cleaned
    assert "received a complaint" in cleaned.lower()
    assert clean_summary_for_document("") == ""
    assert clean_summary_for_document(block) == ""


def test_merge_evidence_skips_empty_excerpt_shells():
    base = (
        "The Department of Health (DOH) received a complaint alleging uncredentialed care.\n\n"
        "WAC 246-341-0510 is authorized for this investigation because Selected.\n\n"
        "The corresponding allegation asserts: Potential violation of WAC 246-341-0510."
    )
    merged = merge_evidence_into_summary(
        base,
        "Anonymous complainant reported uncredentialed counseling.",
        [{"title": "Personnel file extract", "document_date": "January 15, 2025"}],
    )
    assert CANONICAL_PREFIX not in merged
    assert "Personnel file extract" not in merged
    assert "corresponding allegation asserts" not in merged
    assert "Potential violation of WAC" not in merged


def test_merge_evidence_hits_populate_showed_excerpt():
    base = "The Department of Health (DOH) received a complaint alleging staffing concerns."
    merged = merge_evidence_into_summary(
        base,
        base,
        [{"title": "Policy Manual", "document_date": "March 1, 2025"}],
        evidence_hits=[
            {
                "evidence_id": 1,
                "evidence_title": "Policy Manual",
                "document_date": "March 1, 2025",
                "excerpt": (
                    "The administrator is responsible for the day-to-day operation of the "
                    "agency provision of certified behavioral health treatment services"
                ),
                "cite": "WAC 246-341-0410(1)",
                "included_by_default": True,
                "score": 0.55,
            }
        ],
    )
    assert merged.startswith("The Department of Health")
    finding = merged.split("\n\n", 1)[1]
    assert finding.startswith(CANONICAL_PREFIX)
    assert 'Policy Manual", dated March 1, 2025, showed' in finding
    assert "day-to-day operation" in finding
    assert is_summary_evidence_paragraph(finding)
    assert "Related to" not in merged
    assert "WAC 246-341-0410" not in merged


def test_one_summary_paragraph_per_evidence_document():
    """Multiple duty hits for the same exhibit collapse to one Summary paragraph."""
    base = "The Department of Health (DOH) received a complaint alleging safety concerns."
    hits = [
        {
            "evidence_id": 10,
            "evidence_title": "Patient Safety Policy",
            "document_date": "July 15, 2026",
            "excerpt": "Staff must increase supervision when informed of escalating conflict.",
            "cite": "WAC 246-341-0410(1)",
            "included_by_default": True,
            "score": 0.6,
        },
        {
            "evidence_id": 10,
            "evidence_title": "Patient Safety Policy",
            "document_date": "July 15, 2026",
            "excerpt": "Incidents of patient-to-patient assault must be documented within one hour.",
            "cite": "WAC 246-341-0600(1)",
            "included_by_default": True,
            "score": 0.5,
        },
        {
            "evidence_id": 11,
            "evidence_title": "Unit Incident Timeline",
            "document_date": "July 28, 2026",
            "excerpt": "Separation of the patients was delayed after the reported assault.",
            "cite": "WAC 246-341-0600(1)",
            "included_by_default": True,
            "score": 0.45,
        },
    ]
    merged = merge_evidence_into_summary(base, base, [], evidence_hits=hits)
    review_paras = [p for p in merged.split("\n\n") if is_summary_evidence_paragraph(p)]
    assert len(review_paras) == 2
    safety = next(p for p in review_paras if "Patient Safety Policy" in p)
    assert "increase supervision" in safety or "documented within one hour" in safety
    assert 'dated July 15, 2026, showed' in safety
    timeline = next(p for p in review_paras if "Unit Incident Timeline" in p)
    assert "Separation of the patients was delayed" in timeline


def test_format_ir_and_sod_finding_voice():
    from app.services.evidence_review import format_ir_summary_finding, format_sod_document_finding

    ir = format_ir_summary_finding(
        "Agency Staff/Intern Requirements",
        "7/2019",
        "all clients received care from qualified staff",
        cites=["WAC 246-341-0425(1)"],
    )
    assert ir == (
        'Review of a document titled "Agency Staff/Intern Requirements", '
        "dated 7/2019, showed all clients received care from qualified staff."
    )

    sod = format_sod_document_finding(
        "Crisis Intervention",
        "Patient #1 was told by Staff A that services were confidential",
        cites=["WAC 246-341-0425(1)"],
    )
    assert sod.startswith('Review of the document titled, "Crisis Intervention", showed')
    assert "Patient #1 was told" in sod
    assert "Related to" not in sod

    assert format_ir_summary_finding("Empty", "", "") == ""
    assert format_sod_document_finding("Empty", "") == ""


def test_list_markers_become_seamless_prose():
    """Policy a./b./9./bullet outlines must not appear in Summary findings."""
    from app.services.evidence_review import format_ir_summary_finding, format_sod_document_finding

    clinical = format_ir_summary_finding(
        "Clinical Records General Documentation Requirements Policy",
        "June 1, 2020",
        (
            "a. An age-appropriate psychosocial history "
            "b. Assessment of risk to self and others "
            "c. Treatment recommendations "
            "9. Any allergies or adverse reactions "
            "10. Current medications. Related to WAC 246-341-0640(1)(c)(ii)."
        ),
    )
    assert clinical.startswith(
        'Review of a document titled "Clinical Records General Documentation Requirements Policy", '
        "dated June 1, 2020, showed "
    )
    assert "a." not in clinical
    assert "b." not in clinical
    assert "c." not in clinical
    assert "9." not in clinical
    assert "10." not in clinical
    assert "Related to" not in clinical
    assert "WAC 246-341-0640" not in clinical
    assert "age-appropriate psychosocial history" in clinical
    assert "Assessment of risk" in clinical or "assessment of risk" in clinical
    assert "and" in clinical

    sentinel = format_ir_summary_finding(
        "Sentinel Events Policy",
        "June 1, 2020",
        (
            "Some sentinel events include but are not limited to: "
            "• Client death • Client dies by suicide • Allegations of abuse"
        ),
    )
    assert "•" not in sentinel
    assert "client death" in sentinel.lower()
    assert "client dies by suicide" in sentinel.lower()
    assert sentinel.startswith('Review of a document titled "Sentinel Events Policy"')

    sod = format_sod_document_finding(
        "Clinical Records",
        "a. Psychosocial history b. Risk assessment c. Treatment plan",
    )
    assert "a." not in sod
    assert "b." not in sod
    assert "psychosocial history" in sod.lower()
