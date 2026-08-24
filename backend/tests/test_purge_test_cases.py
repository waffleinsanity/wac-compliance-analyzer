"""Harness case purge: scrub pytest leftovers without touching real cases."""

from __future__ import annotations

from app.database import InvestigationCase, User
from app.services.case_store import (
    TEST_HARNESS_USERNAMES,
    hard_delete_case,
    purge_cases_owned_by_usernames,
)


def test_purge_cases_owned_by_usernames_removes_only_harness(db, auth_user):
    other = db.query(User).filter(User.username == "purge_keep_owner").first()
    if not other:
        other = User(
            username="purge_keep_owner",
            email="purge_keep@localhost",
            hashed_password="",
            is_admin=False,
            is_active=True,
            role="editor",
        )
        db.add(other)
        db.commit()
        db.refresh(other)

    keep = InvestigationCase(
        owner_user_id=other.id,
        case_id_label="KEEP-REAL",
        title="Real investigator case",
        complaint_text="keep",
        status="draft",
        status_changed_by=other.id,
    )
    junk = InvestigationCase(
        owner_user_id=auth_user.id,
        case_id_label="EL-TEST-PURGE",
        title="Evidence log case",
        complaint_text="junk",
        status="trashed",
        status_changed_by=auth_user.id,
    )
    db.add_all([keep, junk])
    db.commit()
    db.refresh(keep)
    db.refresh(junk)
    keep_id, junk_id = keep.id, junk.id

    removed = purge_cases_owned_by_usernames(db, TEST_HARNESS_USERNAMES)
    assert removed >= 1
    assert db.query(InvestigationCase).filter(InvestigationCase.id == junk_id).first() is None
    assert db.query(InvestigationCase).filter(InvestigationCase.id == keep_id).first() is not None

    hard_delete_case(db, keep)
    leftover = db.query(User).filter(User.username == "purge_keep_owner").first()
    if leftover:
        db.delete(leftover)
        db.commit()
