/** User-facing labels for investigators — never expose internal codes or model jargon. */

const QUOTE_FAILURE_REASONS: Record<string, string> = {
  not_in_store: 'Statute wording does not match the approved code text',
  cite_outside_selection: 'Cite is outside the approved WAC/RCW selection',
  truncated_ellipsis: 'Statute wording looks incomplete — review against the code text',
  empty_quote: 'Missing statute wording in this line',
  no_source: 'No matching code text found for this cite',
}

const CASE_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  final: 'Final',
  reopened: 'Reopened',
  archived: 'Archived',
  trashed: 'Trash',
}

const DEFENSIBILITY_LABELS: Record<string, string> = {
  pass: 'Ready',
  warn: 'Needs review',
  block: 'Blocked',
}

/** Map quote-integrity failure reason codes to investigator language. */
export function quoteFailureLabel(reason: string | null | undefined): string {
  if (!reason) return 'Needs review'
  return QUOTE_FAILURE_REASONS[reason] || 'Needs review against approved code text'
}

export function caseStatusLabel(status: string | null | undefined): string {
  if (!status) return ''
  return CASE_STATUS_LABELS[status] || status.replace(/_/g, ' ')
}

export function defensibilityOverallLabel(overall: string | null | undefined): string {
  if (!overall) return ''
  return DEFENSIBILITY_LABELS[overall] || 'Needs review'
}
