from __future__ import annotations

import json
import logging
import re
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.auth import get_admin_user, get_current_user, get_editor_user
from app.permissions import can_review, is_admin_role, require_role_edit, require_role_export, user_role
from app.config import settings
from app.database import (
    CaseComment,
    CaseEvidence,
    CaseProcessEntry,
    CaseReportSnapshot,
    InvestigationCase,
    IrTemplate,
    User,
    get_db,
    utcnow,
)
from app.schemas import (
    CaseAnalyticsOut,
    CaseCommentCreate,
    CaseCommentOut,
    CaseCreate,
    CaseDetailOut,
    CaseIrTemplateBind,
    CaseSaveDraft,
    CaseSnapshotOut,
    CaseStatusUpdate,
    CaseSummaryOut,
    CaseUpdate,
    DefensibilityOut,
    EvidenceOut,
    EvidenceReviewResponse,
    InvestigationReport,
    IrTemplateOut,
    ProcessEntryCreate,
    ProcessEntryOut,
)
from app.services.case_store import (
    assert_case_access,
    assert_case_editable,
    assert_case_not_trashed,
    archive_stale_final_cases,
    dumps_list,
    evidence_dir,
    get_case_or_404,
    hard_delete_case,
    parse_json_list,
    merge_process_activity_bullets,
    process_entries_to_bullets,
    purge_trashed_cases,
    report_from_json,
    is_periodic_note,
    maybe_persist_legacy_document_review,
    persist_draft,
    save_snapshot,
    set_status,
    unit_analytics,
)
from app.services.defensibility import check_defensibility
from app.services.docx_export import (
    build_deficiency_cite_sheet,
    build_investigation_docx,
    build_sod_docx,
)
from app.services.investigation import build_investigation_report
from app.services.evidence_review import extract_evidence_text, review_case_evidence
from app.services.audit import log_action
from app.services.ir_learning import harvest_completed_ir
from app.services.ir_templates import (
    bind_case_template,
    create_case_template,
    read_docx_upload,
    resolve_case_template_path,
    template_to_out,
)
from app.services.pii_gate import ensure_clean_or_redact, scan_text
from app.services.documents import extract_text_from_bytes
from app.services.quote_verify import verify_report_quotes
from app.services.template_fill import TemplateFillError, smart_fill

router = APIRouter(prefix="/api/cases", tags=["cases"])
logger = logging.getLogger(__name__)

ALLOWED_EVIDENCE_EXT = {".pdf", ".docx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp"}
_TEXT_EVIDENCE_EXT = {".txt", ".md", ".pdf", ".docx"}
_IMAGE_EVIDENCE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
# Block PDF/DOCX only for high-confidence personal identifiers. Name/phone/address
# hits are common false positives on facility policies (WAC cites, Title Case
# headings, letterhead). .txt/.md still auto-redact any Cat 3/4 kind.
_EVIDENCE_BLOCK_KINDS = frozenset(
    {"ssn", "itin", "mrn", "drivers_license", "dob"}
)


def _scan_evidence_payload(filename: str, data: bytes) -> tuple[bytes, str]:
    """Scan extractable evidence for Cat 3/4 PII; redact .txt/.md or block binary docs.

    Returns (bytes_to_store, notes_suffix). Images are not text-scanned.
    """
    ext = Path(filename).suffix.lower()
    if ext in _IMAGE_EVIDENCE_EXT:
        return data, " [privacy: image not text-scanned — prefer de-identified exhibits]"
    if ext not in _TEXT_EVIDENCE_EXT:
        return data, ""
    try:
        extracted = extract_text_from_bytes(filename, data)
    except Exception:
        extracted = ""
    if not (extracted or "").strip():
        return data, " [privacy: no extractable text to scan]"
    scan = scan_text(extracted)
    if not scan.get("has_hits"):
        return data, " [privacy: scanned — no Cat 3/4 patterns]"
    kinds = sorted((scan.get("summary") or {}).get("by_kind") or {})
    kind_note = ", ".join(kinds) if kinds else "Cat 3/4"
    if ext in {".txt", ".md"}:
        cleaned, meta = ensure_clean_or_redact(extracted, auto_redact=True)
        n = int(meta.get("applied_count") or 0)
        return cleaned.encode("utf-8"), (
            f" [privacy: auto-redacted {n} Cat 3/4 span(s) ({kind_note})]"
        )
    blocking = [k for k in kinds if k in _EVIDENCE_BLOCK_KINDS]
    if blocking:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Evidence file appears to contain Category 3/4 identifiers "
                f"({', '.join(blocking)}). "
                "De-identify the PDF/DOCX and upload again, or attach a .txt/.md excerpt "
                "(text uploads are auto-redacted)."
            ),
        )
    return data, (
        f" [privacy: scanned — possible Cat 3/4-like patterns ({kind_note}); "
        "file kept (assistive screen, not a block)]"
    )


