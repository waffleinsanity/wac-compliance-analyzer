from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import get_current_user, get_optional_user
from app.database import (
    CustomTriggerPhrase,
    User,
    UsageStat,
    AnalysisRun,
    get_db,
)
from app.rag.store import wac_store
from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    StatsOut,
    TriggerPhraseCreate,
    TriggerPhraseOut,
    TriggerPhraseUpdate,
    ValidationResult,
)
from app.services.analyzer import analyze_document, batch_analyze
from app.services.documents import extract_text_from_bytes, extract_text_from_path
from app.services.validation import validate_against_official
from app.config import settings

router = APIRouter(prefix="/api", tags=["analysis"])


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    payload: AnalyzeRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Document text is required")
    if not payload.selected_wacs:
        raise HTTPException(status_code=400, detail="Select at least one WAC")
    try:
        return analyze_document(
            db=db,
            text=payload.text,
            selected_wacs=payload.selected_wacs,
            user_id=user.id if user else None,
            include_informational=payload.include_informational,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/analyze/upload", response_model=AnalyzeResponse)
async def analyze_upload(
    selected_wacs: str = Form(...),
    include_informational: bool = Form(True),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    data = await file.read()
    text = extract_text_from_bytes(file.filename or "upload.txt", data)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from file")
    try:
        selected = [s.strip() for s in selected_wacs.split(",") if s.strip()]
        # Also accept JSON array
        if selected_wacs.strip().startswith("["):
            import json

            selected = json.loads(selected_wacs)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid selected_wacs: {exc}") from exc

    return analyze_document(
        db=db,
        text=text,
        selected_wacs=selected,
        user_id=user.id if user else None,
        document_name=file.filename,
        include_informational=include_informational,
    )


@router.post("/analyze/batch")
async def analyze_batch(
    selected_wacs: str = Form(...),
    include_informational: bool = Form(True),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    import json

    try:
        selected = json.loads(selected_wacs) if selected_wacs.strip().startswith("[") else [
            s.strip() for s in selected_wacs.split(",") if s.strip()
        ]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    docs = []
    for f in files:
        data = await f.read()
        text = extract_text_from_bytes(f.filename or "upload.txt", data)
        docs.append({"name": f.filename, "text": text})
    results = batch_analyze(
        db=db,
        documents=docs,
        selected_wacs=selected,
        user_id=user.id if user else None,
        include_informational=include_informational,
    )
    return {"results": results, "count": len(results)}


@router.get("/examples")
def list_examples():
    examples = []
    if settings.examples_dir.exists():
        for path in sorted(settings.examples_dir.glob("Example*.*")):
            examples.append({"name": path.name, "path": str(path)})
    return examples


@router.get("/examples/{name}/text")
def example_text(name: str):
    path = settings.examples_dir / name
    if not path.exists() or ".." in name:
        raise HTTPException(status_code=404, detail="Example not found")
    return {"name": name, "text": extract_text_from_path(path)}


@router.get("/stats", response_model=StatsOut)
def stats(db: Session = Depends(get_db)):
    codes = wac_store.get_code_nodes()
    total_analyses = db.query(AnalysisRun).count()
    top_selected = (
        db.query(UsageStat)
        .filter(UsageStat.stat_type == "selected")
        .order_by(UsageStat.count.desc())
        .limit(10)
        .all()
    )
    top_matched = (
        db.query(UsageStat)
        .filter(UsageStat.stat_type == "matched")
        .order_by(UsageStat.count.desc())
        .limit(10)
        .all()
    )
    recent = db.query(AnalysisRun).order_by(AnalysisRun.created_at.desc()).limit(8).all()
    return StatsOut(
        total_analyses=total_analyses,
        total_wac_codes=len(codes),
        total_nodes=len(wac_store.nodes),
        top_selected=[{"wac_id": r.wac_id, "count": r.count} for r in top_selected],
        top_matched=[{"wac_id": r.wac_id, "count": r.count} for r in top_matched],
        recent_runs=[
            {
                "id": r.id,
                "document_name": r.document_name,
                "selected_count": r.selected_count,
                "result_count": r.result_count,
                "duration_ms": r.duration_ms,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in recent
        ],
        chapter_breakdown={
            "246-341": sum(1 for c in codes if c.chapter == "246-341"),
            "246-337": sum(1 for c in codes if c.chapter == "246-337"),
        },
    )


@router.get("/validate/{chapter}", response_model=ValidationResult)
async def validate_chapter(chapter: str):
    return await validate_against_official(chapter)


@router.get("/triggers", response_model=list[TriggerPhraseOut])
def list_triggers(
    wac_id: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(CustomTriggerPhrase).filter(CustomTriggerPhrase.user_id == user.id)
    if wac_id:
        q = q.filter(CustomTriggerPhrase.wac_id == wac_id)
    return q.order_by(CustomTriggerPhrase.updated_at.desc()).all()


@router.post("/triggers", response_model=TriggerPhraseOut)
def create_trigger(
    payload: TriggerPhraseCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.wac_id not in wac_store.nodes and payload.wac_id not in wac_store.code_index:
        # Allow code without WAC prefix
        if f"WAC {payload.wac_id}" not in wac_store.nodes:
            raise HTTPException(status_code=404, detail="Unknown WAC id")
    row = CustomTriggerPhrase(user_id=user.id, wac_id=payload.wac_id, phrase=payload.phrase.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/triggers/{phrase_id}", response_model=TriggerPhraseOut)
def update_trigger(
    phrase_id: int,
    payload: TriggerPhraseUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(CustomTriggerPhrase)
        .filter(CustomTriggerPhrase.id == phrase_id, CustomTriggerPhrase.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Phrase not found")
    row.phrase = payload.phrase.strip()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/triggers/{phrase_id}")
def delete_trigger(
    phrase_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(CustomTriggerPhrase)
        .filter(CustomTriggerPhrase.id == phrase_id, CustomTriggerPhrase.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Phrase not found")
    db.delete(row)
    db.commit()
    return {"deleted": True}


@router.post("/ingest")
def ingest(force: bool = False, db: Session = Depends(get_db)):
    result = wac_store.ingest(db, force=force)
    return result


@router.get("/health")
def health():
    return {
        "status": "ok",
        "wac_nodes": len(wac_store.nodes),
        "wac_codes": len(wac_store.get_code_nodes()),
        "ready": wac_store.ready,
    }
