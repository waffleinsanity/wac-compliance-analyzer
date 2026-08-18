"""Allegation drafts must stay concise and match Baseline shape (no quotation marks)."""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.services.quote_verify import (
    extract_duty_spans,
    is_contiguous_substring,
    store_text_for_cite,
    verify_allegation,
)
from app.services.wac_scope import (
    ALLEGATION_TARGET_CHARS,
    MAX_ALLEGATION_DRAFT_CLAUSES,
    draft_allegation_from_source,
    sanitize_subsection_label,
)

CASES = Path(__file__).parent / "fixtures" / "cases"


def _clauses_after_failed_to(text: str) -> list[str]:
    """Split the labeled duty clauses following 'by having failed to' for line-shape tests."""
    m = re.search(r"by having failed to\s+(.+?)\.\s*$", text or "", flags=re.IGNORECASE | re.DOTALL)
    if not m:
        return []
    body = m.group(1).strip().rstrip(".")
    return [c.strip() for c in re.split(r";\s*(?:and\s+)?", body) if c.strip()]


def test_draft_duty_phrases_are_store_substrings(store_ready):
    draft = draft_allegation_from_source(
        "246-341-0600",
        "Agency administration",
        "patient assault safety security protection staff failed to protect",
        max_subs=2,
    )
    assert '"' not in draft.text, "Baseline allegation lines must not wrap duties in quotes"
    assert draft.text.startswith("Potential violation of")
    assert not draft.text.startswith("A potential")
    spans = extract_duty_spans(draft.text)
    assert spans, "allegation must include duty phrases after subsection labels"
    assert "by having failed to" in draft.text.lower()
    assert "failed to comply with the following requirements" not in draft.text.lower()
    assert len(draft.text) <= ALLEGATION_TARGET_CHARS + 120
    for span in spans:
        matched = False
        for cite in draft.cites or ["246-341-0600"]:
            source = store_text_for_cite(cite) or store_text_for_cite("246-341-0600")
            if source and is_contiguous_substring(span, source):
                matched = True
                break
        assert matched, f"span not in store: {span[:80]}"


def test_weak_overlap_flags_confidence_not_meta_fluff(store_ready):
    case = json.loads((CASES / "weak_overlap.json").read_text(encoding="utf-8"))
    code = case["selected_wacs"][0].replace("WAC ", "").replace("RCW ", "")
    draft = draft_allegation_from_source(code, code, case["complaint"], max_subs=2)
    assert draft.low_confidence or draft.match_reason == "code_fallback" or draft.match_score < 0.15
    assert "investigator review" not in draft.text.lower()
    assert "limited overlap" not in draft.text.lower()
    assert "failed to comply with the following requirements" not in draft.text.lower()
    assert "by having failed to" in draft.text.lower() or "as applied to the reported concern" in draft.text.lower()
    assert '"' not in draft.text
    spans = extract_duty_spans(draft.text)
    assert spans or "as applied to the reported concern" in draft.text.lower()


def test_allegation_never_emits_see_also_shortcut(store_ready):
    """Legacy length shortcut (; see also labels) must never appear in drafts."""
    draft = draft_allegation_from_source(
        "246-341-0605",
        "Complaint process",
        "employee of the agency reported retaliation after filing a complaint with the department",
        max_subs=2,
    )
    assert "see also" not in draft.text.lower()
    assert "not retaliate against any" in draft.text.lower()
    assert "Employee of the agency" in draft.text
    assert draft.duty_options, "expected exact duty options for Compare"


def test_allegation_stays_concise(store_ready):
    draft = draft_allegation_from_source(
        "246-341-0600",
        "Agency administration — Administrator key responsibilities",
        "patient was sexually assaulted; facility failed to protect safety and security of patients",
        max_subs=2,
    )
    # Full exact WAC duties are allowed; only forbid the see-also cite-list shortcut.
    assert "see also" not in draft.text.lower()
    assert '"' not in draft.text
    assert "\n" not in draft.text
    assert len(draft.text) <= ALLEGATION_TARGET_CHARS + 200



