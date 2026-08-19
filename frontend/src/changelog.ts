/**
 * Admin changelog / build notes (adapted from Navy EHIP lib/changelog.ts).
 * Append a new entry at the top whenever you ship a deploy operators should understand.
 *
 * `buildTag` is a human release label (YYYY.MM.DD.N), separate from the runtime
 * health `started_at` fingerprint.
 */

export type ChangelogArea =
  | 'platform'
  | 'auth'
  | 'cases'
  | 'investigation'
  | 'admin'
  | 'security'
  | 'learning'

export type ChangelogEntry = {
  id: string
  /** Human release tag shown in Admin (newest first). */
  buildTag: string
  /** ISO date (YYYY-MM-DD) of the ship / note. */
  date: string
  title: string
  summary: string
  highlights: string[]
  areas: ChangelogArea[]
  /** Optional commit SHAs or deploy IDs this note covers. */
  relatedBuilds?: string[]
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    id: '2026.08.19.5',
    buildTag: '2026.08.19.5',
    date: '2026-08-19',
    title: 'Periodic draft save and recall points',
    summary:
      'Open cases save on a 45-second interval and when you leave the tab. The current IR/SOD is written to the server; a versioned recall point is kept about every five minutes of changes, plus every manual save. If the network drops, the draft stays on this device until it can be restored.',
    highlights: [
      'Stepper shows last saved time, or Kept on this device when the server is unreachable.',
      'Recall restores a prior server snapshot; current work is saved first.',
      'A banner offers restore when this device has a newer copy than the server.',
    ],
    areas: ['cases', 'investigation'],
  },
  {
    id: '2026.08.19.4',
    buildTag: '2026.08.19.4',
    date: '2026-08-19',
    title: 'SOD Writing deck is core instruction; official SOD PDF labels merged',
    summary:
      'Behavioral Health SOD Writing.pptx is the writing specification (Based on evidence forms, Failure to risk, Findings included). Official SOD PDFs supplied pack labels: Facility Name and Address, Observation Findings, Case Number(s), and BHA/RTF Facility Services Type. Peer SODs remain layout shells only. Statute text still comes from local PDFs.',
    highlights: [
      'Based on seeds use observation, interview, and document review (PPTX three-form rule).',
      'Validators require two evidence forms and matching Findings included rows.',
      'Export header table matches the official SOD PDF form labels.',
    ],
    areas: ['investigation'],
  },
  {
    id: '2026.08.19.3',
    buildTag: '2026.08.19.3',
    date: '2026-08-19',
    title: 'SOD pack follows the same shell rules as the Investigation Report',
    summary:
      'Statement of Deficiency export now uses the DOH pack order from peer SOD examples: cover letter, Plan of Correction instructions, header table, then Cite / Based on / Failure to / Findings included. Regulation text still comes only from local PDFs. Findings stay investigator-owned. The identifier key is not exported.',
    highlights: [
      'SOD blank shell encoded the same way as the blank IR form (structure and voice only).',
      'Based on seeds require two or more evidence types and echo the cited duty.',
      'Export always labels Findings included and leaves the Plan of Correction column blank.',
    ],
    areas: ['investigation'],
  },
  {
    id: '2026.08.19.2',
    buildTag: '2026.08.19.2',
    date: '2026-08-19',
    title: 'Evidence step ranks exhibits against allegation duties',
    summary:
      'After Compare, Documents (IR/SOD) stay available even if exhibits are missing. Evidence is optional and ranks attached files against allegation duties. Exhibit language is not statute authority.',
    highlights: [
      'Stepper order is Intake, Compare, Documents, then Evidence.',
      'IR and SOD remain open without completing Evidence.',
      'Move between Documents and Evidence from the stepper or the Documents toolbar.',
    ],
    areas: ['investigation', 'cases'],
  },
  {
    id: '2026.08.19.1',
    buildTag: '2026.08.19.1',
    date: '2026-08-19',
    title: 'Facility policies no longer blocked as Category 3/4 evidence',
    summary:
      'Evidence upload no longer treats WAC cites, Title Case policy headings, or facility letterhead phones as personal identifiers. PDF/DOCX still block on SSN, MRN, DOB, and driver license.',
    highlights: [
      'WAC 246-341/337 section numbers are not scanned as phone numbers.',
      'Policy phrases such as Individual Service Plan are not scanned as personal names.',
      'PDF/DOCX evidence is blocked only for high-confidence identifiers, not name/phone false positives.',
    ],
    areas: ['security', 'cases'],
  },
  {
    id: '2026.08.17.5',
    buildTag: '2026.08.17.5',
    date: '2026-08-17',
    title: 'Pick any subsection from full code text',
    summary:
      'Compare investigators can add any PDF-backed subsection from the full code outline to the allegation duties and line — not only complaint-ranked suggestions.',
    highlights: [
      'Full code outline rows include Add / In allegation controls.',
      'Custom picks resolve exact duty phrases from the PDF store and persist on the case.',
      'Duty checkboxes show which subsections came from the full code picker.',
    ],
    areas: ['investigation'],
  },
  {
    id: '2026.08.17.4',
    buildTag: '2026.08.17.4',
    date: '2026-08-17',
    title: 'Readable full-code outline on Compare',
    summary:
      'Show full selected code text now breaks numbered and nested WAC/RCW list items into an indented outline. Statute wording stays PDF-exact; cross-references stay inline.',
    highlights: [
      'Compare full-code pane uses hanging (1)/(a)/(i)/(A) labels instead of one paragraph.',
      'Phrases like “subsection (3) of this section” are not treated as new list items.',
    ],
    areas: ['investigation'],
  },
  {
    id: '2026.08.17.3',
    buildTag: '2026.08.17.3',
    date: '2026-08-17',
    title: 'Compare catch-all (1) and full-width Google sign-in',
    summary:
      'Compare drafts include each selected WAC’s PDF-backed (1) catch-all beside compact exact-duty leaves. Login Google and password fields share one width.',
    highlights: [
      'Allegation lines use nearest-parent + leaf WAC wording, sanitized cites, and up to three specific duties plus (1).',
      'Patrol/background-check false friends drop unless the complaint mentions them.',
      'Sign in with Google uses the same full-width control as Username and Sign in.',
    ],
    areas: ['investigation', 'auth'],
  },
  {
    id: '2026.08.17.2',
    buildTag: '2026.08.17.2',
    date: '2026-08-17',
    title: 'Groq as the default optional investigator LLM',
    summary:
      'Optional collaborator notes default to Groq openai/gpt-oss-120b instead of unpaid Gemini. IR cites stay PDF-backed; LLM_FOR_INVESTIGATE remains off. Ollama stays the on-box privacy path.',
    highlights: [
      'Default LLM_BASE_URL is api.groq.com with openai/gpt-oss-120b (gpt-oss-20b fallback).',
      'Unpaid Gemini remains documented but is not recommended for complaint text (training on prompts).',
      'Ollama and Cerebras stay as drop-in OpenAI-compatible alternatives.',
    ],
    areas: ['investigation', 'platform', 'security'],
  },
  {
    id: '2026.08.17.1',
    buildTag: '2026.08.17.1',
    date: '2026-08-17',
    title: 'Bug report screenshots from the live app',
    summary:
      'Report a bug can capture the current Investigation screen in one click, or attach an uploaded image, so Inbox reports include what the investigator actually saw.',
    highlights: [
      'Take screenshot hides the report dialog and captures the live application view.',
      'Upload image remains available for cropped or external pictures.',
      'Preview and remove before submit; existing Inbox screenshot viewer is unchanged.',
    ],
    areas: ['admin', 'platform'],
  },
  {
    id: '2026.07.31.1',
    buildTag: '2026.07.31.1',
    date: '2026-07-31',
    title: 'IR demos, exact allegations, and easy Download',
    summary:
      'Admin demos seed blank-IR shell fields and match today’s product: full exact WAC duties, always-available Download DOCX, Report Edit dropdowns, and policy guidance under data/examples/policy_guidance/.',
    highlights: [
      'Twelve demos carry investigation type + licensing/federal priorities into the drafted IR and DOCX.',
      'Allegations keep full PDF duty language — no "; see also" cite-list shortcuts or truncated duties.',
      'Working-draft Download DOCX is always available; evidence attach accepts multiple files.',
      'Report toolbar sits flush under Intake–Compare–Report; Edit dropdowns update the IR shell.',
      'Core docs: blank IR template plus Peer Review / SOD / Enforcement / DPOC desk manuals in policy_guidance/.',
    ],
    areas: ['investigation', 'admin', 'platform'],
  },
  {
    id: '2026.07.22.2',
    buildTag: '2026.07.22.2',
    date: '2026-07-22',
    title: 'Exact DOH Investigation Report format',
    summary:
      'DOCX export and Form preview follow the blank Investigation Report shell — Header facility lines, Allegation: lines, Pre-investigation Activity, and DOH conclusion phrasing — without Heading 2 chrome or Regulatory Framework dumps.',
    highlights: [
      'Export clones blank template styles (Header / No Spacing); process is plain paragraphs, not bullets.',
      'Pre-investigation Activity block is part of the canonical Investigative Process shell.',
      'Report panel Document preview shows the letter-style IR on screen (same layout as Download DOCX).',
    ],
    areas: ['investigation', 'platform'],
  },
  {
    id: '2026.07.22.1',
    buildTag: '2026.07.22.1',
    date: '2026-07-22',
    title: 'Update banner contrast and session keep-alive',
    summary:
      'New-build banner is readable in dark mode, and Update now no longer wipes the session on a brief API blip.',
    highlights: [
      'Dark-mode update banner uses high-contrast teal and ink text.',
      'Session refresh only clears the token on 401/403; network/deploy errors retry and keep you signed in.',
    ],
    areas: ['platform', 'auth'],
  },
  {
    id: '2026.07.21.3',
    buildTag: '2026.07.21.3',
    date: '2026-07-21',
    title: 'Readable Cases panel',
    summary:
      'Cases rail is wider and title-first, with status chips restored so Draft / In review / Final stay scannable alongside search.',
    highlights: [
      'Human titles lead each card; compact status chips match the workflow stepper language.',
      'Status filter chips return (All / Draft / In review / Final); search filters by title or case ID.',
      'Archive and trash stay in a ⋯ menu so titles are not crushed by action buttons.',
    ],
    areas: ['cases', 'platform'],
  },
  {
    id: '2026.07.21.2',
    buildTag: '2026.07.21.2',
    date: '2026-07-21',
    title: 'Compact report chrome on small screens',
    summary:
      'Workflow stepper and Report sticky toolbar collapse into single dense rows so mid-width and mobile viewports keep the draft readable.',
    highlights: [
      'Workflow stepper is one row: step labels + context chips (hints only via tooltip).',
      'Report toolbar is one row: title, status chips, Save/DOCX, and a More menu for secondary export actions.',
      'Privacy banner and long subtitle stay off until large screens.',
    ],
    areas: ['platform', 'investigation'],
  },
  {
    id: '2026.07.21.1',
    buildTag: '2026.07.21.1',
    date: '2026-07-21',
    title: 'Application strength on research and Compare',
    summary:
      'Optional corpus research and Compare now share Strong / Moderate / Weak / None application labels so investigators can spot WAC/RCW that may fit the complaint better than current approvals.',
    highlights: [
      'Shared application-strength scale on Optional research, Related suggestions, and Compare.',
      'Research hits that look stronger than the weakest approved code are flagged “Stronger fit?”.',
      'Compare page includes the same optional research panel for discovery without leaving the step.',
    ],
    areas: ['investigation', 'cases', 'platform'],
  },
  {
    id: '2026.07.20.3',
    buildTag: '2026.07.20.3',
    date: '2026-07-20',
    title: 'Full Navy EHIP platform parity pass',
    summary:
      'Closes the remaining useful EHIP SaaS gaps: update banner, invites, lockout, access requests, diagnostics install, retention UI, and collector protection.',
    highlights: [
      'App update banner + /api/version fingerprint; chunk-stale handler keeps sessions intact after deploys.',
      'Client diagnostics ring buffer installed globally for richer bug reports; session-expired recovery on bug/feedback submit.',
      'Invite codes + invite-only signup; login lockout (3/15m) with admin Unlock; email domain allowlist config.',
      'Role elevation access requests (Account settings → Admin Access triage).',
      'Admin Access tab: mint invites, review requests, run case retention.',
      'Google unlink; robots.txt + known AI crawler block; health includes version.',
    ],
    areas: ['platform', 'auth', 'admin', 'security'],
  },
  {
    id: '2026.07.20.2',
    buildTag: '2026.07.20.2',
    date: '2026-07-20',
    title: 'Viewer edit access and evolving IR style bank',
    summary:
      'Viewers can create and edit investigation reports in-system; export/copy stay Editor/Admin. Completed exports and submissions harvest writing style for future drafts.',
    highlights: [
      'Viewer role may create/edit cases and IR drafts; Export DOCX, pack, copy, and .txt remain Editor/Admin only.',
      'IR learning bank (ir_learning_snippets) harvests on export, submit-for-review, and finalize.',
      'Future drafts reuse learned allegation connectors and preamble preferences; statute duty text stays PDF-only.',
      'Admin privacy screen banner and corpus search blend improvements included in this ship.',
    ],
    areas: ['auth', 'cases', 'investigation', 'learning', 'admin'],
    relatedBuilds: ['0ae4308'],
  },
  {
    id: '2026.07.20.1',
    buildTag: '2026.07.20.1',
    date: '2026-07-20',
    title: 'Google account linking and case isolation',
    summary:
      'Admins and users can link Google to an existing password account; cases stay owner-isolated across multi-user Google sign-in.',
    highlights: [
      'Authenticated Google link prepare + callback so Google sign-in opens the same account (including admin).',
      'Per-account case isolation for multi-user Google sign-in (no cross-user case leakage).',
      'Google OAuth start/callback stability fixes for Railway.',
    ],
    areas: ['auth', 'cases', 'security', 'admin'],
    relatedBuilds: ['415a18e', 'c32d876', '6d5fa17'],
  },
  {
    id: '2026.07.18.1',
    buildTag: '2026.07.18.1',
    date: '2026-07-18',
    title: 'Admin, support inbox, and role model',
    summary:
      'Navy-style Admin / Editor / Viewer roles, bug reports, feedback inbox, and account tools adapted for WACMAKR.',
    highlights: [
      'Admin users panel: create users, assign roles, issue temporary passwords.',
      'Bug report and feedback dialogs with diagnostics; Admin Inbox triage.',
      'Audit log of auth, admin, and support actions.',
      'Account settings for theme, password, and profile.',
    ],
    areas: ['admin', 'auth', 'platform'],
  },
  {
    id: '2026.07.17.1',
    buildTag: '2026.07.17.1',
    date: '2026-07-17',
    title: 'Investigation workflow and Railway packaging',
    summary:
      'End-to-end IR drafting workflow with case workspace, trash/restore, and production Docker/Railway packaging.',
    highlights: [
      'Complaint → WAC selection → review → IR draft workflow with case persistence.',
      'Case trash/restore and defensibility/quote gates on export.',
      'Railway healthcheck-safe startup with background corpus ingest.',
    ],
    areas: ['investigation', 'cases', 'platform'],
    relatedBuilds: ['f923ec7', 'a8bca77', 'a1e64a1'],
  },
]

export function listChangelogEntries(): ChangelogEntry[] {
  return [...CHANGELOG_ENTRIES].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    return b.buildTag.localeCompare(a.buildTag)
  })
}

export function getLatestChangelogEntry(): ChangelogEntry | null {
  return listChangelogEntries()[0] ?? null
}

export const CHANGELOG_AREA_LABELS: Record<ChangelogArea, string> = {
  platform: 'Platform',
  auth: 'Auth',
  cases: 'Cases',
  investigation: 'Investigation',
  admin: 'Admin',
  security: 'Security',
  learning: 'Learning',
}
