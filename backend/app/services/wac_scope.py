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
from dataclasses import dataclass, field
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

DUTY_MAX_CHARS = 480
# Allegation LINE: start with the strongest duties; Compare can add more from the pool.
# Never truncate or replace exact WAC duty wording to meet a character budget.
MAX_DUTY_CLAUSES = 2  # legacy tight default for callers that still pass max_subs=2
# Starting count for the drafted line — Compare can add more optional duties beyond this.
MAX_ALLEGATION_DRAFT_CLAUSES = 2
MAX_ALLEGATION_CLAUSES = 6  # optional-duty / chip pool
MAX_RANKED_SUBSECTIONS = 14
LOW_CONFIDENCE_SCORE = 0.15
# Application bands (raw ranked scores after TF-IDF + light boosts):
#   strong ≥ 0.50 | moderate 0.30–0.49 | weak < 0.30
STRONG_SCORE = 0.50
MODERATE_SCORE = 0.30
# Include strong + upper half of moderate (≥ midpoint of 0.30–0.49).
ALLEGATION_INCLUDE_MIN = 0.40
# Soft UI hint only — never used to shorten or rewrite statute duty text.
ALLEGATION_TARGET_CHARS = 1200
DEFAULT_QUOTE_MAX_CHARS = DUTY_MAX_CHARS
# Forbidden shortcut trailer (legacy bug). Never emit cite-only leftovers.
_SEE_ALSO_SHORTCUT_RE = re.compile(r";\s*see also\b.*$", re.IGNORECASE)


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
    """Allegation duty fragment — leaf-only exact PDF text (contiguous in the leaf node).

    We deliberately do NOT concatenate parent list-intro + leaf here, because that
    combined string is rarely a contiguous substring of any single PDF node and
    quote_verify then rewrites the line back to a bare leaf via
    ``repair_allegation_text_from_store``. The DOH Baseline shape works best when
    the drafted duty is an exact leaf phrase; promotion of bare-noun leaves to a
    verb/gerund-led ancestor happens in ``_prefer_verb_led_for_draft`` for the
    drafted line only — this helper stays leaf-only for chip / quote checks.
    """
    return duty_phrase_from_text(sub.text, max_chars=max_chars)


# Statute duty phrases read naturally after "by having failed to" when they open with a
# gerund (Adopting, Developing, Providing) or a common imperative verb (Provide, Ensure).
# Bare noun openers (Management, Environmental, Staff, Personnel, Contracts) do not — we
# still emit exact leaf text as a last resort, but promote to a verb-led ancestor when we
# can and prefer verb-led siblings in the drafted line.
_STATUTE_VERB_STARTERS = frozenset(
    {
        "adopt",
        "address",
        "adhere",
        "administer",
        "assess",
        "assign",
        "be",
        "conduct",
        "comply",
        "develop",
        "document",
        "ensure",
        "establish",
        "evaluate",
        "govern",
        "have",
        "implement",
        "keep",
        "make",
        "maintain",
        "manage",
        "monitor",
        "notify",
        "obtain",
        "orient",
        "prepare",
        "provide",
        "protect",
        "report",
        "retaliate",
        "review",
        "safeguard",
        "supervise",
        "train",
        "update",
        "use",
    }
)


_HANGING_DUTY_ENDINGS = frozenset(
    {
        "a",
        "an",
        "and",
        "by",
        "for",
        "including",
        "of",
        "or",
        "that",
        "the",
        "to",
        "which",
        "whose",
        "with",
    }
)


def _is_incomplete_duty_phrase(phrase: str) -> bool:
    """True when a duty fragment trails off mid-clause (list intros, truncated cuts)."""
    body = _strip_list_edge_punct(phrase or "")
    if not body:
        return True
    last = body.split()[-1].lower().strip(".,;:()[]\"'")
    return last in _HANGING_DUTY_ENDINGS


def _is_topic_heading_duty(phrase: str) -> bool:
    """Short noun/gerund headings that do not read after 'failed to' (e.g. Cleaning and disinfection)."""
    body = _strip_list_edge_punct(phrase or "")
    words = body.split()
    if len(words) <= 4:
        # Topic labels: "Hand hygiene", "Housekeeping functions", "Cleaning and disinfection"
        return True
    return False


