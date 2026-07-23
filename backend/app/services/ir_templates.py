"""Persist and resolve user Investigation Report DOCX templates."""

from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.database import InvestigationCase, IrTemplate, User, utcnow
from app.schemas import IrTemplateOut
from app.services.case_store import (
    case_ir_template_dir,
    resolve_data_path,
    user_ir_templates_dir,
)
from app.services.template_fill import SectionMap, detect_sections_from_bytes


def _section_map_fields(raw: str | None) -> tuple[list[str], int, list[str]]:
    sm = SectionMap.from_json(raw)
    if not sm:
        return [], 0, []
    return [s.key for s in sm.sections], sm.core_count, list(sm.warnings)


def template_to_out(row: IrTemplate) -> IrTemplateOut:
    keys, core, warnings = _section_map_fields(row.section_map_json)
    return IrTemplateOut(
        id=row.id,
        name=row.name or "",
        original_filename=row.original_filename or "",
        content_type=row.content_type or "",
        source=row.source or "library",
        case_id=row.case_id,
        is_default=bool(row.is_default),
        section_keys=keys,
        core_count=core,
        warnings=warnings,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def get_template_or_404(db: Session, template_id: int, user: User) -> IrTemplate:
    from app.permissions import is_admin_role, user_role

    row = db.query(IrTemplate).filter(IrTemplate.id == template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    if not is_admin_role(user_role(user)) and row.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Template not found")
    return row


def list_user_templates(db: Session, user: User) -> list[IrTemplate]:
    return (
        db.query(IrTemplate)
        .filter(IrTemplate.owner_user_id == user.id)
        .order_by(IrTemplate.is_default.desc(), IrTemplate.updated_at.desc())
        .all()
    )


async def read_docx_upload(file: UploadFile) -> tuple[str, bytes]:
    filename = file.filename or "template.docx"
    ext = Path(filename).suffix.lower()
    if ext != ".docx":
        raise HTTPException(status_code=400, detail="Only .docx Investigation Report templates are supported")
    data = await file.read()
    max_bytes = settings.case_upload_max_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.case_upload_max_mb} MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    return filename, data


def _safe_stem(filename: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", Path(filename).stem)[:80] or "template"


def create_library_template(
    db: Session,
    user: User,
    *,
    filename: str,
    data: bytes,
    name: str = "",
    content_type: str = "",
) -> IrTemplate:
    section_map = detect_sections_from_bytes(data)
    row = IrTemplate(
        owner_user_id=user.id,
        name=(name or Path(filename).stem or "Investigation Report template").strip()[:255],
        original_filename=filename,
        stored_path="",  # set after id
        content_type=content_type or "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        section_map_json=section_map.to_json(),
        source="library",
        case_id=None,
        is_default=False,
    )
    db.add(row)
    db.flush()
    dest_dir = user_ir_templates_dir(user.id)
    dest = dest_dir / f"{row.id}_{_safe_stem(filename)}.docx"
    dest.write_bytes(data)
    row.stored_path = str(dest.relative_to(settings.data_dir)).replace("\\", "/")
    row.updated_at = utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def create_case_template(
    db: Session,
    user: User,
    case: InvestigationCase,
    *,
    filename: str,
    data: bytes,
    name: str = "",
    content_type: str = "",
) -> IrTemplate:
    section_map = detect_sections_from_bytes(data)
    row = IrTemplate(
        owner_user_id=user.id,
        name=(name or Path(filename).stem or f"Case {case.id} template").strip()[:255],
        original_filename=filename,
        stored_path="",
        content_type=content_type
        or "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        section_map_json=section_map.to_json(),
        source="case",
        case_id=case.id,
        is_default=False,
    )
    db.add(row)
    db.flush()
    dest = case_ir_template_dir(case.id) / "ir_template.docx"
    dest.write_bytes(data)
    row.stored_path = str(dest.relative_to(settings.data_dir)).replace("\\", "/")
    case.ir_template_id = row.id
    case.updated_at = utcnow()
    db.add(row)
    db.add(case)
    db.commit()
    db.refresh(row)
    return row


def set_default_template(db: Session, user: User, template_id: int) -> IrTemplate:
    row = get_template_or_404(db, template_id, user)
    db.query(IrTemplate).filter(
        IrTemplate.owner_user_id == user.id,
        IrTemplate.is_default.is_(True),
    ).update({"is_default": False})
    row.is_default = True
    row.updated_at = utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_template(db: Session, user: User, template_id: int) -> None:
    row = get_template_or_404(db, template_id, user)
    # Unbind cases that reference it
    cases = (
        db.query(InvestigationCase)
        .filter(InvestigationCase.ir_template_id == template_id)
        .all()
    )
    for case in cases:
        case.ir_template_id = None
        case.updated_at = utcnow()
        db.add(case)
    path = resolve_data_path(row.stored_path)
    db.delete(row)
    db.commit()
    try:
        if path.is_file():
            path.unlink()
    except OSError:
        pass


def bind_case_template(
    db: Session,
    case: InvestigationCase,
    user: User,
    template_id: int | None,
) -> InvestigationCase:
    if template_id is None:
        case.ir_template_id = None
    else:
        row = get_template_or_404(db, template_id, user)
        case.ir_template_id = row.id
    case.updated_at = utcnow()
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


def resolve_case_template_path(db: Session, case: InvestigationCase) -> Path | None:
    tid = getattr(case, "ir_template_id", None)
    if not tid:
        return None
    row = db.query(IrTemplate).filter(IrTemplate.id == tid).first()
    if not row or not row.stored_path:
        return None
    path = resolve_data_path(row.stored_path)
    if not path.is_file():
        return None
    return path


def promote_to_library(db: Session, user: User, template_id: int) -> IrTemplate:
    """Copy a case-scoped template into the user's library."""
    row = get_template_or_404(db, template_id, user)
    path = resolve_data_path(row.stored_path)
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Template file missing on disk")
    data = path.read_bytes()
    return create_library_template(
        db,
        user,
        filename=row.original_filename or "template.docx",
        data=data,
        name=row.name,
        content_type=row.content_type or "",
    )


def parse_section_map_raw(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}
