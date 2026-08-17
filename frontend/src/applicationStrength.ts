/** Shared WAC/RCW application-strength labels for research + Compare. */

export type ApplicationStrength = 'strong' | 'moderate' | 'weak' | 'none'

export type ApplicationStrengthSource = 'ir_match' | 'research'

/** Align with backend wac_scope score bands for IR drafts. */
export const IR_WEAK_SCORE = 0.3
export const IR_STRONG_SCORE = 0.5

/**
 * Legacy corpus-blend cutoffs (pre IR-preview research).
 * Prefer score_basis === 'ir_leaf' → IR bands.
 */
export const RESEARCH_WEAK_SCORE = 0.06
export const RESEARCH_STRONG_SCORE = 0.16

const LABELS: Record<ApplicationStrength, string> = {
  strong: 'Strong application',
  moderate: 'Moderate application',
  weak: 'Weak application',
  none: 'No clear application',
}

const SHORT: Record<ApplicationStrength, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  weak: 'Weak',
  none: 'None',
}

export function applicationStrengthLabel(
  s: ApplicationStrength,
  opts?: { short?: boolean },
): string {
  return opts?.short ? SHORT[s] : LABELS[s]
}

function bandFromScore(
  score: number,
  weakCut: number,
  strongCut: number,
): ApplicationStrength {
  if (score <= 0) return 'none'
  if (score < weakCut) return 'weak'
  if (score < strongCut) return 'moderate'
  return 'strong'
}

/**
 * Map IR compare match fields (or research preview scores) to application strength.
 * Quote integrity stays separate — this is complaint-to-code fit only.
 */
export function applicationStrengthFromMatch(input: {
  score?: number | null
  reason?: string | null
  lowConfidence?: boolean | null
  source?: ApplicationStrengthSource
  /** When research returns IR leaf scores, use Compare bands. */
  scoreBasis?: string | null
}): ApplicationStrength {
  const reason = (input.reason || '').toLowerCase()
  const source = input.source || 'ir_match'
  const score = typeof input.score === 'number' && Number.isFinite(input.score) ? input.score : null
  const useIrBands =
    source === 'ir_match' ||
    input.scoreBasis === 'ir_leaf' ||
    reason === 'lexical_overlap' ||
    reason === 'explicit_cite' ||
    reason === 'structural_anchor' ||
    reason === 'code_fallback'

  if (reason === 'explicit_cite') return 'strong'
  if (reason === 'structural_anchor') return 'moderate'
  if (reason === 'code_fallback') {
    if (score != null && score >= IR_STRONG_SCORE) return 'moderate'
    return score != null && score > 0 ? 'weak' : 'none'
  }

  if (score == null) {
    if (input.lowConfidence) return 'weak'
    return 'none'
  }

  if (source === 'research' && !useIrBands) {
    return bandFromScore(score, RESEARCH_WEAK_SCORE, RESEARCH_STRONG_SCORE)
  }

  if (input.lowConfidence || score < IR_WEAK_SCORE) {
    return score <= 0 ? 'none' : 'weak'
  }
  return bandFromScore(score, IR_WEAK_SCORE, IR_STRONG_SCORE)
}

/** True when a research hit looks stronger than an approved code's IR match. */
export function isStrongerThan(
  candidate: ApplicationStrength,
  approved: ApplicationStrength,
): boolean {
  const rank: Record<ApplicationStrength, number> = {
    none: 0,
    weak: 1,
    moderate: 2,
    strong: 3,
  }
  return rank[candidate] > rank[approved]
}