def _is_verb_led_duty(phrase: str) -> bool:
    """True when the duty phrase opens with a gerund / imperative-verb form.

    Reads well after "by having failed to". Rejects bare-noun openers, short topic
    headings ("Cleaning and disinfection"), and hanging list intros ("… for", "… whose").
    Accepts Baseline-style "not retaliate…" (exact WAC after stripping "must").
    """
    body = _strip_list_edge_punct(phrase or "")
    if not body or _is_incomplete_duty_phrase(body):
        return False
    if _is_topic_heading_duty(body):
        # Still allow short imperatives: "Provide staffing", "Ensure safety"
        m = re.match(r"^[\(\[\"'“”]*([A-Za-z][A-Za-z\-]*)", body)
        if not m:
            return False
        first = m.group(1).lower()
        return first in _STATUTE_VERB_STARTERS and not first.endswith("ing")
    # Exact WAC "not retaliate against…" after ceremonial "must" strip
    body = re.sub(r"^not\s+", "", body, count=1, flags=re.IGNORECASE)
    m = re.match(r"^[\(\[\"'“”]*([A-Za-z][A-Za-z\-]*)", body)
    if not m:
        return False
    first = m.group(1).lower()
    if not first:
        return False
    if first.endswith("ing"):
        return True
    candidates = {first}
    if first.endswith("es") and len(first) > 3:
        candidates.add(first[:-2])  # addresses → address
    if first.endswith("s") and len(first) > 2:
        candidates.add(first[:-1])  # ensures → ensure
    return bool(candidates & _STATUTE_VERB_STARTERS)


def _complete_list_intro_duty(text: str) -> str:
    """Strip hanging list-intro tails (' for:', ' whose:', ' including:') to a complete gerund clause.

    The result remains a contiguous prefix of the source node text (sole-source safe).
    Prefer ``_compose_list_intro_leaf_duty`` when a concrete leaf topic exists — stripping
    ``for:`` alone drops the specific WAC item the allegation should cite.
    """
    body = normalize_statute_text(_clean(text))
    if not body:
        return ""
    # Drop trailing relative/prepositional hangers that introduce nested children.
    trimmed = re.sub(
        r"\s+(?:for|whose|which|that|including|with|of|to)\s*:?\s*$",
        "",
        body,
        flags=re.IGNORECASE,
    )
    trimmed = _strip_list_edge_punct(_strip_duty_leadins(trimmed))
    if not trimmed or _is_incomplete_duty_phrase(trimmed):
        return ""
    if not _is_verb_led_duty(trimmed):
        return ""
    return trimmed


def _is_hanging_list_intro(text: str) -> bool:
    """True when text is a list opener that expects nested leaf topics (… for:)."""
    body = normalize_statute_text(_clean(text))
    if not body:
        return False
    if _is_list_intro_stub(body):
        return True
    return bool(
        re.search(
            r"\b(?:for|whose|which|that|including)\s*:?\s*$",
            body,
            flags=re.IGNORECASE,
        )
    )


def _compose_list_intro_leaf_duty(sub: ScopedSubsection) -> str:
    """Exact WAC duty for a bare-noun leaf under a list intro (parent intro + leaf).

    Matches Compare's Exact PDF Subsection Text, e.g.:
      Developing written policies and procedures for: Management of staff …
      not retaliate against any: Employee of the agency
    Parent and leaf stay separate store nodes; the composed string is exact language
    from both, joined the same way as ``subsection_display_text``. Never paraphrased.
    """
    leaf = _strip_list_edge_punct(normalize_statute_text(sub.text or ""))
    if not leaf:
        return ""
    # Already a complete verb-led duty on the leaf itself — no parent join needed.
    if _is_verb_led_duty(leaf) and not _is_incomplete_duty_phrase(leaf):
        return ""
    context = subsection_ancestor_context(sub)
    if not context or not _is_hanging_list_intro(context):
        return ""
    display = _strip_list_edge_punct(subsection_display_text(sub))
    # PDF list tails often end with "; and" / "; or" — not part of the duty content.
    display = re.sub(r"(?:;?\s*(?:and|or))+$", "", display, flags=re.IGNORECASE).strip()
    display = _strip_list_edge_punct(display)
    if not display or display == leaf:
        return ""
    # Strip only ceremonial subject/modal prefixes; keep every remaining WAC word exact.
    phrase = _strip_list_edge_punct(_strip_duty_leadins(display))
    if not phrase:
        return ""
    if not _is_verb_led_duty(phrase) or _is_incomplete_duty_phrase(phrase):
        return ""
    return phrase