def _quote_integrity_blocks_finalize(report: InvestigationReport) -> str | None:
    """Return error detail when quote integrity must block finalize; else None."""
    integrity = verify_report_quotes(report)
    if integrity.ok:
        # Also honor persisted flag when verify path is clean but report marked broken.
        qi = report.quote_integrity
        if qi is not None and qi.ok is False:
            n = len(qi.failures or [])
            return (
                f"Cannot finalize: quote integrity failed ({n} issue(s)). "
                "Fix statute wording in the draft, then try again. Working-draft DOCX remains available."
            )
        return None
    n = len(integrity.failures or [])
    return (
        f"Cannot finalize: quote integrity failed ({n} issue(s)). "
        "Fix statute wording in the draft, then try again. Working-draft DOCX remains available."
    )


def _latest_snapshot_id(db: Session, case_id: int) -> int | None:
    snap = (
        db.query(CaseReportSnapshot)
        .filter(CaseReportSnapshot.case_id == case_id)
        .order_by(CaseReportSnapshot.version.desc())
        .first()
    )
    return snap.id if snap else None


def _harvest_ir_style(
    db: Session,
    case: InvestigationCase,
    report: InvestigationReport,
    user: User,
    *,
    trigger: str,
) -> None:
    """Best-effort: promote completed IR style into the evolving learning bank."""
    try:
        result = harvest_completed_ir(
            db,
            case,
            report,
            user,
            trigger=trigger,
            snapshot_id=_latest_snapshot_id(db, case.id),
        )
        log_action(
            db,
            user_id=user.id,
            action="ir_learning_harvest",
            entity_type="investigation_case",
            entity_id=case.id,
            details=f"trigger={trigger}; saved={result.get('saved', 0)}",
            outcome="ok" if not result.get("error") else "error",
        )
    except Exception:
        # Never block export/submit on learning failures
        logger.exception("IR learning harvest failed for case %s", case.id)


def _apply_privacy_to_complaint(case: InvestigationCase, text: str) -> str:
    """Auto-redact Cat 3/4 before persistence; note acknowledgment on the case."""
    clean, meta = ensure_clean_or_redact(text or "", auto_redact=True)
    if meta.get("redacted"):
        case.privacy_acknowledged_at = utcnow()
        n = int(meta.get("applied_count") or 0)
        case.privacy_redaction_note = f"Auto-redacted {n} Category 3/4 span(s) before save"
    return clean


def _username(db: Session, user_id: int | None) -> str:
    if not user_id:
        return ""
    u = db.query(User).filter(User.id == user_id).first()
    return u.username if u else ""


def _summary(case: InvestigationCase) -> CaseSummaryOut:
    return CaseSummaryOut(
        id=case.id,
        case_id_label=case.case_id_label or "",
        title=case.title or "",
        status=case.status,
        approved_wac_count=len(parse_json_list(case.approved_wac_ids)),
        has_report=bool(case.current_report_json),
        owner_user_id=case.owner_user_id,
        updated_at=case.updated_at,
        created_at=case.created_at,
        archived_at=case.archived_at,
        trashed_at=case.trashed_at,
    )


def _case_ir_template(db: Session, case: InvestigationCase) -> IrTemplateOut | None:
    tid = getattr(case, "ir_template_id", None)
    if not tid:
        return None
    row = db.query(IrTemplate).filter(IrTemplate.id == tid).first()
    return template_to_out(row) if row else None


