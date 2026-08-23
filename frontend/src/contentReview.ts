import rules from '@data/content_review_rules.json'

export type RemovalSpan = { start: number; end: number; reason: string }

type RulePattern = { pattern: string; reason: string; flags?: string }

const REMOVAL_LITERALS: string[] = Array.isArray(rules.literals)
  ? rules.literals.filter((x): x is string => typeof x === 'string' && !!x.trim())
  : []

const FACILITY_PLACEHOLDERS: string[] = Array.isArray(rules.facility_placeholders)
  ? rules.facility_placeholders.filter((x): x is string => typeof x === 'string' && !!x.trim())
  : ['Washington State']

function compilePattern(row: RulePattern): { pattern: RegExp; reason: string } | null {
  const source = (row.pattern || '').trim()
  if (!source) return null
  // matchAll requires the global flag; keep i/m/s from the fixture and always add g.
  const flags = `${(row.flags || '').replace(/[^ims]/gi, '')}g`
  try {
    return { pattern: new RegExp(source, flags), reason: row.reason || 'assist_placeholder' }
  } catch {
    return null
  }
}

const REMOVAL_PATTERNS = (Array.isArray(rules.patterns) ? rules.patterns : [])
  .map((row) => compilePattern(row as RulePattern))
  .filter((row): row is { pattern: RegExp; reason: string } => !!row)

function mergeSpans(raw: RemovalSpan[]): RemovalSpan[] {
  if (!raw.length) return []
  const ordered = [...raw].sort((a, b) => a.start - b.start)
  const merged: RemovalSpan[] = [ordered[0]]
  for (const span of ordered.slice(1)) {
    const prev = merged[merged.length - 1]
    if (span.start <= prev.end) {
      prev.end = Math.max(prev.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged.filter((s) => s.end > s.start)
}

export function findRemovalSpans(text: string): RemovalSpan[] {
  const body = text || ''
  if (!body.trim()) return []
  const hits: RemovalSpan[] = []
  for (const literal of REMOVAL_LITERALS) {
    let start = 0
    while (true) {
      const idx = body.indexOf(literal, start)
      if (idx < 0) break
      hits.push({ start: idx, end: idx + literal.length, reason: 'assist_placeholder' })
      start = idx + Math.max(literal.length, 1)
    }
  }
  for (const { pattern, reason } of REMOVAL_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of body.matchAll(pattern)) {
      if (match.index == null) continue
      hits.push({ start: match.index, end: match.index + match[0].length, reason })
    }
  }
  if (FACILITY_PLACEHOLDERS.includes(body.trim())) {
    hits.push({ start: 0, end: body.trim().length, reason: 'facility_placeholder' })
  }
  return mergeSpans(hits)
}

export function buildHighlightSegments(
  text: string,
  spans: RemovalSpan[],
): { key: string; text: string; hit?: boolean; reason?: string }[] {
  if (!spans.length) return [{ key: 'all', text }]
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  const parts: { key: string; text: string; hit?: boolean; reason?: string }[] = []
  let cursor = 0
  ordered.forEach((span, i) => {
    if (span.start > cursor) {
      parts.push({ key: `t${i}`, text: text.slice(cursor, span.start) })
    }
    parts.push({
      key: `h${i}`,
      text: text.slice(span.start, span.end),
      hit: true,
      reason: span.reason,
    })
    cursor = span.end
  })
  if (cursor < text.length) parts.push({ key: 'tail', text: text.slice(cursor) })
  return parts
}

export function countRemovalSpans(text: string): number {
  return findRemovalSpans(text).length
}

export function isFacilityPlaceholder(value: string): boolean {
  return FACILITY_PLACEHOLDERS.includes((value || '').trim())
}

const COLLABORATOR_FOOTER =
  '[Human investigators complete evidentiary findings after interviews, observations, and document review.]'

/** Remove in-app collaborator notes from Summary of Findings (document body only). */
export function stripCollaboratorFromSummary(text: string | null | undefined): string {
  let body = (text || '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '').trim()
  if (!body) return ''
  // Hard cut at the marked header through the end of Summary (ignore dash / spacing variants).
  const marker = /Investigator\s+collaborator\s+notes\b/i
  const idx = body.search(marker)
  if (idx >= 0) {
    body = body.slice(0, idx).trim()
  } else {
    // Header missing: drop the Areas + Suggested methods collaborator pair if present.
    body = body
      .replace(
        /(?:^|\n)\s*Areas of concern:\s*\n(?:[ \t]*-.+\n)+\s*\nSuggested methods to begin or strengthen the investigation:\s*\n[\s\S]*$/i,
        '',
      )
      .trim()
  }
  body = body.split(COLLABORATOR_FOOTER).join('').trim()
  body = body
    .replace(/\nSuggested methods to begin or strengthen the investigation:\s*\n[\s\S]*$/i, '')
    .trim()
  return body.replace(/\n{3,}/g, '\n\n').trim()
}
