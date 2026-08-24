import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth import get_admin_user, get_current_user, get_editor_user
from app.database import User, get_db
from app.rag.store import wac_store
from app.schemas import (
    AllegationDutyOption,
    DutyOptionFromLabelRequest,
    InvestigationReport,
    InvestigationRequest,
    QuoteIntegrityOut,
    StatuteHit,
    StatuteSearchRequest,
    StatuteSearchResponse,
    SuggestRelatedRequest,
    SuggestRelatedResponse,
    ValidateReportRequest,
    ValidateReportResponse,
)
from app.services.documents import extract_text_from_bytes
from app.services.investigation import build_investigation_report
from app.services.pii_gate import ensure_clean_or_redact
from app.services.quote_verify import verify_report_quotes
from app.services.research_suggest import (
    chapters_for_selection,
    rank_research_suggestions,
)
from app.services.wac_scope import build_duty_option_from_label, cite_prefix

router = APIRouter(prefix="/api", tags=["analysis"])

_started_at = datetime.now(timezone.utc).isoformat()
_HEALTH_FEATURES = {
    "case_trash": True,
    "case_restore": True,
}


@router.post("/extract")
async def extract_document(
    file: UploadFile = File(...),
    _: User = Depends(get_editor_user),
):
    data = await file.read()
    text = extract_text_from_bytes(file.filename or "upload.txt", data)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from file")
    return {"filename": file.filename, "text": text, "characters": len(text)}


def _hit_from_suggestion(s) -> StatuteHit:
    node = s.node
    text = (node.text or "").strip()
    instrument = cite_prefix(node.code)
    return StatuteHit(
        id=node.id,
        instrument=instrument,
        chapter=node.chapter,
        code=node.code,
        title=node.title or "",
        level=node.level,
        hierarchy_path=node.hierarchy_path,
        score=round(float(s.score), 4),
        reason=s.reason,
        text=text,
        excerpt=s.excerpt or (text if len(text) <= 420 else text[:419].rstrip() + "…"),
        score_basis=s.score_basis or "ir_leaf",
        duty_label=s.duty_label or "",
    )


@router.post("/search-statutes", response_model=StatuteSearchResponse)
async def search_statutes(
    payload: StatuteSearchRequest,
    _: User = Depends(get_current_user),
):
    """Optional research: corpus candidates re-scored with IR leaf/overlap ranking.

    Discovery only — never authorizes codes. Strength uses the same Compare bands.
    """
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Complaint text is required")
    if not wac_store.ready:
        raise HTTPException(status_code=503, detail="Statute corpus is not loaded")
    exclude = {c.replace("WAC ", "").replace("RCW ", "") for c in payload.exclude_codes}
    ranked = rank_research_suggestions(
        payload.text,
        top_k=max(1, min(payload.top_k, 50)),
        exclude_codes=exclude or None,
    )
    hits = [_hit_from_suggestion(s) for s in ranked]
    preview = payload.text.strip()
    return StatuteSearchResponse(
        hits=hits,
        query_preview=preview if len(preview) <= 240 else preview[:240] + "…",
        total=len(hits),
    )


@router.post("/suggest-related", response_model=SuggestRelatedResponse)
async def suggest_related(
    payload: SuggestRelatedRequest,
    _: User = Depends(get_current_user),
):
    """Suggest related WAC/RCW after approved selection (research only).

    Complaint-driven IR preview ranking; selected codes are excluded and only
    provide soft chapter affinity — statute body is never pasted into the query.
    """
    if not payload.selected_wacs:
        raise HTTPException(status_code=400, detail="Select at least one authorized WAC/RCW")
    if not wac_store.ready:
        raise HTTPException(status_code=503, detail="Statute corpus is not loaded")
    if not payload.text.strip():
        raise HTTPException(
            status_code=400,
            detail="Complaint text is required to rank related codes against the allegation",
        )

    selected_nodes = wac_store.resolve_selection(payload.selected_wacs)
    selected_codes = {
        n.code.replace("WAC ", "").replace("RCW ", "") for n in selected_nodes
    }
    preferred = chapters_for_selection(payload.selected_wacs)
    ranked = rank_research_suggestions(
        payload.text,
        top_k=max(1, min(payload.top_k, 40)),
        exclude_codes=selected_codes,
        preferred_chapters=preferred or None,
    )
    return SuggestRelatedResponse(
        suggestions=[_hit_from_suggestion(s) for s in ranked],
        selected_count=len(selected_codes),
    )


