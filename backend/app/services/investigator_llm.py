"""Investigative LLM collaborator (OpenAI-compatible) with scoped local fallback.

Uses only SELECTED WAC context. Never invents duties from non-selected codes.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import settings
from app.services.investigator_prompt import INVESTIGATOR_SYSTEM_PROMPT
from app.services.pii_gate import ensure_clean_or_redact
from app.services.wac_scope import (
    draft_allegation_from_source,
    filter_cites_to_source,
    format_scoped_context,
    normalize_allegation_line,
    score_relevant_subsections,
    strip_foreign_wac_mentions,
)


@dataclass
class CodeInvestigation:
    code: str
    title: str
    relevant_subsections: list[str] = field(default_factory=list)
    allegation_text: str = ""
    known_facts: list[str] = field(default_factory=list)
    unclear: list[str] = field(default_factory=list)
    inferences: list[str] = field(default_factory=list)
    rationale: str = ""
    source: str = "local"  # llm | local | template


@dataclass
class InvestigatorResult:
    intake_summary: str
    known_facts: list[str] = field(default_factory=list)
    unclear: list[str] = field(default_factory=list)
    inferences: list[str] = field(default_factory=list)
    clarifying_questions: list[str] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)
    areas_of_concern: list[str] = field(default_factory=list)
    investigation_methods: list[str] = field(default_factory=list)
    recommended_subsections: list[str] = field(default_factory=list)
    codes: list[CodeInvestigation] = field(default_factory=list)
    investigator_notes: str = ""
    llm_used: bool = False
    llm_assist_used: bool = False
    llm_model: str | None = None
    llm_error: str | None = None
    complaint_redacted_for_llm: bool = False


def _clean(text: str) -> str:
    return re.sub(r"[ \t]+", " ", (text or "").replace("\ufffd", "-").replace("�", "-")).strip()


_LLM_AVAIL_CACHE: tuple[float, bool] | None = None
_LLM_AVAIL_TTL_SECONDS = 60.0


def llm_available(*, force: bool = False) -> bool:
    """Cached reachability check — avoid a network probe on every investigate call."""
    global _LLM_AVAIL_CACHE
    import time

    if not settings.llm_enabled:
        return False
    now = time.monotonic()
    if not force and _LLM_AVAIL_CACHE is not None:
        cached_at, cached_ok = _LLM_AVAIL_CACHE
        if now - cached_at < _LLM_AVAIL_TTL_SECONDS:
            return cached_ok

    base = (settings.llm_base_url or "").rstrip("/")
    if not base:
        _LLM_AVAIL_CACHE = (now, False)
        return False
    # Cloud providers (Gemini / OpenAI) need a key — skip dead localhost probes.
    is_local = "127.0.0.1" in base or "localhost" in base
    if not is_local and not (settings.llm_api_key or "").strip():
        _LLM_AVAIL_CACHE = (now, False)
        return False
    ok = False
    try:
        headers = {}
        if settings.llm_api_key:
            headers["Authorization"] = f"Bearer {settings.llm_api_key}"
        with httpx.Client(timeout=1.5) as client:
            resp = client.get(f"{base}/models", headers=headers)
            if resp.status_code < 500:
                ok = True
    except Exception:
        # Localhost without a running server → unavailable
        if is_local and not settings.llm_api_key:
            ok = False
        else:
            # Cloud endpoint with key may still work for chat even if /models differs
            ok = bool(settings.llm_api_key)
    _LLM_AVAIL_CACHE = (now, ok)
    return ok


def _chat_completion(messages: list[dict[str, str]], *, temperature: float = 0.2) -> str:
    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if settings.llm_api_key:
        headers["Authorization"] = f"Bearer {settings.llm_api_key}"

    # Gemini retires Flash ids for new keys; try configured model then free-tier fallbacks.
    models = [settings.llm_model]
    if "generativelanguage.googleapis.com" in url:
        for fallback in ("gemini-3.5-flash", "gemini-flash-latest"):
            if fallback not in models:
                models.append(fallback)

    last_error: Exception | None = None
    with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
        for model in models:
            payload: dict[str, Any] = {
                "model": model,
                "temperature": temperature,
                "messages": messages,
                "response_format": {"type": "json_object"},
            }
            resp = client.post(url, headers=headers, json=payload)
            # Some servers ignore response_format — retry without it
            if resp.status_code >= 400 and "response_format" in (resp.text or "").lower():
                payload.pop("response_format", None)
                resp = client.post(url, headers=headers, json=payload)
            if resp.status_code < 400:
                data = resp.json()
                content = data["choices"][0]["message"].get("content") or ""
                if content:
                    return content
                last_error = RuntimeError(f"Empty LLM content for model={model}")
                continue
            body = (resp.text or "").lower()
            # Gemini often returns 403/404 for retired or project-gated model ids — try next.
            retryable = resp.status_code in (403, 404) or (
                resp.status_code == 429 and "limit: 0" in body
            )
            if retryable and len(models) > 1:
                last_error = httpx.HTTPStatusError(
                    f"{resp.status_code} for model={model}: {resp.text[:300]}",
                    request=resp.request,
                    response=resp,
                )
                continue
            resp.raise_for_status()
    if last_error:
        raise last_error
    raise RuntimeError("LLM chat completion failed with no response")


def _extract_json(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise


def _local_code_investigation(
    code: str,
    title: str,
    full_text: str,
    complaint: str,
) -> CodeInvestigation:
    # Allegation + cites come ONLY from PDF-derived subsection text
    draft = draft_allegation_from_source(code, title, complaint, max_subs=2)
    allegation, labels = normalize_allegation_line(draft.text), draft.cites
    relevant = score_relevant_subsections(complaint, code, max_items=2)
    known = []
    unclear = []
    if relevant and relevant[0].score < 0.08 and relevant[0].reason != "explicit_cite":
        unclear.append(
            f"Complaint facts have weak textual overlap with WAC {code}; "
            "confirm which duties under this selected section are implicated."
        )
    else:
        known.append(f"Selected WAC {code} ({title}) is authorized for this review.")
        if labels:
            known.append(
                f"Applicable subsections determined from local source PDF text: {', '.join(labels[:4])}."
            )
    return CodeInvestigation(
        code=code,
        title=title,
        relevant_subsections=labels,
        allegation_text=allegation,
        known_facts=known,
        unclear=unclear,
        inferences=[
            "Inference: subsection relevance is based on explicit cites and/or lexical overlap "
            "with the selected WAC PDF text; human review should confirm fit."
        ],
        rationale=(
            "Drafted only from subsections of the selected WAC as ingested from the local source PDFs. "
            "Example templates and non-selected WACs were not used."
        ),
        source="local",
    )


def _local_summary_assist(
    complaint: str,
    selected: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    """Heuristic areas of concern + investigation methods (no outcomes)."""
    concerns: list[str] = []
    methods: list[str] = []
    lower = complaint.lower()
    for item in selected:
        code, title = item["code"], item["title"]
        concerns.append(
            f"Whether practices described in the intake align with duties under WAC {code} ({title}) "
            "— confirm with records and interviews (not a finding)."
        )
        methods.append(
            f"Request facility policies, procedures, and records relevant to WAC {code} ({title}) "
            "and compare them to the authorized allegation scope."
        )
        methods.append(
            f"Prepare interview questions for staff responsible for duties under WAC {code}, "
            "focused on how the facility implements those requirements day-to-day."
        )
    if "self report" in lower or "self-report" in lower or "self reported" in lower:
        concerns.append(
            "Completeness and timing of the facility self-report relative to when concerns arose."
        )
        methods.append(
            "Obtain the facility's internal incident/self-report packet and any corrective-action documentation."
        )
    if not any(
        k in lower
        for k in (
            "date",
            "on ",
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
            "202",
        )
    ):
        concerns.append("Event timeline is incomplete — dates and sequence may need reconstruction.")
        methods.append(
            "Build a chronology from intake facts, then request dated records that can confirm or refute it."
        )
    methods.append(
        "Document observations and interviews separately; return to this draft to strengthen Summary of Findings "
        "as evidence develops."
    )
    # Deduplicate while preserving order
    def _uniq(items: list[str], limit: int) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for x in items:
            if x in seen:
                continue
            seen.add(x)
            out.append(x)
            if len(out) >= limit:
                break
        return out

    return _uniq(concerns, 8), _uniq(methods, 10)


def _local_investigate(
    complaint: str,
    selected: list[dict[str, Any]],
) -> InvestigatorResult:
    codes: list[CodeInvestigation] = []
    clarifying: list[str] = []
    recommended: list[str] = []
    known: list[str] = [f"Authorized WAC selection: {', '.join(s['code'] for s in selected)}."]
    unclear: list[str] = []

    lower = complaint.lower()
    if len(complaint.strip()) < 80:
        clarifying.append("Can you provide more detail about what the facility self-reported and when?")
    if "self report" in lower or "self-report" in lower or "self reported" in lower:
        clarifying.append("What specific incident or concern prompted the facility self-report?")
        clarifying.append("What corrective actions, if any, did the facility already document?")
    if not any(k in lower for k in ("date", "on ", "january", "february", "march", "april", "may", "june",
                                    "july", "august", "september", "october", "november", "december", "202")):
        clarifying.append("What is the timeline of the events described in the complaint/self-report?")

    for item in selected:
        ci = _local_code_investigation(item["code"], item["title"], item["text"], complaint)
        codes.append(ci)
        recommended.extend(ci.relevant_subsections)
        known.extend(ci.known_facts)
        unclear.extend(ci.unclear)
        if not ci.relevant_subsections:
            clarifying.append(
                f"Which specific duties under WAC {item['code']} do you want examined for this matter?"
            )

    areas, methods = _local_summary_assist(complaint, selected)
    notes_lines = [
        "Local investigator analysis (LLM unavailable or disabled for full investigate).",
        "Scope locked to selected WACs only. Collaborator notes are templates — not findings.",
        "",
        "Known:",
        *[f"- {x}" for x in known[:8]],
        "",
        "Unclear:",
        *[f"- {x}" for x in (unclear or ["None identified beyond need for human confirmation."])[:6]],
        "",
        "Recommended subsections (within selection):",
        *[f"- {x}" for x in recommended[:12] or ["(none ranked)"]],
    ]
    return InvestigatorResult(
        intake_summary=_clean(complaint)[:600],
        known_facts=known,
        unclear=unclear,
        inferences=[
            "Inferences are labeled and must be confirmed by human investigators.",
        ],
        clarifying_questions=clarifying[:8],
        # Investigation activity / process steps are human-owned — do not auto-seed scripts.
        next_steps=list(methods[:6]),
        areas_of_concern=areas,
        investigation_methods=methods,
        recommended_subsections=recommended,
        codes=codes,
        investigator_notes="\n".join(notes_lines),
        llm_used=False,
        llm_assist_used=False,
        llm_model=None,
        llm_error=None,
    )


def _build_user_prompt(complaint: str, selected: list[dict[str, Any]]) -> str:
    blocks = []
    allowed = []
    for item in selected:
        code = item["code"]
        allowed.append(code)
        relevant = score_relevant_subsections(complaint, code, max_items=8)
        blocks.append(
            format_scoped_context(code, item["title"], item["text"], relevant)
        )
    return f"""COMPLAINT / FACILITY SELF-REPORT / INTAKE:
{_clean(complaint)[:8000]}

