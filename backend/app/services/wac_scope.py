"""Source-document authority for WAC subsection selection.

SOLE SOURCE RULE
---------------
Which subsections apply to a complaint/allegation is determined ONLY from the
locally ingested WAC PDFs (WAC 246-341.pdf and WAC 246-337.pdf) stored in
WACStore — never from example DOCX templates, hardcoded theme maps, external
Leg.wa.gov browsing, or free-form LLM invention.

Pipeline for a selected code:
  1. Collect hierarchical nodes for that code from the PDF-derived store
  2. Prefer subsections the complaint explicitly cites
  3. Otherwise rank remaining PDF subsection text against the complaint (TF-IDF)
  4. Draft allegation duties only from the text of those ranked nodes
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.rag.store import wac_store


FOREIGN_WAC_RE = re.compile(r"246-(?:341|337)-\d{3,4}")
EXPLICIT_CITE_RE = re.compile(
    r"(?:WAC\s*)?(246-(?:341|337)-\d{3,4})\s*((?:\([0-9a-z]+\))+)?",
    re.IGNORECASE,
)
SUBSECTION_ONLY_RE = re.compile(r"(?<!\d)((?:\([0-9a-z]+\))+)", re.IGNORECASE)
OBLIGATION_RE = re.compile(
    r"\b(?:must|shall|is required to|are required to|is responsible for|are responsible for)\b",
    re.IGNORECASE,
)


@dataclass
class ScopedSubsection:
    code: str
    label: str  # e.g. "(4)(d)"
    hierarchy_path: str
    title: str
    text: str
    level: str
    score: float = 0.0
    reason: str = ""  # explicit_cite | lexical_overlap | code_fallback


def _clean(text: str) -> str:
    text = (text or "").replace("\u00ad", "").replace("\ufffd", "-").replace("�", "-")
    return re.sub(r"[ \t]+", " ", text).strip()


def subsection_label(node: Any) -> str:
    """Extract (1)(a)(iii)-style label from hierarchy path / id."""
    path = getattr(node, "hierarchy_path", "") or getattr(node, "id", "") or ""
    m = re.search(r"246-(?:341|337)-\d{3,4}((?:\([^)]+\))+)", path)
    if m:
        return m.group(1)
    for attr in ("tertiary", "secondary", "primary"):
        val = getattr(node, attr, None)
        if val and re.fullmatch(r"\([^)]+\)(?:\([^)]+\))*", str(val).strip()):
            return str(val).strip()
        if val and re.fullmatch(r"[0-9a-z]+", str(val).strip(), re.I):
            return f"({val})"
    return ""


def code_node_for(code: str) -> Any | None:
    code = code.replace("WAC ", "").strip()
    return wac_store.code_index.get(code) or wac_store.code_index.get(f"WAC {code}")


def subsections_for_code(code: str) -> list[ScopedSubsection]:
    """All hierarchical nodes belonging to one selected code (PDF-derived only)."""
    code = code.replace("WAC ", "").strip()
    out: list[ScopedSubsection] = []
    for node in wac_store.nodes.values():
        if node.code != code or node.level == "code":
            continue
        label = subsection_label(node)
        text = _clean(node.text or "")
        if len(text) < 20:
            continue
        out.append(
            ScopedSubsection(
                code=code,
                label=label,
                hierarchy_path=node.hierarchy_path or node.id,
                title=node.title or "",
                text=text,
                level=node.level,
            )
        )
    # Prefer deeper / more specific nodes first for ranking stability
    level_rank = {"tertiary": 0, "secondary": 1, "primary": 2}
    out.sort(key=lambda s: (level_rank.get(s.level, 9), s.label or s.hierarchy_path))
    return out


def validate_subsection_cite(code: str, cite: str) -> ScopedSubsection | None:
    """Return the PDF subsection matching a cite string, if it exists under this code."""
    code = code.replace("WAC ", "").strip()
    cite = (cite or "").strip()
    if not cite:
        return None
    m = EXPLICIT_CITE_RE.search(cite)
    label = ""
    if m:
        if m.group(1).replace("WAC ", "") != code and m.group(1) != code:
            return None
        label = (m.group(2) or "").lower()
    else:
        sm = SUBSECTION_ONLY_RE.search(cite)
        if sm:
            label = sm.group(1).lower()
        elif cite.lower().startswith(code.lower()):
            rem = cite[len(code) :].strip()
            sm = SUBSECTION_ONLY_RE.search(rem)
            label = sm.group(1).lower() if sm else ""
    for sub in subsections_for_code(code):
        if label and sub.label.lower() == label:
            return sub
        if cite.lower() in sub.hierarchy_path.lower() or sub.hierarchy_path.lower() in cite.lower():
            return sub
    return None


def _explicit_cites_for_code(complaint: str, code: str) -> list[str]:
    code = code.replace("WAC ", "").strip()
    labels: list[str] = []
    for m in EXPLICIT_CITE_RE.finditer(complaint or ""):
        if m.group(1).replace("WAC ", "") != code:
            continue
        label = (m.group(2) or "").strip()
        if label and label.lower() not in {x.lower() for x in labels}:
            labels.append(label)
    return labels


def score_relevant_subsections(
    complaint: str,
    code: str,
    *,
    max_items: int = 4,
) -> list[ScopedSubsection]:
    """Rank PDF subsections for a selected code against the complaint text."""
    code = code.replace("WAC ", "").strip()
    subs = subsections_for_code(code)
    if not subs:
        return []

    complaint = _clean(complaint)
    explicit = _explicit_cites_for_code(complaint, code)
    ranked: list[ScopedSubsection] = []
    used: set[str] = set()

    for label in explicit:
        for sub in subs:
            key = sub.hierarchy_path
            if key in used:
                continue
            if sub.label.lower() == label.lower() or label.lower() in (sub.label or "").lower():
                sub.score = 1.0
                sub.reason = "explicit_cite"
                ranked.append(sub)
                used.add(key)
                break

    remaining = [s for s in subs if s.hierarchy_path not in used]
    if remaining and complaint:
        docs = [f"{s.label} {s.title} {s.text}" for s in remaining]
        try:
            vectorizer = TfidfVectorizer(
                stop_words="english",
                ngram_range=(1, 2),
                max_features=12000,
                sublinear_tf=True,
            )
            matrix = vectorizer.fit_transform(docs + [complaint])
            sims = cosine_similarity(matrix[-1], matrix[:-1]).flatten()
            order = sorted(range(len(remaining)), key=lambda i: sims[i], reverse=True)
            for i in order:
                if sims[i] < 0.04:
                    break
                sub = remaining[i]
                sub.score = float(sims[i])
                sub.reason = "lexical_overlap"
                ranked.append(sub)
                used.add(sub.hierarchy_path)
        except ValueError:
            pass

    if len(ranked) < max_items:
        # Token-overlap fallback favoring obligation language
        stop = {
            "that", "with", "from", "this", "shall", "must", "have", "been", "under",
            "which", "their", "other", "agency", "facility", "services", "including",
            "provide", "provided", "requirements", "section", "chapter", "washington",
        }
        tokens = {
            t.lower()
            for t in re.findall(r"[A-Za-z]{4,}", complaint)
            if t.lower() not in stop
        }
        scored: list[tuple[float, ScopedSubsection]] = []
        for sub in remaining:
            if sub.hierarchy_path in used:
                continue
            body = f"{sub.title} {sub.text}".lower()
            overlap = sum(1 for t in tokens if t in body)
            if overlap < 1 and not OBLIGATION_RE.search(sub.text):
                continue
            boost = 1.5 if OBLIGATION_RE.search(sub.text) else 1.0
            # Prefer primary/secondary nodes with obligations even on weak overlap
            level_boost = {"primary": 0.3, "secondary": 0.2, "tertiary": 0.1}.get(sub.level, 0)
            scored.append((overlap * boost + level_boost, sub))
        scored.sort(key=lambda x: x[0], reverse=True)
        for score, sub in scored:
            if len(ranked) >= max_items:
                break
            sub.score = float(score)
            sub.reason = "code_fallback"
            ranked.append(sub)
            used.add(sub.hierarchy_path)

    # Last resort: take obligation-bearing subsections from the code itself
    if not ranked:
        for sub in subs:
            if OBLIGATION_RE.search(sub.text):
                sub.score = 0.01
                sub.reason = "code_fallback"
                ranked.append(sub)
            if len(ranked) >= max_items:
                break
    if not ranked:
        ranked = subs[: min(max_items, 2)]
        for sub in ranked:
            sub.score = 0.0
            sub.reason = "code_fallback"

    # Prefer obligation-bearing nodes when scores are close
    ranked.sort(
        key=lambda s: (
            0 if s.reason == "explicit_cite" else 1,
            -s.score,
            0 if OBLIGATION_RE.search(s.text) else 1,
        )
    )
    return ranked[:max_items]


def _duty_clause_from_text(text: str) -> str | None:
    """Extract a concise duty clause from PDF subsection text."""
    text = _clean(text)
    # Strip leading subsection markers like (1)(a)
    text = re.sub(r"^(?:\([0-9a-z]+\))+\s*", "", text, flags=re.IGNORECASE)
    m = OBLIGATION_RE.search(text)
    if m:
        clause = text[m.end() :].strip(" :;,.")
        # Cut at first sentence boundary when long
        cut = re.split(r"(?<=[.|;])\s+", clause, maxsplit=1)[0]
        clause = _clean(cut).rstrip(" .;")
        # Normalize leading "to "
        clause = re.sub(r"^(?:to\s+)+", "", clause, flags=re.IGNORECASE)
        if len(clause.split()) >= 4:
            return clause[:280].rstrip(" ,;")
    # Fallback: first meaningful chunk
    snippet = text[:240].rstrip(" ,;")
    if len(snippet.split()) >= 6:
        return snippet
    return None


def duty_clauses_from_subsections(
    subsections: list[ScopedSubsection],
    *,
    max_clauses: int = 4,
) -> list[tuple[str, str]]:
    """Return (label, duty_clause) pairs from ranked PDF subsections."""
    out: list[tuple[str, str]] = []
    for s in subsections:
        clause = _duty_clause_from_text(s.text)
        if not clause:
            continue
        out.append((s.label or "", clause))
        if len(out) >= max_clauses:
            break
    return out


def draft_allegation_from_source(
    code: str,
    title: str,
    complaint: str,
    *,
    max_subs: int = 4,
) -> tuple[str, list[str], list[ScopedSubsection]]:
    """Build allegation text solely from PDF subsection duties for this code.

    Returns (allegation_sentence, cite strings, ranked subsections).
    Phrasing follows Example / baseline RTF shape:
      Potential violation of WAC {code}, {title}, by having failed to
      (1)(a) duty…; (1)(b) duty…; and (3)(c) duty.
    """
    relevant = score_relevant_subsections(complaint, code, max_items=max_subs)
    duties = duty_clauses_from_subsections(relevant, max_clauses=max_subs)
    cites = [f"{code}{s.label}" if s.label else code for s in relevant]

    clean_title = _clean(title).replace("—", " - ").replace("–", " - ")
    if not duties:
        snippet = _clean(complaint)[:160].rstrip(" .")
        text = (
            f"Potential violation of WAC {code}, {clean_title}, by failing to ensure "
            f"requirements of this section were met regarding the reported concern that {snippet}."
        )
        return text, cites, relevant

    parts: list[str] = []
    n = len(duties)
    for i, (label, clause) in enumerate(duties):
        cite = f"{label} " if label else ""
        piece = f"{cite}{clause}".strip()
        # Baseline style: final item prefixed with "and "
        if n > 1 and i == n - 1:
            piece = f"and {piece}"
        parts.append(piece)
    body = "; ".join(parts)
    text = (
        f"Potential violation of WAC {code}, {clean_title}, by having failed to {body}."
    )
    return text, cites, relevant