def _export_ir_bytes(db: Session, case: InvestigationCase, report: InvestigationReport) -> bytes:
    """Built-in blank or smart-fill against the case-bound custom template."""
    template_path = resolve_case_template_path(db, case)
    if template_path is None:
        return build_investigation_docx(report, draft_label=_draft_label(case))
    try:
        return smart_fill(template_path, report)
    except TemplateFillError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _detail(db: Session, case: InvestigationCase) -> CaseDetailOut:
    evidence_out: list[EvidenceOut] = []
    for ev in case.evidence:
        evidence_out.append(
            EvidenceOut(
                id=ev.id,
                title=ev.title,
                original_filename=ev.original_filename or "",
                content_type=ev.content_type or "",
                linked_wac_ids=parse_json_list(ev.linked_wac_ids),
                notes=ev.notes or "",
                created_at=ev.created_at,
            )
        )
    comments_out = [
        CaseCommentOut(
            id=c.id,
            author_user_id=c.author_user_id,
            author_username=_username(db, c.author_user_id),
            body=c.body,
            created_at=c.created_at,
        )
        for c in sorted(case.comments, key=lambda x: x.created_at or utcnow())
    ]
    ir_tpl = _case_ir_template(db, case)
    return CaseDetailOut(
        id=case.id,
        case_id_label=case.case_id_label or "",
        title=case.title or "",
        status=case.status,
        complaint_text=case.complaint_text or "",
        investigation_date=case.investigation_date or "",
        facility_address=case.facility_address or "",
        credential_number=case.credential_number or "",
        approved_wac_ids=parse_json_list(case.approved_wac_ids),
        report=report_from_json(case.current_report_json),
        owner_user_id=case.owner_user_id,
        ir_template_id=getattr(case, "ir_template_id", None),
        ir_template=ir_tpl,
        privacy_acknowledged_at=getattr(case, "privacy_acknowledged_at", None),
        privacy_redaction_note=getattr(case, "privacy_redaction_note", None) or "",
        status_changed_at=case.status_changed_at,
        status_changed_by=case.status_changed_by,
        archived_at=case.archived_at,
        trashed_at=getattr(case, "trashed_at", None),
        created_at=case.created_at,
        updated_at=case.updated_at,
        snapshots=[
            CaseSnapshotOut(
                id=s.id,
                version=s.version,
                note=s.note or "",
                created_by=s.created_by,
                created_at=s.created_at,
            )
            for s in sorted(case.snapshots, key=lambda x: -x.version)
        ],
        evidence=evidence_out,
        process_entries=[ProcessEntryOut.model_validate(p) for p in case.process_entries],
        comments=comments_out,
    )


def _report_for_export(case: InvestigationCase) -> InvestigationReport:
    report = report_from_json(case.current_report_json)
    if not report:
        raise HTTPException(status_code=400, detail="Case has no report draft to export")
    return report


def _draft_label(case: InvestigationCase) -> str:
    if case.status == "final":
        return "Final — investigator-approved draft"
    if case.status == "in_review":
        return "In review — working draft for supervisor review"
    return "Working draft — for investigator review"


