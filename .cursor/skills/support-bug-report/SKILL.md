---
name: support-bug-report
description: >-
  Investigate and fix WACMAKR Support inbox bug reports end-to-end. Use when the
  user pastes a Support inbox agent brief, mentions Admin Inbox / bug report
  triage, asks to resolve a product bug from the inbox, or references
  /api/support/bugs. Prefer this over generic debugging for inbox-filed issues.
---

# Support bug report

## Goal

Turn an Admin → Inbox bug into a fixed, shippable change and a clear resolve path.

## Inputs

Accept any of:

- Pasted **agent brief** from Inbox → **Copy agent brief**
- Bug id + title/description/screenshot notes
- Link to production page from `page_url`

Do **not** expect complaint text in diagnostics (by design).

## Workflow

1. **Restate** the user-visible failure in one sentence.
2. **Locate** UI/API from `page_url`, title, description, and diagnostics (route, component, console errors).
3. **Reproduce** from code paths; check sticky headers, banners, z-index, and viewport height first for “screen not visible / too much room” class bugs.
4. **Fix** with the smallest change that matches existing patterns. Avoid drive-by refactors.
5. **Verify** with typecheck/tests relevant to the touch points when practical.
6. **Resolve handoff** for the admin:
   - Suggested admin note (1–2 sentences: cause + fix)
   - Remind to set status `resolved` via Inbox (or `PATCH /api/support/bugs/{id}` with `{ "status": "resolved", "admin_note": "..." }`)
7. If the user says **ship it**, commit/push/deploy per repo norms (`feature/wacmakr-investigation-flow`, Railway).

## Inbox API (admin JWT)

- `GET /api/support/bugs?status=open|in_progress|resolved|closed`
- `PATCH /api/support/bugs/{id}` body `{ status?, admin_note? }`
- `GET /api/support/bugs/{id}/screenshot`
- Statuses: `open` | `in_progress` | `resolved` | `closed`

## Done criteria

- Code fix addresses the reported symptom
- No silent status UX regressions in Admin inbox
- Admin note text ready to paste
- Bug can be marked **Resolved** without disappearing into a mismatched filter (inbox syncs filter to new status)
