/** Baseline IR allegation shape: no quotation marks; opener is "Potential violation…". */
export function normalizeAllegationLine(text: string | null | undefined): string {
  let out = (text || '')
    .replace(/["“”„]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
      .replace(/^A\s+potential\s+violation\b/gim, 'Potential violation')
  }
  return report
}
