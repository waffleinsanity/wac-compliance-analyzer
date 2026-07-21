import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import get_admin_user, get_current_user, get_editor_user
from app.database import User, get_db
from app.rag.store import wac_store
from app.schemas import (
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
from app.services.wac_scope import cite_prefix

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


def _hit_from_node(node, score: float, reason: str) -> StatuteHit:
    text = (node.text or "").strip()
    excerpt = text if len(text) <= 420 else text[:419].rstrip() + "…"
    instrument = cite_prefix(node.code)
    return StatuteHit(
        id=node.id,
        instrument=instrument,
        chapter=node.chapter,
        code=node.code,
        title=node.title or "",
        level=node.level,
        hierarchy_path=node.hierarchy_path,
        score=round(float(score), 4),
        reason=reason,
        text=text,
        excerpt=excerpt,
    )


@router.post("/search-statutes", response_model=StatuteSearchResponse)
async def search_statutes(
    payload: StatuteSearchRequest,
    _: User = Depends(get_current_user),
):
    """Full-corpus keyword RAG over local WAC + RCW PDFs (exact text excerpts)."""
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Complaint text is required")
    if not wac_store.ready:
        raise HTTPException(status_code=503, detail="Statute corpus is not loaded")
    exclude = {c.replace("WAC ", "").replace("RCW ", "") for c in payload.exclude_codes}
    ranked = wac_store.corpus_search(
        payload.text,
        top_k=max(1, min(payload.top_k, 50)),
        exclude_codes=exclude or None,
    )
    hits = [_hit_from_node(n, s, reason) for n, s, reason in ranked]
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
    """Suggest related WAC/RCW sections after approved selection (research only)."""
    if not payload.selected_wacs:
        raise HTTPException(status_code=400, detail="Select at least one authorized WAC/RCW")
    if not wac_store.ready:
        raise HTTPException(status_code=503, detail="Statute corpus is not loaded")

    selected_nodes = wac_store.resolve_selection(payload.selected_wacs)
    selected_codes = {
        n.code.replace("WAC ", "").replace("RCW ", "") for n in selected_nodes
    }
    seed_parts = [payload.text.strip()]
    for n in selected_nodes:
        if n.level == "code":
            seed_parts.append(f"{n.code} {n.title} {n.text[:800]}")
    seed = "\n".join(p for p in seed_parts if p)
    if not seed.strip():
        raise HTTPException(status_code=400, detail="Need selected codes or complaint text")

    ranked = wac_store.corpus_search(
        seed,
        top_k=max(1, min(payload.top_k, 40)),
        exclude_codes=selected_codes,
    )
    suggestions: list[StatuteHit] = []
    seen_codes: set[str] = set()
    for node, score, reason in ranked:
        key = node.code
        if node.level not in {"code", "primary", "secondary"}:
            continue
        if key in seen_codes and node.level != "code":
            continue
        if node.level == "code":
            seen_codes.add(key)
        suggestions.append(_hit_from_node(node, score, reason))
        if len(suggestions) >= payload.top_k:
            break

    return SuggestRelatedResponse(
        suggestions=suggestions,
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
    return ValidateReportResponse(quote_integrity=out, can_export=out.ok)


@router.post("/ingest")
def ingest(
    force: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    return wac_store.ingest(db, force=force)


@router.get("/templates")
def list_templates(_: User = Depends(get_current_user)):
    """Show which example IR shell templates are loaded (phrasing only, not duty authority)."""
    from app.services.template_corpus import load_template_corpus

    corpus = load_template_corpus()
    return {
        "example_files": [e.source_file for e in corpus.examples],
        "allegation_templates": sum(len(v) for v in corpus.by_code.values()),
        "codes_covered": sorted(corpus.by_code.keys()),
        "by_code_counts": {k: len(v) for k, v in sorted(corpus.by_code.items())},
        "reload": "POST /api/templates/reload",
    }


@router.post("/templates/reload")
def reload_templates(_: User = Depends(get_admin_user)):
    from app.services.template_corpus import reload_corpus

    corpus = reload_corpus()
    return {
        "reloaded": True,
        "example_files": [e.source_file for e in corpus.examples],
        "allegation_templates": sum(len(v) for v in corpus.by_code.values()),
        "codes_covered": len(corpus.by_code),
    }


@router.get("/health")
def health():
    from app.config import settings
    from app.services.investigator_llm import llm_available
    from app.services.template_corpus import load_template_corpus

    corpus = load_template_corpus()
    return {
        "status": "ok",
        "pid": os.getpid(),
        "started_at": _started_at,
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