def test_sanitize_subsection_label_repairs_pdf_glyphs():
    assert sanitize_subsection_label("(4)(@)(iii)(C)") == "(4)(g)(iii)(C)"
    assert sanitize_subsection_label("(4)(@)ii)(C)") == "(4)(g)(ii)(C)"
    assert sanitize_subsection_label("(1)(c)") == "(1)(c)"


def test_0410_picks_leaf_duties_not_parent_dump(store_ready):
    draft = draft_allegation_from_source(
        "246-341-0410",
        "Agency administration - Administrator key responsibilities",
        "The agency administrator failed to ensure adequate staffing and did not respond "
        "to resident safety concerns after a reported incident of neglect.",
        max_subs=2,
    )
    assert "for investigator review" not in draft.text.lower()
    assert "limited overlap" not in draft.text.lower()
    assert "by having failed to" in draft.text.lower()
    assert '"' not in draft.text
    assert len(draft.text) <= ALLEGATION_TARGET_CHARS + 80
    assert "\n" not in draft.text
    # Must not paste the giant parent (4) "must ensure:" list opener
    assert "must ensure:" not in draft.text.lower()


def test_0410_no_list_intro_stub_or_double_punct(store_ready):
    draft = draft_allegation_from_source(
        "246-341-0410",
        "Agency administration - Administrator key responsibilities",
        "clinical supervision and training of staff continuously improves the quality of care",
        max_subs=2,
    )
    assert '"' not in draft.text
    assert ";;" not in draft.text
    assert ":." not in draft.text
    assert ";." not in draft.text
    assert "the following:" not in draft.text.lower()
    assert draft.text.endswith(".")
    assert "by having failed to" in draft.text.lower()
    # Prefer concrete quaternary / leaf duties over the (iii) list intro
    assert "(4)(g)(iii) Cultural" not in draft.text


_ADMIN_POLICY_INCIDENT_COMPLAINT = (
    "The administrator failed to meet applicable rules, policies, and ethical standards. "
    "Administrative, personnel, and clinical policies and procedures were not adhered to. "
    "After critical incidents and substantiated complaints, the agency did not maintain "
    "a quality management plan that improved care."
)


def test_0410_admin_policy_incident_draft_picks_companion_leaves(store_ready):
    """Compare draft for 0410 must cite policy/ethics/quality leaves, not WSP checks or parent dumps."""
    draft = draft_allegation_from_source(
        "246-341-0410",
        "Agency administration—Administrator key responsibilities",
        _ADMIN_POLICY_INCIDENT_COMPLAINT,
    )
    text = draft.text
    assert text.startswith("Potential violation of WAC 246-341-0410")
    assert "—" in text or "Administrator key responsibilities" in text
    assert "@" not in text
    assert "must ensure:" not in text.lower()
    assert "the following:" not in text.lower()
    assert "human resources plan" not in text.lower()
    assert "awritten" not in text.lower()
    assert "(4)(f)" not in text
    assert "patrol" not in text.lower()
    assert "background check" not in text.lower()
    assert "meet all applicable rules" in text.lower()
    labels = {m.group(0) for m in re.finditer(r"(?:\([0-9a-z]+\))+", text.split("by having failed to", 1)[-1])}
    assert "(1)(c)" in labels, text
    assert "(4)(a)" in labels or any("(4)(g)" in lab for lab in labels), text
    # Compact quality leaf — not the full nested (4)(g) dump
    if any(lab.startswith("(4)(g)") for lab in labels):
        assert "in response to critical incidents" in text.lower()
        assert "substantiated complaints" in text.lower()
    included = [o for o in (draft.duty_options or []) if o.get("included_by_default")]
    included_labels = {o.get("label") for o in included}
    assert "(1)" in included_labels, draft.duty_options
    assert "(4)(f)" not in included_labels
    for o in included:
        phrase = (o.get("duty_phrase") or "").lower()
        assert "human resources plan" not in phrase
        assert "must ensure:" not in phrase


