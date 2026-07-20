# WACMAKR

Self-contained web application for Washington Administrative Code (WAC) **246-341** and **246-337** compliance analysis.

## Features

- Hierarchical PDF ingestion (code → (1) → (a) → (i)) into SQLite + ChromaDB
- Checkbox WAC authorization directory with search, favorites, and expand/collapse chapters
- Investigative analysis scoped to **selected WAC subsections only** (no cross-code bleed)
- **Sole source authority:** subsection applicability is determined only from the local PDFs `data/source/WAC 246-341.pdf` and `WAC 246-337.pdf` (not example reports or external sites)
- **Case workspace** (assistive): save/resume IR drafts; rebuild only on explicit request
- DOCX export + pack (IR + deficiency cite sheet); defensibility checks (warn vs quote-integrity block)
- Evidence attachments + investigative-process builder (insert into editable draft)
- Review workflow: `draft` → `in_review` → `final` with comments (admin finalizes in-review)
- Optional OpenAI-compatible investigator LLM; scoped local fallback when unreachable
- JWT auth with open signup, Google Sign-In, password reset, and admin user management
- DOH-shaped Investigation Report draft; example DOCX corpus for IR shell phrasing only
- Voice-notes assist for intake (browser Speech API); case analytics on the Cases panel
- Dark/light/system theme; quote-integrity checks on IR draft/export
- **Privacy Category Gate:** scans complaint text for Washington Cat 3/4-style PII/PHI, highlights matches, warns, and redacts before draft/save

## Quick start (local)

One-time setup:

```bat
setup-local.bat
```

Run the full local app (API + UI in two windows):

```bat
Launch.bat
```

Or: `start-local.bat`

- UI: http://localhost:5173  
- API: http://127.0.0.1:8000  
- API docs: http://127.0.0.1:8000/docs  

Or start pieces separately with `start-backend.bat` / `start-frontend.bat`.

### Backend only

```bat
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Or run `start-backend.bat` from the project root (uses `backend\.venv`).

On first startup the API parses `data/source/WAC 246-341.pdf` and `data/source/WAC 246-337.pdf` and builds the RAG store.

### Frontend only

```bat
cd frontend
npm install
npm run dev
```

Or run `start-frontend.bat`. Open http://localhost:5173

### 3. Investigator LLM (Google Gemini free tier)

Copy `backend/.env.example` to `backend/.env` and set a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey):

```
LLM_ENABLED=true
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_API_KEY=your-gemini-api-key
LLM_MODEL=gemini-3.5-flash
```

`gemini-3.5-flash` is the current free-tier Flash model (rate-limited). Older ids like `gemini-2.5-flash` are blocked for new keys. Restart the API after editing `.env`.

**Optional — Ollama (local):**
```
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_API_KEY=
LLM_MODEL=llama3.2
```

**Optional — OpenAI:**
```
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

If no LLM is reachable, the app uses a scoped local investigator that still only cites subsections of the WACs you selected.

### 4. Auth, Google Sign-In, and admin

**Login is required.** Visiting the app redirects to `/login` until you sign in with Google SSO or a username/password. Open signup remains available (local register or Google).

**Bootstrap admin** (created on API startup when no admin exists):

```
ADMIN_BOOTSTRAP_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=ChangeMeAdmin1!
ADMIN_BOOTSTRAP_EMAIL=admin@localhost
```

Change that password after first login. Admins can open **Users** to enable/disable accounts, promote/demote admins, and issue one-time temporary passwords.

**Google Sign-In** (server-side OAuth, Navy EHIP-style button redirect)

1. Google OAuth **Web** client redirect URI:  
   `http://localhost:5173/api/auth/google/callback`  
   (origin: `http://localhost:5173`).
2. Set in `backend/.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_PUBLIC_URL=http://localhost:5173`.
3. Restart API and UI. Sign in at `http://localhost:5173/login`.
4. Details: `docs/google-signin-setup.md`.

**IR accuracy tests** (quote fidelity, ranking goldens, investigate API):

```bat
scripts\run_accuracy_tests.bat
```

Or from `backend/`: `\.venv\Scripts\python.exe -m pytest -q`

**Password reset**

- Users: **Forgot password?** in the sign-in modal, or `/reset-password?token=...` from email.
- Configure SMTP (`SMTP_HOST`, `SMTP_FROM`, etc.) to send reset links. If SMTP is unset, the API prints the reset link to the console for local testing.
- Admins can also set a temporary password from **Users** (user must change it on next sign-in).

**Security notes**

- Set a strong `SECRET_KEY` for any shared deployment.
- Register / login / Google / forgot-password are rate-limited per IP.
- New local passwords require at least 10 characters; register requires an email.

### Privacy / Category 1 gate (PII & HIPAA assist)

WACMAKR includes an **assistive** Category 3/4 gate aligned to Washington WaTech / OCIO data classification (used by DOH):

| Category | Meaning | App behavior |
|----------|---------|--------------|
| 1 – Public | Releasable | Allowed as-is |
| 2 – Sensitive | Official use only | Not auto-redacted (investigation narrative is typically Cat 2) |
| 3 – Confidential | Protected by law (e.g. RCW personal info) | Detect → highlight → warn → redact on continue |
| 4 – Special handling | Strict mandates (much HIPAA PHI) | Same as Cat 3 |

**Flow:** On blur, file extract, or **Draft report**, the API scans for identifiers (SSN, DOB, phone, email, MRN, addresses, names near clinical cues, etc.). Hits are highlighted in the complaint editor. Continuing replaces spans with tokens such as `[REDACTED_SSN]`. Only redacted text is persisted on cases or sent to investigation/LLM paths. Original identifiers are **not** stored.

This is **not** a substitute for a BAA, HIPAA program, or formal records classification. Final sensitivity judgment remains with the investigator and agency policy. Evidence file uploads are not scanned in v1 — do not upload PHI-bearing files.

## Source files

| Path | Purpose |
|------|---------|
| `data/source/WAC 246-341.pdf` | Behavioral health agency licensing |
| `data/source/WAC 246-337.pdf` | Residential treatment facility |
| `data/examples/Example 1-5.docx` | Sample investigative reports |

## Output templates

1. Full Compliance  
2. Non-Compliance  
3. Partial Compliance  
4. Informational Reference  
5. Insufficient Information  

## Architecture

- **FastAPI** async API + JWT sessions  
- **PyMuPDF** / **python-docx** document parsing  
- **ChromaDB** hierarchical metadata store  
- **TF-IDF** local retrieval + regulatory cue scoring  
- **React + Vite + Tailwind** UI  

Optional validation endpoints hit:

- https://app.leg.wa.gov/WAC/default.aspx?cite=246-341&full=true  
- https://app.leg.wa.gov/WAC/default.aspx?cite=246-337&full=true  