def gerund_opener_to_infinitive(phrase: str) -> str:
    """Fold a leading statute gerund to an infinitive so 'failed to …' reads as a sentence.

    Keeps the remainder of the WAC wording exact (including 'for: …' leaf topics).
    Developing → develop; Providing → provide; Ensuring → ensure.
    """
    body = (phrase or "").strip()
    if not body:
        return ""
    m = re.match(r"^([A-Za-z][A-Za-z\-]*)ing\b(.*)$", body)
    if not m:
        return body
    stem = m.group(1).lower()
    rest = m.group(2)
    candidates = [stem, f"{stem}e"]
    # Doubled consonant gerunds: running → run (rare in WAC openers)
    if len(stem) >= 2 and stem[-1] == stem[-2]:
        candidates.append(stem[:-1])
    for cand in candidates:
        if cand in _STATUTE_VERB_STARTERS:
            return f"{cand}{rest}"
    return body


def _promote_to_verb_led_parent(sub: ScopedSubsection) -> ScopedSubsection | None:
    """Return nearest verb-led ancestor as a ScopedSubsection using completed intro text.

    Used only when a bare-noun leaf would otherwise land in the drafted line. Prefer a
    complete gerund clause from the ancestor (stripping hanging 'for'/'whose') so the
    drafted line never ends mid-phrase. Text remains a contiguous prefix of the
    ancestor PDF node.
    """
    for parent_label in reversed(parent_subsection_labels(sub.label)):
        parent = validate_subsection_cite(sub.code, f"{sub.code}{parent_label}")
        if not parent:
            continue
        candidate = _complete_list_intro_duty(own_clause_text(parent.text))
        if not candidate:
            # Fall back to full own-clause when it is already a complete verb-led duty.
            intro = own_clause_text(parent.text)
            candidate = _strip_list_edge_punct(
                _strip_duty_leadins(normalize_statute_text(intro))
            )
            if (
                not candidate
                or len(candidate) < 20
                or _is_incomplete_duty_phrase(candidate)
                or not _is_verb_led_duty(candidate)
            ):
                continue
        return ScopedSubsection(
            code=parent.code,
            label=parent.label,
            hierarchy_path=parent.hierarchy_path,
            title=parent.title,
            text=candidate,
            level=parent.level,
            score=sub.score,
            reason=sub.reason,
            instrument=parent.instrument,
        )
    return None


