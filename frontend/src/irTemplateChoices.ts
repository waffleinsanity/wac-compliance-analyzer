/** Dropdown choices from blank Investigation Report content controls. */

export const CHOOSE_ITEM = 'Choose an item.'

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

/** Blank conclusion SDT: only these two; empty = Choose an item. */
export const CONCLUSION_FINDING_CHOICES = ['not in compliance', 'in compliance'] as const

export const ACTION_DETERMINATION_CHOICES = [
  'No Statement of Deficiency, No Further Action Required',
  'Letter of No Deficiency',
  'Statement of Deficiency with Directed Plan of Correction',
  'Referred Statement of Deficiency to Office of Investigative and Legal Services',
  'Memo to File',
  'Statement of Deficiency, Plan of Correction Reviewed',
  'Statement of Deficiency - No Plan of Correction Required',
  'Statement of Deficiency, Plan of Correction Reviewed, On-site Re-visit',
] as const

/** Preserve blank spelling "Referrred" (three r's) for CARF. */
export const ACTION_REFERRAL_CHOICES = [
  'Referred to Medical Commission',
  'Referred to Nursing Commission',
  'Referred to Office of Investigative and Legal Services',
  'Referred to Health Care Authority',
  'Referred back to Case Management Team',
  'No Additional Referrals Needed',
  'Referrred to Commission on Accreditation of Rehabilitation Facilities',
  'Referred to Joint Commission',
  'Referred to Council on Accreditation',
] as const

export function composeActionsText(determination?: string | null, referral?: string | null): string {
  const d = (determination || '').trim() || CHOOSE_ITEM
  const r = (referral || '').trim() || CHOOSE_ITEM
  return `${d}\n${r}`
}

export function parseActionsFields(report: {
  actions?: string | null
  action_determination?: string | null
  action_referral?: string | null
}): { determination: string; referral: string } {
  const det = (report.action_determination || '').trim()
  const ref = (report.action_referral || '').trim()
  if (det || ref) return { determination: det, referral: ref }

  const lines = (report.actions || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l.toLowerCase() !== '[to be determined after investigation]')

  if (!lines.length) return { determination: '', referral: '' }

  const knownDet = new Set(
    ACTION_DETERMINATION_CHOICES.map((c) => c.toLowerCase()).concat(CHOOSE_ITEM.toLowerCase()),
  )
  const knownRef = new Set(
    ACTION_REFERRAL_CHOICES.map((c) => c.toLowerCase()).concat(CHOOSE_ITEM.toLowerCase()),
  )

  if (lines.length >= 2) {
    const a = lines[0]
    const b = lines[1]
    return {
      determination: a.toLowerCase() === CHOOSE_ITEM.toLowerCase() ? '' : a,
      referral: b.toLowerCase() === CHOOSE_ITEM.toLowerCase() ? '' : b,
    }
  }
  const only = lines[0]
  if (knownRef.has(only.toLowerCase())) {
    return { determination: '', referral: only === CHOOSE_ITEM ? '' : only }
  }
  if (only.toLowerCase() === CHOOSE_ITEM.toLowerCase()) {
    return { determination: '', referral: '' }
  }
  if (knownDet.has(only.toLowerCase())) {
    return { determination: only, referral: '' }
  }
  return { determination: only, referral: '' }
}