@router.get("", response_model=list[CaseSummaryOut])
def list_cases(
    view: str = "active",
    include_archived: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    archive_stale_final_cases(db)
    purge_trashed_cases(db)
    q = db.query(InvestigationCase)
    if not is_admin_role(user_role(user)):
        q = q.filter(InvestigationCase.owner_user_id == user.id)

    # Backward-compatible: include_archived=true maps to archived view
    mode = (view or "active").strip().lower()
    if include_archived and mode == "active":
        mode = "archived"

    if mode == "archived":
        q = q.filter(InvestigationCase.status == "archived")
    elif mode in {"trash", "trashed"}:
        q = q.filter(InvestigationCase.status == "trashed")
    else:
        q = q.filter(InvestigationCase.status.notin_(["archived", "trashed"]))

    cases = q.order_by(InvestigationCase.updated_at.desc()).all()
    return [_summary(c) for c in cases]


@router.post("", response_model=CaseDetailOut)
def create_case(
    payload: CaseCreate,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    case = InvestigationCase(
        owner_user_id=user.id,
        case_id_label=payload.case_id_label.strip(),
        title=payload.title.strip() or payload.case_id_label.strip() or "Untitled case",
        status="draft",
        complaint_text="",
        investigation_date=payload.investigation_date,
        facility_address=payload.facility_address,
        credential_number=payload.credential_number,
        approved_wac_ids=dumps_list(payload.approved_wac_ids),
        status_changed_by=user.id,
    )
    case.complaint_text = _apply_privacy_to_complaint(case, payload.complaint_text)
    db.add(case)
    db.commit()
    db.refresh(case)
    return _detail(db, case)


@router.get("/analytics", response_model=CaseAnalyticsOut)
def case_analytics(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return CaseAnalyticsOut(**unit_analytics(db, user))


@router.get("/{case_id}", response_model=CaseDetailOut)
def get_case(
    case_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    maybe_persist_legacy_document_review(db, case, user)
    return _detail(db, case)


@router.patch("/{case_id}", response_model=CaseDetailOut)
def update_case(
    case_id: int,
    payload: CaseUpdate,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    if payload.case_id_label is not None:
        case.case_id_label = payload.case_id_label.strip()
    if payload.title is not None:
        case.title = payload.title.strip()
    if payload.complaint_text is not None:
        case.complaint_text = _apply_privacy_to_complaint(case, payload.complaint_text)
    if payload.investigation_date is not None:
        case.investigation_date = payload.investigation_date
    if payload.facility_address is not None:
        case.facility_address = payload.facility_address
    if payload.credential_number is not None:
        case.credential_number = payload.credential_number
    if payload.approved_wac_ids is not None:
        case.approved_wac_ids = dumps_list(payload.approved_wac_ids)
    case.updated_at = utcnow()
    db.add(case)
    db.commit()
    db.refresh(case)
    return _detail(db, case)


@router.put("/{case_id}/ir-template", response_model=CaseDetailOut)
def bind_ir_template(
    case_id: int,
    payload: CaseIrTemplateBind,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    """Bind a library template to this case, or null for the built-in blank."""
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    bind_case_template(db, case, user, payload.ir_template_id)
    db.refresh(case)
    return _detail(db, case)


@router.post("/{case_id}/ir-template", response_model=CaseDetailOut)
async def upload_case_ir_template(
    case_id: int,
    name: str = Form(""),
    file: UploadFile = File(...),
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    """Upload a case-scoped IR template and bind it for export smart-fill."""
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    filename, data = await read_docx_upload(file)
    create_case_template(
        db,
        user,
        case,
        filename=filename,
        data=data,
        name=name,
        content_type=file.content_type or "",
    )
    db.refresh(case)
    return _detail(db, case)


@router.post("/{case_id}/save-draft", response_model=CaseDetailOut)
def save_draft(
    case_id: int,
    payload: CaseSaveDraft,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    note = payload.note or "Draft save"
    persist_draft(
        db,
        case,
        payload.report,
        user,
        note=note,
        snapshot_mode="auto" if is_periodic_note(note) else "always",
    )
    # Sync light metadata from report when present
    if payload.report.case_id:
        case.case_id_label = payload.report.case_id
    if payload.report.facility_info:
        case.facility_address = payload.report.facility_info.facility_address or case.facility_address
        case.credential_number = (
            payload.report.facility_info.credential_number or case.credential_number
        )
        case.investigation_date = (
            payload.report.facility_info.investigation_dates
            or payload.report.investigation_date
            or case.investigation_date
        )
    db.add(case)
    db.commit()
    db.refresh(case)
    return _detail(db, case)


@router.post("/{case_id}/snapshots/{snapshot_id}/restore", response_model=CaseDetailOut)
def restore_draft_snapshot(
    case_id: int,
    snapshot_id: int,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    """Replace the working draft with a prior recall point. Current work is snapshotted first."""
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    snap = (
        db.query(CaseReportSnapshot)
        .filter(CaseReportSnapshot.id == snapshot_id, CaseReportSnapshot.case_id == case_id)
        .first()
    )
    if not snap:
        raise HTTPException(status_code=404, detail="Recall point not found")
    target = report_from_json(snap.report_json)
    if not target:
        raise HTTPException(status_code=400, detail="Recall point has no report to restore")
    current = report_from_json(case.current_report_json)
    if current:
        persist_draft(
            db,
            case,
            current,
            user,
            note="Auto-snapshot before recall",
            snapshot_mode="always",
        )
    persist_draft(
        db,
        case,
        target,
        user,
        note=f"Restored from version {snap.version}",
        snapshot_mode="always",
    )
    db.refresh(case)
    return _detail(db, case)


@router.post("/{case_id}/rebuild", response_model=CaseDetailOut)
def rebuild_draft(
    case_id: int,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    """Explicit rebuild from approved WACs — overwrites current draft after snapshot."""
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    wacs = parse_json_list(case.approved_wac_ids)
    if not wacs:
        raise HTTPException(status_code=400, detail="Select approved WACs before rebuilding the draft")
    if not (case.complaint_text or "").strip():
        raise HTTPException(status_code=400, detail="Complaint text is required to rebuild the draft")

    case.complaint_text = _apply_privacy_to_complaint(case, case.complaint_text or "")

    existing = report_from_json(case.current_report_json) if case.current_report_json else None
    if existing:
        save_snapshot(
            db,
            case,
            existing,
            user,
            note="Auto-snapshot before rebuild (investigator edits may be overwritten)",
        )

    prior_sod = existing.sod if existing else None
    report = build_investigation_report(
        db=db,
        complaint_text=case.complaint_text,
        selected_wacs=wacs,
        user_id=user.id,
        investigation_date=case.investigation_date or None,
        case_id=case.case_id_label or None,
        facility_address=case.facility_address or None,
        credential_number=case.credential_number or None,
    )
    # Preserve investigator SOD edits (findings / Based on) across rebuild when cites match.
    if prior_sod:
        from app.services.ir_format import sync_report_text
        from app.services.sod_draft import attach_sod_to_report

        report.sod = prior_sod
        attach_sod_to_report(report)
        sync_report_text(report)
    save_snapshot(db, case, report, user, note="Rebuilt from approved WACs")
    db.refresh(case)
    return _detail(db, case)


def _move_case_to_trash(db: Session, case: InvestigationCase, user: User) -> InvestigationCase:
    """Soft-delete: mark trashed. Allowed from any non-trashed status."""
    require_role_edit(user)
    if case.status == "trashed":
        return case
    return set_status(db, case, "trashed", user)


def _restore_case_from_shelf(db: Session, case: InvestigationCase, user: User) -> InvestigationCase:
    """Restore archived or trashed case to draft."""
    require_role_edit(user)
    if case.status not in {"archived", "trashed"}:
        raise HTTPException(status_code=400, detail="Only archived or trashed cases can be restored")
    return set_status(db, case, "draft", user)


@router.post("/{case_id}/trash", response_model=CaseDetailOut)
def trash_case(
    case_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move a case to trash (soft delete). Dedicated path — do not rely on /status alone."""
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    case = _move_case_to_trash(db, case, user)
    db.refresh(case)
    return _detail(db, case)


@router.post("/{case_id}/restore", response_model=CaseDetailOut)
def restore_case(
    case_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restore a case from archive or trash back to draft."""
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    case = _restore_case_from_shelf(db, case, user)
    db.refresh(case)
    return _detail(db, case)


@router.post("/{case_id}/status", response_model=CaseDetailOut)
def update_status(
    case_id: int,
    payload: CaseStatusUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    role = user_role(user)
    target = (payload.status or "").strip().lower()
    # Aliases
    if target == "trash":
        target = "trashed"

    if target == "in_review":
        require_role_edit(user)
        if case.status not in {"draft", "reopened"}:
            raise HTTPException(status_code=400, detail="Only draft/reopened cases can be submitted for review")
        report = _report_for_export(case)
        save_snapshot(db, case, report, user, note=payload.note or "Submitted for review")
        set_status(db, case, "in_review", user)
        _harvest_ir_style(db, case, report, user, trigger="submitted")
    elif target == "final":
        if case.status not in {"in_review", "draft", "reopened"}:
            raise HTTPException(status_code=400, detail="Cannot finalize from current status")
        if case.status == "in_review":
            if not can_review(role):
                raise HTTPException(status_code=403, detail="Only an admin can finalize an in-review case")
        else:
            require_role_edit(user)
        report = _report_for_export(case)
        block = _quote_integrity_blocks_finalize(report)
        if block:
            raise HTTPException(status_code=400, detail=block)
        save_snapshot(db, case, report, user, note=payload.note or "Marked final")
        set_status(db, case, "final", user)
        _harvest_ir_style(db, case, report, user, trigger="finalized")
    elif target == "reopened":
        require_role_edit(user)
        if case.status not in {"final", "in_review"}:
            raise HTTPException(status_code=400, detail="Only final or in-review cases can be reopened")
        set_status(db, case, "reopened", user)
        if case.current_report_json:
            existing = report_from_json(case.current_report_json)
            if existing:
                save_snapshot(db, case, existing, user, note=payload.note or "Reopened for editing")
    elif target == "draft":
        require_role_edit(user)
        if case.status != "reopened":
            raise HTTPException(status_code=400, detail="Use reopen before returning to draft")
        set_status(db, case, "draft", user)
    elif target == "archived":
        require_role_edit(user)
        if case.status == "trashed":
            raise HTTPException(status_code=400, detail="Restore from trash before archiving")
        set_status(db, case, "archived", user)
    elif target == "trashed":
        _move_case_to_trash(db, case, user)
    elif target == "restore":
        _restore_case_from_shelf(db, case, user)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported status transition: {target}")

    db.refresh(case)
    return _detail(db, case)


@router.delete("/{case_id}")
def delete_case(
    case_id: int,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    """Permanently delete a case. Prefer trash first; only trashed cases can be purged here."""
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    if case.status != "trashed":
        raise HTTPException(
            status_code=400,
            detail="Move the case to trash first, then permanently delete it from Trash.",
        )
    hard_delete_case(db, case)
    return {"ok": True, "deleted_id": case_id}


@router.post("/{case_id}/comments", response_model=CaseCommentOut)
def add_comment(
    case_id: int,
    payload: CaseCommentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    if case.status == "trashed":
        raise HTTPException(status_code=400, detail="Case is in trash. Restore it before adding comments.")
    comment = CaseComment(case_id=case.id, author_user_id=user.id, body=payload.body.strip())
    db.add(comment)
    case.updated_at = utcnow()
    db.add(case)
    db.commit()
    db.refresh(comment)
    return CaseCommentOut(
        id=comment.id,
        author_user_id=comment.author_user_id,
        author_username=user.username,
        body=comment.body,
        created_at=comment.created_at,
    )


@router.get("/{case_id}/defensibility", response_model=DefensibilityOut)
def defensibility(
    case_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    report = _report_for_export(case)
    selected = parse_json_list(case.approved_wac_ids) or [a.wac_code for a in report.allegations]
    integrity = verify_report_quotes(
        allegations=report.allegations,
        regulatory_framework=report.regulatory_framework or [],
        evidentiary_examples=report.evidentiary_examples or [],
        selected_codes=selected or None,
    )
    result = check_defensibility(report, quote_integrity=integrity.to_dict())
    return DefensibilityOut(**result)


@router.post("/{case_id}/export/docx")
def export_docx(
    case_id: int,
    acknowledge_gaps: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_role_export(user)
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_not_trashed(case, action="exporting")
    report = _report_for_export(case)
    selected = parse_json_list(case.approved_wac_ids) or [a.wac_code for a in report.allegations]
    verify_report_quotes(
        allegations=report.allegations,
        regulatory_framework=report.regulatory_framework or [],
        evidentiary_examples=report.evidentiary_examples or [],
        selected_codes=selected or None,
    )
    # Working drafts are always downloadable; gaps are assistive only.
    _ = acknowledge_gaps
    content = _export_ir_bytes(db, case, report)
    _harvest_ir_style(db, case, report, user, trigger="export_docx")
    filename = f"IR_{case.case_id_label or case.id}.docx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{case_id}/export/sod")
def export_sod(
    case_id: int,
    acknowledge_gaps: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Facility-facing Statement of Deficiency DOCX (POC column blank)."""
    require_role_export(user)
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_not_trashed(case, action="exporting")
    report = _report_for_export(case)
    _ = acknowledge_gaps
    content = build_sod_docx(report)
    filename = f"SOD_{case.case_id_label or case.id}.docx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{case_id}/export/pack")
def export_pack(
    case_id: int,
    acknowledge_gaps: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Multi-doc pack: IR DOCX + SOD DOCX (+ working cite sheet)."""
    require_role_export(user)
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_not_trashed(case, action="exporting")
    report = _report_for_export(case)
    selected = parse_json_list(case.approved_wac_ids) or [a.wac_code for a in report.allegations]
    from app.schemas import InvestigationAllegation

    # Quote-check Compare cite-first drafts (IR categorical lines are not statute quotes).
    cite_allegations = [
        InvestigationAllegation(
            wac_code=c.code,
            wac_title=c.title,
            allegation_text=c.allegation_draft,
            matched_subsections=list(c.matched_subsections or []),
        )
        for c in (report.comparisons or [])
        if (c.allegation_draft or "").strip()
    ]
    verify_report_quotes(
        allegations=cite_allegations
        or [
            InvestigationAllegation(
                wac_code=a.wac_code,
                wac_title=a.wac_title,
                allegation_text=a.allegation_text,
                matched_subsections=list(a.matched_subsections or []),
            )
            for a in (report.allegations or [])
        ],
        regulatory_framework=report.regulatory_framework or [],
        evidentiary_examples=report.evidentiary_examples or [],
        selected_codes=selected or None,
    )
    # Working drafts are always downloadable; gaps are assistive only.
    _ = acknowledge_gaps

    ir = _export_ir_bytes(db, case, report)
    sod_bytes = build_sod_docx(report)
    cites = build_deficiency_cite_sheet(report)
    _harvest_ir_style(db, case, report, user, trigger="export_pack")
    buf = BytesIO()
    label = case.case_id_label or case.id
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"IR_{label}.docx", ir)
        zf.writestr(f"SOD_{label}.docx", sod_bytes)
        zf.writestr(f"Deficiency_Cite_Sheet_{label}.docx", cites)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="case_{label}_pack.zip"'
        },
    )


@router.post("/{case_id}/evidence", response_model=EvidenceOut)
async def upload_evidence(
    case_id: int,
    title: str = Form(""),
    notes: str = Form(""),
    linked_wac_ids: str = Form("[]"),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)

    filename = file.filename or "upload.bin"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EVIDENCE_EXT:
        raise HTTPException(status_code=400, detail=f"File type not allowed: {ext or '(none)'}")

    data = await file.read()
    max_bytes = settings.case_upload_max_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.case_upload_max_mb} MB limit")

    data, privacy_note = _scan_evidence_payload(filename, data)

    try:
        links = json.loads(linked_wac_ids) if linked_wac_ids.strip().startswith("[") else [
            s.strip() for s in linked_wac_ids.split(",") if s.strip()
        ]
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid linked_wac_ids") from exc

    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", Path(filename).stem)[:80] or "evidence"
    dest_dir = evidence_dir(case.id)
    dest = dest_dir / f"{utcnow().strftime('%Y%m%d%H%M%S')}_{safe}{ext}"
    dest.write_bytes(data)

    ev = CaseEvidence(
        case_id=case.id,
        title=(title or filename).strip(),
        original_filename=filename,
        stored_path=str(dest.relative_to(settings.cases_dir)),
        content_type=file.content_type or "",
        linked_wac_ids=dumps_list(links),
        notes=((notes or "").strip() + privacy_note).strip(),
        uploaded_by=user.id,
    )
    db.add(ev)
    case.updated_at = utcnow()
    db.add(case)
    db.commit()
    db.refresh(ev)
    return EvidenceOut(
        id=ev.id,
        title=ev.title,
        original_filename=ev.original_filename or "",
        content_type=ev.content_type or "",
        linked_wac_ids=parse_json_list(ev.linked_wac_ids),
        notes=ev.notes or "",
        created_at=ev.created_at,
    )


@router.post("/{case_id}/evidence/review", response_model=EvidenceReviewResponse)
def review_evidence_against_report(
    case_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rank exhibit text against allegation and Regulatory Framework duties."""
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    report = report_from_json(case.current_report_json)
    files = list(case.evidence or [])
    if not report:
        raise HTTPException(
            status_code=400,
            detail="Draft a report from Intake before reviewing evidence against allegations.",
        )
    if not files:
        return EvidenceReviewResponse(
            hits=[],
            evidence_count=0,
            scanned_count=0,
            skipped_images=0,
            message=(
                "No exhibits attached. Investigation Report and Statement of Deficiencies "
                "stay available. Attach files when you have them, or return to Documents."
            ),
        )
    skipped = 0
    scanned = 0
    for ev in files:
        name = (ev.original_filename or "").lower()
        if Path(name).suffix in {".png", ".jpg", ".jpeg", ".webp"}:
            skipped += 1
            continue
        if extract_evidence_text(ev).strip():
            scanned += 1
    hits = review_case_evidence(case, report)
    if not hits:
        message = (
            "No exhibit language matched the Washington WAC/RCW duty text from the local "
            "statute store. Other-state citations in a policy are ignored. You can still "
            "continue to Documents."
        )
    else:
        message = (
            "Suggested excerpts are exhibit language that matches the cited Washington "
            "duty in the local WAC/RCW store. Select what applies; this is assistive "
            "record review, not a finding and not statute authority."
        )
    return EvidenceReviewResponse(
        hits=hits,
        evidence_count=len(files),
        scanned_count=scanned,
        skipped_images=skipped,
        message=message,
    )


@router.delete("/{case_id}/evidence/{evidence_id}")
def delete_evidence(
    case_id: int,
    evidence_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    ev = (
        db.query(CaseEvidence)
        .filter(CaseEvidence.id == evidence_id, CaseEvidence.case_id == case_id)
        .first()
    )
    if not ev:
        raise HTTPException(status_code=404, detail="Evidence not found")
    path = settings.cases_dir / ev.stored_path
    if path.exists():
        path.unlink()
    db.delete(ev)
    db.commit()
    return {"ok": True}


@router.post("/{case_id}/process-entries", response_model=ProcessEntryOut)
def add_process_entry(
    case_id: int,
    payload: ProcessEntryCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    order = len(case.process_entries)
    entry = CaseProcessEntry(
        case_id=case.id,
        activity_date=payload.activity_date,
        activity_type=payload.activity_type,
        who=payload.who,
        summary=payload.summary,
        sort_order=order,
    )
    db.add(entry)
    case.updated_at = utcnow()
    db.add(case)
    db.commit()
    db.refresh(entry)
    return ProcessEntryOut.model_validate(entry)


@router.post("/{case_id}/process-entries/apply")
def apply_process_to_report(
    case_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compose process bullets + exhibit lines into the editable IR (investigator may rewrite)."""
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    report = _report_for_export(case)
    bullets = process_entries_to_bullets(list(case.process_entries))
    process = list(report.investigative_process or [])
    if bullets:
        process = merge_process_activity_bullets(process, bullets)
    files = list(case.evidence or [])
    if files:
        from app.services.evidence_review import (
            extract_document_date,
            extract_evidence_text,
            merge_exhibit_process_lines,
        )

        report.investigative_process = merge_exhibit_process_lines(
            process,
            [
                {
                    "evidence_id": ev.id,
                    "evidence_title": ev.title or ev.original_filename or f"document {ev.id}",
                    "document_date": extract_document_date(extract_evidence_text(ev)),
                    "excerpt": "",
                }
                for ev in files
            ],
        )
    else:
        report.investigative_process = process
    save_snapshot(db, case, report, user, note="Applied process/evidence assists into draft")
    return _detail(db, case)


@router.delete("/{case_id}/process-entries/{entry_id}")
def delete_process_entry(
    case_id: int,
    entry_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    assert_case_access(case, user)
    assert_case_editable(case, user)
    entry = (
        db.query(CaseProcessEntry)
        .filter(CaseProcessEntry.id == entry_id, CaseProcessEntry.case_id == case_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Process entry not found")
    db.delete(entry)
    db.commit()
    return {"ok": True}


@router.post("/retention/run")
def run_retention(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    archived = archive_stale_final_cases(db)
    purged = purge_trashed_cases(db)
    return {
        "archived": archived,
        "retention_days": settings.case_retention_days,
        "trash_purged": purged,
        "trash_retention_days": settings.case_trash_retention_days,
    }
