from datetime import datetime, timezone

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
)
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker

from app.config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=True)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    theme_preference = Column(String(16), default="system")

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


engine = create_engine(
    f"sqlite:///{settings.sqlite_path}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
