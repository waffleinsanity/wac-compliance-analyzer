"""User Investigation Report template library."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.auth import get_current_user, get_editor_user
from app.database import User, get_db, utcnow
from app.schemas import IrTemplateOut, IrTemplatePatch
from app.services.ir_templates import (
    create_library_template,
    delete_template,
    get_template_or_404,
    list_user_templates,
    promote_to_library,
    read_docx_upload,
    set_default_template,
    template_to_out,
)

router = APIRouter(prefix="/api/ir-templates", tags=["ir-templates"])


@router.get("", response_model=list[IrTemplateOut])
def list_templates(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return [template_to_out(r) for r in list_user_templates(db, user)]


@router.post("", response_model=IrTemplateOut)
async def upload_template(
    name: str = Form(""),
    file: UploadFile = File(...),
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    filename, data = await read_docx_upload(file)
    row = create_library_template(
        db,
        user,
        filename=filename,
        data=data,
        name=name,
        content_type=file.content_type or "",
    )
    return template_to_out(row)


@router.get("/{template_id}", response_model=IrTemplateOut)
def get_template(
    template_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return template_to_out(get_template_or_404(db, template_id, user))


@router.patch("/{template_id}", response_model=IrTemplateOut)
def patch_template(
    template_id: int,
    payload: IrTemplatePatch,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    if payload.is_default is True:
        row = set_default_template(db, user, template_id)
        if payload.name is not None and payload.name.strip():
            row.name = payload.name.strip()[:255]
            row.updated_at = utcnow()
            db.add(row)
            db.commit()
            db.refresh(row)
        return template_to_out(row)

    row = get_template_or_404(db, template_id, user)
    if payload.name is not None and payload.name.strip():
        row.name = payload.name.strip()[:255]
    if payload.is_default is False:
        row.is_default = False
    row.updated_at = utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return template_to_out(row)


@router.post("/{template_id}/promote", response_model=IrTemplateOut)
def promote_template(
    template_id: int,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    return template_to_out(promote_to_library(db, user, template_id))


@router.delete("/{template_id}")
def remove_template(
    template_id: int,
    user: User = Depends(get_editor_user),
    db: Session = Depends(get_db),
):
    delete_template(db, user, template_id)
    return {"ok": True}
