"""ChromaDB-backed hierarchical WAC RAG store with TF-IDF fallback scoring."""

from __future__ import annotations

import json
import re
from typing import Any

import chromadb
from chromadb.config import Settings as ChromaSettings
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy.orm import Session

from app.config import settings
from app.database import WACCodeRecord
from app.parser.rcw_parser import parse_all_rcw_sources
from app.parser.wac_parser import WACNode, parse_all_sources


class WACStore:
    def __init__(self) -> None:
        self.nodes: dict[str, WACNode] = {}
        self.code_index: dict[str, WACNode] = {}
        self._vectorizer: TfidfVectorizer | None = None
        self._tfidf_matrix = None
        self._tfidf_ids: list[str] = []
        self._chroma = chromadb.PersistentClient(
            path=str(settings.chroma_dir),
            settings=ChromaSettings(anonymized_telemetry=False, allow_reset=True),
        )
        self._collection = self._chroma.get_or_create_collection(
            name="wac_hierarchy",
            metadata={"hnsw:space": "cosine"},
        )

    @property
    def ready(self) -> bool:
        return bool(self.nodes)

    def load_from_db(self, db: Session) -> int:
        rows = db.query(WACCodeRecord).all()
        if not rows:
            return 0
        self.nodes.clear()
        self.code_index.clear()
        for row in rows:
            phrases = []
            try:
                phrases = json.loads(row.auto_trigger_phrases or "[]")
            except json.JSONDecodeError:
                phrases = []
            node = WACNode(
                id=row.id,
                chapter=row.chapter,
                code=row.code,
                title=row.title or "",
                text=row.text or "",
                level=row.level,
                parent_id=row.parent_id,
                hierarchy_path=row.hierarchy_path or row.id,
                primary=row.primary_label,
                secondary=row.secondary_label,
                tertiary=row.tertiary_label,
                version_date=row.version_date,
                certified_date=row.certified_date,
                source_file=row.source_file,
                trigger_phrases=phrases,
            )
            self.nodes[node.id] = node
            if node.level == "code":
                self.code_index[node.code] = node
                self.code_index[node.id] = node
        try:
            from app.services import wac_scope

            wac_scope._CODE_TFIDF.clear()
        except Exception:
            pass
        self._rebuild_tfidf()
        self._ensure_chroma()
        return len(self.nodes)

    def ingest(self, db: Session, force: bool = False) -> dict[str, Any]:
        existing = db.query(WACCodeRecord).count()
        # Re-parse when source PDFs are newer than the DB so PDFs remain sole corpus
        if existing and not force:
            db_mtime = settings.sqlite_path.stat().st_mtime if settings.sqlite_path.exists() else 0
            pdf_mtime = 0.0
            for name in (
                "WAC 246-341.pdf",
                "WAC 246-337.pdf",
                *settings.rcw_source_pdfs,
            ):
                path = settings.source_dir / name
                if path.exists():
                    pdf_mtime = max(pdf_mtime, path.stat().st_mtime)
            sections_dir = settings.source_dir / "sections"
            if sections_dir.is_dir():
                for path in sections_dir.glob("*.pdf"):
                    pdf_mtime = max(pdf_mtime, path.stat().st_mtime)
            if pdf_mtime and pdf_mtime > db_mtime + 1:
                force = True
            else:
                loaded = self.load_from_db(db)
                return {"status": "loaded_existing", "nodes": loaded}

        nodes = parse_all_sources(settings.source_dir) + parse_all_rcw_sources(settings.source_dir)
        # Deduplicate by id (prefer longer text)
        deduped: dict[str, WACNode] = {}
        for node in nodes:
            prev = deduped.get(node.id)
            if not prev or len(node.text) > len(prev.text):
                deduped[node.id] = node
        nodes = list(deduped.values())

        if force or existing:
            db.query(WACCodeRecord).delete()
            db.commit()
            try:
                self._chroma.delete_collection("wac_hierarchy")
            except Exception:
                pass
            self._collection = self._chroma.get_or_create_collection(
                name="wac_hierarchy",
                metadata={"hnsw:space": "cosine"},
            )

        for node in nodes:
            record = WACCodeRecord(
                id=node.id,
                chapter=node.chapter,
                code=node.code,
                title=node.title,
                text=node.text,
                level=node.level,
                parent_id=node.parent_id,
                hierarchy_path=node.hierarchy_path,
                primary_label=node.primary,
                secondary_label=node.secondary,
                tertiary_label=node.tertiary,
                version_date=node.version_date,
                certified_date=node.certified_date,
                source_file=node.source_file,
                auto_trigger_phrases=json.dumps(node.trigger_phrases),
            )
            db.merge(record)
        db.commit()

        self.nodes = {n.id: n for n in nodes}
        self.code_index = {n.code: n for n in nodes if n.level == "code"}
        self.code_index.update({n.id: n for n in nodes if n.level == "code"})
        # Subsection TF-IDF caches are keyed by code text; drop them after store rebuild.
        try:
            from app.services import wac_scope

            wac_scope._CODE_TFIDF.clear()
        except Exception:
            pass
        self._rebuild_tfidf()
        self._sync_chroma(nodes)
        chapters: dict[str, int] = {}
        for n in nodes:
            if n.level == "code":
                chapters[n.chapter] = chapters.get(n.chapter, 0) + 1
        return {
            "status": "ingested",
            "nodes": len(nodes),
            "codes": sum(1 for n in nodes if n.level == "code"),
            "chapters": chapters,
        }

    def _rebuild_tfidf(self) -> None:
        docs = []
        ids = []
        for node_id, node in self.nodes.items():
            blob = " ".join(
                [
                    node.id,
                    node.code,
                    node.title,
                    node.text,
                    " ".join(node.trigger_phrases),
                ]
            )
            docs.append(blob)
            ids.append(node_id)
        if not docs:
            self._vectorizer = None
            self._tfidf_matrix = None
            self._tfidf_ids = []
            return
        self._vectorizer = TfidfVectorizer(
            stop_words="english",
            ngram_range=(1, 2),
            max_features=50000,
            sublinear_tf=True,
        )
        self._tfidf_matrix = self._vectorizer.fit_transform(docs)
        self._tfidf_ids = ids

    def _ensure_chroma(self) -> None:
        try:
            count = self._collection.count()
        except Exception:
            count = 0
        if count == 0 and self.nodes:
            self._sync_chroma(list(self.nodes.values()))

    def _sync_chroma(self, nodes: list[WACNode]) -> None:
        if not nodes:
            return
        batch = 100
        for i in range(0, len(nodes), batch):
            chunk = nodes[i : i + batch]
            self._collection.upsert(
                ids=[n.id for n in chunk],
                documents=[f"{n.title}. {n.text}"[:8000] for n in chunk],
                metadatas=[
                    {
                        "chapter": n.chapter,
                        "code": n.code,
                        "level": n.level,
                        "title": n.title[:200],
                        "hierarchy_path": n.hierarchy_path,
                        "version_date": n.version_date or "",
                        "parent_id": n.parent_id or "",
                    }
                    for n in chunk
                ],
            )

    def get_code_nodes(self) -> list[WACNode]:
        return sorted(
            [n for n in self.nodes.values() if n.level == "code"],
            key=lambda n: (n.chapter, n.code),
        )

    def get_children(self, parent_id: str) -> list[WACNode]:
        return [n for n in self.nodes.values() if n.parent_id == parent_id]

    def resolve_selection(self, selected: list[str]) -> list[WACNode]:
        """Expand selected IDs to code-level nodes (and keep subsection targets)."""
        resolved: dict[str, WACNode] = {}
        for item in selected:
            item = item.strip()
            if not item:
                continue
            # WAC 246-341/337 or RCW 71.xx.xxx
            m = re.search(
                r"(?:WAC\s+)?(246-(?:341|337)-\d{3,4})|(?:RCW\s+)?(71\.(?:05|24|34)\.\d{3,4})",
                item,
                re.IGNORECASE,
            )
            if not m:
                # Fall back to direct id / code lookup
                exact = (
                    self.nodes.get(item)
                    or self.nodes.get(f"WAC {item}")
                    or self.nodes.get(f"RCW {item}")
                    or self.code_index.get(item)
                )
                if exact:
                    if exact.level == "code":
                        resolved[exact.id] = exact
                    else:
                        parent = self.code_index.get(exact.code)
                        if parent:
                            resolved[parent.id] = parent
                        resolved[exact.id] = exact
                continue
            code = m.group(1) or m.group(2)
            prefix = "RCW" if code.startswith("71.") else "WAC"
            node = (
                self.code_index.get(code)
                or self.code_index.get(f"{prefix} {code}")
                or self.nodes.get(f"{prefix} {code}")
            )
            if node:
                resolved[node.id] = node
            exact = (
                self.nodes.get(item)
                or self.nodes.get(f"WAC {item}")
                or self.nodes.get(f"RCW {item}")
            )
            if exact and exact.level != "code":
                resolved[exact.id] = exact
        return list(resolved.values())

    def search(
        self,
        query: str,
        selected_codes: set[str] | None = None,
        top_k: int = 20,
        *,
        exclude_codes: set[str] | None = None,
        min_score: float = 0.02,
    ) -> list[tuple[WACNode, float]]:
        if not self._vectorizer or self._tfidf_matrix is None or not query.strip():
            return []
        q = self._vectorizer.transform([query])
        sims = cosine_similarity(q, self._tfidf_matrix).flatten()
        ranked = sorted(enumerate(sims), key=lambda x: x[1], reverse=True)
        selected_norm = {c.replace("WAC ", "").replace("RCW ", "") for c in (selected_codes or set())}
        exclude_norm = {c.replace("WAC ", "").replace("RCW ", "") for c in (exclude_codes or set())}
        results: list[tuple[WACNode, float]] = []
        for idx, score in ranked:
            if score < min_score:
                break
            node = self.nodes[self._tfidf_ids[idx]]
            code_key = node.code.replace("WAC ", "").replace("RCW ", "")
            if exclude_norm and code_key in exclude_norm:
                continue
            if selected_norm and code_key not in selected_norm and node.id not in (selected_codes or set()):
                continue
            results.append((node, float(score)))
            if len(results) >= top_k:
                break
        return results

    def search_chroma(
        self,
        query: str,
        top_k: int = 20,
        *,
        selected_codes: set[str] | None = None,
    ) -> list[tuple[WACNode, float]]:
        """Semantic backup over the local statute corpus.

        When ``selected_codes`` is set, restrict Chroma to those code metadata
        values so subsection ranking can blend a code-scoped signal without
        letting unrelated chapters crowd out the approved selection.
        """
        if not query.strip() or not self.nodes:
            return []
        where: dict[str, Any] | None = None
        if selected_codes:
            codes = sorted(
                {c.replace("WAC ", "").replace("RCW ", "").strip() for c in selected_codes if c}
            )
            if len(codes) == 1:
                where = {"code": codes[0]}
            elif len(codes) > 1:
                where = {"code": {"$in": codes}}
        try:
            self._ensure_chroma()
            # When code-scoped, pull enough peers under that code for a light boost.
            n_results = min(max(top_k, 12), 40) if where else min(top_k, 40)
            raw = self._collection.query(
                query_texts=[query[:4000]],
                n_results=n_results,
                where=where,
            )
        except Exception:
            return []
        ids = (raw.get("ids") or [[]])[0]
        dists = (raw.get("distances") or [[]])[0]
        out: list[tuple[WACNode, float]] = []
        for node_id, dist in zip(ids, dists):
            node = self.nodes.get(node_id)
            if not node:
                continue
            # Chroma cosine distance → similarity-ish score
            score = max(0.0, 1.0 - float(dist))
            out.append((node, score))
            if len(out) >= top_k:
                break
        return out

    def corpus_search(
        self,
        query: str,
        *,
        top_k: int = 25,
        exclude_codes: set[str] | None = None,
    ) -> list[tuple[WACNode, float, str]]:
        """Full-corpus keyword RAG: TF-IDF primary, Chroma as backup filler."""
        tfidf_hits = self.search(query, selected_codes=None, top_k=top_k, exclude_codes=exclude_codes)
        scored: dict[str, tuple[WACNode, float, str]] = {
            n.id: (n, s, "tfidf") for n, s in tfidf_hits
        }
        if len(scored) < top_k:
            for node, score in self.search_chroma(query, top_k=top_k):
                code_key = node.code.replace("WAC ", "").replace("RCW ", "")
                if exclude_codes and code_key in {
                    c.replace("WAC ", "").replace("RCW ", "") for c in exclude_codes
                }:
                    continue
                prev = scored.get(node.id)
                if not prev or score > prev[1]:
                    scored[node.id] = (node, score, "chroma" if not prev else prev[2])
        # Keyword / trigger-phrase boost
        q_lower = query.lower()
        tokens = {t for t in re.findall(r"[a-z0-9]{4,}", q_lower)}
        for node in self.nodes.values():
            code_key = node.code.replace("WAC ", "").replace("RCW ", "")
            if exclude_codes and code_key in {
                c.replace("WAC ", "").replace("RCW ", "") for c in exclude_codes
            }:
                continue
            phrase_hit = any(p.lower() in q_lower for p in node.trigger_phrases if len(p) >= 8)
            if not phrase_hit and tokens:
                blob = f"{node.title} {node.text}".lower()
                overlap = sum(1 for t in tokens if t in blob)
                if overlap < max(3, len(tokens) // 8):
                    continue
                phrase_hit = True
            if phrase_hit:
                prev = scored.get(node.id)
                boost = 0.15 if not prev else prev[1] + 0.05
                scored[node.id] = (node, max(prev[1] if prev else 0.0, boost), "keyword")
        ranked = sorted(scored.values(), key=lambda x: x[1], reverse=True)
        return ranked[:top_k]

    def phrase_hits(self, document: str, node: WACNode, extra_phrases: list[str] | None = None) -> list[str]:
        doc_lower = document.lower()
        hits: list[str] = []
        phrases = list(node.trigger_phrases) + (extra_phrases or [])
        for phrase in phrases:
            p = phrase.strip()
            if len(p) < 4:
                continue
            # Prefer multi-word phrase containment; also allow significant token overlap
            if p.lower() in doc_lower:
                hits.append(p)
                continue
            tokens = [t for t in re.findall(r"[a-z0-9']+", p.lower()) if len(t) > 3]
            if len(tokens) >= 3:
                matched = sum(1 for t in tokens if t in doc_lower)
                if matched / len(tokens) >= 0.7:
                    hits.append(p)
        # Deduplicate preserving order
        seen = set()
        unique = []
        for h in hits:
            key = h.lower()
            if key not in seen:
                seen.add(key)
                unique.append(h)
        return unique


wac_store = WACStore()
