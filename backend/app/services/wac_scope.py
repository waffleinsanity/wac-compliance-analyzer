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

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.rag.store import wac_store

# Per-code TF-IDF matrices (subsection docs are static after ingest)
_CODE_TFIDF: dict[str, tuple[TfidfVectorizer, Any, tuple[str, ...]]] = {}


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

    for sub in subsections_for_code(code):
        if sub.label == label or sub.hierarchy_path.endswith(f"{code}{label}") or sub.hierarchy_path.endswith(label):
            return sub
        if f"{code}{label}" in sub.hierarchy_path.replace("WAC ", "").replace("RCW ", ""):
            return sub
    return None


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
    if re.search(r"(must|shall)\s+ensure\s*:?\s*(\n|\r)?\s*\([a-z0-9]+\)", body, re.I):
        return True
    if len(body) > 320 and len(re.findall(r"\n\s*\([a-z0-9]+\)", body)) >= 2:
        return True
    if re.search(r"including\s*:?\s*(\n|\r)?\s*\([a-z0-9]+\)", body, re.I) and len(body) > 220:
        return True
    return False


def _actionable_subsections(subs: list[ScopedSubsection]) -> list[ScopedSubsection]:
    """Prefer leaf duties over bloated parent containers for complaint matching."""
    leaves = [s for s in subs if s.level in ("secondary", "tertiary")]
    short_primaries = [
        s
        for s in subs
        if s.level == "primary" and not _looks_like_container(s.text) and len(s.text) <= 360
    ]
    pool = leaves + short_primaries
    if pool:
        return pool
    non_containers = [s for s in subs if not _looks_like_container(s.text)]
    return non_containers or subs


def _level_rank(level: str) -> int:
    return {"tertiary": 0, "secondary": 1, "primary": 2, "code": 3}.get(level, 4)


def score_relevant_subsections(
    complaint: str,
    code: str,
    *,
    max_items: int = 6,
    min_score: float = 0.08,
) -> list[ScopedSubsection]:
    """Rank the most complaint-relevant *leaf* duties under one selected code."""
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    explicit = extract_explicit_cites(complaint, code)
    if explicit:
        # Prefer the most specific cited node when both parent and child appear
        explicit.sort(key=lambda s: (-s.score, _level_rank(s.level), len(s.text), s.hierarchy_path))
        return explicit[:max_items]

    all_subs = subsections_for_code(code)
    subs = _actionable_subsections(all_subs)
    if not subs:
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
                    score=1.0,
                    reason="code_fallback",
                    instrument=instrument_for(code),
                )
            ]
        return []

    complaint_c = _clean(complaint)
    if not complaint_c:
        for s in subs[:max_items]:
            s.reason = "code_fallback"
        return subs[:max_items]

    docs = [f"{s.label} {s.title} {s.text}" for s in subs]
    labels = tuple(s.label or s.hierarchy_path for s in subs)
    try:
        cached = _CODE_TFIDF.get(code)
        if cached is None or cached[2] != labels:
            vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_features=8000)
            matrix = vectorizer.fit_transform(docs)
            _CODE_TFIDF[code] = (vectorizer, matrix, labels)
        else:
            vectorizer, matrix, _ = cached
        q = vectorizer.transform([complaint_c])
        scores = cosine_similarity(q, matrix).flatten()
    except ValueError:
        for s in subs[:max_items]:
            s.reason = "code_fallback"
        return subs[:max_items]

    ranked: list[ScopedSubsection] = []
    for sub, score in zip(subs, scores):
        # Prefer specific leaves; penalize long dumps that survived the container filter
        boost = 0.08 if sub.level == "tertiary" else 0.05 if sub.level == "secondary" else 0.0
        penalty = min(0.14, max(0.0, (len(sub.text) - 220) / 3500.0))
        sub.score = float(score) + boost - penalty
        sub.reason = "lexical_overlap"
        ranked.append(sub)
    ranked.sort(key=lambda s: (-s.score, _level_rank(s.level), len(s.text)))

    filtered = [s for s in ranked if s.score >= min_score]
    if not filtered:
        tokens = {t for t in re.findall(r"[a-z]{4,}", complaint_c.lower())}
        for s in ranked:
            blob = f"{s.label} {s.text}".lower()
            hits = sum(1 for t in tokens if t in blob)
            s.score = hits / max(len(tokens), 1)
            s.reason = "lexical_overlap" if s.score > 0 else "code_fallback"
        ranked.sort(key=lambda s: (-s.score, _level_rank(s.level), len(s.text)))
        # Always keep the next-closest subsections under this code — never empty.
        filtered = [s for s in ranked if s.score > 0][:max_items] or ranked[:max_items]
        for s in filtered:
            if s.score <= 0:
                s.reason = "code_fallback"

    # Guarantee at least one closest leaf when the code has subsections
    if not filtered and ranked:
        closest = ranked[0]
        closest.reason = closest.reason or "code_fallback"
        filtered = [closest]

    return filtered[:max_items]


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


# Lexical match below this is flagged low-confidence in the UI (allegation shape unchanged).
LOW_CONFIDENCE_SCORE = 0.15
# Peer IR Allegation lines are short (~200–450 chars). Keep duty excerpts tight.
DUTY_MAX_CHARS = 120
MAX_DUTY_CLAUSES = 2
ALLEGATION_TARGET_CHARS = 420
DEFAULT_QUOTE_MAX_CHARS = DUTY_MAX_CHARS


def sanitize_for_outer_quotes(text: str) -> str:
    """Replace inner double quotes so allegation wrappers stay parseable."""
    return (text or "").replace('"', "'").replace("“", "'").replace("”", "'")


