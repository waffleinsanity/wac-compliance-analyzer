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
    id: '2026.07.21.2',
    buildTag: '2026.07.21.2',
    date: '2026-07-21',
    title: 'Compact report chrome on small screens',
    summary:
      'Workflow stepper and Report sticky toolbar collapse on narrow viewports so investigators keep more of the draft in view.',
    highlights: [
      'Workflow stepper hides step hints and shrinks chips on small screens.',
      'Report toolbar keeps primary Save/Export actions visible; secondary actions move under More.',
      'Privacy banner and long subtitle hide on mobile Report to reclaim vertical space.',
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
