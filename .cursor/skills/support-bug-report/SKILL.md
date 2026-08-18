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

## Production-first inbox check

**Always query the live/production Admin Inbox first**, not just the local database.

- Production base URL: `https://app-production-c7de.up.railway.app`
- Authenticate with `POST /api/auth/login` (form-urlencoded `username` + `password`; admin credentials from `backend/.env` or `ADMIN_BOOTSTRAP_*` env vars).
- Fetch `GET /api/support/bugs?status=open` and `GET /api/support/bugs?status=in_progress` from the production URL.
- Only fall back to localhost if the production endpoint is unreachable.

## Workflow

1. **Fetch** open and in-progress bugs from the **production** Inbox API (see above).
2. **Restate** each user-visible failure in one sentence.
3. **Locate** UI/API from `page_url`, title, description, and diagnostics (route, component, console errors).
4. **Reproduce** from code paths; check sticky headers, banners, z-index, and viewport height first for "screen not visible / too much room" class bugs.
5. **Fix** with the smallest change that matches existing patterns. Avoid drive-by refactors.
6. **Verify** with typecheck/tests relevant to the touch points when practical.
7. **Mark each bug resolved automatically** when fixes + verification are done:
   - Create an admin note (1–2 sentences: cause + fix).
   - `PATCH /api/support/bugs/{id}` on the **production** API with body `{ "status": "resolved", "admin_note": "..." }`.
8. If the user says **ship it**, commit/push/deploy per repo norms (`feature/wacmakr-investigation-flow`, Railway).

## Inbox API (admin JWT)

- `GET /api/support/bugs?status=open|in_progress|resolved|closed`
- `PATCH /api/support/bugs/{id}` body `{ status?, admin_note? }`
- `GET /api/support/bugs/{id}/screenshot`
- Statuses: `open` | `in_progress` | `resolved` | `closed`

## Done criteria

- Code fix addresses the reported symptom
- No silent status UX regressions in Admin inbox
- Each fixed bug is PATCH'd to `resolved` on production with an admin note
- Bug can be marked **Resolved** without disappearing into a mismatched filter (inbox syncs filter to new status)