# --- POC demo asserts: 246-337-045 governance + 246-337-060 infection ---

_GOVERNANCE_COMPLAINT = (
    "Governance failed at the RTF: no adopted policies were periodically reviewed or "
    "updated, communication process for staff and residents was absent, and the "
    "personnel system did not track qualifications or supervision of clinical staff."
)

_INFECTION_COMPLAINT = (
    "Infection control breakdown at the RTF: staff worked while sick with a "
    "communicable disease, hand hygiene was not enforced, environmental management "
    "was neglected, and resident hygiene routines were missed on multiple shifts."
)


def test_duty_options_start_with_strongest(store_ready):
    """Draft starts with ≤MAX included duties; optional pool may list more for Compare."""
    draft = draft_allegation_from_source(
        "246-341-0600",
        "Individual rights",
        "patient was sexually assaulted; facility failed to protect safety and security "
        "of patients and failed to prevent sexual harassment and exploitation",
    )
    opts = draft.duty_options or []
    assert opts, "expected duty_options for Compare checkboxes"
    included = [o for o in opts if o.get("included_by_default")]
    assert 1 <= len(included) <= MAX_ALLEGATION_DRAFT_CLAUSES + 1
    # Catch-all (1) is first when present; remaining options stay strong→moderate.
    other_scores = [float(o["score"]) for o in opts if o.get("label") != "(1)"]
    assert other_scores == sorted(other_scores, reverse=True)
    clauses = _clauses_after_failed_to(draft.text)
    assert len(clauses) <= MAX_ALLEGATION_DRAFT_CLAUSES + 1


def test_246_337_045_governance_draft_is_two_clause_and_short(store_ready):
    """246-337-045 must not produce the demo run-on with 4 concatenated subsections."""
    draft = draft_allegation_from_source(
        "246-337-045", "Governance and administration", _GOVERNANCE_COMPLAINT
    )
    assert "by having failed to" in draft.text.lower()
    assert draft.text.startswith("Potential violation of")
    assert '"' not in draft.text
    # Three exact duties can exceed the old two-clause 560 cap.
    assert len(draft.text) <= 800, f"line too long ({len(draft.text)}): {draft.text}"
    clauses = _clauses_after_failed_to(draft.text)
    assert 1 <= len(clauses) <= MAX_ALLEGATION_DRAFT_CLAUSES + 1, (
        f"expected ≤{MAX_ALLEGATION_DRAFT_CLAUSES + 1} labeled duty clauses in the line, got "
        f"{len(clauses)}: {clauses}"
    )
    assert "system whose Staff" not in draft.text
    assert "system whose." not in draft.text
    assert not re.search(r"\bwhose\s*\.", draft.text, re.I)
    assert "policies that Provide" not in draft.text or " that " not in draft.text.split(
        "by having failed to", 1
    )[1]
    for clause in _clauses_after_failed_to(draft.text):
        assert not re.search(r"\b(for|whose|which|that|including)\s*$", clause, re.I), (
            f"hanging duty clause: {clause!r}"
        )


