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
    .replace(/\u2014/g, ', ')
    .replace(/\u2013/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  // Forbidden legacy shortcut, never keep cite-only leftovers
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
  'improve',
  'keep',
  'make',
  'maintain',
  'manage',
  'meet',
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

const LEADING_ADVERBS = new Set([
  'continuously',
  'promptly',
  'immediately',
  'adequately',
  'annually',
  'periodically',
  'timely',
])

/** Repair PDF glyph swaps in subsection labels (@→g) and missing roman parens. */
export function sanitizeSubsectionLabel(label: string): string {
  let raw = (label || '').trim().replace(/@/g, 'g')
  if (!raw) return ''
  raw = raw.replace(/\)([ivxlcdmIVXLCDM]+)\)/g, ')($1)')
  const parts = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])
  if (!parts.length) return raw
  const cleaned: string[] = []
  for (const part of parts) {
    const token = part.replace(/\s+/g, '').replace(/[^A-Za-z0-9ivxlcdmIVXLCDM]/g, '')
    if (token) cleaned.push(`(${token})`)
  }
  return cleaned.join('') || raw
}

/** True when ``ancestor`` is a proper cite-prefix of ``descendant`` (e.g. (4)(g) ⊂ (4)(g)(iii)). */
export function subsectionLabelNests(ancestor: string, descendant: string): boolean {
  const a = sanitizeSubsectionLabel(ancestor)
  const d = sanitizeSubsectionLabel(descendant)
  return Boolean(a && d && d.startsWith(a) && d.length > a.length)
}

/**
 * Keep at most one cite per nested branch: selecting a leaf drops ancestors and
 * descendants so allegation duties do not repeat the same WAC prose.
 */
export function pruneNestedDutyCites(
  selectedCites: string[],
  toggledCite: string,
  citeToLabel: (cite: string) => string,
  adding: boolean,
): string[] {
  const toggledLabel = sanitizeSubsectionLabel(citeToLabel(toggledCite))
  if (!adding) {
    return selectedCites.filter((c) => c !== toggledCite)
  }
  const kept = selectedCites.filter((cite) => {
    if (cite === toggledCite) return false
    const label = sanitizeSubsectionLabel(citeToLabel(cite))
    if (!label || !toggledLabel) return true
    if (subsectionLabelNests(label, toggledLabel)) return false
    if (subsectionLabelNests(toggledLabel, label)) return false
    return true
  })
  kept.push(toggledCite)
  return kept
}

function finiteVerbToInfinitive(word: string): string | null {
  const lower = (word || '').replace(/[.,;:()[\]"']+/g, '').toLowerCase()
  if (!lower) return null
  const candidates = new Set<string>([lower])
  if (lower.endsWith('ies') && lower.length > 4) candidates.add(`${lower.slice(0, -3)}y`)
  if (lower.endsWith('es') && lower.length > 3) candidates.add(lower.slice(0, -2))
  if (lower.endsWith('s') && lower.length > 2) candidates.add(lower.slice(0, -1))
  for (const cand of candidates) {
    if (STATUTE_VERB_STARTERS.has(cand)) return cand
  }
  return null
}

/** Developing → develop so "failed to …" reads as a sentence; rest stays exact WAC text. */
export function gerundOpenerToInfinitive(phrase: string): string {
  const body = (phrase || '').replace(/\u00a0/g, ' ').trim()
  const m = body.match(/^([A-Za-z][A-Za-z-]*)ing\b(.*)$/)
  if (m) {
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
  const words = body.split(/\s+/)
  let verbIdx = 0
  if (words.length > 1 && LEADING_ADVERBS.has(words[0].toLowerCase().replace(/[.,;:()[\]"']+/g, ''))) {
    verbIdx = 1
  }
  const folded = finiteVerbToInfinitive(words[verbIdx] || '')
  if (folded) {
    words[verbIdx] = folded
    return words.join(' ')
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
  let cleanTitle = (title || '').trim()
  if (cleanTitle.length > 80) cleanTitle = `${cleanTitle.slice(0, 77).trimEnd()}…`
  const opener = `Potential violation of ${prefix} ${bare}, ${cleanTitle}`
  const ordered = [...duties].sort((a, b) => (a.label || '').localeCompare(b.label || ''))
  const parts: string[] = []
  for (const d of ordered) {
    // Exact duty_phrase from the store; fold only the leading gerund → infinitive
    // so "by having failed to …" matches backend compose_allegation_from_duties.
    let phrase = (d.duty_phrase || '').trim().replace(/[ ;:,.]+$/g, '')
    if (!phrase) continue
    phrase = gerundOpenerToInfinitive(phrase)
    if (phrase && !(phrase.length >= 2 && phrase[0] === phrase[0].toUpperCase() && phrase[1] === phrase[1].toUpperCase())) {
      phrase = phrase.charAt(0).toLowerCase() + phrase.slice(1)
    }
    const label = sanitizeSubsectionLabel(d.label || '').trim()
    const frag = `${label ? `${label} ` : ''}${phrase}`.trim()
    parts.push(parts.length ? `and ${frag}` : frag)
  }
  if (!parts.length) {
    return `${opener}, as applied to the reported concern in the complaint intake.`
  }
  return normalizeAllegationLine(`${opener}, by having failed to ${parts.join('; ')}.`)
}

import { cleanSummaryForDocument } from './summaryFindingsFormat'

/** Normalize allegation fields on an investigate/case report payload (in place). */
export function normalizeReportAllegations<T extends {
  allegations?: Array<{ allegation_text?: string }>
  comparisons?: Array<{ allegation_draft?: string }>
  conclusions?: Array<{ allegation_text?: string }>
  summary_of_findings?: string
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
  if (report.summary_of_findings != null) {
    report.summary_of_findings = cleanSummaryForDocument(report.summary_of_findings)
  }
  if (report.report_text) {
    report.report_text = cleanSummaryForDocument(
      report.report_text
        .replace(/["“”„]/g, '')
        .replace(/;\s*see also\b.*$/gim, '')
        .replace(/^A\s+potential\s+violation\b/gim, 'Potential violation'),
    )
  }
  return report
}
