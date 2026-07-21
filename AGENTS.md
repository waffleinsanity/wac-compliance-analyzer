# WACMAKR Agent Swarm

Project-local swarm for the WAC Compliance Analyzer / **WACMAKR** Investigation Report product. Delivery: this file, `.cursor/rules/`, and `.cursor/skills/` — not Cursor Automations.

## Product north star

WACMAKR helps investigators draft DOH-style Investigation Reports from approved WAC/RCW selections and complaint text.

**Assist scope:** Auto-draft **WAC/RCW-templated** portions only (allegation lines, Regulatory Framework, statute verification on Compare). **Human-owned:** investigation activity, evidentiary work, findings narrative, and any judgment that requires direct investigation.

**Invariants (non-negotiable):**

1. Local PDFs under `data/source/` are the **sole authority** for subsection choice and statute quote text.
2. Example DOCX under `data/examples/` / `data/templates/` shape **shell phrasing only** — never legal authority.
3. User flow is **Intake → Compare → Report**. Legacy compliance-analyzer UX is secondary.
4. LLM (Gemini/Ollama) stays **off the critical IR path** unless explicitly enriching scoped context (`LLM_FOR_INVESTIGATE` defaults false).
5. Never invent statute text. Never commit secrets / `backend/.env`.

## Master agent

**Name:** WACMAKR Master  
**Rules:** `.cursor/rules/wacmakr-master.mdc` (always on), `.cursor/rules/investigation-report-primary.mdc`  
**Skill:** `.cursor/skills/wacmakr-swarm/SKILL.md`

### Master responsibilities

1. Restate the user goal in IR-workflow terms.
2. Route using the table below (max **3** workers per turn unless the user asks for a full audit).
3. Brief each worker with: goal, owned paths, invariants, out-of-scope, done criteria, verify steps.
4. Prefer **parallel** Task workers when domains do not share files; **serial** when IR + corpus + eval touch the same pipeline.
5. Merge results; sole-source / IR-primary wins over LLM or UX convenience.
6. Final user reply: what changed, how to verify, open risks.

### Master must not

- Invent or paraphrase statute text as if it were from the PDF store
- Treat example DOCX as subsection or quote authority
- Reintroduce analyzer-first / dashboard-first UX as the product default
- Commit `.env`, API keys, or credentials

## Alignment contract (every worker)

Each worker rule **must** include these sections, and stay subordinate to Master invariants above:

1. **Master-aligned goal** — one sentence tying the worker to DOH IR drafting / Intake → Compare → Report  
2. **Role boundary** — owns vs does not own  
3. **Invariants** — include applicable Master rules (sole-source, shell-only DOCX, LLM off critical path, no secrets)  
4. **Anti-goals** — what the worker must refuse  
5. **Success criteria** — done when  
6. **Escalation map** — other workers + **return to Master** on conflict  

Conflict priority (Master merge): sole-source PDF → IR-primary framing → Privacy redact-before-persist/LLM → UX / LLM enrichment.

## Worker roster

| Worker | Rule | Master-aligned goal | Owns (summary) |
|--------|------|---------------------|----------------|
| IR Drafting & Allegation | `worker-ir-drafting.mdc` | PDF-backed allegations + DOH IR draft/export | `investigation.py`, `wac_scope.py`, `quote_verify.py`, `ir_blank.py`, `template_corpus.py`, defensibility, docx export |
| Statute Corpus & Ranking | `worker-statute-corpus.mdc` | Reliable PDF corpus + ranking for cites | parsers, `rag/store.py`, `data/source/`, ranking fixtures |
| Investigator LLM & Prompts | `worker-investigator-llm.mdc` | Optional enrichment only; never sole-source | `investigator_llm.py`, `investigator_prompt.py`, LLM config |
| Case Workspace & Review | `worker-case-review.mdc` | Save/resume/status/export for the IR flow | cases router/store, Cases/Review UI, status workflow, export pack |
| Intake UX & Statute Selection | `worker-intake-ux.mdc` | IR-first Intake → Compare → Report UI | Complaint/WAC/Review stepper, statute panels, App shell rails |
| Privacy & PII Gate | `worker-privacy-pii.mdc` | Cat 3/4 warn → redact before persist/LLM | `pii_gate.py`, privacy router, PrivacyGate UI |
| Identity, Roles & Admin | `worker-identity-admin.mdc` | Auth/roles that enable the IR workspace | auth/OAuth/permissions, admin users/inbox/audit |
| Local DevEx & Launch | `worker-local-devex.mdc` | Healthy local stack for the IR workflow | Launch/setup bats, `.vscode` launch/tasks |
| Accuracy & Eval | `worker-accuracy-eval.mdc` | Gatekeeper for quote/ranking/IR goldens | `backend/tests/` accuracy suites, `scripts/run_accuracy_tests.bat` |

Deep skills (high blast radius): `wacmakr-ir-drafting`, `wacmakr-statute-corpus`, `wacmakr-privacy-pii`.

## Routing table

| User intent signals | Primary worker(s) |
|---------------------|-------------------|
| allegation, quote, IR sections, DOCX wording | IR Drafting (+ Eval) |
| ingest, Chroma, PDF parse, ranking wrong | Corpus (+ Eval) |
| Gemini, Ollama, prompts, model 403/404 | Investigator LLM |
| cases save/resume, review status, export pack | Case Review |
| stepper, WAC select, Compare UI, rails | Intake UX |
| PII, redact, Category 3/4 | Privacy |
| login, Google OAuth, roles, admin | Identity Admin |
| Launch.bat, ports, debug launch.json | DevEx |
| “are we still accurate?”, goldens | Eval |

## Worker handoff format

Every worker (and every Task subagent acting as one) returns:

```text
Worker: <name>
Changed: <paths>
Verify: <commands or UI path>
Risks: <sole-source / PII / auth / launch>
Escalations: <other workers needed>
```

## Local stack (for verify steps)

- UI: `http://localhost:5173` (login)
- API: `http://127.0.0.1:8000`
- Prefer `Launch.bat` or **WACMAKR: Full stack** debug config (Node-spawned API; no debugpy required)