def test_246_337_060_infection_no_bare_noun_after_failed_to(store_ready):
    """246-337-060 must use exact list-intro + leaf WAC text, not bare '(1)(f) Management…'."""
    draft = draft_allegation_from_source(
        "246-337-060", "Infection control", _INFECTION_COMPLAINT
    )
    assert "by having failed to" in draft.text.lower()
    assert '"' not in draft.text
    assert len(draft.text) <= 800, f"line too long ({len(draft.text)}): {draft.text}"

    clauses = _clauses_after_failed_to(draft.text)
    assert clauses, f"no duty clauses parsed from: {draft.text}"

    _bare_noun_openers = (
        "management of",
        "environmental management",
        "hand hygiene",
        "resident hygiene",
        "housekeeping functions",
        "cleaning and disinfection",
        "standard precautions",
    )
    # Every drafted clause must be a complete verb/gerund duty — never a bare topic
    # noun and never a hanging list intro ("Developing … for") without its leaf.
    for clause in clauses:
        body = _SUBSECTION_LABEL_STRIP(clause)
        low = body.lower()
        assert not re.search(r"\b(for|whose|which|that|including)\s*$", low), (
            f"hanging duty clause: {body!r} in {draft.text}"
        )
        for opener in _bare_noun_openers:
            assert not low.startswith(opener), (
                f"bare-noun duty ('{body[:60]}'): {draft.text}"
            )

    # Infection (1)(f)-style duties must keep the exact WAC lead-in + leaf topic.
    joined = " ".join(_SUBSECTION_LABEL_STRIP(c).lower() for c in clauses)
    assert "written policies and procedures for" in joined, draft.text
    assert "management of staff with a communicable disease" in joined or (
        "resident hygiene" in joined or "environmental management" in joined
        or "hand hygiene" in joined
    ), draft.text
    # Grammar after "failed to": Baseline examples keep gerund openers ("developing").
    assert (
        "develop written policies and procedures for" in draft.text.lower()
        or "developing written policies and procedures for" in draft.text.lower()
    ), draft.text

    # Duty options keep leaf cites with full exact phrases (checkbox pool).
    leaf_opts = [
        o
        for o in draft.duty_options
        if "(1)(" in (o.get("cite") or "") and o.get("duty_phrase")
    ]
    assert leaf_opts, f"expected leaf duty options, got: {draft.duty_options}"
    assert any(
        "written policies and procedures for" in (o.get("duty_phrase") or "").lower()
        for o in leaf_opts
    ), draft.duty_options


def _SUBSECTION_LABEL_STRIP(clause: str) -> str:
    """Return the duty text portion of a labeled clause (drops leading (…) label)."""
    m = re.match(r"^(?:\([^)]+\))+\s+(.+)$", clause.strip())
    return (m.group(1) if m else clause).strip()


def test_246_337_060_infection_quote_verify_passes(store_ready):
    """Infection draft's duty spans must remain contiguous PDF store substrings."""
    from app.services.quote_verify import duty_span_matches_cite

    draft = draft_allegation_from_source(
        "246-337-060", "Infection control", _INFECTION_COMPLAINT
    )
    failures = verify_allegation(
        draft.text,
        wac_code="246-337-060",
        matched_subsections=list(draft.cites),
        selected_codes=["246-337-060"],
    )
    assert failures == [], (
        f"quote_verify should pass for infection draft; failures: {[f.to_dict() for f in failures]}"
    )
    for span in extract_duty_spans(draft.text):
        matched = False
        for cite in draft.cites or ["246-337-060"]:
            if duty_span_matches_cite(span, cite):
                matched = True
                break
            source = store_text_for_cite(cite) or store_text_for_cite("246-337-060")
            if source and is_contiguous_substring(span, source):
                matched = True
                break
        assert matched, f"duty span not contiguous in store: {span!r}"


def test_246_337_045_matched_subsections_keep_wider_selection(store_ready):
    """Draft LINE stays at ≤MAX clauses but matched chips may keep the wider selection."""
    draft = draft_allegation_from_source(
        "246-337-045", "Governance and administration", _GOVERNANCE_COMPLAINT
    )
    assert len(_clauses_after_failed_to(draft.text)) <= MAX_ALLEGATION_DRAFT_CLAUSES + 1
    # Chips typically surface additional complaint-aligned leaves for pruning; when
    # ranking only agrees on two strong leaves that's OK, but never fewer than the
    # drafted clauses.
    body = draft.text.split("by having failed to", 1)[-1]
    line_labels = {m.group(0) for m in re.finditer(r"(?:\([0-9a-z]+\))+", body)}
    cite_labels = {c.split("246-337-045", 1)[-1] for c in draft.cites}
    assert cite_labels >= line_labels, (
        f"cites {cite_labels} should be a superset of the labels in the drafted line {line_labels}"
    )
