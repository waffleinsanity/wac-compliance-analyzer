"""Cross-user WAC usage counters for directory statistics."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.database import InvestigationCase, SelectionHistory, UsageStat, utcnow
from app.services.case_store import parse_json_list


def _normalize_ids(wac_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in wac_ids:
        wid = (raw or "").strip()
        if not wid or wid in seen:
            continue
        seen.add(wid)
        out.append(wid)
    return out


def bump_usage(db: Session, wac_ids: list[str], stat_type: str = "selected") -> None:
    """Increment platform-wide counters for the given WAC ids."""
    ids = _normalize_ids(wac_ids)
    if not ids:
        return
    now = utcnow()
    for wid in ids:
        row = (
            db.query(UsageStat)
            .filter(UsageStat.wac_id == wid, UsageStat.stat_type == stat_type)
            .first()
        )
        if row:
            row.count = int(row.count or 0) + 1
            row.last_used = now
            db.add(row)
        else:
            db.add(
                UsageStat(
                    wac_id=wid,
                    stat_type=stat_type,
                    count=1,
                    last_used=now,
                )
            )
    db.commit()


def record_selection(
    db: Session,
    *,
    user_id: int | None,
    wac_ids: list[str],
    stat_type: str = "selected",
) -> None:
    """Record a generation-time selection for stats (+ optional per-user history)."""
    ids = _normalize_ids(wac_ids)
    if not ids:
        return
    bump_usage(db, ids, stat_type=stat_type)
    if user_id:
        db.add(
            SelectionHistory(
                user_id=user_id,
                selected_wacs=json.dumps(ids),
                created_at=utcnow(),
            )
        )
        db.commit()


def top_wacs(
    db: Session,
    *,
    limit: int = 25,
    stat_type: str = "selected",
) -> list[dict[str, Any]]:
    rows = (
        db.query(UsageStat)
        .filter(UsageStat.stat_type == stat_type)
        .order_by(UsageStat.count.desc(), UsageStat.last_used.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "wac_id": r.wac_id,
            "count": int(r.count or 0),
            "last_used": r.last_used.isoformat() if r.last_used else None,
            "stat_type": r.stat_type,
        }
        for r in rows
    ]


def usage_counts_map(db: Session, stat_type: str = "selected") -> dict[str, int]:
    rows = db.query(UsageStat).filter(UsageStat.stat_type == stat_type).all()
    return {r.wac_id: int(r.count or 0) for r in rows}


def backfill_from_cases(db: Session) -> int:
    """Seed usage_stats from existing case approved WAC lists (idempotent-ish via replace)."""
    # Only seed when empty so we don't double-count live traffic.
    existing = db.query(UsageStat).filter(UsageStat.stat_type == "selected").count()
    if existing > 0:
        return 0

    counts: dict[str, int] = {}
    cases = db.query(InvestigationCase).all()
    for case in cases:
        for wid in parse_json_list(case.approved_wac_ids):
            counts[wid] = counts.get(wid, 0) + 1

    now = utcnow()
    for wid, n in counts.items():
        db.add(
            UsageStat(
                wac_id=wid,
                stat_type="selected",
                count=n,
                last_used=now,
            )
        )
    if counts:
        db.commit()
    return len(counts)