def _prefer_verb_led_for_draft(
    subs: list[ScopedSubsection], count: int
) -> list[ScopedSubsection]:
    """Reorder chip selection into a draft-line ordering.

    Only verb/gerund-led, complete duties enter the drafted line. Bare-noun leaves under
    a list intro keep their leaf cite and use exact parent-intro + leaf WAC text (same as
    Compare's Exact PDF view). Otherwise promote to a completed verb-led ancestor when
    possible; never emit "failed to Management of…".
    """
    if count <= 0 or not subs:
        return []
    verb_led: list[ScopedSubsection] = []
    bare: list[ScopedSubsection] = []
    for s in subs:
        # Skip hanging parent list intros when we can draft from their leaves instead.
        if _is_hanging_list_intro(own_clause_text(s.text) or s.text):
            # Still allow if no leaf composition is possible elsewhere — handled below
            # only when this node itself has actionable nested text already in s.text.
            if _looks_like_container(s.text) or _is_list_intro_stub(own_clause_text(s.text) or ""):
                bare.append(s)
                continue
        composed = _compose_list_intro_leaf_duty(s)
        if composed:
            verb_led.append(
                ScopedSubsection(
                    code=s.code,
                    label=s.label,
                    hierarchy_path=s.hierarchy_path,
                    title=s.title,
                    text=composed,
                    level=s.level,
                    score=s.score,
                    reason=s.reason,
                    instrument=s.instrument,
                )
            )
            continue
        phrase = duty_phrase_from_text(s.text)
        # Prefer completed list-intro text when the raw duty hangs (e.g. "… for").
        if _is_incomplete_duty_phrase(phrase) or not phrase:
            completed = _complete_list_intro_duty(own_clause_text(s.text) or s.text)
            if completed and not _is_hanging_list_intro(own_clause_text(s.text) or ""):
                verb_led.append(
                    ScopedSubsection(
                        code=s.code,
                        label=s.label,
                        hierarchy_path=s.hierarchy_path,
                        title=s.title,
                        text=completed,
                        level=s.level,
                        score=s.score,
                        reason=s.reason,
                        instrument=s.instrument,
                    )
                )
                continue
            if completed and _is_hanging_list_intro(own_clause_text(s.text) or ""):
                # Parent-only "Developing written policies…" without a leaf topic —
                # keep as last-resort bare; prefer sibling leaves when present.
                bare.append(s)
                continue
        if _is_verb_led_duty(phrase) and not _is_incomplete_duty_phrase(phrase):
            verb_led.append(s)
        else:
            bare.append(s)
    if len(verb_led) >= count:
        return verb_led[:count]
    result: list[ScopedSubsection] = list(verb_led)
    seen_labels: set[str] = {s.label for s in result if s.label}
    for s in bare:
        if len(result) >= count:
            break
        composed = _compose_list_intro_leaf_duty(s)
        if composed and s.label and s.label not in seen_labels:
            result.append(
                ScopedSubsection(
                    code=s.code,
                    label=s.label,
                    hierarchy_path=s.hierarchy_path,
                    title=s.title,
                    text=composed,
                    level=s.level,
                    score=s.score,
                    reason=s.reason,
                    instrument=s.instrument,
                )
            )
            seen_labels.add(s.label)
            continue
        # Do not promote hanging parents into the line when leaves already cover them.
        if _is_hanging_list_intro(own_clause_text(s.text) or s.text):
            continue
        promoted = _promote_to_verb_led_parent(s)
        if promoted and promoted.label and promoted.label not in seen_labels:
            result.append(promoted)
            seen_labels.add(promoted.label)
    return result[:count]


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
# Domain markers that disqualify a leaf when absent from the complaint
# (e.g. gambling / seclusion / OTP specialty leaves on an unrelated complaint).
_ALLEGATION_DOMAIN_EXCLUSIVE_TOKENS = frozenset(
    {
        "gambling",
        "gambler",
        "casino",
        "seclusion",
        "restraint",
        "restraints",
        "opioid",
        "methadone",
        "buprenorphine",
        "otp",
        "withdrawal",
        "detoxification",
        "detox",
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
    """Inject curated umbrella duties only when the code already shows complaint signal.

    Avoids forcing 0410(1)(a–c) / similar umbrellas onto narrow complaints (e.g. meds-only)
    merely because the parent code was authorized. Requires an existing moderate+ or
    explicit-cite leaf among non-anchor ranks before anchors are injected.
    """
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    wanted = STRUCTURAL_ANCHORS.get(code)
    if not wanted:
        return ranked
    has_signal = any(
        s.reason == "explicit_cite" or float(s.score) >= MODERATE_SCORE
        for s in ranked
        if s.reason != "structural_anchor"
    )
    if not has_signal:
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
    on a medication-error complaint). Explicit complaint cites skip this gate; structural
    anchors must still share complaint substance so umbrella duties are not forced in.
    """
    if sub.reason == "explicit_cite":
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
    # Structural anchors never qualify on weak-role-only overlap.
    if sub.reason == "structural_anchor":
        return False
    return bool(shared) and float(sub.score) >= STRONG_SCORE


def select_for_allegation(
    ranked: list[ScopedSubsection],
    *,
    max_items: int = MAX_ALLEGATION_CLAUSES,
    complaint: str = "",
) -> list[ScopedSubsection]:
    """Strong + upper-moderate + overlap-passing anchors for allegation/compare chips.

    Applies a complaint-overlap gate so weak TF-IDF leaves (gambling staffing, generic
    clinical supervision on a meds complaint, etc.) are dropped rather than forced in.
    Structural anchors must pass the same substance gate (explicit cites still skip it).
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
        if s.reason == "explicit_cite":
            selected.append(s)
            used.add(key)
        elif s.reason == "structural_anchor":
            if subsection_passes_complaint_overlap(complaint, s):
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
        if s.reason == "structural_anchor":
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


def _strip_duty_leadins(body: str) -> str:
    """Trim ceremonial subjects and modal helpers so duty text reads after 'failed to'.

    Only removes a leading subject/modal prefix that is already present in the PDF
    sentence — never rewrites the remaining statute words. Applied so Baseline
    "by having failed to …" lines keep exact WAC duty language.
    """
    body = (body or "").strip()
    # An/the/each agency or agency provider | administrator | facility | …
    body = re.sub(
        r"^(?:(?:an|the|each)\s+)?("
        r"agency(?:\s+or\s+agency\s+provider)?(?:\s+administrator)?|"
        r"administrator(?:\s+or\s+their\s+designee)?|"
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
    # Do not strip a lone "ensure/ensuring" when it is the statute verb itself after failed to.
    return body


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
        body = _strip_duty_leadins(normalized)
        phrase = sanitize_for_outer_quotes(body)
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
    body = _strip_duty_leadins(re.sub(r"\s+", " ", raw).strip())
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
    """Baseline IR allegation shape: no quotation marks; clean clause punctuation.

    Also strips the forbidden legacy "; see also (labels)" shortcut trailer — that
    path must never survive into Compare/Report.
    """
    out = (text or "").replace('"', "").replace("“", "").replace("”", "").replace("„", "")
    out = re.sub(r"\s+", " ", out).strip()
    # Forbidden shortcut: cite-only leftovers after a truncated first duty
    out = _SEE_ALSO_SHORTCUT_RE.sub("", out).strip()
    out = re.sub(r"\bsee also\b.*$", "", out, flags=re.IGNORECASE).strip()
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
    """Return (label, short exact PDF duty phrase) pairs — never full subsection dumps.

    Two-word bare-noun leaves like "Hand hygiene" / "Resident hygiene" pass the
    word-count floor so infection-control style codes can still surface specific
    labeled duties alongside a promoted verb-led parent.
    """
    out: list[tuple[str, str]] = []
    for s in subs:
        body = _clean(s.text)
        if len(body.split()) < 2:
            continue
        quote = _duty_phrase_for_option(s)
        if not quote:
            # Prefer a completed list-intro when the stored text hangs ("… for:").
            completed = _complete_list_intro_duty(own_clause_text(s.text) or s.text)
            if completed:
                quote = completed
            else:
                quote = duty_phrase_from_subsection(s, max_chars=max_chars)
        if len(quote.split()) < 2:
            continue
        if _is_incomplete_duty_phrase(quote):
            continue
        # Draft-line callers pass already-preferred subs; still refuse bare topic headings
        # that cannot follow "failed to" unless they are true imperatives.
        if not _is_verb_led_duty(quote):
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
    # Optional duties for Compare checkboxes (strong→moderate); start with top 2 included.
    duty_options: list[dict[str, Any]] = field(default_factory=list)

    # Tuple-unpacking compatibility for older callers: text, cites = draft
    def __iter__(self):
        yield self.text
        yield self.cites


def _score_band(score: float) -> str:
    if float(score) >= STRONG_SCORE:
        return "strong"
    if float(score) >= MODERATE_SCORE:
        return "moderate"
    return "weak"


def _duty_phrase_for_option(sub: ScopedSubsection) -> str:
    """Exact duty phrase for a draft/option leaf — list-intro + leaf when needed."""
    # Resolve from the store node for this label so composed intros stay exact even
    # when ``_prefer_verb_led_for_draft`` already rewrote ``sub.text``.
    src = sub
    if sub.label:
        store_sub = validate_subsection_cite(sub.code, f"{sub.code}{sub.label}")
        if store_sub:
            src = store_sub
    composed = _compose_list_intro_leaf_duty(src)
    if composed:
        return composed

    # Promoted / rewritten draft text on ``sub`` (contiguous prefix of the store node).
    drafted = _strip_list_edge_punct(normalize_statute_text(sub.text or ""))
    store_body = normalize_statute_text(src.text or "")
    if (
        drafted
        and _is_verb_led_duty(drafted)
        and not _is_incomplete_duty_phrase(drafted)
        and drafted.lower() in store_body.lower()
    ):
        return drafted

    # Hanging parent list intros: only the completed verb clause (no bare "for:").
    if _is_hanging_list_intro(own_clause_text(src.text) or src.text):
        completed = _complete_list_intro_duty(own_clause_text(src.text) or src.text)
        if completed and _is_verb_led_duty(completed) and not _is_incomplete_duty_phrase(completed):
            return completed
        return ""

    completed = _complete_list_intro_duty(own_clause_text(src.text) or src.text)
    if completed and _is_verb_led_duty(completed) and not _is_incomplete_duty_phrase(completed):
        return completed
    phrase = duty_phrase_from_subsection(src, max_chars=DUTY_MAX_CHARS)
    if phrase and _is_verb_led_duty(phrase) and not _is_incomplete_duty_phrase(phrase):
        return phrase
    return ""


def compose_allegation_from_duties(
    code: str,
    title: str,
    duties: list[tuple[str, str]],
    *,
    preferred_connector: str | None = None,
) -> str:
    """Compose a Baseline allegation line from (label, exact_duty_phrase) pairs.

    Duty phrases stay exact PDF wording (list-intro + leaf when needed). After
    ``having failed to`` / ``failing to``, a leading gerund is folded to an
    infinitive so the line reads as a sentence (Developing → develop).
    """
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    prefix = cite_prefix(code)
    connector = (preferred_connector or "having failed to").strip().lower()
    if connector not in {"having failed to", "failing to", "not", "violating"}:
        connector = "having failed to"
    clean_title = _clean(title).replace("—", " - ").replace("–", " - ")
    if len(clean_title) > 80:
        clean_title = clean_title[:77].rstrip() + "…"
    opener = f"Potential violation of {prefix} {code}, {clean_title}"
    fold_infinitive = connector in {"having failed to", "failing to"}

    parts: list[str] = []
    for label, phrase in duties:
        quote = _strip_list_edge_punct(phrase or "")
        if not quote:
            continue
        if fold_infinitive:
            quote = gerund_opener_to_infinitive(quote)
        cite = f"{label} " if label else ""
        frag = f"{cite}{quote}".strip()
        parts.append(frag if not parts else f"and {frag}")
    if not parts:
        return f"{opener}, as applied to the reported concern in the complaint intake."
    return _allegation_without_quotes(f"{opener}, by {connector} {'; '.join(parts)}.")


def allegation_has_shortcut(text: str) -> bool:
    """True when a draft used the forbidden cite-only / see-also shortcut."""
    body = text or ""
    if _SEE_ALSO_SHORTCUT_RE.search(body):
        return True
    return bool(re.search(r"\bsee also\b", body, flags=re.IGNORECASE))


def build_allegation_duty_options(
    code: str,
    selection: list[ScopedSubsection],
    *,
    start_count: int = MAX_ALLEGATION_DRAFT_CLAUSES,
) -> list[dict[str, Any]]:
    """Strong→moderate duty options for Compare: start with top ``start_count`` included.

    Returns dicts: cite, label, duty_phrase, score, band, included_by_default.
    """
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    prefix = cite_prefix(code)
    eligible = _prefer_verb_led_for_draft(
        selection, count=max(len(selection), start_count, MAX_ALLEGATION_CLAUSES)
    )
    # Strongest first for the starting pair; keep relative score order.
    eligible_sorted = sorted(
        eligible,
        key=lambda s: (-float(s.score), 0 if _score_band(s.score) == "strong" else 1, s.label or ""),
    )
    options: list[dict[str, Any]] = []
    seen: set[str] = set()
    for s in eligible_sorted:
        phrase = _duty_phrase_for_option(s)
        if not phrase:
            continue
        label = s.label or ""
        key = label or s.hierarchy_path
        if key in seen:
            continue
        seen.add(key)
        cite = f"{prefix} {code}{label}" if label else f"{prefix} {code}"
        options.append(
            {
                "cite": cite,
                "label": label,
                "duty_phrase": phrase,
                "score": round(float(s.score), 4),
                "band": _score_band(s.score),
                "included_by_default": len(options) < start_count,
            }
        )
        if len(options) >= MAX_ALLEGATION_CLAUSES:
            break
    return options


def draft_allegation_from_source(
    code: str,
    title: str,
    complaint: str,
    *,
    max_subs: int = MAX_ALLEGATION_DRAFT_CLAUSES,
    relevant: list[ScopedSubsection] | None = None,
    preferred_connector: str | None = None,
) -> AllegationDraft:
    """Build a DOH-shaped allegation from ranked PDF duty phrases.

    Starts with up to ``max_subs`` labeled duties (default 2 — strongest first).
    ``duty_options`` lists additional strong/moderate duties investigators can add
    in Compare. ``cites`` keeps the wider chip selection. Shape:
      Potential violation of WAC {code}, {title}, by having failed to (1)(a) …; and (2) ….
    """
    code = code.replace("WAC ", "").replace("RCW ", "").strip()
    connector = (preferred_connector or "having failed to").strip().lower()
    if connector not in {"having failed to", "failing to", "not", "violating"}:
        connector = "having failed to"
    if relevant is None:
        ranked = score_relevant_subsections(
            complaint, code, max_items=MAX_RANKED_SUBSECTIONS
        )
        selection = select_for_allegation(
            ranked, max_items=MAX_ALLEGATION_CLAUSES, complaint=complaint
        )
    else:
        selection = select_for_allegation(
            list(relevant), max_items=MAX_ALLEGATION_CLAUSES, complaint=complaint
        )

    duty_options = build_allegation_duty_options(
        code, selection, start_count=max_subs
    )
    included = [o for o in duty_options if o.get("included_by_default")]
    if not included and duty_options:
        included = duty_options[:max_subs]

    def _cite_for_option(o: dict[str, Any]) -> str:
        label = o.get("label") or ""
        return f"{code}{label}" if label else code

    cites: list[str] = []
    seen_cites: set[str] = set()
    for o in included + duty_options:
        c = _cite_for_option(o)
        if c and c not in seen_cites:
            seen_cites.add(c)
            cites.append(c)
    # Also keep raw selection cites for chip coverage
    for s in selection:
        c = f"{code}{s.label}" if s.label else code
        if c not in seen_cites:
            seen_cites.add(c)
            cites.append(c)
    cites = cites[:MAX_ALLEGATION_CLAUSES]

    top_score = max((s.score for s in selection), default=0.0)
    top_reason = selection[0].reason if selection else "code_fallback"
    if selection and selection[0].reason == "code_fallback":
        top_reason = "code_fallback"
    low_confidence = top_reason == "code_fallback" or top_score < LOW_CONFIDENCE_SCORE

    if not selection:
        return AllegationDraft(
            text=compose_allegation_from_duties(code, title, [], preferred_connector=connector),
            cites=[],
            match_reason="code_fallback",
            match_score=0.0,
            low_confidence=True,
            duty_options=[],
        )

    if not included:
        return AllegationDraft(
            text=compose_allegation_from_duties(code, title, [], preferred_connector=connector),
            cites=cites,
            match_reason=top_reason,
            match_score=top_score,
            low_confidence=True,
            duty_options=duty_options,
        )

    duties = [(str(o.get("label") or ""), str(o.get("duty_phrase") or "")) for o in included]
    text = compose_allegation_from_duties(
        code, title, duties, preferred_connector=connector
    )
    return AllegationDraft(
        text=text,
        cites=cites,
        match_reason=top_reason,
        match_score=top_score,
        low_confidence=low_confidence,
        duty_options=duty_options,
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
        ranked = score_relevant_subsections(complaint, code, max_items=max(14, max_subs_per_code))
        relevant = select_for_allegation(
            ranked, max_items=max_subs_per_code, complaint=complaint
        )
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
