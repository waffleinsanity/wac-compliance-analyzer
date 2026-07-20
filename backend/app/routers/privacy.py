from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import User, get_db
from app.schemas import (
    PrivacyRedactRequest,
    PrivacyRedactResponse,
    PrivacyScanRequest,
    PrivacyScanResponse,
)
from app.services.audit import log_action
from app.services.pii_gate import redact_text, scan_text

router = APIRouter(prefix="/api/privacy", tags=["privacy"])


@router.post("/scan", response_model=PrivacyScanResponse)
def privacy_scan(
    payload: PrivacyScanRequest,
    _: User = Depends(get_current_user),
):
    """Scan text for Cat 3/4 PII/PHI patterns. Text is not stored."""
    result = scan_text(payload.text or "")
    return PrivacyScanResponse(**result)


@router.post("/redact", response_model=PrivacyRedactResponse)
def privacy_redact(
    payload: PrivacyRedactRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Apply server-side redaction tokens for detected Cat 3/4 spans."""
    result = redact_text(payload.text or "", hit_ids=payload.hit_ids)
    # Audit kinds/counts only — never raw PII.
    kinds = sorted({a.get("kind", "") for a in result.get("applied") or [] if a.get("kind")})
    log_action(
        db,
        user_id=user.id,
        action="privacy.redact",
        entity_type="complaint_text",
        entity_id="",
        details=f"applied={result.get('applied_count', 0)} kinds={','.join(kinds)}",
    )
    return PrivacyRedactResponse(**result)