AUTHORIZED SELECTED WAC CODES (hard allow-list): {', '.join(allowed)}

SELECTED WAC CONTEXT (do not use any WAC outside this context):
{chr(10).join(blocks)}

Return a single JSON object with this exact shape:
{{
  "intake_summary": "string",
  "known_facts": ["..."],
  "unclear": ["..."],
  "inferences": ["..."],
  "clarifying_questions": ["..."],
  "next_steps": ["..."],
  "areas_of_concern": ["gaps or risks to examine — not findings"],
  "investigation_methods": ["records to request, interviews, observations, timeline work"],
  "recommended_subsections": ["246-341-0410(4)(a)", "..."],
  "investigator_notes": "short structured notes for the human team",
  "codes": [
    {{
      "code": "246-341-0410",
      "title": "...",
      "relevant_subsections": ["246-341-0410(4)(a)"],
      "allegation_text": "Potential violation of WAC ..., by having failed to (4)(a) ...",
      "rationale": "why these subsections of THIS selected WAC fit"
    }}
  ]
}}

Rules:
- Include one codes[] entry for EACH selected WAC code listed above.
- allegation_text may cite ONLY that code's subsections.
- recommended_subsections may ONLY include codes from the allow-list.
- areas_of_concern and investigation_methods must help humans investigate; never state in/out of compliance.
- If the complaint does not clearly implicate a selected WAC, say so in unclear/clarifying_questions and draft a narrowly scoped allegation from the closest relevant subsection of that selected WAC only.
"""


def _build_summary_assist_prompt(complaint: str, selected: list[dict[str, Any]]) -> str:
    allowed = [s["code"] for s in selected]
    titles = "; ".join(f"{s['code']} ({s['title']})" for s in selected)
    blocks = []
    for item in selected:
        relevant = score_relevant_subsections(complaint, item["code"], max_items=4)
        blocks.append(
            format_scoped_context(item["code"], item["title"], item["text"], relevant)
        )
    return f"""DE-IDENTIFIED INTAKE / COMPLAINT (Cat 3/4 identifiers redacted before this prompt):
{_clean(complaint)[:6000]}

