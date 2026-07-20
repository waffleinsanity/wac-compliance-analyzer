"""Parse DOH Investigative Report examples into a reusable template corpus.

Sources (local only):
  - data/examples/*.docx  — full sample / peer-reviewed IRs
  - data/examples/*.txt   — baseline Allegation: lines (subsection cites)

Structure and language are taken from the consensus of peer-reviewed facility IRs.
Short training skeletons (e.g. bare "State Investigation" drafts) are treated as
style outliers and do not override the fuller DOH report shape.

Statute applicability and duty language still come only from ingested WAC/RCW PDFs.
Example DOCX files guide IR shell phrasing and allegation sentence shape only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from docx import Document

from app.config import settings
from app.services.ir_blank import (
    ALLEGATION_HEADER as DOH_ALLEGATION_BLOCK_HEADER,
    BLANK_PROCESS_SKELETON,
    CONCLUSION_HEADER as DOH_CONCLUSION_HEADER,
    INTAKE_LABEL as DOH_INTAKE_LABEL,
    PROCESS_HEADER as DOH_PROCESS_LABEL,
    SUMMARY_HEADER as DOH_SUMMARY_LABEL,
)


ALLEGATION_LINE_RE = re.compile(
    r"^Allegation:\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)
# Lakeside-style outlier: potential-violation lines without "Allegation:" prefix
BARE_POTENTIAL_RE = re.compile(
    r"^(?:A\s+)?[Pp]otential violation of\s+WAC.+$",
    re.IGNORECASE | re.MULTILINE,
)
WAC_IN_ALLEGATION_RE = re.compile(
    r"(?:A\s+)?[Pp]otential violation of\s+WAC[-\s]*(246-(?:341|337)-\d{3,4})\s*[:,]?\s*"
    r"(.*?)\s+by\s+(having failed to|failing to|not|violating)\s+(.+)$",
    re.IGNORECASE | re.DOTALL,
)
INTAKE_BLOCK_RE = re.compile(
    r"Intake Details:\s*(?:\([^)]*\)\s*)?(.*?)(?=\n\s*Allegation/?s?(?:\(s\))?:|\Z)",
    re.IGNORECASE | re.DOTALL,
)
CONCLUSION_SPLIT_RE = re.compile(
    r"\n\s*Conclusion/?\s*Results of Investigation\b",
    re.IGNORECASE,
)
PROCESS_HINT_RE = re.compile(
    r"Investigative Process Included:\s*\(([^)]+)\)",
    re.IGNORECASE,
)
ALLEGATION_HEADER_RE = re.compile(
    r"^(Allegation/?s?(?:\(s\))?):\s*\((.+)\)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
SUBSECTION_CITE_RE = re.compile(r"\(\d+\)(?:\([a-z0-9]+\))*", re.IGNORECASE)
FINDING_LINE_RE = re.compile(
    r"the investigator found the facility",
    re.IGNORECASE,
)

THEME_KEYWORDS: dict[str, tuple[str, ...]] = {
    "confidentiality": (
        "disclos", "confidential", "phi", "protected health", "without consent", "hipaa", "parent",
    ),
    "assault": ("assault", "sexual", "abuse", "rape", "exploitation", "harassment"),
    "death": ("death", "overdose", "died", "deceased", "unresponsive", "cpr"),
    "safety": ("safety", "security", "harm", "injury", "search"),
    "medication": ("medication", "mar", "self-administered", "suboxone", "withdrawal"),
    "pediatric": ("child", "infant", "baby", "mother", "pregnancy", "pediatric", "parent in treatment"),
    "grievance": ("grievance", "complaint", "resident rights", "assets"),
    "unlicensed": ("unlicensed", "grandfather", "certification", "operating without"),
}


# Canonical shell labels from data/templates/5. Investigation report.docx
DOH_ALLEGATION_HEADER = "Allegation(s)"
DOH_ALLEGATION_PREAMBLE = (
    "The allegation(s) listed below is what the department has jurisdiction and "
    "authorization to investigate. An allegation is considered an assertion of "
    "improper practice or condition that could result in a violation of facility "
    "law or rule."
)
DOH_INTAKE_HINT = "List of concerns reported in the original complaint."
DOH_PROCESS_HINT = (
    "This is what the investigator did in terms of methods employed to conduct inquiry."
)
DOH_SUMMARY_HINT = "Narrative overview of the results of investigation."
DOH_DEFAULT_PROCESS = list(BLANK_PROCESS_SKELETON)


@dataclass
class AllegationTemplate:
    wac_code: str
    title_in_template: str
    connector: str  # "having failed to" | "failing to" | "not" | "violating"
    failure_clause: str
    full_text: str  # full allegation body without "Allegation: " prefix
    source_file: str
    themes: list[str] = field(default_factory=list)
    uses_a_prefix: bool = True  # "A potential violation" vs "Potential violation"
    has_subsection_cites: bool = False


@dataclass
class ExampleReport:
    source_file: str
    intake: str
    themes: list[str]
    allegations: list[AllegationTemplate]
    process_hint: str = DOH_PROCESS_HINT
    allegation_header: str = DOH_ALLEGATION_HEADER
    is_full_facility_report: bool = False


@dataclass
class TemplateCorpus:
    examples: list[ExampleReport]
    by_code: dict[str, list[AllegationTemplate]]
    allegation_header: str = DOH_ALLEGATION_HEADER
    allegation_preamble: str = DOH_ALLEGATION_PREAMBLE
    intake_hint: str = DOH_INTAKE_HINT
    process_hint: str = DOH_PROCESS_HINT
    summary_hint: str = DOH_SUMMARY_HINT
    conclusion_header: str = DOH_CONCLUSION_HEADER
    default_process: list[str] = field(default_factory=lambda: list(DOH_DEFAULT_PROCESS))

    def templates_for(self, code: str) -> list[AllegationTemplate]:
        code = code.replace("WAC ", "").replace("WAC-", "").strip()
        return self.by_code.get(code, [])


def _clean(text: str) -> str:
    text = text.replace("\u00ad", "").replace("\ufffd", "'").replace("�", "'")
    return re.sub(r"[ \t]+", " ", text or "").strip()


def _detect_themes(text: str) -> list[str]:
    lower = text.lower()
    found = []
    for theme, keys in THEME_KEYWORDS.items():
        if any(k in lower for k in keys):
            found.append(theme)
    return found or ["general"]


def _has_subsection_cites(text: str) -> bool:
    return bool(SUBSECTION_CITE_RE.search(text or ""))


def _pre_conclusion_text(text: str) -> str:
    """Drop Conclusion section so finding lines are not treated as allegation drafts."""
    parts = CONCLUSION_SPLIT_RE.split(text, maxsplit=1)
    return parts[0]


def _parse_allegation(raw: str, source_file: str, themes: list[str]) -> AllegationTemplate | None:
    text = _clean(raw)
    if FINDING_LINE_RE.search(text):
        return None
    m = WAC_IN_ALLEGATION_RE.search(text)
    if not m:
        code_m = re.search(r"246-(?:341|337)-\d{3,4}", text)
        if not code_m:
            return None
        code = code_m.group(0)
        return AllegationTemplate(
            wac_code=code,
            title_in_template="",
            connector="failing to",
            failure_clause=text,
            full_text=text if text.endswith(".") else text + ".",
            source_file=source_file,
            themes=themes,
            uses_a_prefix=text.lower().startswith("a potential"),
            has_subsection_cites=_has_subsection_cites(text),
        )

    code = m.group(1)
    title = _clean(m.group(2)).rstrip(".,;:")
    connector = m.group(3).lower()
    clause = _clean(m.group(4)).rstrip(".")
    uses_a = text.lower().startswith("a potential")
    clause_themes = _detect_themes(f"{clause} {title}")
    merged = list(dict.fromkeys([*themes, *clause_themes]))
    return AllegationTemplate(
        wac_code=code,
        title_in_template=title,
        connector=connector,
        failure_clause=clause,
        full_text=text if text.endswith(".") else text + ".",
        source_file=source_file,
        themes=merged,
        uses_a_prefix=uses_a,
        has_subsection_cites=_has_subsection_cites(clause),
    )


def _extract_allegations(text: str, source_file: str, themes: list[str]) -> list[AllegationTemplate]:
    body = _pre_conclusion_text(text)
    allegations: list[AllegationTemplate] = []
    seen: set[str] = set()

    for m in ALLEGATION_LINE_RE.finditer(body):
        tmpl = _parse_allegation(m.group(1), source_file, themes)
        if not tmpl:
            continue
        key = tmpl.full_text.lower()
        if key in seen:
            continue
        seen.add(key)
        allegations.append(tmpl)

    # Outlier: some peer-reviewed IRs omit the "Allegation:" prefix on draft lines
    if len(allegations) < 2:
        for m in BARE_POTENTIAL_RE.finditer(body):
            tmpl = _parse_allegation(m.group(0), source_file, themes)
            if not tmpl:
                continue
            key = tmpl.full_text.lower()
            if key in seen:
                continue
            seen.add(key)
            allegations.append(tmpl)

    return allegations


def parse_example_docx(path: Path) -> ExampleReport | None:
    doc = Document(path)
    text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    if "Investigative Report" not in text and "Allegation" not in text:
        return None

    intake = ""
    im = INTAKE_BLOCK_RE.search(text)
    if im:
        intake = _clean(im.group(1))
        if intake.lower().startswith("list of concerns"):
            parts = re.split(r"(?<=\.)\s+", intake, maxsplit=1)
            intake = parts[-1] if len(parts) > 1 else intake

    themes = _detect_themes(intake or text)
    allegations = _extract_allegations(text, path.name, themes)

    process_hint = DOH_PROCESS_HINT
    pm = PROCESS_HINT_RE.search(text)
    if pm:
        process_hint = _clean(pm.group(1))

    allegation_header = DOH_ALLEGATION_HEADER
    hm = ALLEGATION_HEADER_RE.search(text)
    if hm:
        allegation_header = hm.group(1).strip()

    is_full = bool(
        re.search(r"Facility Address:", text, re.IGNORECASE)
        and re.search(r"Investigative Process Included:", text, re.IGNORECASE)
    )

    return ExampleReport(
        source_file=path.name,
        intake=intake,
        themes=themes,
        allegations=allegations,
        process_hint=process_hint,
        allegation_header=allegation_header,
        is_full_facility_report=is_full,
    )


def parse_allegation_text_file(path: Path) -> ExampleReport | None:
    """Load baseline allegation .txt files (Allegation: lines, often with subsection cites)."""
    text = path.read_text(encoding="utf-8", errors="ignore")
    if "Allegation:" not in text:
        return None
    themes = _detect_themes(text)
    allegations = _extract_allegations(text, path.name, themes)
    if not allegations:
        return None
    return ExampleReport(
        source_file=path.name,
        intake="",
        themes=themes,
        allegations=allegations,
        is_full_facility_report=False,
    )


def _derive_shell_defaults(examples: list[ExampleReport]) -> dict[str, object]:
    """Prefer language from full facility peer-reviewed IRs; fall back to DOH constants."""
    full = [e for e in examples if e.is_full_facility_report] or examples
    header_votes: dict[str, int] = {}
    process_votes: dict[str, int] = {}
    a_prefix = 0
    total_alleges = 0
    for e in full:
        header_votes[e.allegation_header] = header_votes.get(e.allegation_header, 0) + 1
        process_votes[e.process_hint] = process_votes.get(e.process_hint, 0) + 1
        for a in e.allegations:
            total_alleges += 1
            if a.uses_a_prefix:
                a_prefix += 1

    header = max(header_votes, key=header_votes.get) if header_votes else DOH_ALLEGATION_HEADER
    # Normalize header variants to Allegation(s) when peer-reviewed majority uses it
    if "allegation(s)" in header.lower() or header_votes.get("Allegation(s)", 0) >= header_votes.get("Allegation/s", 0):
        header = DOH_ALLEGATION_HEADER
        preamble = DOH_ALLEGATION_PREAMBLE
    else:
        preamble = (
            "The allegation/s listed below is what the department has jurisdiction and "
            "authorization to investigate. An allegation is considered an assertion of "
            "improper practice or condition that could result in a violation of facility "
            "law or rule."
        )

    process_hint = (
        max(process_votes, key=process_votes.get) if process_votes else DOH_PROCESS_HINT
    )
    prefer_a_prefix = (a_prefix / total_alleges) >= 0.5 if total_alleges else True

    return {
        "allegation_header": header,
        "allegation_preamble": preamble,
        "process_hint": process_hint,
        "prefer_a_prefix": prefer_a_prefix,
    }


@lru_cache(maxsize=1)
def load_template_corpus(examples_dir: str | None = None) -> TemplateCorpus:
    root = Path(examples_dir) if examples_dir else settings.examples_dir
    examples: list[ExampleReport] = []
    by_code: dict[str, list[AllegationTemplate]] = {}

    if root.exists():
        for path in sorted(root.glob("*.docx")):
            report = parse_example_docx(path)
            if not report:
                continue
            examples.append(report)
            for a in report.allegations:
                by_code.setdefault(a.wac_code, []).append(a)

        for path in sorted(root.glob("*.txt")):
            report = parse_allegation_text_file(path)
            if not report:
                continue
            examples.append(report)
            for a in report.allegations:
                by_code.setdefault(a.wac_code, []).append(a)

    shell = _derive_shell_defaults(examples)
    return TemplateCorpus(
        examples=examples,
        by_code=by_code,
        allegation_header=str(shell["allegation_header"]),
        allegation_preamble=str(shell["allegation_preamble"]),
        intake_hint=DOH_INTAKE_HINT,
        process_hint=str(shell["process_hint"]),
        summary_hint=DOH_SUMMARY_HINT,
        conclusion_header=DOH_CONCLUSION_HEADER,
        default_process=list(DOH_DEFAULT_PROCESS),
    )


def prefer_a_prefix(corpus: TemplateCorpus | None = None) -> bool:
    corpus = corpus or load_template_corpus()
    full = [e for e in corpus.examples if e.is_full_facility_report] or corpus.examples
    total = sum(len(e.allegations) for e in full)
    if not total:
        return True
    a_count = sum(1 for e in full for a in e.allegations if a.uses_a_prefix)
    return (a_count / total) >= 0.5


def best_template_for(
    code: str,
    complaint_themes: list[str],
    corpus: TemplateCorpus | None = None,
) -> AllegationTemplate | None:
    """Pick the best example allegation for a WAC code (phrasing shape only)."""
    corpus = corpus or load_template_corpus()
    candidates = corpus.templates_for(code)
    if not candidates:
        return None

    theme_set = set(complaint_themes)
    theme_words = {
        "confidentiality": ("confidential", "disclosure", "phi", "health information", "consent"),
        "assault": ("assault", "abuse", "safety", "security", "harm", "exploitation", "harassment"),
        "death": ("death", "overdose", "critical incident", "unresponsive"),
        "safety": ("safety", "security", "search", "harm"),
        "medication": ("medication", "mar", "suboxone", "withdrawal"),
        "pediatric": ("child", "infant", "baby", "mother", "pregnancy", "parent"),
        "grievance": ("grievance", "assets", "abuse", "files"),
        "unlicensed": ("unlicensed", "certification", "operating"),
    }

    # Prefer allegations from full peer-reviewed facility reports
    full_sources = {e.source_file for e in corpus.examples if e.is_full_facility_report}

    def score(t: AllegationTemplate) -> tuple[int, int, int, int, int]:
        overlap = len(theme_set & set(t.themes))
        clause_l = t.failure_clause.lower()
        clause_hits = 0
        for theme in theme_set:
            for w in theme_words.get(theme, ()):
                if w in clause_l:
                    clause_hits += 1
        cite_bonus = 1 if t.has_subsection_cites else 0
        full_bonus = 1 if t.source_file in full_sources else 0
        return (full_bonus, cite_bonus, clause_hits, overlap, len(t.failure_clause))

    return max(candidates, key=score)


def format_intake_narrative(raw_complaint: str) -> str:
    """Normalize intake toward peer-reviewed DOH voice when not already styled."""
    text = _clean(raw_complaint)
    m = INTAKE_BLOCK_RE.search(text)
    if m:
        body = _clean(m.group(1))
        if body and not body.lower().startswith("list of concerns"):
            return body

    lower = text.lower()
    if lower.startswith(
        (
            "the department of health",
            "doh received",
            "the doh received",
            "it was alleged",
            "respondent is alleged",
            "the department received",
        )
    ):
        return text

    if "alleged" in lower or "self-report" in lower:
        return text

    # Default peer-reviewed intake opener
    body = text[0].lower() + text[1:] if text else text
    return f"The Department of Health (DOH) received a complaint alleging {body}"


def reload_corpus() -> TemplateCorpus:
    load_template_corpus.cache_clear()
    return load_template_corpus()
