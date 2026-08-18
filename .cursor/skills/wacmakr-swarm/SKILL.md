---
name: wacmakr-swarm
description: >-
  Orchestrates the WACMAKR master/worker agent swarm via Task subagents.
  Use when the user asks to run the swarm, when a request spans multiple
  domains (IR drafting, corpus, LLM, cases, intake UX, privacy, auth, DevEx,
  eval), or when routing work across WACMAKR specialists per AGENTS.md.
---

# WACMAKR Swarm Orchestration

## When to use

- Multi-domain requests (e.g. “fix quotes and ranking” → IR + Corpus + Eval)
- Explicit “use the swarm” / “spawn workers”
- Large changes where master should not edit every file alone

Skip for single-file trivial edits already inside one worker’s globs.

## Protocol

### 1. Classify

Map intent to workers using `AGENTS.md` routing table. Cap at **3** workers unless user requests a full audit.

### 2. Brief

Each Task prompt must include (Alignment contract from `AGENTS.md`):

```text
You are the <Worker Name> for WACMAKR.
Master-aligned goal: <one sentence tied to DOH IR / Intake→Compare→Report>
Owned paths: <list>
Does not own: <out of scope>
Invariants: <from AGENTS.md + your worker rule>
Anti-goals: <what to refuse>
Done criteria: <testable success>
Verify: <commands or UI>
Escalate via your rule’s map; return to Master on conflict.
Return the handoff block:
Worker / Changed / Verify / Risks / Escalations
```

Before editing product code, workers should confirm their `.mdc` still has Goal / Boundary / Invariants / Anti-goals / Success / Escalation.

### 3. Execute

| Situation | Task subagent_type |
|-----------|--------------------|
| Read-only recon | `explore` |
| Code edits | `generalPurpose` |
| Shell-heavy launch/debug | `shell` |

- **Parallel:** workers with disjoint file ownership
- **Serial:** IR → Corpus → Eval when the same pipeline is in flight (or Corpus → IR → Eval)

### 4. Merge

Master resolves conflicts. Priority:

1. Sole-source PDF authority
2. IR-primary product framing
3. Privacy redact-before-persist/LLM
4. UX convenience / LLM enrichment

### 5. Verify

If IR Drafting or Corpus changed, run or request Eval:

```bat
scripts\run_accuracy_tests.bat
```

Or targeted pytest under `backend/tests/` (`test_quote_verify`, `test_subsection_ranking`, `test_allegation_source`, `test_investigate_api`).

### 6. Report

Concise user summary: workers used, changes, verify steps, risks. No `.env` / secrets.

## Examples

**“Allegation quotes don’t match the PDF”**  
Workers: IR Drafting → Eval (serial). Deep skill: `wacmakr-ir-drafting`.

**“Chroma empty / ranking wrong after ingest”**  
Workers: Corpus → Eval. Deep skill: `wacmakr-statute-corpus`.

**“PII gate blocks draft then Groq still sees raw text”**  
Workers: Privacy (+ Investigator LLM if prompt path). Deep skill: `wacmakr-privacy-pii`.

**“Full stack won’t start / debugpy error”**  
Worker: DevEx only (usually no swarm).
