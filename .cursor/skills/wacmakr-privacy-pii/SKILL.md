---
name: wacmakr-privacy-pii
description: >-
  Deep playbook for WACMAKR Privacy & PII Gate — Category 3/4 detection, warn
  and redact flows, PrivacyGate UI, and redact-before-persist/LLM contracts.
  Use when working on PII, redaction, Category 3/4, or privacy gate behavior.
---

# WACMAKR Privacy & PII Playbook

## Goal (Master-aligned)

Strengthen the assistive Category 3/4 gate so investigators can draft DOH-style Investigation Reports (Intake → Compare → Report) without sending raw sensitive text into **case persist** or **LLM** paths — without claiming perfect detection or legal compliance.

Master conflict order still applies: sole-source PDF / IR-primary win over UX; privacy redact-before-persist/LLM is next (see `wacmakr-swarm`).

## Role boundary

| In scope | Out of scope |
|----------|----------------|
| `backend/app/services/pii_gate.py` | Case store / cases router (Case Review) |
| `backend/app/routers/privacy.py` | Allegation quotes, IR shell, DOCX (IR Drafting) |
| `frontend/src/components/PrivacyGate.tsx` | Gemini/Ollama prompts & config (Investigator LLM) |
| Warn → acknowledge/redact API↔UI contracts | Auth, roles, admin audit surfaces (Identity) |
| Assistive copy & recovery paths | Stepper chrome / WAC select (Intake UX) |

Touch shared call sites only to confirm cleaned text flows; escalate ownership edits.

## Owned paths

- `backend/app/services/pii_gate.py`
- `backend/app/routers/privacy.py`
- `frontend/src/components/PrivacyGate.tsx`

## Invariants

1. Gate is **assistive** — never claim perfect detection or compliance certification.
2. Flow: detect → warn → user path → **redact before persist** and **before LLM**.
3. Do not pretend evidence uploads are fully scanned if product docs say they are not.
4. False positives need a clear continue/redact path so IR drafting is not a dead end.
5. Do not log raw Category 3/4 payloads into audit/support beyond existing deliberate design.

## Anti-goals

- Hard-blocking Intake → Report with no acknowledge/redact recovery
- Expanding ownership into case persistence, LLM prompts, or auth
- Marketing the gate as “HIPAA/DOH certified” or similar
- Using privacy work to reintroduce analyzer-first UX
- Inventing statute/quote behavior (not this worker’s domain)

## Success criteria

- Investigators see clear Cat 3/4 warn + actionable redact/continue paths
- When gate is engaged, case persist and optional LLM enrichment receive cleaned text
- UI/API contracts stay aligned (`PrivacyGate` ↔ privacy router ↔ `frontend/src/api.ts`)
- No new claims of perfect scanning or legal compliance in copy or docs you touch
- Legitimate IR drafting remains possible after a detection (assistive, not a wall)

## Escalation map

| Signal | Escalate to |
|--------|-------------|
| Case save still stores raw complaint text after redact | **Case Review** |
| Investigate / enrichment still prompts on raw text | **Investigator LLM** + **IR Drafting** |
| Gate missing or misplaced on Complaint step | **Intake UX** |
| Support tickets / admin audit expose raw Cat 3/4 | **Identity Admin** |
| Accuracy suites need privacy fixtures | **Accuracy & Eval** |

## Typical change checklist

1. Trace text: Complaint intake → PrivacyGate → case store / investigate / LLM.
2. Confirm redacted text is what downstream services receive after acknowledge/redact.
3. Keep UI copy assistive and investigator-facing (warn, don’t block without recovery).
4. If LLM or investigate still sees raw text, escalate — do not “fix” by owning their modules.
5. Avoid logging or echoing matched payloads in new error/audit paths.

## Verify

- UI (`http://localhost:5173`): paste sample Cat 3/4-like text on Intake; confirm warn + redact/continue path; proceed toward Compare/Report.
- API (`http://127.0.0.1:8000`): privacy endpoints still match `PrivacyGate` / `frontend/src/api.ts` contracts.
- Spot-check investigate/LLM and case-save paths use cleaned text when gate engaged.

## Handoff

Return the `AGENTS.md` handoff block:

```text
Worker: Privacy & PII Gate
Changed: <paths>
Verify: <commands or UI path>
Risks: <PII / persist / LLM exposure>
Escalations: <other workers needed>
```
