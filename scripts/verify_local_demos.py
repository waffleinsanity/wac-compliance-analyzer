"""Verify local demo catalog drafts under the exact-WAC / top-2 duty system.

Reads data/examples/local_demo_catalog.json (mirror of frontend demos) and asserts:
- Each non-weak demo produces at least one 'having failed to' allegation
- Drafted lines keep ≤ 2 labeled duty clauses by default
- Infection demo keeps list-intro + leaf language for 246-337-060 (infinitive opener)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
CATALOG = ROOT / "data" / "examples" / "local_demo_catalog.json"

sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal, init_db  # noqa: E402
from app.rag.store import wac_store  # noqa: E402
from app.services.wac_scope import (  # noqa: E402
    MAX_ALLEGATION_DRAFT_CLAUSES,
    draft_allegation_from_source,
)


def _ensure_store() -> None:
    init_db()
    db = SessionLocal()
    try:
        if not wac_store.ready:
            wac_store.ingest(db, force=False)
        if not wac_store.ready:
            loaded = wac_store.load_from_db(db)
            if loaded <= 0:
                raise SystemExit("WAC store empty — ingest PDFs under data/source/")
    finally:
        db.close()


def _clauses_after_failed_to(text: str) -> list[str]:
    m = re.search(r"by having failed to\s+(.+?)\.\s*$", text or "", flags=re.I | re.S)
    if not m:
        return []
    body = m.group(1).strip().rstrip(".")
    return [c.strip() for c in re.split(r";\s*(?:and\s+)?", body) if c.strip()]


def main() -> int:
    _ensure_store()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    scenarios = catalog.get("scenarios") or []
    if len(scenarios) < 10:
        raise SystemExit(f"Expected ≥10 demos, found {len(scenarios)}")

    failures: list[str] = []
    for sc in scenarios:
        sid = sc["id"]
        complaint = sc["complaint"]
        codes = [c.replace("WAC ", "").replace("RCW ", "").strip() for c in sc["selected_wacs"]]
        print(f"\n=== {sid} ({len(codes)} codes) ===")
        drafted_any = False
        for code in codes:
            draft = draft_allegation_from_source(code, code, complaint)
            clauses = _clauses_after_failed_to(draft.text)
            print(f"  {code}: {len(clauses)} clause(s), {len(draft.duty_options)} options")
            print(f"    {draft.text[:160]}{'…' if len(draft.text) > 160 else ''}")

            if sid == "weak_overlap":
                if len(clauses) > 2:
                    failures.append(f"{sid}/{code}: weak demo should not invent a long strong line")
                continue

            if "by having failed to" in draft.text.lower():
                drafted_any = True
            if len(clauses) > MAX_ALLEGATION_DRAFT_CLAUSES:
                failures.append(
                    f"{sid}/{code}: drafted {len(clauses)} clauses (max {MAX_ALLEGATION_DRAFT_CLAUSES})"
                )
            if '"' in draft.text:
                failures.append(f"{sid}/{code}: allegation must not wrap duties in quotes")

            for clause in clauses:
                body = re.sub(r"^(?:\([^)]+\))+\s+", "", clause).strip().lower()
                if body.startswith("management of staff") or body.startswith("resident hygiene"):
                    failures.append(
                        f"{sid}/{code}: bare leaf topic without list intro: {clause!r}"
                    )

            if sid == "infection_environment" and code == "246-337-060":
                low = draft.text.lower()
                if "develop written policies and procedures for" not in low:
                    failures.append(
                        f"{sid}/{code}: expected infinitive list-intro lead-in: {draft.text}"
                    )
                if not any(
                    "written policies and procedures for" in (o.get("duty_phrase") or "").lower()
                    for o in draft.duty_options
                ):
                    failures.append(f"{sid}/{code}: duty_options missing list-intro phrases")

        if sid != "weak_overlap" and not drafted_any:
            failures.append(f"{sid}: no code produced a 'having failed to' allegation line")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(" -", f)
        return 1
    print(f"\nOK — {len(scenarios)} demos verified against exact-WAC / top-2 drafting.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