@router.post("/investigate", response_model=InvestigationReport)
async def investigate(
    payload: InvestigationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_editor_user),
):
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Complaint / allegation text is required")
    if not payload.selected_wacs:
        raise HTTPException(status_code=400, detail="Select at least one authorized WAC")
    clean_text, _privacy = ensure_clean_or_redact(payload.text, auto_redact=True)
    try:
        return build_investigation_report(
            db=db,
            complaint_text=clean_text,
            selected_wacs=payload.selected_wacs,
            user_id=user.id,
            investigation_date=payload.investigation_date,
            case_id=payload.case_id,
            include_informational=payload.include_informational,
            facility_address=payload.facility_address,
            credential_number=payload.credential_number,
            use_llm=payload.use_llm,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/investigate/duty-option", response_model=AllegationDutyOption)
async def resolve_duty_option_from_label(
    payload: DutyOptionFromLabelRequest,
    user: User = Depends(get_editor_user),
):
    """Resolve a PDF-backed duty phrase for a subsection picked from full code text."""
    _ = user
    code = payload.code.replace("WAC ", "").replace("RCW ", "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="WAC/RCW code is required")
    label = (payload.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Subsection label is required")
    option = build_duty_option_from_label(code, label)
    if not option:
        raise HTTPException(
            status_code=404,
            detail="Subsection not found in approved PDF store or has no draftable duty text",
        )
    return AllegationDutyOption(**option)


@router.post("/investigate/validate", response_model=ValidateReportResponse)
async def validate_investigation_report(
    payload: ValidateReportRequest,
    user: User = Depends(get_current_user),
):
    """Re-check allegation / RF / evidentiary quotes against the PDF store after edits."""
    _ = user
    selected = [
        c.replace("WAC ", "").replace("RCW ", "").strip() for c in payload.selected_wacs
    ]
    integrity = verify_report_quotes(
        allegations=payload.allegations,
        regulatory_framework=payload.regulatory_framework,
        evidentiary_examples=payload.evidentiary_examples,
        selected_codes=selected or None,
    )
    out = QuoteIntegrityOut(**integrity.to_dict())
    # Working drafts remain downloadable even when wording needs review.
    return ValidateReportResponse(quote_integrity=out, can_export=True)


@router.post("/ingest")
def ingest(
    force: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    return wac_store.ingest(db, force=force)


@router.get("/templates/investigation-sod-template")
def get_investigation_sod_template(_: User = Depends(get_current_user)):
    """Official Investigation SOD Template.docx bytes (same file as Export SOD)."""
    from app.services.sod_template import read_blank_sod_template_bytes

    content = read_blank_sod_template_bytes()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": 'inline; filename="Investigation SOD Template.docx"',
        },
    )


@router.get("/templates")
def list_templates(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Show which example IR shell templates + policy guidance are loaded."""
    from app.services.guidance_corpus import guidance_stats
    from app.services.ir_learning import corpus_stats
    from app.services.template_corpus import load_template_corpus

    corpus = load_template_corpus()
    learned = corpus_stats(db)
    return {
        "example_files": [e.source_file for e in corpus.examples],
        "allegation_templates": sum(len(v) for v in corpus.by_code.values()),
        "codes_covered": sorted(corpus.by_code.keys()),
        "by_code_counts": {k: len(v) for k, v in sorted(corpus.by_code.items())},
        "learned": learned,
        "guidance": guidance_stats(),
        "reload": "POST /api/templates/reload",
    }


@router.post("/templates/reload")
def reload_templates(_: User = Depends(get_admin_user)):
    from app.services.guidance_corpus import reload_guidance_corpus
    from app.services.template_corpus import reload_corpus

    corpus = reload_corpus()
    guidance = reload_guidance_corpus()
    return {
        "reloaded": True,
        "example_files": [e.source_file for e in corpus.examples],
        "allegation_templates": sum(len(v) for v in corpus.by_code.values()),
        "codes_covered": len(corpus.by_code),
        "guidance_files": len(guidance.files),
    }


@router.get("/guidance")
def get_guidance(_: User = Depends(get_current_user)):
    """Policy guidance corpus stats (structure/voice only — not statute authority)."""
    from app.services.guidance_corpus import guidance_stats

    return guidance_stats()


@router.get("/health")
def health():
    from app.config import settings
    from app.services.app_version import get_app_version
    from app.services.investigator_llm import llm_available
    from app.services.template_corpus import load_template_corpus

    corpus = load_template_corpus()
    return {
        "status": "ok",
        "pid": os.getpid(),
        "started_at": _started_at,
        "version": get_app_version(),
        "features": dict(_HEALTH_FEATURES),
        "wac_nodes": len(wac_store.nodes),
        "wac_codes": len(wac_store.get_code_nodes()),
        "ready": wac_store.ready,
        "template_examples": len(corpus.examples),
        "template_allegations": sum(len(v) for v in corpus.by_code.values()),
        "template_codes": len(corpus.by_code),
        "llm": {
            "enabled": settings.llm_enabled,
            "available": llm_available(),
            "base_url": settings.llm_base_url,
            "model": settings.llm_model,
            "has_api_key": bool(settings.llm_api_key),
        },
    }


@router.get("/version")
def version():
    """Public deploy fingerprint for the in-app update banner."""
    from app.services.app_version import get_app_version

    return {"version": get_app_version(), "started_at": _started_at}
