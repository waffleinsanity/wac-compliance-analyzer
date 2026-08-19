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
from app.schemas import EvidenceReviewHit, InvestigationReport
from app.services.documents import extract_text_from_bytes
from app.services.wac_scope import normalize_statute_text

_STOP = frozenset(ENGLISH_STOP_WORDS)
_WORD = re.compile(r"[a-z]{3,}")
_SENT_SPLIT = re.compile(r"(?<=[.!;:])\s+")

MIN_CHUNK_CHARS = 40
MAX_CHUNK_CHARS = 420
MAX_CHUNKS_PER_FILE = 80
MAX_HITS_PER_CITE = 4
MAX_HITS_TOTAL = 40
INCLUDE_MIN = 0.28
STRONG_SCORE = 0.50
MODERATE_SCORE = 0.30

EXHIBIT_PROCESS_PREFIX = "Record review of exhibit"


def evidence_file_path(ev: CaseEvidence) -> Path:
    stored = (ev.stored_path or "").replace("\\", "/")
    return settings.cases_dir / stored


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if w not in _STOP}


def _overlap_score(query: str, chunk: str) -> float:
    q = _tokens(query)
    c = _tokens(chunk)
    if not q or not c:
        return 0.0
    inter = len(q & c)
    if not inter:
        return 0.0
    return inter / ((len(q) ** 0.5) * (len(c) ** 0.5))


def _score_band(score: float) -> str:
    if score >= STRONG_SCORE:
        return "strong"
    if score >= MODERATE_SCORE:
        return "moderate"
    return "weak"


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
        query = f"{cite} {phrase}"
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
    files = list(case.evidence or [])
    if not files:
        return []

    file_chunks: list[tuple[CaseEvidence, str, str]] = []
    for ev in files:
        text = extract_evidence_text(ev)
        for chunk in chunk_evidence_text(text):
            file_chunks.append((ev, chunk, normalize_statute_text(chunk)))

    hits: list[EvidenceReviewHit] = []
    per_cite: dict[str, int] = {}
    ranked: list[tuple[float, EvidenceReviewHit]] = []
    for ev, raw, chunk in file_chunks:
        for cite, phrase, query in targets:
            score = _overlap_score(query, chunk)
            if score < 0.18:
                continue
            hit = EvidenceReviewHit(
                id=_hit_id(ev.id, cite, chunk),
                evidence_id=ev.id,
                evidence_title=ev.title or ev.original_filename or f"Exhibit {ev.id}",
                cite=cite,
                duty_phrase=phrase[:240],
                excerpt=raw.strip()[:MAX_CHUNK_CHARS],
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


def format_exhibit_process_line(hit: EvidenceReviewHit | dict[str, Any]) -> str:
    if isinstance(hit, dict):
        title = str(hit.get("evidence_title") or "exhibit")
        cite = str(hit.get("cite") or "")
        excerpt = normalize_statute_text(str(hit.get("excerpt") or ""))
    else:
        title = hit.evidence_title
        cite = hit.cite
        excerpt = normalize_statute_text(hit.excerpt)
    excerpt = excerpt.rstrip(" ;,")
    if len(excerpt) > 320:
        excerpt = excerpt[:317].rstrip() + "…"
    return (
        f"{EXHIBIT_PROCESS_PREFIX} {title} as applied to {cite}: {excerpt}"
    )


def merge_exhibit_process_lines(
    process: list[str],
    selected: list[EvidenceReviewHit] | list[dict[str, Any]],
) -> list[str]:
    kept = [p for p in process if not (p or "").startswith(EXHIBIT_PROCESS_PREFIX)]
    added = [format_exhibit_process_line(h) for h in selected]
    return [*kept, *added]
