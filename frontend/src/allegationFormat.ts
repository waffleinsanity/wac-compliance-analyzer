/** Baseline IR allegation shape: no quotation marks; opener is "Potential violation…".
 *
 * Duty phrases must stay exact WAC wording from the PDF store (ceremonial
 * subject/modal strip happens server-side). Never truncate, paraphrase, or
 * invent "; see also (labels)" shortcuts.
 */

/** Baseline IR allegation shape: no quotation marks; opener is "Potential violation…". */
export function normalizeAllegationLine(text: string | null | undefined): string {
  let out = (text || '')
    .replace(/["“”„]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Forbidden legacy shortcut — never keep cite-only leftovers
  out = out.replace(/;\s*see also\b.*$/i, '').trim()
  out = out.replace(/\bsee also\b.*$/i, '').trim()
  out = out.replace(/^A\s+potential\s+violation\b/i, 'Potential violation')
  out = out.replace(/;{2,}/g, ';')
  out = out.replace(/:{2,}/g, ':')
  out = out.replace(/([;:])\s*\./g, '.')
  out = out.replace(/\.\s*;/g, '.')
  out = out.replace(/;\s*;/g, ';')
  out = out.replace(/\s+([;,.])/g, '$1')
  out = out.replace(/[ ;:]+$/g, '')
  if (out && !out.endsWith('.')) out += '.'
  out = out.replace(/\.{2,}$/g, '.')
  return out
}

export function allegationHasShortcut(text: string | null | undefined): boolean {
  return /\bsee also\b/i.test(text || '')
}

/** Statute verb stems used to fold leading gerunds after "failed to". */
const STATUTE_VERB_STARTERS = new Set([
  'adopt',
  'address',
  'adhere',
  'administer',
  'assess',
  'assign',
  'be',
  'conduct',
  'comply',
  'develop',
  'document',
  'ensure',
  'establish',
  'evaluate',
  'govern',
  'have',
  'implement',
  'keep',
  'make',
  'maintain',
  'manage',
  'monitor',
  'notify',
  'obtain',
  'orient',
  'prepare',
  'provide',
  'protect',
  'report',
  'review',
  'safeguard',
  'supervise',
  'train',
  'update',
  'use',
])

/** Developing → develop so "failed to …" reads as a sentence; rest stays exact WAC text. */
export function gerundOpenerToInfinitive(phrase: string): string {
  const body = (phrase || '').trim()
  const m = body.match(/^([A-Za-z][A-Za-z-]*)ing\b(.*)$/)
  if (!m) return body
  const stem = m[1].toLowerCase()
  const rest = m[2]
  const candidates = [stem, `${stem}e`]
  if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
    candidates.push(stem.slice(0, -1))
  }
  for (const cand of candidates) {
    if (STATUTE_VERB_STARTERS.has(cand)) return `${cand}${rest}`
  }
  return body
}

export type DutyPhraseInput = {
  label?: string
  duty_phrase: string
}

/** Compose Baseline allegation from selected duty options (client-side Compare rebuild). */
export function composeAllegationFromDuties(
  code: string,
  title: string,
  duties: DutyPhraseInput[],
): string {
  const bare = code.replace(/^WAC\s+/i, '').replace(/^RCW\s+/i, '').trim()
  const prefix = bare.startsWith('71.') ? 'RCW' : 'WAC'
  let cleanTitle = (title || '').replace(/[—–]/g, ' - ').trim()
  if (cleanTitle.length > 80) cleanTitle = `${cleanTitle.slice(0, 77).trimEnd()}…`
  const opener = `Potential violation of ${prefix} ${bare}, ${cleanTitle}`
  const parts: string[] = []
  for (const d of duties) {
    // Exact duty_phrase from the store; fold only the leading gerund → infinitive
    // so "by having failed to …" matches backend compose_allegation_from_duties.
    let phrase = (d.duty_phrase || '').trim().replace(/[ ;:,.]+$/g, '')
    if (!phrase) continue
    phrase = gerundOpenerToInfinitive(phrase)
    const label = (d.label || '').trim()
    const frag = `${label ? `${label} ` : ''}${phrase}`.trim()
    parts.push(parts.length ? `and ${frag}` : frag)
  }
  if (!parts.length) {
    return `${opener}, as applied to the reported concern in the complaint intake.`
  }
  return normalizeAllegationLine(`${opener}, by having failed to ${parts.join('; ')}.`)
}

/** Normalize allegation fields on an investigate/case report payload (in place). */
export function normalizeReportAllegations<T extends {
  allegations?: Array<{ allegation_text?: string }>
  comparisons?: Array<{ allegation_draft?: string }>
  conclusions?: Array<{ allegation_text?: string }>
  report_text?: string
}>(report: T): T {
  if (report.allegations) {
    for (const a of report.allegations) {
      if (a.allegation_text != null) a.allegation_text = normalizeAllegationLine(a.allegation_text)
    }
  }
  if (report.comparisons) {
    for (const c of report.comparisons) {
      if (c.allegation_draft != null) c.allegation_draft = normalizeAllegationLine(c.allegation_draft)
    }
  }
  if (report.conclusions) {
    for (const c of report.conclusions) {
      if (c.allegation_text != null) c.allegation_text = normalizeAllegationLine(c.allegation_text)
    }
  }
  if (report.report_text) {
    report.report_text = report.report_text
      .replace(/["“”„]/g, '')
      .replace(/;\s*see also\b.*$/gim, '')
      .replace(/^A\s+potential\s+violation\b/gim, 'Potential violation')
  }
  return report
}
