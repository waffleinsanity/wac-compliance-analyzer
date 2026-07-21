from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user, get_optional_user
from app.database import Favorite, User, get_db
from app.permissions import is_admin_role, user_role
from app.rag.store import wac_store
from app.schemas import FavoriteToggle, WACNodeOut, WACUsageStatOut, WACUsageStatsResponse
from app.services.usage_stats import top_wacs, usage_counts_map

router = APIRouter(prefix="/api/wacs", tags=["wacs"])


def _favorites_set(db: Session, user: User | None) -> set[str]:
    if not user:
        return set()
    return {f.wac_id for f in db.query(Favorite).filter(Favorite.user_id == user.id).all()}


def _node_out(n, favs: set[str], usage: dict[str, int] | None = None) -> WACNodeOut:
    usage = usage or {}
    return WACNodeOut(
        id=n.id,
        chapter=n.chapter,
        code=n.code,
        title=n.title,
        text=n.text,
        level=n.level,
        parent_id=n.parent_id,
        hierarchy_path=n.hierarchy_path,
        primary=n.primary,
        secondary=n.secondary,
        tertiary=n.tertiary,
        version_date=n.version_date,
        certified_date=n.certified_date,
        trigger_phrases=n.trigger_phrases,
        custom_trigger_phrases=[],
        is_favorite=n.id in favs or n.code in favs,
        usage_count=usage.get(n.id, 0) or usage.get(n.code, 0) or 0,
    )


@router.get("/stats/popular", response_model=WACUsageStatsResponse)
def popular_wacs(
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Org-wide selection stats — admin only (avoids leaking other investigators' patterns)."""
    if not is_admin_role(user_role(user)):
        return WACUsageStatsResponse(items=[], total_tracked=0)
    rows = top_wacs(db, limit=limit, stat_type="selected")
    enriched: list[WACUsageStatOut] = []
    for row in rows:
        node = wac_store.nodes.get(row["wac_id"]) or wac_store.code_index.get(row["wac_id"])
        enriched.append(
            WACUsageStatOut(
                wac_id=row["wac_id"],
                code=node.code if node else row["wac_id"],
                title=node.title if node else "",
                chapter=node.chapter if node else "",
                count=row["count"],
                last_used=row.get("last_used"),
                stat_type=row.get("stat_type") or "selected",
            )
        )
    return WACUsageStatsResponse(items=enriched, total_tracked=len(usage_counts_map(db)))


@router.get("", response_model=list[WACNodeOut])
def list_wacs(
    chapter: str | None = None,
    q: str | None = None,
    level: str = "code",
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    favs = _favorites_set(db, user)
    # Usage counts reflect org-wide case activity — only expose to admins.
    usage = usage_counts_map(db) if user and is_admin_role(user_role(user)) else {}
    nodes = list(wac_store.nodes.values())
    if level:
        nodes = [n for n in nodes if n.level == level]
    if chapter:
        nodes = [n for n in nodes if n.chapter == chapter.replace("WAC ", "")]
    if q:
        ql = q.lower()
        nodes = [
            n
            for n in nodes
            if ql in n.id.lower() or ql in n.title.lower() or ql in n.code.lower() or ql in (n.chapter or "").lower()
        ]
    nodes = sorted(nodes, key=lambda n: (n.chapter, n.code, n.hierarchy_path))
    return [_node_out(n, favs, usage) for n in nodes]


@router.post("/favorites/toggle")
def toggle_favorite(
    payload: FavoriteToggle,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(Favorite)
        .filter(Favorite.user_id == user.id, Favorite.wac_id == payload.wac_id)
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
        return {"wac_id": payload.wac_id, "favorited": False}
    db.add(Favorite(user_id=user.id, wac_id=payload.wac_id))
    db.commit()
    return {"wac_id": payload.wac_id, "favorited": True}
