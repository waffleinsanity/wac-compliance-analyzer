---
name: wacmakr-ir-drafting
description: >-
  Deep playbook for WACMAKR IR Drafting & Allegation work — investigation
  pipeline, wac_scope, quote verify, IR blank/template corpus, DOCX export.
  Use when editing allegations, statute quotes, Investigation Report sections,
  quote integrity, or DOCX wording.
---

# WACMAKR IR Drafting Playbook

## Master-aligned goal

Draft DOH-style Investigation Report allegations and shell text from **approved** WAC/RCW selections and complaint text, with statute cites/quotes solely from local `data/source/` PDFs — along **Intake → Compare → Report**.

## Role boundary

### Owns

- `backend/app/services/investigation.py`
- `backend/app/services/wac_scope.py`
- `backend/app/services/quote_verify.py`
- `backend/app/services/ir_blank.py`
- `backend/app/services/template_corpus.py`
- `backend/app/services/defensibility.py`
- `backend/app/services/docx_export.py`
- `backend/app/services/sod_draft.py`
- `backend/app/services/sod_validate.py`
- `backend/app/services/sod_blank.py`
- `backend/app/services/sod_writing.py`

### Does not own

| Domain | Owner |
|--------|--------|
| PDF parse, Chroma, ingest, ranking fixtures | Statute Corpus |
| Groq/Ollama prompts & model config | Investigator LLM |
| Cases save/resume, review status, export pack UI | Case Review |
| Complaint/WAC stepper, statute panels, App rails | Intake UX |
| Category 3/4 detect/redact | Privacy & PII |
| Auth / OAuth / admin | Identity Admin |
| Launch.bat, ports, debug configs | Local DevEx |
| Accuracy suites / goldens | Accuracy & Eval |

## Invariants (from Master)

1. **Sole-source:** `data/source/` PDFs are the only authority for which subsections apply and for statute quote text (via corpus APIs — do not invent text).
2. **Shell only:** Example DOCX under `data/examples/` / `data/templates/` and `template_corpus` shape labels and phrasing — never legal authority for codes or quotes.
3. **Product flow:** Prefer IR drafting outcomes compatible with Intake → Compare → Report; legacy analyzer UX is secondary.
4. **LLM off critical path:** `LLM_FOR_INVESTIGATE` defaults false; LLM must not become the source of subsection choice or quote wording.
5. **No invented statute text;** never commit secrets / `backend/.env`.
6. **Baseline allegation shape:** Allegation lines match `data/examples/Baseline Allegations RTF.txt` — **no quotation marks** around duty language; opener is `Potential violation of WAC …, by having failed to (1)(a) …` (not `A potential…` and not `"duty phrase"`).

Conflict rule: sole-source / IR-primary **wins** over LLM convenience or UX shortcuts.

## Anti-goals (refuse)

- Hardcoding or paraphrasing statute cites/quotes to “make tests pass”
- Using example Investigation Report DOCX as authority for which WAC/RCW apply
- Routing cite/quote generation through investigator LLM free-text
- Reintroducing trigger-phrase / generic findings lists as the main IR path
- Silently changing Corpus ingest/ranking, PII contracts, auth, or Launch configs
- Claiming unverified quotes are PDF-exact

## Success criteria (done when)

1. Allegations scoped to approved codes and PDF-backed subsections; duty phrases unquoted per Baseline.
2. Statute language (quoted or Baseline unquoted duty spans) is exact from the store, or clearly flagged/failed by `quote_verify`.
3. Blank DOH IR section labels and formal investigative tone remain intact.
4. Regulatory Framework / allegation blocks stay compatible with the editable Report and DOCX export.
5. Touched verify paths pass (below); broader golden drift → escalate Eval.

## Typical change checklist

1. Trace: approved codes → `wac_scope` ranking → allegation draft → IR emit → DOCX.
2. Confirm quote verification still runs on every emitted statute span.
3. If ranking *inputs* or ingest are wrong, escalate Corpus — do not patch cites in IR code.
4. Keep shell labels in `ir_blank` / template phrasing aligned with blank DOH form.
5. After material IR changes, request Accuracy & Eval (or run targeted pytest).

## Escalation map

| Signal | Escalate to | When to return to Master |
|--------|-------------|---------------------------|
| Empty corpus, parse/Chroma, wrong ranking scores | Statute Corpus | Ranking change needs IR + Corpus + Eval coordinated |
| Goldens / `run_accuracy_tests` | Accuracy & Eval | Always after IR or corpus pipeline edits that affect allegations |
| Cat 3/4 in complaint before draft | Privacy & PII | Gate blocks draft with no clear path |
| Want model enrichment (non-cite) | Investigator LLM | Request would put LLM on critical cite path → refuse + Master |
| Editor UI / case persist / export pack | Case Review or Intake UX | Cross-cutting product framing conflict |
| Multi-worker conflict or unclear ownership | **WACMAKR Master** | Sole-source vs convenience disputes |

## Verify

```bat
cd backend
.venv\Scripts\python.exe -m pytest tests\test_quote_verify.py tests\test_allegation_source.py tests\test_subsection_ranking.py -q
```

UI: Intake → Compare → Report on a fixture-like complaint; spot-check allegation duty phrase against statute pane (PDF-backed text; no quotation marks on the allegation line).

## Handoff

Return the `AGENTS.md` handoff block:

```text
Worker: IR Drafting & Allegation
Changed: <paths>
Verify: <commands or UI path>
Risks: <sole-source / PII / auth / launch>
Escalations: <other workers needed>
```
