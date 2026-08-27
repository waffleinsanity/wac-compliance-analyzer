"""TestClient port of hard IR asserts from verify_report_templates.py."""

from __future__ import annotations

import json
from pathlib import Path

CASES = Path(__file__).parent / "fixtures" / "cases"


def test_investigate_assault_structure(client):
    case = json.loads((CASES / "assault_safety.json").read_text(encoding="utf-8"))
    res = client.post(
        "/api/investigate",
        json={
            "text": case["complaint"],
            "selected_wacs": case["selected_wacs"],
            "case_id": "2020-TEST",
            "investigation_date": "07/10/2026",
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()

    assert data.get("regulatory_framework"), "missing Regulatory Framework"
    # Evidentiary examples / findings narrative are human-owned — not auto-seeded.
    assert (data.get("evidentiary_examples") or []) == []
    summary = (data.get("summary_of_findings") or "").strip()
    assert summary, "expected Summary of Findings framework starter"
    assert "Department of Health" in summary
    assert "Investigative findings (to be completed)" not in summary
    assert "…" not in summary
    assert "..." not in summary
    # Summary narrates evidence vs allegations; WAC cites and allegation lines stay elsewhere.
    assert "The corresponding allegation asserts:" not in summary
    assert "is authorized for this investigation because" not in summary
    for a in data.get("allegations") or []:
        line = (a.get("allegation_text") or "").strip()
        if line:
            assert line not in summary
    assert "primary investigative standard" in (data.get("authority_statement") or "").lower()
    assert data.get("quote_integrity", {}).get("ok") is True, data.get("quote_integrity")

    for a in data["allegations"]:
        # Allegation line must stay in Baseline cite-first Potential violation form.
        assert a["allegation_text"].lower().startswith("potential violation")
        assert "investigator review" not in a["allegation_text"].lower()
        assert "see also" not in a["allegation_text"].lower()
        assert a.get("matched_subsections")
        assert a.get("match_reason")
        assert "low_confidence" in a
        # Starting line uses ≤MAX duties; optional pool may list more for Compare checkboxes.
        opts = a.get("duty_options") or []
        if opts:
            included = [o for o in opts if o.get("included_by_default")]
            assert 1 <= len(included) <= 4
            assert len(opts) >= len(included)

    for c in data.get("comparisons") or []:
        draft = (c.get("allegation_draft") or "").lower()
        assert draft.startswith(("a potential violation", "potential violation"))
        assert "by having failed to" in draft or "by failing to" in draft or '"' in draft

    sod = data.get("sod") or {}
    assert sod.get("deficiencies"), "sister SOD skeleton should be created with IR"
    for d in sod["deficiencies"]:
        assert d.get("regulation_cite")
        assert (d.get("based_on") or "").lower().startswith("based on")

    text = data["report_text"]
    assert text.startswith("Investigative Report")
    assert "Facility Address:" in text
    assert "Laboratory Director:" in text
    assert "CLIA Number:" in text
    assert "Intake Details:" in text
    assert "Allegation(s):" in text
    assert "Investigative Process Included:" in text
    assert "Pre-investigation Activity:" in text
    assert "Investigation Activity:" in text
    assert "Observations" in text
    assert "Interviews" in text
    assert "Document Review" in text
    assert "Summary of Findings" in text
    assert "Conclusion/ Results of Investigation" in text
    assert "The investigator found the facility" in text
    assert "Choose an item." in text
    assert "Actions:" in text
    assert "Regulatory Framework:" not in text
    process = data.get("investigative_process") or []
    assert any(s.startswith("Pre-investigation Activity") for s in process)
    # No complaint-keyword invention (APS/LE/theme-driven investigation steps)
    joined = "\n".join(process).lower()
    assert "adult protective" not in joined
    assert "law enforcement" not in joined


def test_investigate_confidentiality_includes_rcw(client):
    case = json.loads((CASES / "confidentiality_rcw.json").read_text(encoding="utf-8"))
    res = client.post(
        "/api/investigate",
        json={
            "text": case["complaint"],
            "selected_wacs": case["selected_wacs"],
            "investigation_date": "07/10/2026",
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert any(e["instrument"] == "RCW" for e in data["regulatory_framework"])
    for a in data["allegations"]:
        # Allegation line remains Baseline cite-first in API output.
        assert a["allegation_text"].startswith("Potential violation")
        assert '"' not in a["allegation_text"]
    for c in data.get("comparisons") or []:
        draft = c.get("allegation_draft") or ""
        assert draft.startswith("Potential violation")
        assert '"' not in draft
    assert data.get("sod", {}).get("deficiencies")
    assert data["quote_integrity"]["ok"] is True


def test_validate_warns_but_allows_export_with_broken_quotes(client):
    case = json.loads((CASES / "assault_safety.json").read_text(encoding="utf-8"))
    res = client.post(
        "/api/investigate",
        json={"text": case["complaint"], "selected_wacs": case["selected_wacs"]},
    )
    assert res.status_code == 200
    report = res.json()
    broken = report["allegations"][0].copy()
    broken["allegation_text"] = (
        'A potential violation of WAC 246-341-0600, regarding: "THIS_IS_NOT_IN_THE_PDF_STORE".'
    )
    val = client.post(
        "/api/investigate/validate",
        json={
            "selected_wacs": case["selected_wacs"],
            "allegations": [broken],
            "regulatory_framework": report.get("regulatory_framework") or [],
            "evidentiary_examples": report.get("evidentiary_examples") or [],
        },
    )
    assert val.status_code == 200
    body = val.json()
    assert body["can_export"] is True
    assert body["quote_integrity"]["ok"] is False