def sentence_boundary_excerpt(text: str, max_chars: int = DEFAULT_QUOTE_MAX_CHARS) -> str:
    """Contiguous PDF excerpt ending on a sentence boundary when possible.

    Hard-capped: never returns more than max_chars (cuts at last space if needed).
    Never inserts ellipsis characters into the statute text.
    """
    body = re.sub(r"\s+", " ", _clean(text))
    if not body:
        return ""
    if len(body) <= max_chars:
        return body
    window = body[:max_chars]
    best = -1
    for sep in (". ", "? ", "! ", "; "):
        idx = window.rfind(sep)
        if idx > best:
            best = idx
    if best >= 20:
        return window[: best + 1].rstrip()
    # Fall back to last whitespace inside the budget (still contiguous prefix of PDF text)
    space = window.rfind(" ")
    if space >= 20:
        return window[:space].rstrip()
    return window.rstrip()


def duty_phrase_from_text(text: str, max_chars: int = DUTY_MAX_CHARS) -> str:
    """Short verbatim duty fragment suitable after 'by having failed to' (Baseline IR shape)."""
    raw = _clean(text)
    # Prefer the first concrete lettered item inside a container parent
    if _looks_like_container(raw) or "\n" in raw:
        item = re.search(
            r"\(([a-z]|[0-9]+)\)\s+([^\n(]+?)(?=\s*(?:\([a-z0-9]+\)|;|$))",
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
    cut = re.search(r"\s\([a-z0-9]+\)\s", body, flags=re.IGNORECASE)
    if cut and cut.start() >= 24:
        body = body[: cut.start()].rstrip(" ;,")
    return sanitize_for_outer_quotes(sentence_boundary_excerpt(body, max_chars=max_chars))


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
        quote = duty_phrase_from_text(body, max_chars=max_chars)
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
    max_subs: int = MAX_DUTY_CLAUSES,
    relevant: list[ScopedSubsection] | None = None,
) -> AllegationDraft:
    """Build a concise DOH-shaped allegation from short exact PDF duty phrases.

    Shape matches peer-reviewed / Baseline IR lines:
      A potential violation of WAC {code}, {title}, by having failed to (1)(a) "…"; and (2) "…".
    Full subsection text stays in matched_subsections / Regulatory Framework — not here.
    Low-confidence is flagged on the draft object for the UI; wording stays allegation-shaped.
    """
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    prefix = cite_prefix(code)
    if relevant is None:
        relevant = score_relevant_subsections(
            complaint, code, max_items=max(max_subs, MAX_DUTY_CLAUSES)
        )
    else:
        relevant = relevant[: max(max_subs, MAX_DUTY_CLAUSES)]
    quotes = exact_quotes_from_subsections(relevant, max_quotes=MAX_DUTY_CLAUSES)
    cites = [f"{code}{s.label}" if s.label else code for s in relevant[:MAX_DUTY_CLAUSES]]

    top_score = max((s.score for s in relevant), default=0.0)
    top_reason = relevant[0].reason if relevant else "code_fallback"
    if relevant and relevant[0].reason == "code_fallback":
        top_reason = "code_fallback"
    low_confidence = top_reason == "code_fallback" or top_score < LOW_CONFIDENCE_SCORE

    clean_title = _clean(title).replace("—", " - ").replace("–", " - ")
    # Keep title short in the allegation line
    if len(clean_title) > 80:
        clean_title = clean_title[:77].rstrip() + "…"
    opener = f"A potential violation of {prefix} {code}, {clean_title}"

    if not quotes:
        # Prefer the closest ranked subsection text before falling back to the whole code body.
        low_confidence = True
        top_reason = relevant[0].reason if relevant else "code_fallback"
        top_score = max((s.score for s in relevant), default=0.0)
        snippet = ""
        cite_label = ""
        if relevant:
            snippet = duty_phrase_from_text(relevant[0].text, max_chars=DUTY_MAX_CHARS)
            cite_label = relevant[0].label or ""
            if not cites:
                cites = [f"{code}{s.label}" if s.label else code for s in relevant[:MAX_DUTY_CLAUSES]]
        if not snippet:
            node = code_node_for(code)
            snippet = duty_phrase_from_text(node.text if node else "", max_chars=DUTY_MAX_CHARS)
            top_reason = "code_fallback"
            top_score = 0.0
        if snippet:
            cite0 = f"{cite_label} " if cite_label else ""
            text = f'{opener}, by having failed to {cite0}"{snippet}".'.strip()
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
        fragment = f'{cite}"{quote}"'.strip()
        if i == 0:
            parts.append(fragment)
        else:
            parts.append(f"and {fragment}")
    body = "; ".join(parts)
    text = f"{opener}, by having failed to {body}."

    # Hard trim: peer Allegation lines stay short; never dump multi-subsection walls of text
    if len(text) > ALLEGATION_TARGET_CHARS and len(quotes) > 1:
        label0, quote0 = quotes[0]
        cite0 = f"{label0} " if label0 else ""
        text = f'{opener}, by having failed to {cite0}"{quote0}".'.strip()
    if len(text) > ALLEGATION_TARGET_CHARS + 40:
        # Last resort: shorten the single remaining quote in place
        label0, quote0 = quotes[0]
        cite0 = f"{label0} " if label0 else ""
        short = duty_phrase_from_text(quote0, max_chars=90)
        text = f'{opener}, by having failed to {cite0}"{short}".'.strip()

    return AllegationDraft(
        text=text,
        cites=cites[:MAX_DUTY_CLAUSES],
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
                "text": s.text,
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
