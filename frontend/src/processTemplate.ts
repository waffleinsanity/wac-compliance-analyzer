/** Fixed DOH Investigative Process shell, labels are template structure, not deletable rows. */

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
    // Preserve empty and whitespace-only lines as user content.
    // We only strip label lines, not blanks (otherwise a typed single space snaps back).
    return src
      .slice(from, to)
      .filter((l) => {
        const n = normLabel(l)
        return (
          n !== normLabel(PROCESS_LABELS.investigationActivity) &&
          n !== normLabel(PROCESS_LABELS.observations) &&
          n !== normLabel(PROCESS_LABELS.interviews) &&
          n !== normLabel(PROCESS_LABELS.documentReview) &&
          n !== normLabel(PROCESS_LABELS.preInvestigation)
        )
      })
      .join('\n')
  }

  // Structured shell present
  if (idx.pre >= 0 || idx.obs >= 0 || idx.interviews >= 0 || idx.docs >= 0) {
    const preEnd = idx.activity >= 0 ? idx.activity : idx.obs >= 0 ? idx.obs : src.length
    const preHasAnyBody = idx.pre >= 0 && preEnd > idx.pre + 1
    const obsEnd = idx.interviews >= 0 ? idx.interviews : idx.docs
    const obsHasAnyBody = idx.obs >= 0 && obsEnd > idx.obs + 1
    const intHasAnyBody = idx.interviews >= 0 && idx.docs > idx.interviews + 1
    const docsHasAnyBody = idx.docs >= 0 && src.length > idx.docs + 1
    return {
      // Only fall back to defaults when the labeled block is missing entirely.
      preInvestigation: preHasAnyBody ? sliceBody(idx.pre, preEnd) : DEFAULT_PROCESS_FIELDS.preInvestigation,
      observations: obsHasAnyBody
        ? sliceBody(idx.obs, idx.interviews >= 0 ? idx.interviews : idx.docs)
        : DEFAULT_PROCESS_FIELDS.observations,
      interviews: intHasAnyBody ? sliceBody(idx.interviews, idx.docs) : DEFAULT_PROCESS_FIELDS.interviews,
      documentReview: docsHasAnyBody ? sliceBody(idx.docs, -1) : DEFAULT_PROCESS_FIELDS.documentReview,
    }
  }

  // Legacy flat list, keep as pre-investigation body so content isn't lost
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

/** Blank DOCX conclusion choices (peer completed IRs use the same voice). */
export const IR_CONCLUSION_OPTIONS = ['not in compliance', 'in compliance'] as const

/** Selectable outcomes (empty = Choose an item.). */
export const FINDING_PHRASES = ['not in compliance', 'in compliance'] as const

export type FindingPhrase = (typeof FINDING_PHRASES)[number] | ''

export function normalizeIrConclusion(result: string): FindingPhrase {
  const r = (result || '').trim()
  const low = r.toLowerCase()
  if (low === 'in compliance' || low === 'not in compliance') {
    return low as FindingPhrase
  }
  if (
    low === '' ||
    low === 'pending' ||
    low === 'pending investigation' ||
    low === 'choose an item.'
  ) {
    return ''
  }
  // Legacy IR Guidance drafts → blank compliance voice.
  if (low.includes('no current deficient')) return 'in compliance'
  if (low.includes('deficient practice or condition cited')) return 'not in compliance'
  if (low === 'not substantiated' || low === 'unsubstantiated') return 'in compliance'
  if (low === 'substantiated' || low === 'out of compliance') return 'not in compliance'
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
  return normalizeIrConclusion(result) === 'not in compliance'
}

/** Peer/blank conclusion sentence (dropdown sits on the compliance phrase). */
export function formatConclusionSentence(
  wacCode: string,
  wacTitle: string,
  finding: FindingPhrase,
): { before: string; after: string } {
  const code = (wacCode || '').replace(/^WAC\s+/i, '').replace(/^RCW\s+/i, '').trim()
  const prefix = code.startsWith('71.') ? 'RCW' : 'WAC'
  const title = (wacTitle || '').trim()
  const titleBit = title ? ` ${title}` : ''
  return {
    before: 'Allegation: The investigator found the facility ',
    after: ` with ${prefix} ${code}${titleBit}.`,
  }
}
