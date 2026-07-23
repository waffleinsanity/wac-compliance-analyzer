"""Source-document authority for WAC/RCW subsection selection.

SOLE SOURCE RULE
---------------
Which subsections apply is determined ONLY from the locally ingested PDFs
(WAC 246-341 / 246-337 and RCW 71.05 / 71.24 / 71.34) in WACStore — never from
example DOCX templates, external browsing, or free-form LLM invention.

Statute language in allegations and Regulatory Framework must be EXACT text
from those PDF nodes. Example DOCX files shape IR shell phrasing only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.rag.store import wac_store

# Per-code TF-IDF matrices (subsection docs are static after ingest)
_CODE_TFIDF: dict[str, tuple[TfidfVectorizer, Any, tuple[str, ...]]] = {}
_TFIDF_STOP = frozenset(ENGLISH_STOP_WORDS)


FOREIGN_WAC_RE = re.compile(r"246-(?:341|337)-\d{3,4}")
FOREIGN_RCW_RE = re.compile(r"71\.(?:05|24|34)\.\d{3,4}")
EXPLICIT_CITE_RE = re.compile(
    r"(?:WAC\s*)?(246-(?:341|337)-\d{3,4})\s*((?:\([0-9a-z]+\))+)?|"
    r"(?:RCW\s*)?(71\.(?:05|24|34)\.\d{3,4})\s*((?:\([0-9a-z]+\))+)?",
    re.IGNORECASE,
)
SUBSECTION_ONLY_RE = re.compile(r"(?<!\d)((?:\([0-9a-z]+\))+)", re.IGNORECASE)

SOURCE_FILES = (
    "WAC 246-341.pdf",
    "WAC 246-337.pdf",
    "RCW 71.05.pdf",
    "RCW 71.24.pdf",
    "RCW 71.34.pdf",
)

DUTY_MAX_CHARS = 120
# Allegation drafts may cite several duties so investigators can prune; not a full dump.
MAX_DUTY_CLAUSES = 2  # legacy tight default for callers that still pass max_subs=2
MAX_ALLEGATION_CLAUSES = 10
MAX_RANKED_SUBSECTIONS = 14
LOW_CONFIDENCE_SCORE = 0.15
# Application bands (raw ranked scores after TF-IDF + light boosts):
#   strong ≥ 0.50 | moderate 0.30–0.49 | weak < 0.30
STRONG_SCORE = 0.50
MODERATE_SCORE = 0.30
# Include strong + upper half of moderate (≥ midpoint of 0.30–0.49).
ALLEGATION_INCLUDE_MIN = 0.40
ALLEGATION_TARGET_CHARS = 900
DEFAULT_QUOTE_MAX_CHARS = DUTY_MAX_CHARS


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
    instrument: str = "WAC"  # WAC | RCW


def _clean(text: str) -> str:
    text = (text or "").replace("\u00ad", "").replace("\ufffd", "-").replace("�", "-")
    return re.sub(r"[ \t]+", " ", text).strip()


def normalize_statute_text(text: str) -> str:
    """Collapse PDF line-break artifacts into contiguous statute wording for display/verify."""
    return re.sub(r"\s+", " ", _clean(text)).strip()


def instrument_for(code: str) -> str:
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    return "RCW" if code.startswith("71.") else "WAC"


def cite_prefix(code: str) -> str:
    return instrument_for(code)


def subsection_label(node: Any) -> str:
    """Extract (1)(a)(iii)-style label from hierarchy path / id."""
    path = getattr(node, "hierarchy_path", "") or getattr(node, "id", "") or ""
    m = re.search(
        r"(?:246-(?:341|337)-\d{3,4}|71\.(?:05|24|34)\.\d{3,4})((?:\([^)]+\))+)",
        path,
    )
    if m:
        return m.group(1)
    for attr in ("tertiary", "secondary", "primary"):
        val = getattr(node, attr, None)
        if val and re.fullmatch(r"\([^)]+\)(?:\([^)]+\))*", str(val).strip()):
            return str(val).strip()
        if val and re.fullmatch(r"[0-9a-z]+", str(val).strip(), re.I):
            return f"({val})"
    return ""


def parent_subsection_labels(label: str) -> list[str]:
    """'(4)(g)(i)' -> ['(4)', '(4)(g)'] (outermost first)."""
    parts = re.findall(r"\([^)]+\)", label or "")
    if len(parts) < 2:
        return []
    return ["".join(parts[:i]) for i in range(1, len(parts))]


_CHILD_MARKER_RE = re.compile(
    r"(?<!\w)\(([a-z]|[ivxlcdm]{1,6}|[A-Z]|\d{1,3})\)\s+",
    re.IGNORECASE,
)


def own_clause_text(text: str) -> str:
    """Text owned by this node before nested child markers (exclusive intro)."""
    body = normalize_statute_text(text)
    if not body:
        return ""
    m = _CHILD_MARKER_RE.search(body)
    # Require enough parent prose so we do not cut a leaf that starts with a cite
    if m and m.start() >= 20:
        return body[: m.start()].rstrip()
    return body


def duty_phrase_from_subsection(sub: ScopedSubsection, max_chars: int = DUTY_MAX_CHARS) -> str:
    """Allegation duty fragment: nearest list-intro parent + leaf duty when applicable."""
    parents = parent_subsection_labels(sub.label)
    intro = ""
    if parents:
        nearest = parents[-1]
        parent = validate_subsection_cite(sub.code, f"{sub.code}{nearest}")
        if parent:
            candidate = own_clause_text(parent.text)
            if candidate and (
                candidate.rstrip().endswith(":")
                or _is_list_intro_stub(candidate)
                or len(candidate) <= 220
            ):
                intro = _strip_list_edge_punct(candidate)
    leaf = duty_phrase_from_text(sub.text, max_chars=max_chars)
    if intro and leaf:
        if leaf.lower().startswith(intro[: min(40, len(intro))].lower()):
            return leaf
        combined = f"{intro} {leaf}"
        if len(combined) <= max(max_chars + 80, 260):
            return _strip_list_edge_punct(combined)
        return leaf
    return leaf


def code_node_for(code: str) -> Any | None:
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    prefix = cite_prefix(code)
    return (
        wac_store.code_index.get(code)
        or wac_store.code_index.get(f"{prefix} {code}")
        or wac_store.nodes.get(f"{prefix} {code}")
    )


def subsections_for_code(code: str) -> list[ScopedSubsection]:
    """All hierarchical nodes belonging to one selected code (PDF-derived only)."""
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    instrument = instrument_for(code)
    out: list[ScopedSubsection] = []
    for node in wac_store.nodes.values():
        if node.code != code:
            continue
        if node.level == "code":
            continue
        text = _clean(node.text)
        if len(text) < 8:
            continue
        label = subsection_label(node)
        out.append(
            ScopedSubsection(
                code=code,
                label=label or "",
                hierarchy_path=node.hierarchy_path,
                title=_clean(node.title),
                text=text,
                level=node.level,
                instrument=instrument,
            )
        )
    out.sort(key=lambda s: (s.hierarchy_path, s.level))
    return out


def validate_subsection_cite(code: str, cite: str) -> ScopedSubsection | None:
    """Return the PDF store node for a cite like 246-341-0410(4)(a) or 71.05.010(1)."""
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    cite = (cite or "").strip()
    if not cite:
        return None
    cite = re.sub(r"^(?:WAC|RCW)\s+", "", cite, flags=re.IGNORECASE)
    if cite.startswith(code):
        label = cite[len(code) :]
    elif FOREIGN_WAC_RE.match(cite) or FOREIGN_RCW_RE.match(cite):
        m = re.match(
            r"(246-(?:341|337)-\d{3,4}|71\.(?:05|24|34)\.\d{3,4})((?:\([^)]+\))+)?",
            cite,
        )
        if not m or m.group(1) != code:
            return None
        label = m.group(2) or ""
    else:
        label = cite if cite.startswith("(") else f"({cite})"

    # Exact label / path only — never treat a longer child cite as the parent
    # (e.g. "(4)(g)" must not resolve to "(4)(g)(i)").
    for sub in subsections_for_code(code):
        if sub.label == label:
            return sub
        path = (sub.hierarchy_path or "").replace("WAC ", "").replace("RCW ", "")
        if path == f"{code}{label}" or path.endswith(f"/{code}{label}"):
            return sub
    return None


def subsection_ancestor_context(sub: ScopedSubsection, *, max_intro_chars: int = 320) -> str:
    """Parent list-intro prose for a leaf (exclusive of the leaf itself)."""
    intros: list[str] = []
    for parent_label in parent_subsection_labels(sub.label):
        parent = validate_subsection_cite(sub.code, f"{sub.code}{parent_label}")
        if not parent:
            continue
        intro = own_clause_text(parent.text)
        if not intro:
            continue
        if len(intro) > max_intro_chars and not intro.rstrip().endswith(":"):
            continue
        leaf_norm = normalize_statute_text(sub.text).lower()
        if leaf_norm and intro.lower() in leaf_norm:
            continue
        if intro not in intros:
            intros.append(intro)
    return " ".join(intros).strip()


def subsection_display_text(sub: ScopedSubsection, *, max_intro_chars: int = 320) -> str:
    """Leaf statute text with ancestor list-intro context. Nodes stay distinct in the store."""
    context = subsection_ancestor_context(sub, max_intro_chars=max_intro_chars)
    leaf = normalize_statute_text(sub.text)
    if not leaf:
        return context
    if not context:
        return leaf
    return f"{context} {leaf}".strip()


def extract_explicit_cites(complaint: str, code: str) -> list[ScopedSubsection]:
    """Subsections the complaint itself cites, validated against the PDF store."""
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    found: dict[str, ScopedSubsection] = {}
    text = complaint or ""

    for m in EXPLICIT_CITE_RE.finditer(text):
        cited_code = m.group(1) or m.group(3)
        label = m.group(2) or m.group(4) or ""
        if not cited_code or cited_code != code:
            continue
        if not label:
            continue
        sub = validate_subsection_cite(code, f"{code}{label}")
        if sub:
            sub.score = 1.0
            sub.reason = "explicit_cite"
            found[sub.label] = sub

    if code in text.replace("WAC ", "").replace("RCW ", ""):
        for m in re.finditer(re.escape(code), text):
            window = text[m.start() : m.start() + 400]
            for sm in SUBSECTION_ONLY_RE.finditer(window):
                label = sm.group(1)
                if len(label) < 3:
                    continue
                sub = validate_subsection_cite(code, f"{code}{label}")
                if sub:
                    sub.score = max(sub.score, 0.95)
                    sub.reason = "explicit_cite"
                    found[sub.label] = sub

    return list(found.values())


def _looks_like_container(text: str) -> bool:
    """True when text is a parent that only introduces a nested (a)/(b) duty list."""
    body = (text or "").strip()
    if not body:
        return False
    if _is_list_intro_stub(body):
        return True
    # e.g. (iii) "… in all of the following: (A) … (B) …"
    if re.search(r"\bfollowing\s*:", body, re.I) and re.search(r"\([A-Z]\)\s+\S+", body):
        return True
    if re.search(r"(must|shall)\s+ensure\s*:?\s*(\n|\r)?\s*\([a-z0-9]+\)", body, re.I):
        return True
    if len(body) > 320 and len(re.findall(r"\n\s*\([a-z0-9A-Z]+\)", body)) >= 2:
        return True
    if re.search(r"including\s*:?\s*(\n|\r)?\s*\([a-z0-9A-Z]+\)", body, re.I) and len(body) > 220:
        return True
    return False


def _is_list_intro_stub(text: str) -> bool:
    """Incomplete list openers like '… in all of the following:' — not actionable duties."""
    body = normalize_statute_text(text)
    if not body:
        return False
    if re.search(r"\b(the\s+following|as\s+follows|all\s+of\s+the\s+following)\s*:\s*$", body, re.I):
        return True
    # Short clause that ends with a bare colon (introduces nested items)
    if body.endswith(":") and len(body) < 180 and not re.search(r"\([A-Za-z0-9]+\)", body):
        return True
    return False


def _looks_like_definition(text: str) -> bool:
    """RCW/WAC definitional clauses ('\"Term\" means …') are not 'failed to' duties."""
    body = normalize_statute_text(text)
    if not body:
        return False
    return bool(
        re.match(
            r"^[\"'“”]?[A-Za-z][^\"'“”]{0,80}[\"'“”]?\s+means\s+",
            body,
            flags=re.IGNORECASE,
        )
    )


def _actionable_subsections(subs: list[ScopedSubsection]) -> list[ScopedSubsection]:
    """Prefer leaf duties over bloated parent containers for complaint matching."""
    leaves = [
        s
        for s in subs
        if s.level in ("quaternary", "tertiary", "secondary")
        and not _looks_like_container(s.text)
        and not _is_list_intro_stub(s.text)
        and not _looks_like_definition(s.text)
    ]
    short_primaries = [
        s
        for s in subs
        if s.level == "primary"
        and not _looks_like_container(s.text)
        and not _looks_like_definition(s.text)
        and len(s.text) <= 360
    ]
    pool = leaves + short_primaries
    if pool:
        return pool
    non_containers = [
        s
        for s in subs
        if not _looks_like_container(s.text) and not _looks_like_definition(s.text)
    ]
    return non_containers or subs


def _level_rank(level: str) -> int:
    return {"quaternary": 0, "tertiary": 1, "secondary": 2, "primary": 3, "code": 4}.get(level, 5)


# Ranking-only aliases: expand complaint query so related facts match PDF wording.
# Never written into statute text or allegations — scoring signal only.
_RANK_QUERY_ALIASES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bsexually\b", re.I), " sexual "),
    (re.compile(r"\bassault(?:ed|s)?\b", re.I), " assault abuse harassment exploitation "),
    (re.compile(r"\bsafety\b", re.I), " safety protect protection security "),
    (re.compile(r"\bsecurity\b", re.I), " security protect protection safety "),
    # Do not match bare "protected" inside "protected health information" → security duties
    (re.compile(r"\bprotect(?:ing|ion)\b", re.I), " protect safety security "),
    (re.compile(r"\bconfidential(?:ity)?\b", re.I), " confidential privacy disclosure information "),
    # Avoid "release" — RCW 71.05.020(49) defines commitment Release, not PHI disclosure
    (re.compile(r"\bdisclos(?:e|ed|ure|ing)\b", re.I), " disclose share confidential privacy "),
    (
        re.compile(r"\b(?:protected\s+health\s+information|phi)\b", re.I),
        " personal health information confidential disclosure share privacy ",
    ),
    (re.compile(r"\bwithout\s+consent\b", re.I), " consent authorization share privacy "),
    (re.compile(r"\bneglect(?:ed|ing)?\b", re.I), " neglect abuse exploitation safety "),
]

# Structural anchors: short umbrella duties that TF-IDF almost never matches to complaint
# narratives, but nearly always apply when the parent code is authorized (e.g. 0410(1)(a)
# "All administrative matters" for the administrator). Labels must exist in the PDF store.
STRUCTURAL_ANCHORS: dict[str, tuple[str, ...]] = {
    # Administrator key responsibilities — (1)(a)–(c) are the program/facility umbrella.
    "246-341-0410": ("(1)(a)", "(1)(b)", "(1)(c)"),
    # Agency policies / staffing — adequate staffing is the recurring structural duty.
    "246-341-0420": ("(3)",),
    # RTF governance — resources, authority, and staff supervision from peer IR baselines.
    "246-337-045": ("(1)(a)(iii)", "(1)(c)", "(3)(b)"),
}

# Allegation overlap gate: ignore ultra-generic WAC phrasing when comparing to the complaint.
_ALLEGATION_BOILERPLATE_TOKENS = frozenset(
    {
        "agency",
        "services",
        "service",
        "provide",
        "providing",
        "provided",
        "ensure",
        "ensuring",
        "must",
        "shall",
        "including",
        "requirements",
        "requirement",
        "section",
        "chapter",
        "facility",
        "treatment",
        "individual",
        "individuals",
        "patient",
        "patients",
        "resident",
        "residents",
        "receive",
        "receives",
        "accordance",
        "appropriately",
        "following",
        "within",
        "under",
        "other",
        "such",
        "also",
    }
)
# Role/staffing words appear in nearly every personnel leaf — alone they do not justify a cite.
_ALLEGATION_WEAK_ROLE_TOKENS = frozenset(
    {
        "staff",
        "staffing",
        "supervision",
        "personnel",
        "employee",
        "employees",
        "clinical",
        "credential",
        "credentialed",
        "licensed",
        "training",
        "trained",
        "provider",
        "providers",
    }
)
# Domain markers that disqualify a leaf when absent from the complaint (e.g. gambling on a meds case).
_ALLEGATION_DOMAIN_EXCLUSIVE_TOKENS = frozenset(
    {
        "gambling",
        "gambler",
        "casino",
    }
)


# Conservative morphology only — avoid stripping "reported"→"report" (false (2)(k) hits).
# Do not map "protected"→"protect" (PHI "protected health information" ≠ safety "protect").
_MORPH_MAP: dict[str, str] = {
    "sexually": "sexual",
    "assaulted": "assault",
    "assaults": "assault",
    "protecting": "protect",
    "protection": "protect",
    "disclosing": "disclose",
    "disclosed": "disclose",
    "disclosure": "disclose",
    "confidentiality": "confidential",
    "neglected": "neglect",
    "neglecting": "neglect",
    "exploited": "exploitation",
    "exploiting": "exploitation",
    "harassing": "harassment",
    "harassed": "harassment",
}


def _normalize_rank_token(token: str) -> str:
    """Map known complaint morphology onto PDF wording; no aggressive stemming."""
    t = token.lower()
    return _MORPH_MAP.get(t, t)


def _tfidf_analyzer(text: str) -> list[str]:
    stems: list[str] = []
    for t in re.findall(r"[a-z0-9]{3,}", (text or "").lower()):
        if t in _TFIDF_STOP:
            continue
        st = _normalize_rank_token(t)
        if len(st) < 3 or st in _TFIDF_STOP:
            continue
        stems.append(st)
    grams = list(stems)
    grams.extend(f"{a}_{b}" for a, b in zip(stems, stems[1:]))
    return grams


def expand_ranking_query(complaint: str) -> str:
    """Public alias: ranking-only query expansion (never mutates statute text)."""
    return _expand_ranking_query(complaint)


def _expand_ranking_query(complaint: str) -> str:
    """Append ranking-only aliases; PDF subsection text remains the documents."""
    out = complaint or ""
    extras: list[str] = []
    for pat, repl in _RANK_QUERY_ALIASES:
        if pat.search(out):
            extras.append(repl.strip())
    if extras:
        out = f"{out} {' '.join(extras)}"
    return out


def _scoped_store_boosts(query: str, code: str) -> dict[str, float]:
    """Light score boosts from store TF-IDF + Chroma, scoped to one approved code.

    PDF subsection text remains the ranking documents; store hits only nudge scores.
    Failures (Chroma down / empty TF-IDF) return {} so the TF-IDF path still works.
    """
    boosts: dict[str, float] = {}
    if not query.strip() or not wac_store.ready:
        return boosts
    try:
        for node, score in wac_store.search(
            query, selected_codes={code}, top_k=12, min_score=0.01
        ):
            if getattr(node, "level", "") == "code":
                continue
            label = subsection_label(node)
            if not label:
                continue
            boosts[label] = max(boosts.get(label, 0.0), float(score) * 0.35)
    except Exception:
        pass
    try:
        for node, score in wac_store.search_chroma(
            query, top_k=12, selected_codes={code}
        ):
            if getattr(node, "level", "") == "code":
                continue
            label = subsection_label(node)
            if not label:
                continue
            # Chroma similarities are often ~0.3–0.5; keep as a light blend only.
            boosts[label] = max(boosts.get(label, 0.0), float(score) * 0.28)
    except Exception:
        pass
    return boosts


def _merge_explicit_and_lexical(
    explicit: list[ScopedSubsection],
    lexical: list[ScopedSubsection],
    *,
    max_items: int,
) -> list[ScopedSubsection]:
    """Explicit cites get a high boost; lexical ranking fills remaining slots."""
    by_key: dict[str, ScopedSubsection] = {}
    for sub in lexical:
        key = sub.label or sub.hierarchy_path
        by_key[key] = sub

    merged: list[ScopedSubsection] = []
    used: set[str] = set()
    explicit_sorted = sorted(
        explicit,
        key=lambda s: (-s.score, _level_rank(s.level), len(s.text), s.hierarchy_path),
    )
    for sub in explicit_sorted:
        key = sub.label or sub.hierarchy_path
        item = by_key.get(key, sub)
        item.reason = "explicit_cite"
        item.score = max(float(item.score), 1.0)
        merged.append(item)
        used.add(key)
        if len(merged) >= max_items:
            return merged

    for sub in lexical:
        key = sub.label or sub.hierarchy_path
        if key in used:
            continue
        merged.append(sub)
        used.add(key)
        if len(merged) >= max_items:
            break
    return merged


def score_relevant_subsections(
    complaint: str,
    code: str,
    *,
    max_items: int = 6,
    min_score: float = 0.08,
) -> list[ScopedSubsection]:
    """Rank the most complaint-relevant *leaf* duties under one selected code.

    Explicit complaint cites are merged with lexical ranking (not an early return).
    Optional code-scoped store/Chroma hits apply a light boost only; PDF text stays
    primary. Always returns closest leaves for UX, with honest low scores / reasons.
    """
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    explicit = extract_explicit_cites(complaint, code)

    all_subs = subsections_for_code(code)
    subs = _actionable_subsections(all_subs)
    if not subs:
        if explicit:
            explicit.sort(
                key=lambda s: (-s.score, _level_rank(s.level), len(s.text), s.hierarchy_path)
            )
            return explicit[:max_items]
        node = code_node_for(code)
        if node and node.text:
            snippet = duty_phrase_from_text(node.text, max_chars=DUTY_MAX_CHARS)
            return [
                ScopedSubsection(
                    code=code,
                    label="",
                    hierarchy_path=node.hierarchy_path,
                    title=_clean(node.title),
                    text=snippet or _clean(node.text)[:DUTY_MAX_CHARS],
                    level="code",
                    score=0.0,
                    reason="code_fallback",
                    instrument=instrument_for(code),
                )
            ]
        return []

    complaint_c = _clean(complaint)
    if not complaint_c:
        for s in subs[:max_items]:
            s.score = 0.0
            s.reason = "code_fallback"
        return _merge_explicit_and_lexical(explicit, subs, max_items=max_items)

    ranking_query = _expand_ranking_query(complaint_c)
    docs = [f"{s.label} {s.title} {s.text}" for s in subs]
    labels = tuple(s.label or s.hierarchy_path for s in subs)
    cache_key = f"{code}::stem_v4"
    try:
        cached = _CODE_TFIDF.get(cache_key)
        if cached is None or cached[2] != labels:
            vectorizer = TfidfVectorizer(
                analyzer=_tfidf_analyzer,
                max_features=8000,
            )
            matrix = vectorizer.fit_transform(docs)
            _CODE_TFIDF[cache_key] = (vectorizer, matrix, labels)
        else:
            vectorizer, matrix, _ = cached
        q = vectorizer.transform([ranking_query])
        scores = cosine_similarity(q, matrix).flatten()
    except ValueError:
        for s in subs[:max_items]:
            s.score = 0.0
            s.reason = "code_fallback"
        return _merge_explicit_and_lexical(explicit, subs, max_items=max_items)

    store_boosts = _scoped_store_boosts(ranking_query, code)

    ranked: list[ScopedSubsection] = []
    for sub, score in zip(subs, scores):
        # Prefer specific leaves, but keep short primary duties competitive ((2), (3)).
        level_boost = (
            0.1
            if sub.level == "quaternary"
            else 0.08
            if sub.level == "tertiary"
            else 0.05
            if sub.level == "secondary"
            else 0.04
            if sub.level == "primary" and len(sub.text) <= 360
            else 0.0
        )
        penalty = min(0.14, max(0.0, (len(sub.text) - 220) / 3500.0))
        base = float(score)
        # Store/Chroma may only nudge an already-plausible lexical hit — never invent relevance.
        store_boost = store_boosts.get(sub.label, 0.0) if base >= 0.04 else 0.0
        sub.score = base + level_boost - penalty + store_boost
        sub.reason = "lexical_overlap"
        ranked.append(sub)
    ranked.sort(key=lambda s: (-s.score, _level_rank(s.level), len(s.text)))
    _boost_sibling_coverage(ranked)

    filtered = [s for s in ranked if s.score >= min_score]
    if not filtered:
        # Token-overlap fallback; keep honest low scores for IR low_confidence flags
        tokens = {
            _normalize_rank_token(t)
            for t in re.findall(r"[a-z]{4,}", complaint_c.lower())
            if t not in _TFIDF_STOP
        }
        for s in ranked:
            blob_tokens = set(_tfidf_analyzer(f"{s.label} {s.text}"))
            hits = sum(1 for t in tokens if t in blob_tokens)
            s.score = hits / max(len(tokens), 1)
            if s.score > 0:
                s.reason = "lexical_overlap"
            else:
                s.reason = "code_fallback"
                s.score = 0.0
        ranked.sort(key=lambda s: (-s.score, _level_rank(s.level), len(s.text)))
        # Always keep the next-closest subsections under this code — never empty.
        filtered = [s for s in ranked if s.score > 0][:max_items] or ranked[:max_items]
        for s in filtered:
            if s.score < min_score and s.reason != "explicit_cite":
                # UX always-return path: mark weak matches honestly
                if s.score <= 0:
                    s.reason = "code_fallback"
                elif s.score < min_score:
                    # Keep lexical_overlap but leave score low for low_confidence
                    pass

    # Guarantee at least one closest leaf when the code has subsections
    if not filtered and ranked:
        closest = ranked[0]
        if closest.score < min_score and closest.reason != "explicit_cite":
            closest.reason = "code_fallback"
        filtered = [closest]

    filtered = _apply_structural_anchors(code, filtered, all_subs)
    return _merge_explicit_and_lexical(explicit, filtered, max_items=max_items)


def _boost_sibling_coverage(ranked: list[ScopedSubsection]) -> None:
    """When one child under a primary is strong, lift near-threshold siblings in that branch.

    Helps general duties under the same parent (e.g. (1)(a)/(b)/(c)) enter the
    upper-moderate include band without selecting the entire code.
    """
    by_primary: dict[str, list[ScopedSubsection]] = {}
    for s in ranked:
        m = re.match(r"(\(\d+\))", s.label or "")
        if not m:
            continue
        by_primary.setdefault(m.group(1), []).append(s)
    for group in by_primary.values():
        if not any(s.score >= STRONG_SCORE or s.reason == "explicit_cite" for s in group):
            # Also lift when the branch already has an upper-moderate hit
            if not any(s.score >= ALLEGATION_INCLUDE_MIN for s in group):
                continue
        for s in group:
            if MODERATE_SCORE <= s.score < ALLEGATION_INCLUDE_MIN:
                s.score = min(ALLEGATION_INCLUDE_MIN + 0.02, s.score + 0.09)


def _apply_structural_anchors(
    code: str,
    ranked: list[ScopedSubsection],
    all_subs: list[ScopedSubsection],
) -> list[ScopedSubsection]:
    """Ensure curated umbrella duties enter the include band when the code is selected."""
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    wanted = STRUCTURAL_ANCHORS.get(code)
    if not wanted:
        return ranked
    by_label = {s.label: s for s in all_subs if s.label}
    by_key = {s.label or s.hierarchy_path: s for s in ranked}
    for lab in wanted:
        src = by_label.get(lab)
        if not src:
            continue
        key = src.label or src.hierarchy_path
        existing = by_key.get(key)
        if existing is not None:
            if existing.score < ALLEGATION_INCLUDE_MIN and existing.reason != "explicit_cite":
                existing.score = ALLEGATION_INCLUDE_MIN
                existing.reason = "structural_anchor"
            continue
        ranked.append(
            ScopedSubsection(
                code=src.code,
                label=src.label,
                hierarchy_path=src.hierarchy_path,
                title=src.title,
                text=src.text,
                level=src.level,
                score=ALLEGATION_INCLUDE_MIN,
                reason="structural_anchor",
                instrument=src.instrument,
            )
        )
        by_key[key] = ranked[-1]
    ranked.sort(key=lambda s: (-s.score, _level_rank(s.level), len(s.text)))
    return ranked


def _allegation_content_tokens(text: str) -> set[str]:
    """Unigram content tokens for allegation↔complaint overlap (no bigrams)."""
    return {
        t
        for t in _tfidf_analyzer(text or "")
        if "_" not in t
        and len(t) >= 4
        and t not in _ALLEGATION_BOILERPLATE_TOKENS
    }


def subsection_passes_complaint_overlap(complaint: str, sub: ScopedSubsection) -> bool:
    """Require real complaint substance overlap — not boilerplate / weak role words alone.

    Prefer dropping a duty over citing an irrelevant leaf (e.g. problem-gambling staffing
    on a medication-error complaint). Explicit cites and structural anchors skip this gate.
    """
    if sub.reason in {"explicit_cite", "structural_anchor"}:
        return True
    complaint_c = _clean(complaint)
    if not complaint_c:
        # No complaint context (unit tests / callers): do not invent a rejection.
        return True
    # Use ranking-query expansion so aliases (assault→harassment) count for overlap.
    c_toks = _allegation_content_tokens(_expand_ranking_query(complaint_c))
    s_toks = _allegation_content_tokens(f"{sub.title} {sub.text}")
    if not s_toks:
        return False
    exclusive = (s_toks & _ALLEGATION_DOMAIN_EXCLUSIVE_TOKENS) - c_toks
    if exclusive:
        return False
    shared = c_toks & s_toks
    strong_shared = shared - _ALLEGATION_WEAK_ROLE_TOKENS
    if strong_shared:
        return True
    # Weak-role-only overlap is insufficient unless TF-IDF is already strong.
    return bool(shared) and float(sub.score) >= STRONG_SCORE


def select_for_allegation(
    ranked: list[ScopedSubsection],
    *,
    max_items: int = MAX_ALLEGATION_CLAUSES,
    complaint: str = "",
) -> list[ScopedSubsection]:
    """Strong + upper-moderate + structural anchors for allegation/compare chips.

    Applies a complaint-overlap gate so weak TF-IDF leaves (gambling staffing, generic
    clinical supervision on a meds complaint, etc.) are dropped rather than forced in.
    Floor keeps at most top-2 leaves that pass the gate and clear the low-confidence
    noise floor — never invents a 'best of the worst' cite with no substance overlap.
    Caps at max_items so investigators prune rather than face a full-code dump.
    """
    if not ranked:
        return []
    selected: list[ScopedSubsection] = []
    used: set[str] = set()
    for s in ranked:
        key = s.label or s.hierarchy_path
        if key in used:
            continue
        if s.reason in {"explicit_cite", "structural_anchor"}:
            selected.append(s)
            used.add(key)
        elif s.score >= ALLEGATION_INCLUDE_MIN and subsection_passes_complaint_overlap(
            complaint, s
        ):
            selected.append(s)
            used.add(key)
        if len(selected) >= max_items:
            return selected
    # Floor: fill up to 2 with overlap-passing leaves above noise (not arbitrary weak).
    for s in ranked:
        if len(selected) >= min(2, max_items):
            break
        key = s.label or s.hierarchy_path
        if key in used:
            continue
        if s.score < LOW_CONFIDENCE_SCORE:
            continue
        if not subsection_passes_complaint_overlap(complaint, s):
            continue
        selected.append(s)
        used.add(key)
    return selected[:max_items]


def format_scoped_context(code: str, title: str, full_text: str, relevant: list[ScopedSubsection]) -> str:
    """Build LLM/user context limited to one selected code from PDF text."""
    prefix = cite_prefix(code)
    lines = [
        f"SELECTED {prefix} ONLY (from local source PDF): {prefix} {code} — {title}",
        f"You must not cite any other {prefix} code outside the selected set.",
        "Subsection applicability must be based only on the text below.",
        "Quote statute language exactly; do not rewrite it.",
        "",
        f"Full text of this selected {prefix} (from local PDF ingest):",
        _clean(full_text)[:6000],
        "",
        "Subsections ranked as most relevant to the complaint (PDF-derived):",
    ]
    for s in relevant:
        cite = f"{code}{s.label}" if s.label else code
        lines.append(f"- {prefix} {cite} [score={s.score:.3f} reason={s.reason}] {s.text[:500]}")
    return "\n".join(lines)


def allegation_cites_only_selected(allegation: str, allowed_codes: set[str]) -> bool:
    found = {m.group(0) for m in FOREIGN_WAC_RE.finditer(allegation or "")}
    found |= {m.group(0) for m in FOREIGN_RCW_RE.finditer(allegation or "")}
    return found.issubset(allowed_codes)


def strip_foreign_wac_mentions(text: str, allowed_codes: set[str]) -> str:
    if not text:
        return text
    parts = re.split(r"(?<=[.!?])\s+", text)
    kept = []
    for p in parts:
        codes = {m.group(0) for m in FOREIGN_WAC_RE.finditer(p)}
        codes |= {m.group(0) for m in FOREIGN_RCW_RE.finditer(p)}
        if codes and not codes.issubset(allowed_codes):
            continue
        kept.append(p)
    return " ".join(kept).strip()


def sanitize_for_outer_quotes(text: str) -> str:
    """Strip double quotes from duty phrases; Baseline allegations never wrap duties in quotes."""
    return (text or "").replace('"', "").replace("“", "").replace("”", "").replace("„", "")


_HANGING_CUT_RE = re.compile(
    r"\b(the|a|an|or|and|of|to|for|in|on|at|by|with|as|from|than|that|which|who)$",
    re.IGNORECASE,
)


def sentence_boundary_excerpt(text: str, max_chars: int = DEFAULT_QUOTE_MAX_CHARS) -> str:
    """Contiguous PDF excerpt ending on a sentence boundary when possible.

    Prefers ending on `.` / `;` etc. Soft-extends past max_chars to finish a short leaf
    sentence rather than hanging on articles ("… or the"). Never inserts ellipsis into
    statute text.
    """
    body = normalize_statute_text(text)
    if not body:
        return ""
    if len(body) <= max_chars:
        return body
    # Soft cap: allow a short overrun to reach the next sentence end (leaf duties ~200–300 chars)
    soft_cap = max(max_chars * 2, 280)
    soft = body[:soft_cap]
    best = -1
    for sep in (". ", "? ", "! ", "; "):
        idx = soft.rfind(sep)
        if idx >= max(20, max_chars // 3) and idx > best:
            best = idx
    if best >= 20:
        return soft[: best + 1].rstrip()
    # Also accept terminal punctuation at end of soft window
    for sep in (".", "?", "!", ";"):
        idx = soft.rfind(sep)
        if idx >= max(20, max_chars // 3):
            return soft[: idx + 1].rstrip()
    window = body[:max_chars]
    best = -1
    for sep in (". ", "? ", "! ", "; "):
        idx = window.rfind(sep)
        if idx > best:
            best = idx
    if best >= 20:
        return window[: best + 1].rstrip()
    space = window.rfind(" ")
    if space >= 20:
        cut = window[:space].rstrip()
        # Avoid "... or the" — extend to next whitespace/sentence within soft_cap
        if _HANGING_CUT_RE.search(cut):
            rest = body[space:]
            m = re.search(r"[.;!?]|(\s+\S+){1,12}", rest)
            if m:
                extended = normalize_statute_text(body[: space + m.end()])
                if len(extended) <= soft_cap:
                    # Prefer ending on punctuation when present in the extension
                    for sep in (".", ";", "?", "!"):
                        if sep in extended[max_chars // 2 :]:
                            return extended[: extended.rfind(sep) + 1].rstrip()
                    return extended.rstrip(" ,;")
        return cut
    return window.rstrip()


def duty_phrase_from_text(text: str, max_chars: int = DUTY_MAX_CHARS) -> str:
    """Short verbatim duty fragment suitable after 'by having failed to' (Baseline IR shape)."""
    raw = _clean(text)
    normalized = normalize_statute_text(raw)

    # Incomplete list intro: pull the first nested lettered/numbered duty when present
    if _is_list_intro_stub(normalized) or (
        "following:" in normalized.lower() and re.search(r"\([A-Za-z0-9]+\)", raw)
    ):
        nested = re.search(
            r"\(([A-Z]|[a-z]|[0-9]+)\)\s+([^\n(]+?)(?=\s*(?:\([A-Za-z0-9]+\)|;|$))",
            raw,
            flags=re.IGNORECASE,
        )
        if nested and len(nested.group(2).split()) >= 3:
            raw = nested.group(2).strip()
            normalized = normalize_statute_text(raw)
        elif _is_list_intro_stub(normalized):
            # No nested duty available — do not emit a hanging "the following:" stub
            return ""

    # Short leaf duties: keep the whole clause — do not mid-cut at DUTY_MAX
    if normalized and not _looks_like_container(raw) and len(normalized) <= max(max_chars, 300):
        phrase = sanitize_for_outer_quotes(normalized)
        phrase = re.sub(r"(?:;?\s*and)+$", "", phrase, flags=re.IGNORECASE)
        return _strip_list_edge_punct(phrase)
    # Prefer the first concrete lettered item inside a container parent
    if _looks_like_container(raw) or "\n" in raw:
        item = re.search(
            r"\(([A-Z]|[a-z]|[0-9]+)\)\s+([^\n(]+?)(?=\s*(?:\([A-Za-z0-9]+\)|;|$))",
            raw,
            flags=re.IGNORECASE,
        )
        if item and len(item.group(2).split()) >= 3:
            raw = item.group(2).strip()
    body = re.sub(r"\s+", " ", raw).strip()
    body = re.sub(
        r"^(the\s+)?("
        r"agency(\s+administrator)?|administrator(\s+or\s+their\s+designee)?|"
        r"facility|provider|rtf|licensee|behavioral health agency"
        r")\s+",
        "",
        body,
        flags=re.IGNORECASE,
    )
    body = re.sub(
        r"^(must|shall|will|is required to|is responsible for|may)\s+",
        "",
        body,
        flags=re.IGNORECASE,
    )
    body = re.sub(r"^(ensure|ensuring)\s+", "", body, flags=re.IGNORECASE)
    # Stop before the next nested subsection marker inside the same blob
    cut = re.search(r"\s\([A-Za-z0-9]+\)\s", body)
    if cut and cut.start() >= 24:
        body = body[: cut.start()]
    phrase = sanitize_for_outer_quotes(sentence_boundary_excerpt(body, max_chars=max_chars))
    # Baseline lines put "; and" between clauses — never inside a duty fragment
    phrase = re.sub(r"(?:;?\s*and)+$", "", phrase, flags=re.IGNORECASE)
    # Never keep wrapping quotation marks or list-edge punctuation in duty fragments
    phrase = phrase.strip().strip('"“”\'')
    return _strip_list_edge_punct(phrase)


def _strip_list_edge_punct(text: str) -> str:
    """Remove trailing list punctuation so allegation joiners do not create ;; or :."""
    return (text or "").strip().rstrip(" ;:,.")


def normalize_allegation_line(text: str) -> str:
    """Baseline IR allegation shape: no quotation marks; clean clause punctuation."""
    out = (text or "").replace('"', "").replace("“", "").replace("”", "").replace("„", "")
    out = re.sub(r"\s+", " ", out).strip()
    # Legacy drafts used "A potential violation…" — Baseline / blank IR omit the leading A.
    out = re.sub(r"^A\s+potential\s+violation\b", "Potential violation", out, flags=re.IGNORECASE)
    # Collapse doubled / mixed list punctuation from PDF list items + allegation joiners
    out = re.sub(r";{2,}", ";", out)
    out = re.sub(r":{2,}", ":", out)
    out = re.sub(r"([;:])\s*\.", r".", out)  # "following:." / "services;." → "."
    out = re.sub(r"\.\s*;", ".", out)
    out = re.sub(r";\s*;", ";", out)
    out = re.sub(r"\s+([;,.])", r"\1", out)
    # Ensure a single terminal period
    out = out.rstrip(" ;:")
    if out and not out.endswith("."):
        out += "."
    out = re.sub(r"\.{2,}$", ".", out)
    return out


def _allegation_without_quotes(text: str) -> str:
    """Backward-compatible alias."""
    return normalize_allegation_line(text)


def exact_quotes_from_subsections(
    subs: list[ScopedSubsection],
    max_quotes: int = MAX_DUTY_CLAUSES,
    max_chars: int = DUTY_MAX_CHARS,
) -> list[tuple[str, str]]:
    """Return (label, short exact PDF duty phrase) pairs — never full subsection dumps."""
    out: list[tuple[str, str]] = []
    for s in subs:
        body = _clean(s.text)
        if len(body.split()) < 4:
            continue
        quote = duty_phrase_from_subsection(s, max_chars=max_chars)
        if len(quote.split()) < 3:
            continue
        out.append((s.label, quote))
        if len(out) >= max_quotes:
            break
    return out


def duty_clauses_from_subsections(
    subs: list[ScopedSubsection], max_clauses: int = MAX_DUTY_CLAUSES
) -> list[tuple[str, str]]:
    """Compatibility wrapper: exact statute duty phrases only (no paraphrase)."""
    return exact_quotes_from_subsections(subs, max_quotes=max_clauses)


@dataclass
class AllegationDraft:
    text: str
    cites: list[str]
    match_reason: str
    match_score: float
    low_confidence: bool

    # Tuple-unpacking compatibility for older callers: text, cites = draft
    def __iter__(self):
        yield self.text
        yield self.cites


def draft_allegation_from_source(
    code: str,
    title: str,
    complaint: str,
    *,
    max_subs: int = MAX_ALLEGATION_CLAUSES,
    relevant: list[ScopedSubsection] | None = None,
    preferred_connector: str | None = None,
) -> AllegationDraft:
    """Build a DOH-shaped allegation from ranked PDF duty phrases.

    Includes strong + upper-moderate subsections (see select_for_allegation) so
    investigators can prune — not a full-code dump. Shape:
      Potential violation of WAC {code}, {title}, by having failed to (1)(a) …; and (2) ….
    """
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    prefix = cite_prefix(code)
    connector = (preferred_connector or "having failed to").strip().lower()
    if connector not in {"having failed to", "failing to", "not", "violating"}:
        connector = "having failed to"
    if relevant is None:
        ranked = score_relevant_subsections(
            complaint, code, max_items=max(max_subs, MAX_RANKED_SUBSECTIONS)
        )
        relevant = select_for_allegation(ranked, max_items=max_subs, complaint=complaint)
    else:
        relevant = select_for_allegation(
            list(relevant), max_items=max_subs, complaint=complaint
        )

    clean_title = _clean(title).replace("—", " - ").replace("–", " - ")
    # Keep title short in the allegation line
    if len(clean_title) > 80:
        clean_title = clean_title[:77].rstrip() + "…"
    opener = f"Potential violation of {prefix} {code}, {clean_title}"

    # No complaint-aligned duties under this code — prefer empty cites over irrelevant leaves.
    if not relevant:
        return AllegationDraft(
            text=f"{opener}, as applied to the reported concern in the complaint intake.",
            cites=[],
            match_reason="code_fallback",
            match_score=0.0,
            low_confidence=True,
        )

    # Shorter duty phrases when many cites so the line stays editable, not a wall of text
    per_quote = DUTY_MAX_CHARS if len(relevant) <= 3 else max(72, DUTY_MAX_CHARS - 20 * (len(relevant) - 3))
    quotes = exact_quotes_from_subsections(relevant, max_quotes=max_subs, max_chars=per_quote)
    cites = [f"{code}{s.label}" if s.label else code for s in relevant[:max_subs]]

    top_score = max((s.score for s in relevant), default=0.0)
    top_reason = relevant[0].reason if relevant else "code_fallback"
    if relevant and relevant[0].reason == "code_fallback":
        top_reason = "code_fallback"
    low_confidence = top_reason == "code_fallback" or top_score < LOW_CONFIDENCE_SCORE

    if not quotes:
        # Prefer the closest ranked subsection text before falling back to the whole code body.
        low_confidence = True
        top_reason = relevant[0].reason if relevant else "code_fallback"
        top_score = max((s.score for s in relevant), default=0.0)
        snippet = ""
        cite_label = ""
        if relevant:
            snippet = duty_phrase_from_subsection(relevant[0], max_chars=DUTY_MAX_CHARS)
            cite_label = relevant[0].label or ""
            if not cites:
                cites = [f"{code}{s.label}" if s.label else code for s in relevant[:max_subs]]
        if not snippet:
            node = code_node_for(code)
            snippet = duty_phrase_from_text(node.text if node else "", max_chars=DUTY_MAX_CHARS)
            top_reason = "code_fallback"
            top_score = 0.0
        if snippet:
            cite0 = f"{cite_label} " if cite_label else ""
            text = _allegation_without_quotes(f"{opener}, by {connector} {cite0}{snippet}.").strip()
        else:
            text = f"{opener}, as applied to the reported concern in the complaint intake."
        return AllegationDraft(
            text=text,
            cites=cites,
            match_reason=top_reason,
            match_score=top_score,
            low_confidence=True,
        )

    parts: list[str] = []
    for i, (label, quote) in enumerate(quotes):
        cite = f"{label} " if label else ""
        fragment = f"{cite}{_strip_list_edge_punct(quote)}".strip()
        if not _strip_list_edge_punct(quote):
            continue
        if i == 0 or not parts:
            parts.append(fragment)
        else:
            parts.append(f"and {fragment}")
    if not parts:
        text = f"{opener}, as applied to the reported concern in the complaint intake."
    else:
        body = "; ".join(parts)
        text = _allegation_without_quotes(f"{opener}, by {connector} {body}.")

    # Prefer shortening duties over dropping cites — investigators prune excess chips.
    if len(text) > ALLEGATION_TARGET_CHARS and len(quotes) > 2:
        short_parts: list[str] = []
        for i, (label, quote) in enumerate(quotes):
            cite = f"{label} " if label else ""
            short = duty_phrase_from_text(quote, max_chars=64)
            frag = f"{cite}{_strip_list_edge_punct(short)}".strip()
            if not frag:
                continue
            short_parts.append(frag if i == 0 else f"and {frag}")
        if short_parts:
            text = _allegation_without_quotes(
                f"{opener}, by {connector} {'; '.join(short_parts)}."
            )
    if len(text) > ALLEGATION_TARGET_CHARS + 120 and len(quotes) > 1:
        # Cite list with first duty only — keep all cites on the draft object for chips
        label0, quote0 = quotes[0]
        cite0 = f"{label0} " if label0 else ""
        short = duty_phrase_from_text(quote0, max_chars=90)
        also = "; ".join(lab for lab, _ in quotes[1:] if lab)
        if also:
            text = _allegation_without_quotes(
                f"{opener}, by {connector} {cite0}{short}; see also {also}."
            )
        else:
            text = _allegation_without_quotes(f"{opener}, by {connector} {cite0}{short}.").strip()

    return AllegationDraft(
        text=text,
        cites=cites[:max_subs],
        match_reason=top_reason,
        match_score=top_score,
        low_confidence=low_confidence,
    )


def filter_cites_to_source(code: str, cites: list[str]) -> list[str]:
    """Keep only cites that exist under this code in the PDF store."""
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    out: list[str] = []
    for c in cites:
        sub = validate_subsection_cite(code, str(c))
        if sub:
            cite = f"{code}{sub.label}" if sub.label else code
            if cite not in out:
                out.append(cite)
    return out


def regulatory_framework_entries(
    codes: list[tuple[str, str]],
    complaint: str,
    *,
    max_subs_per_code: int = 4,
) -> list[dict[str, Any]]:
    """Build Regulatory Framework rows with exact PDF subsection text."""
    entries: list[dict[str, Any]] = []
    for code, title in codes:
        code = code.replace("WAC ", "").replace("RCW ", "").strip()
        prefix = cite_prefix(code)
        relevant = score_relevant_subsections(complaint, code, max_items=max_subs_per_code)
        subsections = [
            {
                "cite": f"{prefix} {code}{s.label}" if s.label else f"{prefix} {code}",
                "label": s.label,
                "text": normalize_statute_text(s.text),
                "context": subsection_ancestor_context(s),
                "level": s.level,
                "score": s.score,
            }
            for s in relevant
        ]
        entries.append(
            {
                "instrument": prefix,
                "code": code,
                "title": _clean(title),
                "subsections": subsections,
            }
        )
    return entries


def evidentiary_examples_from_matches(
    framework: list[dict[str, Any]],
    *,
    count: int = 5,
) -> list[str]:
    """Exactly `count` investigator-facing evidence prompts citing exact matched language."""
    examples: list[str] = []
    for entry in framework:
        for sub in entry.get("subsections") or []:
            cite = sub.get("cite") or f"{entry.get('instrument')} {entry.get('code')}"
            snippet = duty_phrase_from_text(sub.get("text") or "", max_chars=160)
            if not snippet:
                continue
            examples.append(
                f'Review of facility records and documentation to determine whether the following '
                f'requirement was met per {cite}: "{snippet}"'
            )
            if len(examples) >= count:
                return examples[:count]

    defaults = [
        "Review of clinical and administrative records relevant to the selected WAC/RCW requirements.",
        "Review of facility policies and procedures that implement the cited statutory duties.",
        "Interviews with staff responsible for compliance with the matched subsections.",
        "Review of incident reports, logs, and timelines related to the complaint allegations.",
        "Review of training records demonstrating staff knowledge of the cited requirements.",
    ]
    for d in defaults:
        if len(examples) >= count:
            break
        examples.append(d)
    return examples[:count]
