/** Dropdown choices from blank Investigation Report content controls. */

export const INVESTIGATION_TYPE_CHOICES = [
  'On-site State Investigation',
  'On-site Federal Investigation',
  'On-site State and Federal Investigation',
  'Off-site State Investigation',
] as const

export const STATE_LICENSING_PRIORITY_CHOICES = ['A', 'B', 'C', 'N/A'] as const

export const FEDERAL_CERTIFICATION_PRIORITY_CHOICES = [
  'N/A',
  'Immediate Jeopardy (IJ)',
  'Non-IJ High',
  'Non-IJ Medium',
  'Non-IJ Low',
  'Adminstrative Review/Offsite Investigation',
  'Referral - Immediate',
  'Referral - Other',
  'No Action Necessary',
] as const
