import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user, get_optional_user
from app.database import CustomTriggerPhrase, Favorite, SelectionHistory, User, get_db
from app.rag.store import wac_store
from app.schemas import (
    FavoriteToggle,
    WACNodeOut,
    WACTreeNode,
)

router = APIRouter(prefix="/api/wacs", tags=["wacs"])


def _custom_phrases(db: Session, user: User | None, wac_id: str) -> list[str]:
    if not user:
        return []
    rows = (
        db.query(CustomTriggerPhrase)
        .filter(CustomTriggerPhrase.user_id == user.id, CustomTriggerPhrase.wac_id == wac_id)
        .all()
    )
    return [r.phrase for r in rows]


def _favorites_set(db: Session, user: User | None) -> set[str]:
    if not user:
        return set()
    return {f.wac_id for f in db.query(Favorite).filter(Favorite.user_id == user.id).all()}


@router.get("", response_model=list[WACNodeOut])
def list_wacs(
    chapter: str | None = None,
    q: str | None = None,
    level: str = "code",
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    favs = _favorites_set(db, user)
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
            if ql in n.id.lower() or ql in n.title.lower() or ql in n.code.lower()
        ]
    nodes = sorted(nodes, key=lambda n: (n.chapter, n.code, n.hierarchy_path))
    out = []
    for n in nodes:
        out.append(
            WACNodeOut(
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
                custom_trigger_phrases=_custom_phrases(db, user, n.id),
                is_favorite=n.id in favs or n.code in favs,
            )
        )
    return out


@router.get("/tree", response_model=list[WACTreeNode])
def wac_tree(
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    favs = _favorites_set(db, user)
    codes = wac_store.get_code_nodes()
    tree: list[WACTreeNode] = []
    for code in codes:
        primaries = []
        for p in sorted(
            [c for c in wac_store.get_children(code.id) if c.level == "primary"],
            key=lambda x: int(x.primary or 0),
        ):
            secondaries = []
            for s in sorted(
                [c for c in wac_store.get_children(p.id) if c.level == "secondary"],
                key=lambda x: x.secondary or "",
            ):
                tertiaries = [
                    WACTreeNode(
                        id=t.id,
                        code=t.code,
                        title=f"({t.tertiary}) {t.text[:80]}",
                        chapter=t.chapter,
                        level=t.level,
                        is_favorite=t.id in favs,
                    )
                    for t in sorted(
                        [c for c in wac_store.get_children(s.id) if c.level == "tertiary"],
                        key=lambda x: x.tertiary or "",
                    )
                ]
                secondaries.append(
                    WACTreeNode(
                        id=s.id,
                        code=s.code,
                        title=f"({s.secondary}) {s.text[:100]}",
                        chapter=s.chapter,
                        level=s.level,
                        children=tertiaries,
                        is_favorite=s.id in favs,
                    )
                )
            primaries.append(
                WACTreeNode(
                    id=p.id,
                    code=p.code,
                    title=f"({p.primary}) {p.text[:120]}",
                    chapter=p.chapter,
                    level=p.level,
                    children=secondaries,
                    is_favorite=p.id in favs,
                )
            )
        tree.append(
            WACTreeNode(
                id=code.id,
                code=code.code,
                title=code.title,
                chapter=code.chapter,
                level=code.level,
                children=primaries,
                is_favorite=code.id in favs,
            )
        )
    return tree


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


@router.get("/favorites/list")
def list_favorites(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    favs = db.query(Favorite).filter(Favorite.user_id == user.id).all()
    items = []
    for f in favs:
        node = wac_store.nodes.get(f.wac_id) or wac_store.code_index.get(f.wac_id)
        items.append(
            {
                "wac_id": f.wac_id,
                "title": node.title if node else f.wac_id,
                "code": node.code if node else f.wac_id,
                "chapter": node.chapter if node else "",
            }
        )
    return items


@router.post("/selection-history")
def save_selection(
    selected_wacs: list[str],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = SelectionHistory(user_id=user.id, selected_wacs=json.dumps(selected_wacs))
    db.add(row)
    db.commit()
    return {"saved": True, "count": len(selected_wacs)}


@router.get("/{wac_id:path}", response_model=WACNodeOut)
def get_wac(
    wac_id: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    # Accept with or without WAC prefix
    node = wac_store.nodes.get(wac_id) or wac_store.nodes.get(f"WAC {wac_id}")
    if not node and not wac_id.startswith("WAC "):
        node = wac_store.code_index.get(wac_id)
    if not node:
        raise HTTPException(status_code=404, detail="WAC not found")
    favs = _favorites_set(db, user)
    return WACNodeOut(
        id=node.id,
        chapter=node.chapter,
        code=node.code,
        title=node.title,
        text=node.text,
        level=node.level,
        parent_id=node.parent_id,
        hierarchy_path=node.hierarchy_path,
        primary=node.primary,
        secondary=node.secondary,
        tertiary=node.tertiary,
        version_date=node.version_date,
        certified_date=node.certified_date,
        trigger_phrases=node.trigger_phrases,
        custom_trigger_phrases=_custom_phrases(db, user, node.id),
        is_favorite=node.id in favs,
    )
