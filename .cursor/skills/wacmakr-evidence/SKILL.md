---
name: wacmakr-evidence
description: >-
  Deep playbook for WACMAKR Evidence & Allegation RAG — Compare-scoped duty
  targets, exhibit chunk ranking, Evidence Log, Summary/SOD cite links. Use when
  editing evidence review, exhibit matching, EvidenceStep, Evidence Log, or
  allegation↔evidence linking.
---

# WACMAKR Evidence & Allegation RAG Playbook

## Master-aligned goal

Rank and link case exhibits to **Compare-selected** WAC/RCW subsection duties so Documents (IR Summary, SOD Findings, Evidence Log) stay allegation-grounded without inventing statute text.

## Role boundary

### Owns

- `backend/app/services/evidence_review.py`
- `backend/app/services/evidence_cite.py`
- `backend/app/services/evidence_log.py`
- `frontend/src/components/EvidenceStep.tsx`
- `frontend/src/components/EvidenceLogEditor.tsx`
- `frontend/src/evidenceLogFormat.ts`
- `frontend/src/summaryFindingsFormat.ts` (evidence merge / SOD link helpers)
- Evidence endpoints on `backend/app/routers/cases.py` (upload / review / file / evidence-log export)
- `backend/tests/test_evidence_review.py`, `backend/tests/test_evidence_log.py`

### Does not own

| Domain | Owner |
|--------|--------|
| PDF ingest, Chroma, Compare subsection ranking | Statute Corpus |
| Allegation draft / duty_options emit / quote verify | IR Drafting |
| Compare checkbox UX persistence beyond selection sync | Intake UX / Case Review |
| Cat 3/4 detect/redact | Privacy & PII |
| Launch / ports | Local DevEx |
| Broader goldens | Accuracy & Eval |

## Invariants (from Master + Evidence worker)

1. **Compare-selected only:** Duty targets for ranking come from live Compare selection (`matched_subsections` synced with selected duty cites). Do not use stale `included_by_default` starters as the primary set. Do not expand to full Regulatory Framework by default.
2. **PDF-backed queries:** Prefer `validate_subsection_cite` + `subsection_display_text` / `duty_phrase` from the store — never paraphrase statute for matching.
3. **Scoped corpus boost:** `wac_store.search` / `search_chroma` may boost scores but only for labels in the selected cite set for that parent code.
4. **LLM off critical rank path.**
5. **Human selects** which hits enter Summary/SOD; ranking suggests.
6. No secrets in commits.

## Desired RAG design

```text
Compare selected cites
  → resolve duty query text (PDF node / duty_phrase)
  → chunk each exhibit
  → lexical overlap(duty, chunk) + optional code-scoped Chroma/TF-IDF boost
       (boost labels ∩ selected cites only)
  → EvidenceReviewHit{ cite, excerpt, score, evidence_id }
  → investigator confirms → Summary / SOD / Evidence Log
```

Optional: if exhibit `linked_wac_ids` is non-empty, restrict to those parent codes ∩ Compare selection.

## Anti-goals

- Ranking against deselected duties or RF-only subsections by default
- Complaint-as-statute authority
- Auto-writing findings narrative from themes
- Patching Corpus ingest to “fix” evidence scores

## Typical change checklist

1. Trace: Compare toggle → report `matched_subsections` / `duty_options` flags → `POST .../evidence/review` → `_duty_targets` → hits.
2. Confirm `_duty_targets` ignores RF expansion and uses selected cites.
3. Confirm `_store_label_scores` filters to selected labels.
4. Sync FE `applyDutySelection` so `included_by_default` and `matched_subsection_texts` match checkboxes.
5. Add/adjust goldens in `test_evidence_review.py`.

## Verify

```bat
cd backend
python -m pytest tests/test_evidence_review.py tests/test_evidence_log.py tests/test_summary_findings.py -q
```

UI: Compare select leaf duties → Documents/Evidence → Review → hit cites match selection only.

## Escalation

Corpus (store miss), IR Drafting (duty shape), Intake UX (selection not saved), Privacy (exhibit PII), Eval (suite), else **Master**.

Return handoff: Worker / Changed / Verify / Risks / Escalations.