AUTHORIZED SELECTED WAC CODES: {', '.join(allowed)}
Selected titles: {titles}

SELECTED WAC CONTEXT:
{chr(10).join(blocks)}

You are assisting a human investigator with Summary of Findings collaborator notes only.
Return JSON:
{{
  "areas_of_concern": ["3-8 items: gaps, inconsistencies, or WAC-linked issues to examine — not findings"],
  "investigation_methods": ["4-10 concrete methods: records, interviews, observations, timeline reconstruction"],
  "clarifying_questions": ["optional questions for the human team"]
}}

Rules:
- Do not determine compliance or invent patient/facility identifiers.
- Tie suggestions to the selected WAC context when relevant.
- Frame concerns as investigative questions or gaps.
"""


def _parse_llm_result(
    data: dict[str, Any],
    selected: list[dict[str, Any]],
    *,
    model: str,
    complaint: str,
) -> InvestigatorResult:
    allowed = {s["code"] for s in selected}
    title_map = {s["code"]: s["title"] for s in selected}
    complaint_for_draft = _clean(complaint) or _clean(str(data.get("intake_summary") or ""))

    codes_out: list[CodeInvestigation] = []
    raw_codes = data.get("codes") or []
    by_code = {str(c.get("code", "")).replace("WAC ", "").strip(): c for c in raw_codes if isinstance(c, dict)}

    for item in selected:
        code = item["code"]
        raw = by_code.get(code, {})
        # ALWAYS rebuild allegation from PDF source text — LLM may suggest cites only
        llm_cites = [str(x) for x in (raw.get("relevant_subsections") or [])]
        validated = filter_cites_to_source(code, llm_cites)
        draft = draft_allegation_from_source(
            code, title_map[code], complaint_for_draft, max_subs=2
        )
        allegation, source_cites = normalize_allegation_line(draft.text), draft.cites
        # Prefer intersection of LLM suggestions with source-ranked cites when both exist
        if validated:
            # Re-draft still from source, but surface validated LLM cites that also score in source
            source_set = set(source_cites)
            merged = [c for c in validated if c in source_set] or source_cites
            # If LLM named valid PDF subsections, re-score using those as explicit preference
            # by appending them into a synthetic cite hint for ranking — already validated.
            if merged != source_cites:
                # Rebuild using complaint + explicit cite strings so extract_explicit_cites can fire
                hint = complaint_for_draft + " " + " ".join(merged)
                draft = draft_allegation_from_source(
                    code, title_map[code], hint, max_subs=2
                )
                allegation, source_cites = normalize_allegation_line(draft.text), draft.cites
            subs = source_cites
            source = "llm+source"
            rationale = _clean(str(raw.get("rationale") or ""))
            if rationale:
                rationale += " Allegation duties taken from local source PDF subsections only."
            else:
                rationale = "LLM suggested subsections; allegation duties taken from local source PDF text only."
        else:
            subs = source_cites
            source = "source"
            rationale = (
                "Allegation drafted solely from local source PDF subsections for the selected WAC. "
                "(LLM cites were empty or not present in the PDF store.)"
            )

        codes_out.append(
            CodeInvestigation(
                code=code,
                title=title_map[code],
                relevant_subsections=subs,
                allegation_text=allegation,
                rationale=rationale,
                source=source,
            )
        )

    recommended = []
    for x in data.get("recommended_subsections") or []:
        for code in allowed:
            if str(x).startswith(code):
                validated = filter_cites_to_source(code, [str(x)])
                recommended.extend(validated)
    # Also include source-ranked cites
    for c in codes_out:
        for s in c.relevant_subsections:
            if s not in recommended:
                recommended.append(s)

    notes = strip_foreign_wac_mentions(_clean(str(data.get("investigator_notes") or "")), allowed)
    areas = [_clean(str(x)) for x in (data.get("areas_of_concern") or []) if _clean(str(x))][:10]
    methods = [_clean(str(x)) for x in (data.get("investigation_methods") or []) if _clean(str(x))][:12]
    if not areas or not methods:
        loc_areas, loc_methods = _local_summary_assist(complaint, selected)
        areas = areas or loc_areas
        methods = methods or loc_methods

    return InvestigatorResult(
        intake_summary=_clean(str(data.get("intake_summary") or ""))[:800],
        known_facts=[_clean(str(x)) for x in (data.get("known_facts") or [])][:12],
        unclear=[_clean(str(x)) for x in (data.get("unclear") or [])][:12],
        inferences=[_clean(str(x)) for x in (data.get("inferences") or [])][:12],
        clarifying_questions=[_clean(str(x)) for x in (data.get("clarifying_questions") or [])][:10],
        next_steps=[_clean(str(x)) for x in (data.get("next_steps") or [])][:10] or list(methods[:6]),
        areas_of_concern=areas,
        investigation_methods=methods,
        recommended_subsections=recommended,
        codes=codes_out,
        investigator_notes=notes,
        llm_used=True,
        llm_assist_used=True,
        llm_model=model,
        llm_error=None,
    )


def run_summary_assist(
    complaint_redacted: str,
    selected: list[dict[str, Any]],
    base: InvestigatorResult,
) -> InvestigatorResult:
    """LLM (or local) collaborator notes for Summary of Findings — never overwrites allegations."""
    if not selected:
        return base
    if not llm_available():
        if not base.areas_of_concern or not base.investigation_methods:
            areas, methods = _local_summary_assist(complaint_redacted, selected)
            base.areas_of_concern = base.areas_of_concern or areas
            base.investigation_methods = base.investigation_methods or methods
            if not base.next_steps:
                base.next_steps = list(methods[:6])
        return base

    messages = [
        {"role": "system", "content": INVESTIGATOR_SYSTEM_PROMPT},
        {"role": "user", "content": _build_summary_assist_prompt(complaint_redacted, selected)},
    ]
    try:
        raw = _chat_completion(messages, temperature=0.3)
        data = _extract_json(raw)
        areas = [_clean(str(x)) for x in (data.get("areas_of_concern") or []) if _clean(str(x))][:10]
        methods = [_clean(str(x)) for x in (data.get("investigation_methods") or []) if _clean(str(x))][:12]
        questions = [_clean(str(x)) for x in (data.get("clarifying_questions") or []) if _clean(str(x))][:8]
        if not areas or not methods:
            loc_areas, loc_methods = _local_summary_assist(complaint_redacted, selected)
            areas = areas or loc_areas
            methods = methods or loc_methods
        base.areas_of_concern = areas
        base.investigation_methods = methods
        if questions:
            # Prefer LLM questions but keep prior clarifying items
            merged = questions + [q for q in base.clarifying_questions if q not in questions]
            base.clarifying_questions = merged[:10]
        if not base.next_steps:
            base.next_steps = list(methods[:6])
        base.llm_assist_used = True
        if not base.llm_model:
            base.llm_model = settings.llm_model
    except Exception as exc:  # noqa: BLE001
        areas, methods = _local_summary_assist(complaint_redacted, selected)
        base.areas_of_concern = base.areas_of_concern or areas
        base.investigation_methods = base.investigation_methods or methods
        note = f"Summary assist LLM failed; used local collaborator notes. ({exc})"
        base.llm_error = f"{base.llm_error}; {note}" if base.llm_error else note
    return base


def _selected_from_nodes(selected_nodes: list[Any]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for node in selected_nodes:
        code = getattr(node, "code", "") or ""
        if not code or code in seen:
            continue
        if getattr(node, "level", "code") != "code":
            continue
        seen.add(code)
        selected.append(
            {
                "code": code,
                "title": _clean(getattr(node, "title", "") or code),
                "text": _clean(getattr(node, "text", "") or "")[:4000],
            }
        )
    if not selected:
        for node in selected_nodes:
            code = getattr(node, "code", "") or ""
            if code and code not in seen:
                seen.add(code)
                selected.append(
                    {
                        "code": code,
                        "title": _clean(getattr(node, "title", "") or code),
                        "text": _clean(getattr(node, "text", "") or "")[:4000],
                    }
                )
    return selected


def run_investigator(
    complaint: str,
    selected_nodes: list[Any],
    *,
    use_llm: bool | None = None,
) -> InvestigatorResult:
    """Local allegation draft by default; summary assist uses LLM when available.

    Cat 3/4 PII is redacted before any LLM prompt. Full LLM allegation enrichment
    remains opt-in via use_llm / settings.llm_for_investigate.
    """
    selected = _selected_from_nodes(selected_nodes)
    complaint_for_llm, privacy_meta = ensure_clean_or_redact(complaint or "", auto_redact=True)
    redacted = bool(privacy_meta.get("redacted"))

    if not selected:
        return InvestigatorResult(
            intake_summary=_clean(complaint_for_llm)[:600],
            clarifying_questions=["Select at least one authorized WAC before analysis."],
            investigator_notes="No selected WACs provided.",
            complaint_redacted_for_llm=redacted,
        )

    # Allegation drafting uses redacted narrative so identifiers are not embedded in LLM drafts
    draft_complaint = complaint_for_llm or _clean(complaint)

    want_llm = settings.llm_for_investigate if use_llm is None else bool(use_llm)
    if want_llm and llm_available():
        messages = [
            {"role": "system", "content": INVESTIGATOR_SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(draft_complaint, selected)},
        ]
        try:
            raw = _chat_completion(messages)
            data = _extract_json(raw)
            result = _parse_llm_result(
                data, selected, model=settings.llm_model, complaint=draft_complaint
            )
            result.complaint_redacted_for_llm = redacted
            return result
        except Exception as exc:  # noqa: BLE001 — fall back safely
            result = _local_investigate(draft_complaint, selected)
            result.llm_error = f"LLM call failed; used scoped local fallback. ({exc})"
            result.complaint_redacted_for_llm = redacted
            return run_summary_assist(draft_complaint, selected, result)

    result = _local_investigate(draft_complaint, selected)
    result.complaint_redacted_for_llm = redacted
    if want_llm and not llm_available():
        if not settings.llm_enabled:
            result.llm_error = "LLM disabled (LLM_ENABLED=false). Using scoped local investigator."
        elif "generativelanguage.googleapis.com" in (settings.llm_base_url or ""):
            result.llm_error = (
                f"Gemini not configured (model={settings.llm_model}). "
                "Set LLM_API_KEY in backend/.env from https://aistudio.google.com/apikey, then restart the API."
            )
        else:
            result.llm_error = (
                f"LLM not reachable at {settings.llm_base_url} (model={settings.llm_model}). "
                "Using scoped local investigator. Start Ollama or set LLM_API_KEY / LLM_BASE_URL."
            )

    # Summary collaborator assist: LLM when available even if full investigate LLM is off
    return run_summary_assist(draft_complaint, selected, result)
