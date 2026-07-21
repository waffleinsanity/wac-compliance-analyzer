---
name: wacmakr-statute-corpus
description: >-
  Deep playbook for WACMAKR Statute Corpus & Ranking — WAC/RCW PDF parsers,
  RAG/Chroma store, ingest, search, and subsection ranking goldens. Use when
  working on ingest failures, empty corpus, Chroma, PDF parse, or wrong
  subsection ranking.
---

# WACMAKR Statute Corpus Playbook

## Goal (Master-aligned)

WACMAKR’s north star is DOH-style Investigation Reports from approved WAC/RCW + complaint text (`Intake → Compare → Report`). This worker makes that possible by keeping local PDFs the **sole authority** for which subsections exist and what quoteable text they contain.

You enable IR Drafting with faithful parse → store → search → rank. You do **not** write allegations, IR sections, or DOCX phrasing.

## Role boundary

| In scope | Out of scope |
|----------|----------------|
| `backend/app/parser/` (WAC/RCW) | `investigation.py`, allegation draft, quote_verify consumers |
| `backend/app/rag/store.py` (SQLite/Chroma, load, search) | `ir_blank` / `template_corpus` / DOCX export |
| `data/source/` authoritative PDFs | Example DOCX as legal authority |
| Ranking / fixtures: `test_subsection_ranking.py`, `backend/tests/fixtures/**` | Intake stepper UI, cases store, PII gate, LLM prompts |
| Honest empty-corpus / 503 behavior | Inventing subsections to unblock UI |

Conflict rule (Master): sole-source PDF authority and IR-primary framing win over LLM convenience or UX shortcuts.

## Invariants

1. **`data/source/` PDFs are the sole statute authority** for subsection identity and quote text. Never invent, paraphrase, or “improve” statute wording in the store.
2. **Never silently wipe or rebuild** Chroma/SQLite corpus. Rebuild/re-ingest only with clear user intent and a recoverable path.
3. **Ranking goldens matter.** Scoring/chunking/key changes must keep fixture awareness; do not weaken or delete goldens without Eval + explicit user approval.
4. **Incomplete ingest is visible.** Prefer `503 Statute corpus is not loaded` (or equivalent honest failure) over stub/fake sections.
5. **Stable subsection keys** for downstream `wac_scope` / investigation — breaking key shape is a cross-worker change; escalate IR Drafting + Eval.
6. **Example DOCX / LLM are not authority** for which codes apply or what the statute says.

## Anti-goals

- Drafting allegations, Regulatory Framework narrative, evidentiary examples, or DOCX shell wording
- Hardcoding cites or quotes in the store to “fix” IR failures
- Silent corpus deletion, empty-index shipping, or masking parse failures with placeholder text
- Weakening ranking asserts or deleting fixtures to make CI green
- Treating legacy analyzer trigger-phrase / dashboard UX as the ranking success metric
- Replacing PDF text with LLM-summarized statute language

## Success criteria

- Parsers extract subsections that match PDF structure and remain addressable by code/subsection id
- Store loads on API startup; search returns PDF-backed hits (not invented rows)
- Subsection ranking behavior matches goldens, or failures are named with fixture/case paths
- IR consumers can resolve approved selections to store-backed text without this worker writing allegations
- No silent corpus wipe; no fake sections introduced to avoid 503

## Escalation map

| When | Escalate to | Why |
|------|-------------|-----|
| Corpus/ranking OK but allegations/quotes/IR sections wrong | **IR Drafting** | Owns draft, quote verify, IR shell, DOCX |
| Ranking/accuracy suites fail or assert policy unclear | **Accuracy & Eval** | Golden gatekeeper; reports, does not rubber-stamp weaken |
| Compare/stepper shows wrong chips but store search is fine | **Intake UX** | Selection UI, not parse/rank |
| Model invents subsections or ignores store hits | **Investigator LLM** | Prompts/config; LLM stays off critical IR path by default |
| Persist/export of cases after search | **Case Review** | Case workspace, not corpus |
| Cat 3/4 text before ingest of complaint (not PDFs) | **Privacy** | PII gate on complaint path |
| Launch/ports/Chroma path env only | **DevEx** | Local stack wiring |

Serial pipeline tip: Corpus → IR Drafting → Eval when the same investigate path is in flight.

## Owned paths

- `backend/app/parser/` (WAC/RCW parsers)
- `backend/app/rag/store.py`
- `data/source/` (authoritative PDFs — do not replace casually)
- Ranking / fixture tests under `backend/tests/` (especially `test_subsection_ranking.py`, fixtures)

## Typical change checklist

1. Confirm parser output still keys subsections the way `wac_scope` / investigation expect.
2. Check store load on API startup and search endpoints.
3. Run ranking goldens after scoring or chunking changes.
4. If allegation consumers break, escalate IR Drafting — do not duplicate allegation logic in the store.
5. If goldens fail, escalate Eval with fixture names — do not loosen asserts locally without approval.

## Verify

```bat
cd backend
.venv\Scripts\python.exe -m pytest tests\test_subsection_ranking.py -q
scripts\run_accuracy_tests.bat
```

API: `GET http://127.0.0.1:8000/api/health` and a statute search after restart if ingest changed.

## Handoff

Return the `AGENTS.md` handoff block:

```text
Worker: Statute Corpus & Ranking
Changed: <paths>
Verify: <commands or UI path>
Risks: <sole-source / silent wipe / ranking goldens>
Escalations: <IR Drafting / Eval / …>
```
