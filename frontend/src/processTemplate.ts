/** Fixed DOH Investigative Process shell — labels are template structure, not deletable rows. */

export type ProcessFields = {
  preInvestigation: string
  observations: string
  interviews: string
  documentReview: string
}

export const PROCESS_LABELS = {
  preInvestigation: 'Pre-investigation Activity:',
  investigationActivity: 'Investigation Activity:',
  observations: 'Observations',
  interviews: 'Interviews',
  documentReview: 'Document Review',
} as const

const DEFAULT_PRE = [
  'The Investigator reviewed relevant Washington Administrative Codes (WACs) and Revised Code of Washington (RCWs) statutes and regulations.',
  'The Investigator reviewed the complaint allegations.',
  'The Investigator developed an investigation plan.',
].join('\n')

const DEFAULT_DOC_REVIEW =
  'The Investigator will review facility policies, procedures, and records relevant to the authorized allegations.'

export const DEFAULT_PROCESS_FIELDS: ProcessFields = {
  preInvestigation: DEFAULT_PRE,
  observations: '[To be completed]',
  interviews: '[To be completed]',
  documentReview: DEFAULT_DOC_REVIEW,
}

function normLabel(s: string): string {
  return s.trim().replace(/:$/, '').toLowerCase()
}

function isLabel(line: string, label: string): boolean {
  return normLabel(line) === normLabel(label)
}

/** Unpack flat process lines (API / export) into editable template fields. */
export function unpackProcessFields(lines: string[] | null | undefined): ProcessFields {
  const src = (lines || []).map((l) => l ?? '')
  if (!src.length) return { ...DEFAULT_PROCESS_FIELDS }

  const idx = {
    pre: src.findIndex((l) => isLabel(l, PROCESS_LABELS.preInvestigation)),
    activity: src.findIndex((l) => isLabel(l, PROCESS_LABELS.investigationActivity)),
    obs: src.findIndex((l) => isLabel(l, PROCESS_LABELS.observations)),
    interviews: src.findIndex((l) => isLabel(l, PROCESS_LABELS.interviews)),
    docs: src.findIndex((l) => isLabel(l, PROCESS_LABELS.documentReview)),
  }

  const sliceBody = (startLabel: number, endLabel: number) => {
    if (startLabel < 0) return ''
    const from = startLabel + 1
    const to = endLabel >= 0 ? endLabel : src.length
    return src
      .slice(from, to)
      .filter((l) => {
        const n = normLabel(l)
        return (
          n &&
          n !== normLabel(PROCESS_LABELS.investigationActivity) &&
          n !== normLabel(PROCESS_LABELS.observations) &&
          n !== normLabel(PROCESS_LABELS.interviews) &&
          n !== normLabel(PROCESS_LABELS.documentReview) &&
          n !== normLabel(PROCESS_LABELS.preInvestigation)
        )
      })
      .join('\n')
      .trim()
  }

  // Structured shell present
  if (idx.pre >= 0 || idx.obs >= 0 || idx.interviews >= 0 || idx.docs >= 0) {
    const preEnd = idx.activity >= 0 ? idx.activity : idx.obs >= 0 ? idx.obs : src.length
    return {
      preInvestigation: sliceBody(idx.pre, preEnd) || DEFAULT_PROCESS_FIELDS.preInvestigation,
      observations: sliceBody(idx.obs, idx.interviews >= 0 ? idx.interviews : idx.docs) || DEFAULT_PROCESS_FIELDS.observations,
      interviews: sliceBody(idx.interviews, idx.docs) || DEFAULT_PROCESS_FIELDS.interviews,
      documentReview: sliceBody(idx.docs, -1) || DEFAULT_PROCESS_FIELDS.documentReview,
    }
  }

  // Legacy flat list — keep as pre-investigation body so content isn't lost
  return {
    ...DEFAULT_PROCESS_FIELDS,
    preInvestigation: src.join('\n').trim() || DEFAULT_PROCESS_FIELDS.preInvestigation,
  }
}

/** Pack template fields into export order matching the blank DOCX shell. */
export function packProcessFields(fields: ProcessFields): string[] {
  const split = (block: string) => {
    const lines = (block || '').split(/\r?\n/)
    return lines.length ? lines : ['']
  }
  return [
    PROCESS_LABELS.preInvestigation,
    ...split(fields.preInvestigation),
    PROCESS_LABELS.investigationActivity,
    PROCESS_LABELS.observations,
    ...split(fields.observations),
    PROCESS_LABELS.interviews,
    ...split(fields.interviews),
    PROCESS_LABELS.documentReview,
    ...split(fields.documentReview),
  ]
}

/** IR Guidance conclusion options (normalize desk-manual typo citied → cited). */
export const IR_CONCLUSION_OPTIONS = [
  'Substantiated with deficient practice or condition cited',
  'Substantiated with no current deficient practice or condition cited',
  'Not Substantiated',
  'Pending Investigation',
] as const

/** Selectable outcomes (empty = Choose an item.). */
export const FINDING_PHRASES = [
  'Substantiated with deficient practice or condition cited',
  'Substantiated with no current deficient practice or condition cited',
  'Not Substantiated',
] as const

export type FindingPhrase = (typeof IR_CONCLUSION_OPTIONS)[number] | ''

export function normalizeIrConclusion(result: string): FindingPhrase {
  const r = (result || '').trim()
  if ((IR_CONCLUSION_OPTIONS as readonly string[]).includes(r)) {
    return r as FindingPhrase
  }
  const low = r.toLowerCase()
  if (low.includes('no current deficient')) {
    return 'Substantiated with no current deficient practice or condition cited'
  }
  if (low.includes('deficient practice or condition cited')) {
    return 'Substantiated with deficient practice or condition cited'
  }
  if (
    low === 'not substantiated' ||
    low === 'unsubstantiated' ||
    low === 'in compliance'
  ) {
    return 'Not Substantiated'
  }
  if (
    low === 'substantiated' ||
    low === 'out of compliance' ||
    low === 'not in compliance'
  ) {
    return 'Substantiated with deficient practice or condition cited'
  }
  if (low === 'pending investigation' || low === 'pending') return 'Pending Investigation'
  return ''
}

/** @deprecated Use normalizeIrConclusion — kept for call sites. */
export function resultToFindingPhrase(result: string): FindingPhrase {
  return normalizeIrConclusion(result)
}

export function findingPhraseToResult(phrase: FindingPhrase): string {
  if (!phrase) return 'Pending Investigation'
  return phrase
}

export function conclusionDeficiencyCited(result: string): boolean {
  const o = normalizeIrConclusion(result).toLowerCase()
  return o.includes('deficient practice or condition cited') && !o.includes('no current')
}
