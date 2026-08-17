from __future__ import annotations

from typing import Any, Literal

from app.schemas import InvestigationReport, QuoteIntegrityOut

Severity = Literal["pass", "warn", "block"]


def check_defensibility(
    report: InvestigationReport | dict[str, Any],
    *,
    quote_integrity: QuoteIntegrityOut | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Deterministic assistive checks. Never blocks working-draft download."""
    if isinstance(report, InvestigationReport):
        data = report.model_dump()
    else:
        data = report

    checks: list[dict[str, Any]] = []

    def add(code: str, severity: Severity, message: str) -> None:
        checks.append({"code": code, "severity": severity, "message": message})

    fi = data.get("facility_info") or {}
    if not (fi.get("investigation_dates") or data.get("investigation_date") or "").strip():
        add("missing_dates", "warn", "Investigation date(s) are empty.")
    if not (fi.get("facility_address") or "").strip() or fi.get("facility_address") == "Washington State":
        add("missing_facility", "warn", "Facility address is missing or still the placeholder.")
    if not (fi.get("credential_number") or "").strip():
        add("missing_credential", "warn", "Credential number is empty.")
    if not (data.get("case_id") or "").strip():
        add("missing_case_id", "warn", "Case ID label is empty.")

    allegations = data.get("allegations") or []
    if not allegations:
        add("no_allegations", "warn", "No allegations in the draft.")
    for a in allegations:
        code = a.get("wac_code") or "?"
        text = (a.get("allegation_text") or "").strip()
        if not text:
            add(f"empty_allegation:{code}", "warn", f"Allegation text empty for {code}.")
        matched = a.get("matched_subsections") or []
        if not matched:
            add(f"no_matched_sub:{code}", "warn", f"No matched subsections recorded for {code}.")
        if a.get("quote_ok") is False:
            add(f"quote_broken:{code}", "warn", f"Quote marked broken for {code} (see integrity).")

    process = [p for p in (data.get("investigative_process") or []) if str(p).strip()]
    if not process:
        add("empty_process", "warn", "Investigative process section is empty.")

    if not (data.get("summary_of_findings") or "").strip():
        add("empty_summary", "warn", "Summary of findings is empty.")

    for c in data.get("conclusions") or []:
        result = (c.get("result") or "").strip() or "Pending Investigation"
        wac = c.get("wac_code") or "?"
        if result in {"", "Pending Investigation"}:
            add(f"pending_conclusion:{wac}", "warn", f"Conclusion still pending for {wac}.")
        deficient = (
            "deficient practice or condition cited" in result.lower()
            and "no current" not in result.lower()
        )
        if deficient and not (c.get("deficiency_details") or "").strip():
            add(
                f"substantiated_no_detail:{wac}",
                "warn",
                f"Deficient practice cited without IR deficiency details for {wac}.",
            )

    sod = data.get("sod") or {}
    sod_defs = sod.get("deficiencies") or []
    if not sod_defs:
        add("sod_empty", "warn", "Sister SOD has no deficiency blocks yet.")
    else:
        empty_findings = [
            d.get("regulation_cite") or "?"
            for d in sod_defs
            if not (d.get("findings") or [])
            and not any((it.get("findings") or []) for it in (d.get("items") or []))
        ]
        if empty_findings:
            add(
                "sod_findings_empty",
                "warn",
                f"SOD findings empty for: {', '.join(empty_findings[:5])}"
                + ("…" if len(empty_findings) > 5 else ""),
            )

    qi = quote_integrity
    if qi is None:
        qi = data.get("quote_integrity")
    if isinstance(qi, QuoteIntegrityOut):
        qi_ok = qi.ok
        failures = qi.failures
    elif isinstance(qi, dict):
        qi_ok = bool(qi.get("ok", True))
        failures = qi.get("failures") or []
    else:
        qi_ok = True
        failures = []

    if not qi_ok:
        add(
            "quote_integrity",
            "block",
            f"Quote integrity failed ({len(failures)} issue(s)). Working draft may still be downloaded; "
            "fix statute wording before finalize.",
        )

    has_block = any(c["severity"] == "block" for c in checks)
    has_warn = any(c["severity"] == "warn" for c in checks)
    overall: Severity = "block" if has_block else "warn" if has_warn else "pass"

    # Working drafts are always downloadable. Finalize is blocked separately when
    # quote integrity fails (see cases.update_status).
    return {
        "overall": overall,
        "can_export": True,
        "can_finalize": qi_ok,
        "checks": checks,
        "summary": (
            "Ready to download as a working draft."
            if overall == "pass"
            else "Download available — resolve quote integrity before finalize."
            if not qi_ok
            else "Download available — review flagged gaps before treating this IR as final."
            if has_warn or has_block
            else "Ready to download as a working draft."
        ),
    }
