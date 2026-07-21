"""Uppercase (A)(B)(C) markers are quaternary, not secondary (a)(b)(c)."""

from __future__ import annotations

from app.parser.wac_parser import _parse_subsections


SAMPLE_0410_BODY = """
(1) The agency administrator is responsible for day-to-day operation.

(4) The administrator or their designee must ensure:
(a) Administrative policies are adhered to;
(b) There is sufficient qualified personnel;
(g) A written internal quality management plan is developed and maintained that:
(i) Addresses the clinical supervision and training of staff providing clinical services;
(ii) Monitors compliance with the rules in this chapter; and
(iii) Continuously improves the quality of care in all of the following:
(A) Cultural competency that aligns with the agency's local community;
(B) Use of evidence based and promising practices; and
(C) In response to critical incidents and substantiated complaints.
"""


def test_uppercase_letter_markers_are_quaternary_not_secondary():
    nodes = _parse_subsections(
        code="246-341-0410",
        chapter="246-341",
        title="Agency administration",
        body=SAMPLE_0410_BODY,
        version_date=None,
        certified_date=None,
        source_file="test.pdf",
    )
    by_id = {n.id: n for n in nodes}

    assert "WAC 246-341-0410(4)(a)" in by_id
    assert "Administrative policies" in by_id["WAC 246-341-0410(4)(a)"].text
    assert "Cultural competency" not in by_id["WAC 246-341-0410(4)(a)"].text

    g = by_id["WAC 246-341-0410(4)(g)"]
    assert "Cultural competency" in g.text
    assert "(A)" in g.text

    iii = by_id["WAC 246-341-0410(4)(g)(iii)"]
    assert "Cultural competency" in iii.text
    assert iii.text.strip().startswith("Continuously improves")

    a = by_id["WAC 246-341-0410(4)(g)(iii)(A)"]
    assert a.level == "quaternary"
    assert "Cultural competency" in a.text
    assert by_id["WAC 246-341-0410(4)(g)(iii)(B)"].level == "quaternary"
    assert by_id["WAC 246-341-0410(4)(g)(iii)(C)"].level == "quaternary"
