"""Rank case exhibit text against allegation / Regulatory Framework duties.

Evidence excerpts are exhibit language only. They are not statute authority
and must never replace PDF-backed WAC/RCW quotes.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS

from app.config import settings
from app.database import CaseEvidence, InvestigationCase
from app.rag.store import wac_store
from app.schemas import EvidenceReviewHit, InvestigationReport
from app.services.documents import extract_text_from_bytes
from app.services.wac_scope import (
    normalize_statute_text,
    strip_foreign_jurisdiction_cites,
    subsection_display_text,
    subsection_label,
    validate_subsection_cite,
)

_STOP = frozenset(ENGLISH_STOP_WORDS)
_WORD = re.compile(r"[a-z]{3,}")
_SENT_SPLIT = re.compile(r"(?<=[.!;:])\s+")
_CITE_CODE = re.compile(
    r"(246-(?:341|337)-\d{3,4}|71\.(?:05|24|34)\.\d{3,4})",
    re.IGNORECASE,
)
_WA_CITE = re.compile(
    r"\b(?:WAC|RCW)\s*(246-(?:341|337)-\d{3,4}|71\.(?:05|24|34)\.\d{3,4})"
    r"(?:\s*((?:\([^)]+\))+))?",
    re.IGNORECASE,
)
_CITE_TOKEN = re.compile(
    r"\b(?:WAC|RCW|CFR|USC|NMAC|MCA|VAC|COMAR|OAR|IAC|CAC)\b"
    r"|\b\d{1,3}VAC\d+"
    r"|§\s*\d+"
    r"|\b\d+\.\d{2,4}\.\d+",
    re.IGNORECASE,
)
_GENERIC = frozenset(
    {
        "agency",
        "applicable",
        "client",
        "code",
        "document",
        "ensure",
        "facility",
        "federal",
        "following",
        "including",
        "individual",
        "must",
        "patient",
        "policies",
        "policy",
        "procedure",
        "procedures",
        "regulation",
        "regulations",
        "requirement",
        "requirements",
        "review",
        "rcw",
        "service",
        "services",
        "shall",
        "staff",
        "state",
        "wac",
        "written",
    }
)
_CITE_NOISE = frozenset(
    {
        "cac",
        "cfr",
        "chapter",
        "code",
        "codes",
        "comar",
        "iar",
        "mca",
        "nmac",
        "oar",
        "rcw",
        "section",
        "sections",
        "subsection",
        "title",
        "usc",
        "vac",
        "wac",
    }
)

MIN_CHUNK_CHARS = 40
MAX_CHUNK_CHARS = 420
DISPLAY_EXCERPT_CHARS = 800
MAX_CHUNKS_PER_FILE = 80
MAX_HITS_PER_CITE = 4
MAX_HITS_TOTAL = 40
INCLUDE_MIN = 0.32
DISPLAY_MIN = 0.22
MIN_DISTINCT_OVERLAP = 2
STRONG_SCORE = 0.50
MODERATE_SCORE = 0.30

EXHIBIT_PROCESS_PREFIX = 'The investigator reviewed "'
LEGACY_EXHIBIT_PREFIX = "Record review of exhibit"
DOC_REVIEW_LABEL = "Document Review"
DOC_REVIEW_PLACEHOLDER = (
    "The Investigator will review facility policies, procedures, and records relevant "
    "to the authorized allegations."
)
MISSING_DOCUMENT_DATE = "[document date]"


def evidence_file_path(ev: CaseEvidence) -> Path:
    stored = (ev.stored_path or "").replace("\\", "/")
    return settings.cases_dir / stored


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if w not in _STOP}


def _content_tokens(text: str) -> set[str]:
    return {
        w
        for w in _tokens(text)
        if w not in _GENERIC and w not in _CITE_NOISE and len(w) >= 4
    }


def _overlap_score(query: str, chunk: str) -> float:
    """Duty-language overlap. Cite tokens (WAC/VAC/NMAC) do not count."""
    q = _content_tokens(query)
    c = _content_tokens(chunk)
    if len(q) < 3:
        q = _tokens(query) - _CITE_NOISE - _GENERIC
        c = _tokens(chunk) - _CITE_NOISE - _GENERIC
    if not q or not c:
        return 0.0
    inter = q & c
    if len(inter) < MIN_DISTINCT_OVERLAP:
        return 0.0
    return len(inter) / ((len(q) ** 0.5) * (len(c) ** 0.5))


def _prose_only(text: str) -> str:
    """Exhibit language with jurisdiction cite tokens removed."""
    body = strip_foreign_jurisdiction_cites(text or "")
    body = _WA_CITE.sub(" ", body)
    body = _CITE_TOKEN.sub(" ", body)
    return re.sub(r"\s+", " ", body).strip()


def is_citation_catalog(text: str) -> bool:
    """True when a chunk is mostly a multi-jurisdiction cite table, not policy language."""
    prose = _prose_only(text)
    if len(prose) >= MIN_CHUNK_CHARS and len(_content_tokens(prose)) >= 6:
        return False
    cites = _CITE_TOKEN.findall(text or "")
    words = _WORD.findall((text or "").lower())
    if len(cites) >= 4:
        return True
    if len(cites) >= 2 and words and len(cites) / max(len(words), 1) >= 0.22:
        return True
    foreign = len(_CITE_TOKEN.findall(text or "")) - len(_WA_CITE.findall(text or ""))
    if foreign >= 2 and len(_content_tokens(prose)) < 8:
        return True
    return False


def _parse_cite(cite: str) -> tuple[str, str]:
    raw = re.sub(r"^(?:WAC|RCW)\s+", "", (cite or "").strip(), flags=re.IGNORECASE)
    m = re.match(
        r"(246-(?:341|337)-\d{3,4}|71\.(?:05|24|34)\.\d{3,4})((?:\([^)]+\))*)",
        raw,
        flags=re.IGNORECASE,
    )
    if m:
        return m.group(1), m.group(2) or ""
    found = _CITE_CODE.search(raw)
    return (found.group(1), "") if found else (raw, "")


def _store_duty_query(cite: str, phrase: str) -> str:
    """Washington PDF node text for this duty. Cite numbers are not the query."""
    code, label = _parse_cite(cite)
    if code:
        sub = validate_subsection_cite(code, f"{code}{label}" if label else code)
        if sub and (sub.text or "").strip():
            return subsection_display_text(sub)
    return normalize_statute_text(phrase)


def _score_band(score: float) -> str:
    if score >= STRONG_SCORE:
        return "strong"
    if score >= MODERATE_SCORE:
        return "moderate"
    return "weak"


def _is_weak_heading(text: str) -> bool:
    body = re.sub(r"\s+", " ", text or "").strip()
    if not body:
        return True
    if re.match(r"^(subject|title|re|policy name|header)\s*:", body, flags=re.I):
        return True
    if len(body) < 48 and body[-1] not in ".!?":
        return True
    return False


_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
_DATE_LABEL = re.compile(
    r"(?:effective(?:\s+date)?|revised(?:\s+date)?|last\s+review(?:ed)?|"
    r"date\s+adopted|adopted|revision\s+date|policy\s+date|date)\s*[:\-]?\s*",
    flags=re.I,
)
_DATE_VALUE = re.compile(
    r"(?P<month>January|February|March|April|May|June|July|August|September|"
    r"October|November|December)\s+(?P<day>\d{1,2}),\s+(?P<year>\d{4})"
    r"|(?P<m>\d{1,2})/(?P<d>\d{1,2})/(?P<y>\d{2,4})"
    r"|(?P<iso>\d{4}-\d{2}-\d{2})",
    flags=re.I,
)


def _format_ymd(year: int, month: int, day: int) -> str:
    if month < 1 or month > 12 or day < 1 or day > 31:
        return ""
    return f"{_MONTHS[month - 1]} {day}, {year}"


def extract_document_date(text: str) -> str:
    """Pull an effective/revised date from exhibit text. Empty if none found."""
    body = (text or "")[:4000]
    if not body.strip():
        return ""
    labeled = _DATE_LABEL.search(body)
    search_from = labeled.start() if labeled else 0
    window = body[search_from : search_from + 400] if labeled else body[:800]
    match = _DATE_VALUE.search(window) or _DATE_VALUE.search(body[:1200])
    if not match:
        return ""
    if match.group("month"):
        month = {m.lower(): i + 1 for i, m in enumerate(_MONTHS)}[match.group("month").lower()]
        return _format_ymd(int(match.group("year")), month, int(match.group("day")))
    if match.group("iso"):
        y, m, d = match.group("iso").split("-")
        return _format_ymd(int(y), int(m), int(d))
    year = int(match.group("y"))
    if year < 100:
        year += 2000 if year < 70 else 1900
    return _format_ymd(year, int(match.group("m")), int(match.group("d")))


def format_document_date(raw: str | None) -> str:
    text = (raw or "").strip()
    if not text or text == MISSING_DOCUMENT_DATE:
        return MISSING_DOCUMENT_DATE
    parsed = extract_document_date(text)
    if parsed:
        return parsed
    if re.match(
        r"^(January|February|March|April|May|June|July|August|September|"
        r"October|November|December) \d{1,2}, \d{4}$",
        text,
    ):
        return text
    return MISSING_DOCUMENT_DATE


def display_evidence_title(title: str) -> str:
    name = (title or "document").strip()
    name = re.sub(r"\.(pdf|docx?|txt|md|png|jpe?g|webp)$", "", name, flags=re.I)
    name = re.sub(r'[“”"]+', "", name).strip()
    return name or "document"


def complete_sentence_excerpt(text: str, max_chars: int = DISPLAY_EXCERPT_CHARS) -> str:
    body = re.sub(r"\s+", " ", text or "").strip()
    body = body.replace("…", " ").replace("...", " ")
    if not body:
        return ""
    parts = [p.strip() for p in _SENT_SPLIT.split(body) if p.strip()]
    kept: list[str] = []
    for part in parts:
        if _is_weak_heading(part) and not kept:
            continue
        if is_citation_catalog(part):
            continue
        trial = " ".join([*kept, part]).strip()
        if len(trial) > max_chars:
            break
        kept.append(part)
        if len(trial) >= 180 and trial[-1] in ".!?":
            break
    out = " ".join(kept).strip()
    if not out:
        return ""
    if len(out) > max_chars:
        out = out[:max_chars].rsplit(" ", 1)[0].rstrip()
    if out[-1] not in ".!?":
        out = out.rstrip(" :,;") + "."
    return out


def is_exhibit_process_line(line: str) -> bool:
    s = (line or "").strip()
    low = s.lower()
    if low.startswith('the investigator reviewed "') or low.startswith(
        "the investigator reviewed “"
    ):
        return True
    if s.startswith(LEGACY_EXHIBIT_PREFIX):
        return True
    if re.match(r"^exhibit\s+\d+\s*:", s, flags=re.I):
        return True
    return False


def _duty_focused_excerpt(raw: str, statute_query: str) -> str:
    """Prefer sentences that overlap the WAC duty, not a heading or cite table."""
    text = (raw or "").strip()
    if not text:
        return ""
    parts = [p.strip() for p in _SENT_SPLIT.split(text) if p.strip()]
    if not parts:
        return ""
    ranked_idx = sorted(
        range(len(parts)),
        key=lambda i: _overlap_score(statute_query, parts[i]),
        reverse=True,
    )
    start = None
    for i in ranked_idx:
        if is_citation_catalog(parts[i]) or _is_weak_heading(parts[i]):
            continue
        if _overlap_score(statute_query, parts[i]) > 0 or len(parts[i]) >= MIN_CHUNK_CHARS:
            start = i
            break
    if start is None:
        return ""
    return complete_sentence_excerpt(" ".join(parts[start:]), DISPLAY_EXCERPT_CHARS)


def _store_label_scores(chunk: str, code: str) -> dict[str, float]:
    """Retrieve WAC/RCW leaves for this exhibit chunk, scoped to one approved code."""
    if not wac_store.ready or not code or len(chunk) < MIN_CHUNK_CHARS:
        return {}
    query = strip_foreign_jurisdiction_cites(chunk)[:4000]
    if len(query) < MIN_CHUNK_CHARS:
        return {}
    out: dict[str, float] = {}
    try:
        for node, score in wac_store.search(
            query, selected_codes={code}, top_k=8, min_score=0.02
        ):
            lab = subsection_label(node).lower()
            if lab:
                out[lab] = max(out.get(lab, 0.0), float(score))
    except Exception:
        pass
    try:
        for node, score in wac_store.search_chroma(
            query[:2000], top_k=6, selected_codes={code}
        ):
            lab = subsection_label(node).lower()
            if lab:
                out[lab] = max(out.get(lab, 0.0), float(score) * 0.85)
    except Exception:
        pass
    return out


def chunk_evidence_text(text: str) -> list[str]:
    body = re.sub(r"[ \t]+", " ", text or "")
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    if not body:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    chunks: list[str] = []
    for para in paras:
        if len(para) <= MAX_CHUNK_CHARS:
            if len(para) >= MIN_CHUNK_CHARS:
                chunks.append(para)
            continue
        parts = _SENT_SPLIT.split(para)
        buf = ""
        for part in parts:
            piece = part.strip()
            if not piece:
                continue
            trial = f"{buf} {piece}".strip() if buf else piece
            if len(trial) <= MAX_CHUNK_CHARS:
                buf = trial
                continue
            if buf and len(buf) >= MIN_CHUNK_CHARS:
                chunks.append(buf)
            buf = piece[:MAX_CHUNK_CHARS]
        if buf and len(buf) >= MIN_CHUNK_CHARS:
            chunks.append(buf)
        if len(chunks) >= MAX_CHUNKS_PER_FILE:
            break
    return chunks[:MAX_CHUNKS_PER_FILE]


def _hit_id(evidence_id: int, cite: str, excerpt: str) -> str:
    digest = hashlib.sha1(f"{evidence_id}|{cite}|{excerpt[:180]}".encode("utf-8")).hexdigest()[:12]
    return f"ev{evidence_id}-{digest}"


def _cite_title_map(report: InvestigationReport) -> dict[str, str]:
    """Map full cite strings to Washington code titles from Compare / RF / allegations."""
    titles: dict[str, str] = {}

    def note(cite: str, title: str) -> None:
        c = (cite or "").strip()
        t = (title or "").strip()
        if c and t and c not in titles:
            titles[c] = t

    for comp in report.comparisons or []:
        t = (comp.title or "").strip()
        for opt in comp.duty_options or []:
            note(opt.cite, t)
        for cite in comp.matched_subsections or []:
            note(str(cite), t)

    for entry in report.regulatory_framework or []:
        t = (entry.title or "").strip()
        prefix = entry.instrument or "WAC"
        code = entry.code
        note(f"{prefix} {code}", t)
        for sub in entry.subsections or []:
            cite = str(sub.get("cite") or "")
            if not cite:
                label = str(sub.get("label") or "")
                cite = f"{prefix} {code}{label}" if label else f"{prefix} {code}"
            note(cite, t)

    for alleg in report.allegations or []:
        t = (alleg.wac_title or "").strip()
        code = (alleg.wac_code or "").strip()
        if code and t:
            note(f"WAC {code}", t)
            note(code, t)

    return titles


def _title_for_cite(cite: str, title_map: dict[str, str]) -> str:
    cite = (cite or "").strip()
    if cite in title_map:
        return title_map[cite]
    code, _ = _parse_cite(cite)
    if code and wac_store.ready:
        node = wac_store.code_index.get(code)
        if node and (node.title or "").strip():
            return node.title.strip()
    return ""


def _duty_targets(report: InvestigationReport) -> list[tuple[str, str, str]]:
    """(cite, duty_phrase, query_blob) from Compare duties + RF subsections."""
    seen: set[str] = set()
    out: list[tuple[str, str, str]] = []

    def add(cite: str, phrase: str) -> None:
        cite = (cite or "").strip()
        phrase = normalize_statute_text(phrase)
        if not cite or len(phrase) < 12:
            return
        key = f"{cite}|{phrase[:80].lower()}"
        if key in seen:
            return
        seen.add(key)
        query = _store_duty_query(cite, phrase)
        out.append((cite, phrase, query))

    for comp in report.comparisons or []:
        opts = [o for o in (comp.duty_options or []) if o.included_by_default] or list(
            comp.duty_options or []
        )
        for opt in opts:
            add(opt.cite, opt.duty_phrase)
        texts = comp.matched_subsection_texts or []
        for i, cite in enumerate(comp.matched_subsections or []):
            if i < len(texts):
                add(cite, texts[i])

    for entry in report.regulatory_framework or []:
        code = entry.code
        prefix = entry.instrument or "WAC"
        for sub in entry.subsections or []:
            cite = str(sub.get("cite") or "")
            if not cite:
                label = str(sub.get("label") or "")
                cite = f"{prefix} {code}{label}" if label else f"{prefix} {code}"
            add(cite, str(sub.get("text") or ""))

    return out


def extract_evidence_text(ev: CaseEvidence) -> str:
    path = evidence_file_path(ev)
    if not path.is_file():
        return ""
    name = ev.original_filename or path.name
    lower = name.lower()
    if Path(lower).suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        return ""
    try:
        return extract_text_from_bytes(name, path.read_bytes())
    except Exception:
        return ""


def review_case_evidence(
    case: InvestigationCase,
    report: InvestigationReport,
) -> list[EvidenceReviewHit]:
    targets = _duty_targets(report)
    if not targets:
        return []
    title_map = _cite_title_map(report)
    files = list(case.evidence or [])
    if not files:
        return []

    file_chunks: list[tuple[CaseEvidence, str, str]] = []
    file_dates: dict[int, str] = {}
    for ev in files:
        text = extract_evidence_text(ev)
        file_dates[ev.id] = extract_document_date(text)
        for chunk in chunk_evidence_text(text):
            file_chunks.append((ev, chunk, normalize_statute_text(chunk)))

    hits: list[EvidenceReviewHit] = []
    per_cite: dict[str, int] = {}
    ranked: list[tuple[float, EvidenceReviewHit]] = []
    rag_cache: dict[tuple[int, str], dict[str, float]] = {}
    for ev, raw, chunk in file_chunks:
        if is_citation_catalog(raw):
            continue
        match_text = _prose_only(raw) or strip_foreign_jurisdiction_cites(chunk)
        if len(match_text) < MIN_CHUNK_CHARS:
            continue
        for cite, phrase, query in targets:
            lex = max(
                _overlap_score(phrase, match_text),
                _overlap_score(query, match_text),
            )
            if lex < 0.12:
                continue
            code, label = _parse_cite(cite)
            cache_key = (id(match_text), code)
            if cache_key not in rag_cache:
                rag_cache[cache_key] = _store_label_scores(match_text, code)
            label_key = (label or "").lower()
            rag_map = {k.lower(): v for k, v in rag_cache[cache_key].items()}
            rag = rag_map.get(label_key, 0.0) if label_key else 0.0
            if not rag and not label and rag_cache[cache_key]:
                rag = max(rag_cache[cache_key].values())
            score = (0.62 * lex) + (0.38 * rag) if rag else lex
            if rag:
                score = max(score, 0.5 * lex + 0.5 * rag)
            if score < DISPLAY_MIN and rag < 0.22:
                continue
            if lex < 0.18 and rag < 0.28:
                continue
            excerpt = _duty_focused_excerpt(raw, query) or complete_sentence_excerpt(match_text)
            if not excerpt or is_citation_catalog(excerpt):
                continue
            hit = EvidenceReviewHit(
                id=_hit_id(ev.id, cite, excerpt),
                evidence_id=ev.id,
                evidence_title=ev.title or ev.original_filename or f"Exhibit {ev.id}",
                cite=cite,
                wac_title=_title_for_cite(cite, title_map),
                duty_phrase=phrase[:240],
                excerpt=excerpt,
                document_date=file_dates.get(ev.id, ""),
                score=round(float(score), 4),
                band=_score_band(score),
                included_by_default=score >= INCLUDE_MIN,
            )
            ranked.append((score, hit))

    ranked.sort(key=lambda row: (-row[0], row[1].cite, row[1].evidence_id))
    seen_ids: set[str] = set()
    for score, hit in ranked:
        if hit.id in seen_ids:
            continue
        if per_cite.get(hit.cite, 0) >= MAX_HITS_PER_CITE:
            continue
        if len(hits) >= MAX_HITS_TOTAL:
            break
        # Keep at most two auto-included hits per cite.
        if hit.included_by_default and per_cite.get(hit.cite, 0) >= 2:
            hit = hit.model_copy(update={"included_by_default": False})
        seen_ids.add(hit.id)
        per_cite[hit.cite] = per_cite.get(hit.cite, 0) + 1
        hits.append(hit)
    return hits


_LEGACY_LINE = re.compile(
    r"^Record review of exhibit\s+(.+?)(?:\s+as applied to\s+([^:]+))?:\s*(.*)$",
    re.I,
)
_EXHIBIT_N_LINE = re.compile(r"^exhibit\s+\d+\s*:\s*(.*)$", re.I)
_QUOTED_REVIEW_LINE = re.compile(
    r'^The investigator reviewed ["“](.+?)["”] dated (.+?)\.(.*)$',
    re.I,
)


MAX_SUMMARY_FINDINGS = 12
MAX_SOD_FINDING_CHARS = 900


def _exhibit_title_for_finding(title: str) -> str:
    shown = display_evidence_title(title)
    return shown.replace('"', "").replace("“", "").replace("”", "").strip() or "document"


def _finding_excerpt(excerpt: str, *, max_chars: int = DISPLAY_EXCERPT_CHARS) -> str:
    body = re.sub(r"\s+", " ", (excerpt or "").strip())
    body = body.replace('"', "").replace("“", "").replace("”", "")
    if len(body) > max_chars:
        body = complete_sentence_excerpt(body, max_chars=max_chars) or body[:max_chars].rsplit(" ", 1)[0]
    return body.strip().rstrip(".")


def _merge_excerpt_parts(parts: list[str], *, max_chars: int) -> str:
    """Join unique exhibit excerpts into one showed-clause (longest-first dedupe)."""
    cleaned: list[str] = []
    for raw in parts:
        body = _finding_excerpt(raw, max_chars=max_chars)
        if not body:
            continue
        low = body.lower()
        # Drop if already covered by a kept excerpt (or covers a shorter one).
        superseded = False
        for i, kept in enumerate(cleaned):
            kl = kept.lower()
            if low in kl:
                superseded = True
                break
            if kl in low:
                cleaned[i] = body
                superseded = True
                break
        if not superseded:
            cleaned.append(body)
    if not cleaned:
        return ""
    joined = ". ".join(cleaned)
    return _finding_excerpt(joined, max_chars=max_chars)


def format_ir_summary_finding(
    title: str,
    document_date: str = "",
    excerpt: str = "",
    cites: list[str] | None = None,
) -> str:
    """Peer IR Summary of Findings: one paragraph per exhibit (all related duties)."""
    shown = _exhibit_title_for_finding(title)
    dated = format_document_date(document_date) if document_date else MISSING_DOCUMENT_DATE
    body = _finding_excerpt(excerpt)
    if not body:
        return (
            f'A review of the document titled "{shown}", dated {dated}, showed '
            "[pending: how this record supports or does not support the authorized WAC duties]."
        )
    para = f'A review of the document titled "{shown}", dated {dated}, showed {body}.'
    cite_list = [c.strip() for c in (cites or []) if (c or "").strip()]
    # Preserve order, drop duplicates.
    seen: set[str] = set()
    uniq: list[str] = []
    for c in cite_list:
        key = re.sub(r"\s+", "", c.lower())
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    if uniq:
        para = f"{para.rstrip('.')} Related to {'; '.join(uniq)}."
    return para


def format_sod_document_finding(
    title: str,
    excerpt: str = "",
    cites: list[str] | None = None,
) -> str:
    """SOD Findings included row: one paragraph per exhibit for the matched deficiency."""
    shown = _exhibit_title_for_finding(title)
    body = _finding_excerpt(excerpt, max_chars=MAX_SOD_FINDING_CHARS)
    if not body:
        return f'Review of the document titled, "{shown}", showed the record was reviewed.'
    para = f'Review of the document titled, "{shown}", showed {body}.'
    cite_list = [c.strip() for c in (cites or []) if (c or "").strip()]
    seen: set[str] = set()
    uniq: list[str] = []
    for c in cite_list:
        key = re.sub(r"\s+", "", c.lower())
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    if uniq:
        para = f"{para.rstrip('.')} Related to {'; '.join(uniq)}."
    return para


def selected_evidence_hits(
    hits: list[EvidenceReviewHit] | list[dict[str, Any]] | None,
    *,
    included_only: bool = True,
) -> list[dict[str, Any]]:
    """Normalize review hits for Summary / SOD populate (default: included-by-default only)."""
    out: list[dict[str, Any]] = []
    for hit in hits or []:
        if isinstance(hit, dict):
            included = bool(hit.get("included_by_default", True))
            row = {
                "id": str(hit.get("id") or ""),
                "evidence_id": hit.get("evidence_id"),
                "evidence_title": str(hit.get("evidence_title") or "document"),
                "cite": str(hit.get("cite") or ""),
                "duty_phrase": str(hit.get("duty_phrase") or ""),
                "excerpt": str(hit.get("excerpt") or ""),
                "document_date": str(hit.get("document_date") or ""),
                "included_by_default": included,
                "score": float(hit.get("score") or 0),
            }
        else:
            included = bool(getattr(hit, "included_by_default", True))
            row = {
                "id": str(getattr(hit, "id", "") or ""),
                "evidence_id": getattr(hit, "evidence_id", None),
                "evidence_title": str(getattr(hit, "evidence_title", None) or "document"),
                "cite": str(getattr(hit, "cite", "") or ""),
                "duty_phrase": str(getattr(hit, "duty_phrase", "") or ""),
                "excerpt": str(getattr(hit, "excerpt", "") or ""),
                "document_date": str(getattr(hit, "document_date", "") or ""),
                "included_by_default": included,
                "score": float(getattr(hit, "score", 0) or 0),
            }
        if included_only and not row["included_by_default"]:
            continue
        if not (row["excerpt"] or "").strip():
            continue
        out.append(row)
    out.sort(key=lambda r: (-r["score"], r["cite"], str(r["evidence_id"])))
    return out


def consolidate_hits_by_evidence(
    hits: list[EvidenceReviewHit] | list[dict[str, Any]] | None,
    *,
    included_only: bool = True,
    max_chars: int = DISPLAY_EXCERPT_CHARS,
) -> list[dict[str, Any]]:
    """One consolidated row per exhibit: merged excerpts + all related WAC/RCW cites.

    Duty RAG may return several cite hits for the same upload; Summary/SOD should emit
    a single paragraph per evidence document, not one paragraph per cite match.
    """
    selected = selected_evidence_hits(hits, included_only=included_only)
    by_key: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for hit in selected:
        eid = hit.get("evidence_id")
        key = f"id:{eid}" if eid is not None and str(eid).strip() != "" else f"title:{(hit.get('evidence_title') or '').lower()}"
        if key not in by_key:
            by_key[key] = {
                "evidence_id": eid,
                "evidence_title": hit["evidence_title"],
                "document_date": hit.get("document_date") or "",
                "excerpt_parts": [],
                "cites": [],
                "included_by_default": True,
                "score": float(hit.get("score") or 0),
            }
            order.append(key)
        row = by_key[key]
        if hit.get("document_date") and not row["document_date"]:
            row["document_date"] = hit["document_date"]
        row["score"] = max(float(row["score"]), float(hit.get("score") or 0))
        excerpt = (hit.get("excerpt") or "").strip()
        if excerpt:
            row["excerpt_parts"].append(excerpt)
        cite = (hit.get("cite") or "").strip()
        if cite:
            cite_key = re.sub(r"\s+", "", cite.lower())
            existing = {re.sub(r"\s+", "", c.lower()) for c in row["cites"]}
            if cite_key not in existing:
                row["cites"].append(cite)

    out: list[dict[str, Any]] = []
    for key in order:
        row = by_key[key]
        out.append(
            {
                "evidence_id": row["evidence_id"],
                "evidence_title": row["evidence_title"],
                "document_date": row["document_date"],
                "excerpt": _merge_excerpt_parts(row["excerpt_parts"], max_chars=max_chars),
                "cite": "; ".join(row["cites"]),
                "cites": list(row["cites"]),
                "included_by_default": True,
                "score": float(row["score"]),
            }
        )
    out.sort(key=lambda r: (-r["score"], str(r["evidence_id"])))
    return out[:MAX_SUMMARY_FINDINGS]

def format_document_review_line(
    title: str,
    document_date: str = "",
    excerpt: str = "",
    cite: str = "",
) -> str:
    """IR Document Review line: opener, quoted title, date. Excerpt is not appended."""
    del excerpt, cite
    shown = display_evidence_title(title)
    dated = format_document_date(document_date)
    return f'The investigator reviewed "{shown}" dated {dated}.'


def format_exhibit_process_line(hit: EvidenceReviewHit | dict[str, Any]) -> str:
    if isinstance(hit, dict):
        title = str(hit.get("evidence_title") or "document")
        excerpt = str(hit.get("excerpt") or "")
        dated = str(hit.get("document_date") or "")
    else:
        title = hit.evidence_title
        excerpt = hit.excerpt
        dated = hit.document_date or ""
    return format_document_review_line(title, dated, excerpt)


def _is_doc_review_placeholder(line: str) -> bool:
    return re.sub(r"\s+", " ", (line or "").strip()).lower() == re.sub(
        r"\s+", " ", DOC_REVIEW_PLACEHOLDER
    ).lower()


def merge_exhibit_process_lines(
    process: list[str],
    selected: list[EvidenceReviewHit] | list[dict[str, Any]],
    *,
    exhibits: list[Any] | None = None,
) -> list[str]:
    """One Document Review line per exhibit (quoted title and document date)."""
    from app.services.evidence_log import (
        ExhibitRow,
        append_exhibit_superscript,
        exhibit_map_by_id,
        list_exhibits_for_case,
    )

    by_exhibit: dict[int, ExhibitRow] = {}
    if exhibits:
        if exhibits and isinstance(exhibits[0], ExhibitRow):
            by_exhibit = exhibit_map_by_id(list(exhibits))  # type: ignore[arg-type]
        else:
            # CaseEvidence rows
            by_exhibit = exhibit_map_by_id(list_exhibits_for_case(None, evidence_rows=list(exhibits)))  # type: ignore[arg-type]

    by_id: dict[int, dict[str, Any]] = {}
    for hit in selected:
        if isinstance(hit, dict):
            eid = int(hit.get("evidence_id") or 0)
            title = str(hit.get("evidence_title") or "document")
            dated = str(hit.get("document_date") or "")
            excerpt = str(hit.get("excerpt") or "")
        else:
            eid = hit.evidence_id
            title = hit.evidence_title
            dated = hit.document_date or ""
            excerpt = hit.excerpt
        if eid <= 0:
            eid = abs(hash(title)) % 10_000_000
        row = by_id.setdefault(
            eid, {"title": title, "document_date": dated, "excerpt": "", "evidence_id": eid}
        )
        if not row["document_date"] and dated:
            row["document_date"] = dated
        if excerpt and len(excerpt) > len(row["excerpt"]):
            row["excerpt"] = excerpt
    added: list[str] = []
    for row in by_id.values():
        line = format_document_review_line(row["title"], row["document_date"], row["excerpt"])
        ex = by_exhibit.get(int(row["evidence_id"]))
        if ex:
            line = append_exhibit_superscript(line, ex.exhibit_no)
        added.append(line)
    src = [p for p in process if not is_exhibit_process_line(p)]
    label_idx = next(
        (i for i, p in enumerate(src) if (p or "").strip().lower() == DOC_REVIEW_LABEL.lower()),
        -1,
    )
    if label_idx < 0:
        if not added:
            return src
        return [*src, DOC_REVIEW_LABEL, *added]
    head = src[: label_idx + 1]
    tail = [p for p in src[label_idx + 1 :] if not _is_doc_review_placeholder(p)]
    if added:
        return [*head, *added, *tail]
    if tail:
        return [*head, *tail]
    return [*head, DOC_REVIEW_PLACEHOLDER]


def rewrite_legacy_document_review_lines(process: list[str]) -> list[str]:
    """One quoted-title line per document. Convert leftover Record-review / Exhibit-N rows."""
    src = list(process or [])
    has_legacy = any(
        (p or "").strip().startswith(LEGACY_EXHIBIT_PREFIX)
        or _EXHIBIT_N_LINE.match((p or "").strip())
        for p in src
    )
    if not has_legacy:
        return src
    by_title: dict[str, dict[str, str]] = {}
    kept: list[str] = []

    def remember(title: str, dated: str = "") -> None:
        shown = display_evidence_title(title)
        key = shown.lower()
        row = by_title.setdefault(key, {"title": shown, "document_date": ""})
        if dated and (not row["document_date"] or row["document_date"] == MISSING_DOCUMENT_DATE):
            row["document_date"] = dated

    for raw in src:
        s = (raw or "").strip()
        legacy = _LEGACY_LINE.match(s)
        if legacy:
            remember(legacy.group(1), extract_document_date(legacy.group(3) or ""))
            continue
        exhibit = _EXHIBIT_N_LINE.match(s)
        if exhibit:
            remember(exhibit.group(1))
            continue
        quoted = _QUOTED_REVIEW_LINE.match(s)
        if quoted:
            remember(quoted.group(1), quoted.group(2).strip())
            continue
        if s.startswith(LEGACY_EXHIBIT_PREFIX):
            rest = s[len(LEGACY_EXHIBIT_PREFIX) :].strip()
            remember(rest.split(" as applied to ", 1)[0])
            continue
        kept.append(raw)
    fake = [
        {
            "evidence_id": i + 1,
            "evidence_title": row["title"],
            "document_date": row["document_date"],
            "excerpt": "",
        }
        for i, row in enumerate(by_title.values())
    ]
    return merge_exhibit_process_lines(kept, fake)
