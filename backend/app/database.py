from datetime import datetime, timezone
import logging

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=True)
    display_name = Column(String(128), nullable=True)
    role = Column(String(32), default="editor", nullable=False, index=True)  # admin|editor|viewer
    hashed_password = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    theme_preference = Column(String(16), default="system")
    is_admin = Column(Boolean, default=False, nullable=False)  # legacy mirror of role==admin
    is_active = Column(Boolean, default=True, nullable=False)
    google_sub = Column(String(255), unique=True, nullable=True)
    must_change_password = Column(Boolean, default=False, nullable=False)
    password_reset_token_hash = Column(String(128), nullable=True)
    password_reset_expires = Column(DateTime(timezone=True), nullable=True)
    failed_login_count = Column(Integer, default=0, nullable=False)
    lockout_until = Column(DateTime(timezone=True), nullable=True)

    favorites = relationship("Favorite", back_populates="user", cascade="all, delete-orphan")
    custom_phrases = relationship(
        "CustomTriggerPhrase", back_populates="user", cascade="all, delete-orphan"
    )
    selection_history = relationship(
        "SelectionHistory", back_populates="user", cascade="all, delete-orphan"
    )


class WACCodeRecord(Base):
    __tablename__ = "wac_codes"

    id = Column(String(128), primary_key=True)  # e.g. WAC 246-341-0420(1)(a)
    chapter = Column(String(16), index=True)
    code = Column(String(32), index=True)
    title = Column(String(512))
    text = Column(Text)
    level = Column(String(16), index=True)
    parent_id = Column(String(128), nullable=True, index=True)
    hierarchy_path = Column(String(256))
    primary_label = Column(String(8), nullable=True)
    secondary_label = Column(String(8), nullable=True)
    tertiary_label = Column(String(8), nullable=True)
    version_date = Column(String(32), nullable=True)
    certified_date = Column(String(32), nullable=True)
    source_file = Column(String(128), nullable=True)
    auto_trigger_phrases = Column(Text, default="[]")  # JSON list
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("user_id", "wac_id", name="uq_user_favorite"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wac_id = Column(String(128), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    user = relationship("User", back_populates="favorites")


class CustomTriggerPhrase(Base):
    __tablename__ = "custom_trigger_phrases"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    wac_id = Column(String(128), nullable=False, index=True)
    phrase = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user = relationship("User", back_populates="custom_phrases")


class SelectionHistory(Base):
    __tablename__ = "selection_history"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    selected_wacs = Column(Text, nullable=False)  # JSON list
    created_at = Column(DateTime(timezone=True), default=utcnow)

    user = relationship("User", back_populates="selection_history")


class UsageStat(Base):
    __tablename__ = "usage_stats"
    __table_args__ = (UniqueConstraint("wac_id", "stat_type", name="uq_wac_stat"),)

    id = Column(Integer, primary_key=True)
    wac_id = Column(String(128), nullable=False, index=True)
    stat_type = Column(String(32), nullable=False)  # selected | matched | analyzed
    count = Column(Integer, default=0)
    last_used = Column(DateTime(timezone=True), default=utcnow)


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    document_name = Column(String(255), nullable=True)
    selected_count = Column(Integer, default=0)
    result_count = Column(Integer, default=0)
    duration_ms = Column(Float, default=0)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class InvestigationCase(Base):
    """Persistent investigation drafting workspace (assistive — not auto-final)."""

    __tablename__ = "investigation_cases"

    id = Column(Integer, primary_key=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    case_id_label = Column(String(128), default="", index=True)
    title = Column(String(255), default="")
    status = Column(String(32), default="draft", index=True)  # draft|in_review|final|reopened|archived|trashed
    complaint_text = Column(Text, default="")
    investigation_date = Column(String(128), default="")
    facility_address = Column(String(512), default="")
    credential_number = Column(String(128), default="")
    approved_wac_ids = Column(Text, default="[]")  # JSON list
    current_report_json = Column(Text, nullable=True)  # latest editable IR JSON
    privacy_acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    privacy_redaction_note = Column(String(512), default="")
    status_changed_at = Column(DateTime(timezone=True), default=utcnow)
    status_changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    trashed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    snapshots = relationship(
        "CaseReportSnapshot", back_populates="case", cascade="all, delete-orphan"
    )
    evidence = relationship("CaseEvidence", back_populates="case", cascade="all, delete-orphan")
    process_entries = relationship(
        "CaseProcessEntry", back_populates="case", cascade="all, delete-orphan"
    )
    comments = relationship("CaseComment", back_populates="case", cascade="all, delete-orphan")


class CaseReportSnapshot(Base):
    __tablename__ = "case_report_snapshots"

    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, ForeignKey("investigation_cases.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    report_json = Column(Text, nullable=False)
    report_text = Column(Text, default="")
    note = Column(String(512), default="")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    case = relationship("InvestigationCase", back_populates="snapshots")


class CaseEvidence(Base):
    __tablename__ = "case_evidence"

    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, ForeignKey("investigation_cases.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    original_filename = Column(String(255), default="")
    stored_path = Column(String(512), nullable=False)
    content_type = Column(String(128), default="")
    linked_wac_ids = Column(Text, default="[]")  # JSON
    notes = Column(Text, default="")
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    case = relationship("InvestigationCase", back_populates="evidence")


class CaseProcessEntry(Base):
    __tablename__ = "case_process_entries"

    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, ForeignKey("investigation_cases.id"), nullable=False, index=True)
    activity_date = Column(String(64), default="")
    activity_type = Column(String(64), default="record_review")  # interview|record_review|site_visit|other
    who = Column(String(255), default="")
    summary = Column(Text, default="")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    case = relationship("InvestigationCase", back_populates="process_entries")


class CaseComment(Base):
    __tablename__ = "case_comments"

    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, ForeignKey("investigation_cases.id"), nullable=False, index=True)
    author_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    case = relationship("InvestigationCase", back_populates="comments")


class IrLearningSnippet(Base):
    """Evolving IR writing-style bank harvested from completed/exported reports.

    Statute duty wording still comes only from PDF-ingested WAC/RCW nodes.
    These rows capture investigator-adjusted shell/shape (connectors, themes,
    intake voice, process lines) so future drafts improve with use.
    """

    __tablename__ = "ir_learning_snippets"
    __table_args__ = (
        UniqueConstraint(
            "section_type",
            "wac_code",
            "content_hash",
            name="uq_ir_learning_snippet_hash",
        ),
    )

    id = Column(Integer, primary_key=True)
    source_case_id = Column(Integer, ForeignKey("investigation_cases.id"), nullable=True, index=True)
    source_snapshot_id = Column(Integer, ForeignKey("case_report_snapshots.id"), nullable=True)
    harvested_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    trigger_event = Column(String(64), default="", index=True)  # export_docx|export_pack|submitted|finalized
    section_type = Column(String(64), nullable=False, index=True)
    # allegation_shape|intake_voice|process_line|preamble|summary_opener|wac_language
    wac_code = Column(String(64), default="", index=True)
    themes_json = Column(Text, default="[]")
    connector = Column(String(64), default="")
    text_excerpt = Column(Text, default="")
    uses_a_prefix = Column(Boolean, default=False)
    has_subsection_cites = Column(Boolean, default=False)
    content_hash = Column(String(64), nullable=False, index=True)
    weight = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class InviteCode(Base):
    """Single-use or limited invite codes for gated signup (Navy EHIP pattern)."""

    __tablename__ = "invite_codes"

    id = Column(Integer, primary_key=True)
    code = Column(String(32), unique=True, nullable=False, index=True)
    role = Column(String(32), default="viewer", nullable=False)  # admin|editor|viewer
    max_uses = Column(Integer, default=1, nullable=False)
    used_count = Column(Integer, default=0, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    note = Column(String(255), default="")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class AccessRequest(Base):
    """Users request role elevation; admins approve/deny."""

    __tablename__ = "access_requests"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    requested_role = Column(String(32), nullable=False)  # editor|admin
    justification = Column(Text, default="")
    status = Column(String(32), default="pending", index=True)  # pending|approved|denied|withdrawn
    admin_note = Column(Text, default="")
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class BugReport(Base):
    __tablename__ = "bug_reports"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    page_url = Column(String(1024), default="")
    user_agent = Column(String(512), default="")
    viewport_json = Column(Text, default="{}")
    diagnostics_json = Column(Text, default="{}")
    screenshot_path = Column(String(512), nullable=True)
    status = Column(String(32), default="open", index=True)  # open|in_progress|resolved|closed
    admin_note = Column(Text, default="")
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class UserFeedback(Base):
    __tablename__ = "user_feedback"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String(64), default="suggestion", index=True)
    subject = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    page_url = Column(String(1024), default="")
    status = Column(String(32), default="new", index=True)  # new|read|archived
    admin_note = Column(Text, default="")
    read_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String(128), nullable=False, index=True)
    entity_type = Column(String(64), default="", index=True)
    entity_id = Column(String(64), default="")
    details = Column(Text, default="")
    outcome = Column(String(32), default="ok")  # ok|error|denied
    ip_address = Column(String(64), default="")
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)


engine = create_engine(
    f"sqlite:///{settings.sqlite_path}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _migrate_users_table() -> None:
    """Add new auth columns to existing SQLite DBs (create_all does not alter)."""
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return
    existing = {col["name"] for col in insp.get_columns("users")}
    alters: list[tuple[str, str]] = [
        ("is_admin", "ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"),
        ("is_active", "ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1"),
        ("google_sub", "ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"),
        ("must_change_password", "ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT 0"),
        ("password_reset_token_hash", "ALTER TABLE users ADD COLUMN password_reset_token_hash VARCHAR(128)"),
        ("password_reset_expires", "ALTER TABLE users ADD COLUMN password_reset_expires DATETIME"),
        ("display_name", "ALTER TABLE users ADD COLUMN display_name VARCHAR(128)"),
        ("role", "ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'editor'"),
        ("failed_login_count", "ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0"),
        ("lockout_until", "ALTER TABLE users ADD COLUMN lockout_until DATETIME"),
    ]
    with engine.begin() as conn:
        for name, sql in alters:
            if name not in existing:
                conn.execute(text(sql))
                logger.info("Migrated users.%s", name)

    # Backfill role from legacy is_admin when role is missing/blank.
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE users SET role = 'admin' "
                "WHERE (role IS NULL OR role = '' OR role = 'editor') AND is_admin = 1"
            )
        )
        conn.execute(
            text(
                "UPDATE users SET role = 'editor' "
                "WHERE role IS NULL OR role = ''"
            )
        )
        conn.execute(text("UPDATE users SET is_admin = 1 WHERE role = 'admin'"))
        conn.execute(text("UPDATE users SET is_admin = 0 WHERE role != 'admin'"))


def _migrate_cases_table() -> None:
    insp = inspect(engine)
    if "investigation_cases" not in insp.get_table_names():
        return
    existing = {col["name"] for col in insp.get_columns("investigation_cases")}
    alters: list[tuple[str, str]] = [
        (
            "privacy_acknowledged_at",
            "ALTER TABLE investigation_cases ADD COLUMN privacy_acknowledged_at DATETIME",
        ),
        (
            "privacy_redaction_note",
            "ALTER TABLE investigation_cases ADD COLUMN privacy_redaction_note VARCHAR(512) DEFAULT ''",
        ),
        (
            "trashed_at",
            "ALTER TABLE investigation_cases ADD COLUMN trashed_at DATETIME",
        ),
    ]
    with engine.begin() as conn:
        for name, sql in alters:
            if name not in existing:
                conn.execute(text(sql))
                logger.info("Migrated investigation_cases.%s", name)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_users_table()
    _migrate_cases_table()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
